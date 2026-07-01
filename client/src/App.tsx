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

// Eagerly import frequently-visited pages — no Suspense flash on navigation
import Home from "@/pages/Home";
import Missions from "@/pages/Missions";
import Leaderboard from "@/pages/Leaderboard";
import Affiliates from "@/pages/Affiliates";
import Withdraw from "@/pages/Withdraw";
import Landing from "@/pages/Landing";

// Lazy-load heavy/rare pages only
const Admin = lazy(() => import("@/pages/Admin"));
const CreateTask = lazy(() => import("@/pages/CreateTask"));
const CountryControls = lazy(() => import("@/pages/CountryControls"));
const NotFound = lazy(() => import("@/pages/not-found"));

declare global {
  interface Window {
    show_11123429: (type?: string) => Promise<void>;
    Adsgram: {
      init: (params: { blockId: string; debug?: boolean }) => { show: () => Promise<void>; destroy: () => void };
    };
  }
}

// 7 frames — user-provided images showing letter-by-letter reveal
const LOADER_FRAMES = [
  '/pa-frame1.jpg',
  '/pa-frame2.jpg',
  '/pa-frame3.jpg',
  '/pa-frame4.jpg',
  '/pa-frame5.jpg',
  '/pa-frame6.jpg',
  '/pa-frame7.jpg',
];
// How long each frame stays (ms) — last frame stays until app is ready
const FRAME_DURATIONS = [500, 350, 350, 350, 350, 350, 999999];

const PageLoader = memo(function PageLoader() {
  const [frame, setFrame] = useState(0);
  const [showDots, setShowDots] = useState(false);

  useEffect(() => {
    let current = 0;
    let timer: ReturnType<typeof setTimeout>;

    function advance() {
      current += 1;
      if (current < LOADER_FRAMES.length) {
        setFrame(current);
        if (current === LOADER_FRAMES.length - 1) {
          // Last frame reached — show bouncing dots
          setTimeout(() => setShowDots(true), 200);
        } else {
          timer = setTimeout(advance, FRAME_DURATIONS[current]);
        }
      }
    }

    timer = setTimeout(advance, FRAME_DURATIONS[0]);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
    }}>
      <style>{`
        @keyframes dotBounce {
          0%,80%,100%{ transform:translateY(0); opacity:0.3; }
          40%        { transform:translateY(-8px); opacity:1; }
        }
        @keyframes dotsIn {
          from{ opacity:0; }
          to  { opacity:1; }
        }
      `}</style>

      {/* All frames stacked — only the active one is visible, NO remount = NO blink */}
      {LOADER_FRAMES.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'contain',
            opacity: i === frame ? 1 : 0,
            transition: i === frame ? 'none' : 'none',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Bouncing dots — appear on last frame */}
      {showDots && (
        <div style={{
          position: 'absolute', bottom: 60, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 9,
          animation: 'dotsIn 0.3s ease both',
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%', background: '#fff',
              animation: `dotBounce 1.1s ${i * 0.18}s ease-in-out infinite`,
              opacity: 0.3,
            }} />
          ))}
        </div>
      )}
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
  // Minimum 2.6s so the full letter animation is always visible
  const [minDisplayDone, setMinDisplayDone] = useState(false);

  const isDevMode = import.meta.env.DEV || import.meta.env.MODE === 'development';

  useEffect(() => {
    const t = setTimeout(() => setMinDisplayDone(true), 2600);
    return () => clearTimeout(t);
  }, []);

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
    // Don't wait for country check — run auth immediately in parallel
    if (isCountryBlocked) {
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
  }, [isDevMode, isCountryBlocked, checkMembership]);

  if (isBanned) {
    return <BanScreen reason={banReason} />;
  }

  if (!minDisplayDone || isAuthenticating || isCheckingMembership) {
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

  // Detect if running inside Telegram Mini App
  const isTelegramEnv = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp?.initData;

  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      actionsConfiguration={{
        // In Telegram Mini App, tell TonKeeper to return via tgback (Telegram deep link)
        returnStrategy: isTelegramEnv ? 'tgback' : 'back',
        twaReturnUrl: 'back' as any,
      }}
      uiPreferences={{
        theme: 'DARK',
      }}
    >
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
