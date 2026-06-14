import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import AppNotification from "@/components/AppNotification";
import { useEffect, lazy, Suspense, useState, memo, useCallback, useRef } from "react";
import { setupDeviceTracking } from "@/lib/deviceId";
import BanScreen from "@/components/BanScreen";
import CountryBlockedScreen from "@/components/CountryBlockedScreen";
import SeasonEndOverlay from "@/components/SeasonEndOverlay";
import { SeasonEndContext } from "@/lib/SeasonEndContext";
import { useAdmin } from "@/hooks/useAdmin";
import ChannelJoinPopup from "@/components/ChannelJoinPopup";
import { LanguageProvider } from "@/hooks/useLanguage";

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    Adsgram: {
      init: (params: { blockId: string; debug?: boolean }) => { show: () => Promise<void>; destroy: () => void };
    };
  }
}

const Home = lazy(() => import("@/pages/Home"));
const Landing = lazy(() => import("@/pages/Landing"));
const Admin = lazy(() => import("@/pages/Admin"));
const Affiliates = lazy(() => import("@/pages/Affiliates"));
const CreateTask = lazy(() => import("@/pages/CreateTask"));
const Withdraw = lazy(() => import("@/pages/Withdraw"));
const CountryControls = lazy(() => import("@/pages/CountryControls"));
const Missions = lazy(() => import("@/pages/Missions"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const NotFound = lazy(() => import("@/pages/not-found"));

const PageLoader = memo(function PageLoader() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#000', padding: '0 24px' }}>
      <style>{`
        @keyframes powFadeIn { 0%{opacity:0;transform:scale(0.8) translateY(12px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes textSlideUp { 0%{opacity:0;transform:translateY(16px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes barFill { 0%{width:0%} 100%{width:85%} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes ringPulse { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.8;transform:scale(1.05)} }
      `}</style>

      <div style={{ animation: 'powFadeIn 0.55s cubic-bezier(0.34,1.56,0.64,1) both', marginBottom: 28 }}>
        <div style={{ position: 'relative', width: 110, height: 110 }}>
          <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,123,255,0.4) 0%, transparent 70%)', animation: 'ringPulse 2s ease-in-out infinite' }} />
          <div style={{ width: 110, height: 110, borderRadius: '50%', background: 'linear-gradient(135deg, #111 0%, #1a1a1a 100%)', border: '2px solid rgba(0,123,255,0.5)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 30px rgba(0,123,255,0.2)' }}>
            <img
              src="/pow-icon.png"
              alt="POW"
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
            />
          </div>
        </div>
      </div>

      <div style={{ animation: 'textSlideUp 0.5s 0.2s ease both', textAlign: 'center', marginBottom: 10 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', margin: 0, lineHeight: 1 }}>
          Paid Adz
        </h1>
      </div>

      <div style={{ animation: 'textSlideUp 0.5s 0.35s ease both', textAlign: 'center', marginBottom: 48 }}>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>
          Watch Ads · Earn POW
        </p>
      </div>

      <div style={{ animation: 'textSlideUp 0.5s 0.45s ease both', width: '100%', maxWidth: 200 }}>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #007BFF, #60a5fa)', animation: 'barFill 2.2s 0.5s ease-in-out both' }} />
        </div>
      </div>
    </div>
  );
});

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/task/create" component={CreateTask} />
        <Route path="/create-task" component={CreateTask} />
        <Route path="/affiliates" component={Affiliates} />
        <Route path="/withdraw" component={Withdraw} />
        <Route path="/profile" component={Landing} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/country-controls" component={CountryControls} />
        <Route path="/missions" component={Missions} />
        <Route path="/leaderboard" component={Leaderboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AppContent() {
  const [showSeasonEnd, setShowSeasonEnd] = useState(false);
  const [seasonLockActive, setSeasonLockActive] = useState(false);
  const { isAdmin } = useAdmin();
  const adsgramOpenShown = useRef(false);

  const isDevMode = import.meta.env.DEV || import.meta.env.MODE === 'development';

  // Show AdsGram interstitial popup ONCE when app opens (blockId int-34709)
  useEffect(() => {
    if (isDevMode) return;
    if (adsgramOpenShown.current) return;
    adsgramOpenShown.current = true;

    const t = setTimeout(() => {
      if (window.Adsgram) {
        window.Adsgram.init({ blockId: "int-34709" }).show().catch(() => {});
      }
    }, 3000);

    return () => clearTimeout(t);
  }, [isDevMode]);

  useEffect(() => {
    const checkSeasonStatus = () => {
      fetch("/api/app-settings")
        .then(res => res.json())
        .then(settings => {
          if (settings.seasonBroadcastActive) {
            setSeasonLockActive(true);
            setShowSeasonEnd(true);
          } else {
            setSeasonLockActive(false);
            localStorage.removeItem("season_end_seen");
          }
        })
        .catch(() => {});
    };

    checkSeasonStatus();
    const interval = setInterval(checkSeasonStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCloseSeasonEnd = () => {
    if (!seasonLockActive) {
      localStorage.setItem("season_end_seen", "true");
      setShowSeasonEnd(false);
    }
  };

  const shouldShowSeasonEnd = showSeasonEnd && !isAdmin;

  return (
    <SeasonEndContext.Provider value={{ showSeasonEnd: shouldShowSeasonEnd }}>
      <AppNotification />
      {shouldShowSeasonEnd && <SeasonEndOverlay onClose={handleCloseSeasonEnd} isLocked={seasonLockActive} />}
      <Router />
    </SeasonEndContext.Provider>
  );
}

function App() {
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string>();
  const [isCountryBlocked, setIsCountryBlocked] = useState(false);
  const [userCountryCode, setUserCountryCode] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [isCheckingCountry, setIsCheckingCountry] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [isChannelVerified, setIsChannelVerified] = useState<boolean | null>(null);
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);
  
  const isDevMode = import.meta.env.DEV || import.meta.env.MODE === 'development';

  const checkCountry = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) {
        headers['x-telegram-data'] = tg.initData;
      }
      
      const cachedUser = localStorage.getItem("tg_user");
      if (cachedUser) {
        try {
          const user = JSON.parse(cachedUser);
          headers['x-user-id'] = user.id.toString();
        } catch {}
      }
      
      const response = await fetch('/api/check-country', { 
        cache: 'no-store',
        headers
      });
      const data = await response.json();
      
      if (data.country) {
        setUserCountryCode(data.country.toUpperCase());
      }
      
      if (data.blocked) {
        setIsCountryBlocked(true);
      } else {
        setIsCountryBlocked(false);
      }
    } catch (err) {
      console.error("Country check error:", err);
    } finally {
      setIsCheckingCountry(false);
    }
  }, []);

  useEffect(() => {
    checkCountry();
  }, [checkCountry]);

  useEffect(() => {
    const handleCountryBlockChange = (event: CustomEvent) => {
      const { action, countryCode } = event.detail;
      
      if (userCountryCode && countryCode === userCountryCode) {
        if (action === 'blocked') {
          setIsCountryBlocked(true);
        } else if (action === 'unblocked') {
          setIsCountryBlocked(false);
        }
      }
    };
    
    window.addEventListener('countryBlockChanged', handleCountryBlockChange as EventListener);
    
    return () => {
      window.removeEventListener('countryBlockChanged', handleCountryBlockChange as EventListener);
    };
  }, [userCountryCode]);

  // Check membership after auth completes
  const checkMembership = useCallback(async (userTelegramId: string) => {
    if (isDevMode) {
      setIsChannelVerified(true);
      return;
    }

    setIsCheckingMembership(true);
    try {
      const headers: Record<string, string> = {};
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) {
        headers['x-telegram-data'] = tg.initData;
      }

      const response = await fetch('/api/check-membership', {
        cache: 'no-store',
        headers,
      });
      const data = await response.json();

      if (data.banned) {
        setIsBanned(true);
        setBanReason(data.reason);
        setIsChannelVerified(true); // Don't block banned users on join screen
        return;
      }

      setIsChannelVerified(data.isVerified === true);
    } catch (err) {
      // Fail open on network error
      console.error("Membership check error:", err);
      setIsChannelVerified(true);
    } finally {
      setIsCheckingMembership(false);
    }
  }, [isDevMode]);

  useEffect(() => {
    if (isCheckingCountry || isCountryBlocked) {
      return;
    }

    if (isDevMode) {
      console.log('Development mode: Skipping Telegram authentication');
      setTelegramId('dev-user-123');
      setIsChannelVerified(true);
      setIsAuthenticating(false);
      return;
    }
    
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      
      if (tg.initDataUnsafe?.user) {
        localStorage.setItem("tg_user", JSON.stringify(tg.initDataUnsafe.user));
        setTelegramId(tg.initDataUnsafe.user.id.toString());
      }
      
      if (tg.initDataUnsafe?.start_param) {
        localStorage.setItem("tg_start_param", tg.initDataUnsafe.start_param);
      }
      
      const { deviceId, fingerprint } = setupDeviceTracking();
      
      const headers: Record<string, string> = { 
        "Content-Type": "application/json",
        "x-device-id": deviceId,
        "x-device-fingerprint": JSON.stringify(fingerprint)
      };
      let body: any = {};
      let userTelegramId: string | null = null;
      
      const startParam = tg.initDataUnsafe?.start_param || localStorage.getItem("tg_start_param");
      
      if (tg.initData) {
        body = { initData: tg.initData };
        if (startParam) {
          body.startParam = startParam;
        }
        if (tg.initDataUnsafe?.user?.id) {
          userTelegramId = tg.initDataUnsafe.user.id.toString();
        }
      } else {
        const cachedUser = localStorage.getItem("tg_user");
        if (cachedUser) {
          try {
            const user = JSON.parse(cachedUser);
            headers["x-user-id"] = user.id.toString();
            userTelegramId = user.id.toString();
            if (startParam) {
              body.startParam = startParam;
            }
          } catch {}
        }
      }
      
      fetch("/api/auth/telegram", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
        .then(res => res.json())
        .then(data => {
          if (data.referralProcessed) {
            localStorage.removeItem("tg_start_param");
          }
          if (data.banned) {
            setIsBanned(true);
            setBanReason(data.reason);
            setIsAuthenticating(false);
            setIsChannelVerified(true);
          } else if (userTelegramId) {
            setTelegramId(userTelegramId);
            setIsAuthenticating(false);
            // Now check membership
            checkMembership(userTelegramId);
          } else {
            setIsAuthenticating(false);
            setIsChannelVerified(true);
          }
        })
        .catch(() => {
          setIsAuthenticating(false);
          setIsChannelVerified(true);
        });
    } else {
      setIsAuthenticating(false);
      setIsChannelVerified(true);
    }
  }, [isDevMode, isCheckingCountry, isCountryBlocked, checkMembership]);

  if (isBanned) {
    return <BanScreen reason={banReason} />;
  }

  if (isCheckingCountry || isAuthenticating || isCheckingMembership) {
    return <PageLoader />;
  }

  if (isCountryBlocked) {
    return <CountryBlockedScreen />;
  }

  if (!telegramId && !isDevMode) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-8 rounded-full border-2 border-white/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white mb-4 tracking-tight">Open in Telegram</h1>
          <p className="text-white/60 text-base leading-relaxed">
            Please open this app from Telegram to continue.
          </p>
        </div>
      </div>
    );
  }

  const manifestUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/tonconnect-manifest.json`
    : 'https://paidadz.xyz/tonconnect-manifest.json';

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <TooltipProvider>
            {isChannelVerified === false && telegramId && !isDevMode ? (
              <ChannelJoinPopup
                telegramId={telegramId}
                onVerified={() => setIsChannelVerified(true)}
              />
            ) : (
              <AppContent />
            )}
          </TooltipProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </TonConnectUIProvider>
  );
}

export default App;
