import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { setupDeviceTracking } from "../lib/deviceId";

// Storage keys - CRITICAL: These must never be cleared automatically
const AUTH_CACHE_KEY = 'cashwatch_user_cache';
const AUTH_TIMESTAMP_KEY = 'cashwatch_auth_timestamp';
const PERSISTENT_USER_KEY = 'cashwatch_persistent_user';
const USER_EARNINGS_KEY = 'cashwatch_user_earnings';
const USER_SESSION_KEY = 'cashwatch_session_active';

// IndexedDB configuration - Primary storage for maximum persistence
const IDB_NAME = 'CashWatchDB';
const IDB_VERSION = 1;
const IDB_STORE = 'userData';

// IndexedDB wrapper for persistent storage that survives storage pressure, private browsing, etc.
class PersistentStorage {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private isInitialized = false;

  async init(): Promise<boolean> {
    if (this.isInitialized && this.db) return true;
    
    if (this.dbPromise) {
      await this.dbPromise;
      return !!this.db;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          console.warn('📦 IndexedDB not available, using localStorage only');
          resolve(null);
          return;
        }

        const request = indexedDB.open(IDB_NAME, IDB_VERSION);

        request.onerror = () => {
          console.warn('📦 IndexedDB failed to open, using localStorage fallback');
          resolve(null);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.isInitialized = true;
          console.log('📦 IndexedDB initialized successfully');
          resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            console.log('📦 IndexedDB store created');
          }
        };

        // Timeout fallback
        setTimeout(() => {
          if (!this.db) {
            console.warn('📦 IndexedDB timeout, using localStorage');
            resolve(null);
          }
        }, 3000);
      } catch (error) {
        console.warn('📦 IndexedDB error:', error);
        resolve(null);
      }
    });

    await this.dbPromise;
    return !!this.db;
  }

  async set(key: string, value: any): Promise<void> {
    const timestamp = new Date().toISOString();
    const dataWithMeta = { key, value, updatedAt: timestamp };

    // Always save to localStorage first (synchronous, reliable)
    try {
      localStorage.setItem(key, JSON.stringify({ value, updatedAt: timestamp }));
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }

    // Then save to IndexedDB (async, more persistent)
    if (this.db) {
      try {
        const tx = this.db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put(dataWithMeta);
        
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (error) {
        console.warn('IndexedDB write failed (localStorage backup used):', error);
      }
    }
  }

  async get(key: string): Promise<any | null> {
    let idbData: any = null;
    let lsData: any = null;

    // Try IndexedDB first (more persistent)
    if (this.db) {
      try {
        const tx = this.db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const request = store.get(key);

        idbData = await new Promise<any>((resolve) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
      } catch (error) {
        console.warn('IndexedDB read failed:', error);
      }
    }

    // Also read from localStorage
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        lsData = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('localStorage read failed:', e);
    }

    // Return the most recent data
    const idbTime = idbData?.updatedAt ? new Date(idbData.updatedAt).getTime() : 0;
    const lsTime = lsData?.updatedAt ? new Date(lsData.updatedAt).getTime() : 0;

    if (idbTime >= lsTime && idbData?.value) {
      return idbData.value;
    } else if (lsData?.value) {
      return lsData.value;
    }

    return null;
  }
}

// Global persistent storage instance
const persistentStorage = new PersistentStorage();

// Initialize storage on load
if (typeof window !== 'undefined') {
  persistentStorage.init().catch(console.warn);
}

// Function to get Telegram WebApp initData
const getTelegramInitData = (): string | null => {
  if (typeof window !== 'undefined') {
    if (window.Telegram?.WebApp?.initData) {
      console.log('✅ Telegram WebApp initData found:', window.Telegram.WebApp.initData.substring(0, 30) + '...');
      return window.Telegram.WebApp.initData;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const tgData = urlParams.get('tgData');
    if (tgData) {
      console.log('✅ Found Telegram data from URL params');
      return tgData;
    }
    
    console.log('⚠️ Telegram WebApp not available or no initData');
  }
  return null;
};

// CRITICAL: Get user data from IndexedDB with localStorage fallback (synchronous for initial load)
const getPersistentUserData = (): any | null => {
  try {
    // For initial synchronous load, use localStorage
    const persistent = localStorage.getItem(PERSISTENT_USER_KEY);
    if (persistent) {
      const parsed = JSON.parse(persistent);
      const data = parsed.value || parsed;
      if (data && data.id) {
        return data;
      }
    }
    
    const cached = localStorage.getItem(AUTH_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      const data = parsed.value || parsed;
      if (data && data.id) {
        return data;
      }
    }
  } catch (error) {
    console.warn('Failed to get persistent user data:', error);
  }
  return null;
};

// CRITICAL: Async version that checks IndexedDB first
const getPersistentUserDataAsync = async (): Promise<any | null> => {
  await persistentStorage.init();
  
  // Try IndexedDB first
  const idbData = await persistentStorage.get(PERSISTENT_USER_KEY);
  if (idbData && idbData.id) {
    return idbData;
  }

  // Fall back to localStorage
  return getPersistentUserData();
};

// CRITICAL: Save user data to IndexedDB + localStorage for redundancy
const savePersistentUserData = async (userData: any): Promise<void> => {
  if (!userData || !userData.id) return;
  
  const timestamp = new Date().toISOString();
  
  // Initialize storage if needed
  await persistentStorage.init();
  
  // Save to IndexedDB + localStorage
  await persistentStorage.set(PERSISTENT_USER_KEY, userData);
  await persistentStorage.set(AUTH_CACHE_KEY, userData);
  
  // Also save raw to localStorage for synchronous access
  try {
    localStorage.setItem(AUTH_TIMESTAMP_KEY, timestamp);
    localStorage.setItem(USER_SESSION_KEY, 'active');
    
    // Store critical earnings data separately (extra protection)
    if (userData.balance !== undefined || userData.usdBalance !== undefined || userData.totalEarned !== undefined) {
      const earningsData = {
        balance: userData.balance,
        usdBalance: userData.usdBalance,
        totalEarned: userData.totalEarned,
        adsWatched: userData.adsWatched,
        friendsInvited: userData.friendsInvited,
        savedAt: timestamp
      };
      await persistentStorage.set(USER_EARNINGS_KEY, earningsData);
    }
  } catch (error) {
    console.warn('Failed to save auxiliary user data:', error);
  }
};

// Synchronous version for compatibility
const savePersistentUserDataSync = (userData: any): void => {
  if (!userData || !userData.id) return;
  
  try {
    const timestamp = new Date().toISOString();
    const dataToStore = JSON.stringify({ value: userData, updatedAt: timestamp });
    
    localStorage.setItem(PERSISTENT_USER_KEY, dataToStore);
    localStorage.setItem(AUTH_CACHE_KEY, dataToStore);
    localStorage.setItem(AUTH_TIMESTAMP_KEY, timestamp);
    localStorage.setItem(USER_SESSION_KEY, 'active');
    
    // Also trigger async save to IndexedDB
    savePersistentUserData(userData).catch(console.warn);
  } catch (error) {
    console.warn('Failed to save persistent user data:', error);
  }
};

// Get cached user data (synchronous for initial render)
const getCachedUserData = () => {
  return getPersistentUserData();
};

// Save user data - triggers both sync and async saves
const cacheUserData = (userData: any) => {
  savePersistentUserDataSync(userData);
};

// Check if user was recently authenticated (within last 7 days for longer persistence)
const wasRecentlyAuthenticated = (): boolean => {
  try {
    const timestamp = localStorage.getItem(AUTH_TIMESTAMP_KEY);
    if (!timestamp) return false;
    
    const lastAuth = new Date(timestamp);
    const now = new Date();
    const hoursSinceAuth = (now.getTime() - lastAuth.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceAuth < 168; // 7 days for longer session persistence
  } catch (error) {
    return false;
  }
};

// Function to authenticate with Telegram
const authenticateWithTelegram = async (initData: string) => {
  console.log('📨 Telegram initData received:', initData?.slice(0, 30) + '...');
  
  // Get device tracking information
  const { deviceId, fingerprint } = setupDeviceTracking();

  // Always pass startParam so referral codes are saved on every auth attempt
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
  const startParam = tg?.initDataUnsafe?.start_param ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('tg_start_param') : null) ||
    undefined;

  const body: Record<string, unknown> = { initData };
  if (startParam) {
    body.startParam = startParam;
    console.log('🔗 Including startParam in auth:', startParam);
  }
  
  const response = await fetch('/api/auth/telegram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': deviceId,
      'x-device-fingerprint': JSON.stringify(fingerprint),
    },
    body: JSON.stringify(body),
  });
  
  console.log(`📡 Auth response status: ${response.status}`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    
    // Check if user was banned for multiple accounts
    if (errorData.banned) {
      console.error('❌ Account banned:', errorData.reason);
      throw new Error(errorData.message || 'Account banned for multi-account violation');
    }
    
    throw new Error('Telegram authentication failed');
  }
  
  const data = await response.json();
  console.log('✅ Authentication successful for user:', data.id);
  return data;
};

export function useAuth() {
  const queryClient = useQueryClient();
  const hasAttemptedAuth = useRef(false);
  const lastSyncRef = useRef<number>(0);
  
  // Try to use cached data first for instant loading
  const cachedData = getCachedUserData();
  
  const { data: user, isLoading, isFetched, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: 3, // Retry up to 3 times for network issues
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    // Use cached data as placeholder for instant rendering
    // initialDataUpdatedAt: 0 tells React Query the cached data is immediately stale
    // so it ALWAYS refetches from server on mount — fixing the Home/Withdraw balance mismatch
    initialData: cachedData,
    initialDataUpdatedAt: 0,
    // CRITICAL FIX: Always refetch from database on mount to ensure fresh data
    refetchOnMount: true,
    // Refetch on window focus to keep data in sync
    refetchOnWindowFocus: true,
    // Refetch every 30 seconds to prevent stale data
    refetchInterval: 30000,
    // Keep data fresh
    staleTime: 10000,
    // Keep cache for longer
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  // CRITICAL: Update localStorage cache when data changes from server
  // Also sync on regular intervals to prevent data loss
  useEffect(() => {
    if (user && user.id) {
      const now = Date.now();
      // Only sync if at least 5 seconds have passed since last sync
      if (now - lastSyncRef.current > 5000) {
        lastSyncRef.current = now;
        savePersistentUserData(user);
        console.log('✅ User data synced to persistent storage');
      }
    }
  }, [user]);

  // Sync data before page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (user && user.id) {
        // CRITICAL: Use synchronous save for beforeunload (async won't complete)
        savePersistentUserDataSync(user);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && user && user.id) {
        // Use sync save when page goes hidden (user switching apps)
        savePersistentUserDataSync(user);
        // Also trigger async save to IndexedDB in background
        savePersistentUserData(user).catch(console.warn);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);

  const telegramAuthMutation = useMutation({
    mutationFn: authenticateWithTelegram,
    onSuccess: (userData) => {
      console.log('✅ User authenticated successfully:', userData.username || userData.id);
      // Update the user query cache with the authenticated user
      queryClient.setQueryData(["/api/auth/user"], userData);
      // Cache user data for offline/quick loading
      cacheUserData(userData);
      // If referral was processed, remove the stored startParam so it isn't re-sent
      if (userData.referralProcessed) {
        localStorage.removeItem('tg_start_param');
      }
    },
    onError: (error) => {
      console.error('❌ Authentication error:', error);
      // Don't block the app - user is already in Telegram WebApp
    },
  });

  // One-time authentication on first app load
  useEffect(() => {
    // Skip if already attempted authentication
    if (hasAttemptedAuth.current) {
      return;
    }
    
    // Initialize Telegram WebApp
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      console.log('🚀 Telegram WebApp initialized');
    }
    
    // Attempt authentication once
    const initData = getTelegramInitData();
    if (initData) {
      console.log('🔐 Performing one-time Telegram authentication...');
      hasAttemptedAuth.current = true;
      
      // Don't await - let it run in background
      telegramAuthMutation.mutate(initData);
    } else {
      console.log('ℹ️ No Telegram initData - will use backend session if available');
      hasAttemptedAuth.current = true;
    }
  }, []); // Run once on mount

  const authenticateWithTelegramWebApp = () => {
    const initData = getTelegramInitData();
    if (initData) {
      telegramAuthMutation.mutate(initData);
    } else {
      console.error('Telegram WebApp initData not available');
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    authenticateWithTelegramWebApp,
    isTelegramAuthenticating: telegramAuthMutation.isPending,
    telegramAuthError: telegramAuthMutation.error,
  };
}
