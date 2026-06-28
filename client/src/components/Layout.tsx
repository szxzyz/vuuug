import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAdmin } from "@/hooks/useAdmin";
import { motion, AnimatePresence } from "framer-motion";
import { HeartHandshake, User, ListTodo, Trophy, ShieldCheck, Home } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Header";
import { useSeasonEnd } from "@/lib/SeasonEndContext";
import BanScreen from "@/components/BanScreen";
import { useRef, useCallback, useState } from "react";
import { useLanguage } from "@/hooks/useLanguage";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location, navigate] = useLocation();
  const { isConnected } = useWebSocket();
  const { isAdmin } = useAdmin();
  const { showSeasonEnd } = useSeasonEnd();
  const { t } = useLanguage();

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const [photoError, setPhotoError] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHomeButtonClick = useCallback(() => {
    if (!isAdmin) {
      navigate("/");
      return;
    }

    clickCountRef.current += 1;

    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }

    if (clickCountRef.current >= 2) {
      clickCountRef.current = 0;
      if (location === "/admin") {
        navigate("/");
      } else {
        navigate("/admin");
      }
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      if (clickCountRef.current === 1) {
        navigate("/");
      }
      clickCountRef.current = 0;
    }, 400);
  }, [isAdmin, location, navigate]);

  if (user?.banned) {
    return <BanScreen reason={user.bannedReason} />;
  }

  const navItems = [
    { href: "/leaderboard", icon: Trophy, labelKey: "rank" },
    { href: "/affiliates", icon: HeartHandshake, labelKey: "invite" },
    { href: "/missions", icon: ListTodo, labelKey: "mission" },
  ];

  const telegramPhotoUrl = typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const userPhotoUrl = telegramPhotoUrl || user?.profileImageUrl || user?.profileUrl || null;
  const isHomeActive = location === "/";
  const isAdminActive = location === "/admin" || location.startsWith("/admin");

  const isAdminNavMode = isAdmin && isAdminActive;

  return (
    <div className="h-screen w-full flex flex-col bg-black overflow-hidden">
      {!showSeasonEnd && <Header />}
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: '88px', paddingTop: '64px' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ 
              duration: 0.1,
              ease: "easeOut"
            }}
            className="min-h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {!showSeasonEnd && (
        <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-auto h-16 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl">
          <div className="flex justify-center items-center h-full px-7 gap-8">

            <button
              onClick={handleHomeButtonClick}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${
                isAdminNavMode
                  ? "text-yellow-400 scale-105"
                  : isHomeActive
                    ? "text-white scale-105"
                    : "text-[#6E6E73] hover:text-white/80"
              }`}
            >
              {isAdminNavMode ? (
                <ShieldCheck className="w-8 h-8 transition-all" strokeWidth={2.5} />
              ) : (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all relative ${
                  isHomeActive ? "ring-2 ring-white" : "ring-1 ring-white/20"
                } bg-[#2a2a2a]`}>
                  {/* Fallback icon — always visible unless photo loaded */}
                  {(!photoLoaded || photoError) && (
                    <User className="w-5 h-5 text-[#6E6E73]" />
                  )}
                  {/* Photo — hidden until fully loaded */}
                  {userPhotoUrl && !photoError && (
                    <img
                      src={userPhotoUrl}
                      alt="Profile"
                      onLoad={() => setPhotoLoaded(true)}
                      onError={() => { setPhotoError(true); setPhotoLoaded(false); }}
                      className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-200 ${
                        photoLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  )}
                </div>
              )}
            </button>

            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              
              return (
                <Link key={item.href} href={item.href}>
                  <button
                    className={`flex flex-col items-center justify-center transition-all duration-300 ${
                      isActive 
                        ? "text-white scale-105" 
                        : "text-[#6E6E73] hover:text-white/80"
                    }`}
                  >
                    <Icon 
                      className="w-8 h-8 transition-all"
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  </button>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
