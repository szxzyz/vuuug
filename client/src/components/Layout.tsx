import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAdmin } from "@/hooks/useAdmin";
import { motion, AnimatePresence } from "framer-motion";
import {
  HeartHandshake,
  ListTodo,
  ShieldCheck,
  Trophy,
  Star,
  Home as HomeIcon,
  Radio,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Header";
import { useSeasonEnd } from "@/lib/SeasonEndContext";
import BanScreen from "@/components/BanScreen";
import CreatePanel from "@/components/CreatePanel";
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
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const [photoError, setPhotoError] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adminFlash, setAdminFlash] = useState(false);

  const handleHomeClick = useCallback(() => {
    if (!isAdmin) {
      navigate("/");
      return;
    }

    clickCountRef.current += 1;

    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);

    if (clickCountRef.current >= 2) {
      clickCountRef.current = 0;
      setAdminFlash(true);
      setTimeout(() => setAdminFlash(false), 600);
      navigate(location === "/admin" ? "/" : "/admin");
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      if (clickCountRef.current === 1) navigate("/");
      clickCountRef.current = 0;
    }, 400);
  }, [isAdmin, location, navigate]);

  if (user?.banned) {
    return <BanScreen reason={user.bannedReason} />;
  }

  const navItems = [
    { href: "/leaderboard", icon: Trophy, label: "Contest" },
    { href: "/missions", icon: ListTodo, label: "Mission" },
    { href: "/affiliates", icon: HeartHandshake, label: "Invite" },
    { href: "/ambassador", icon: Star, label: "Ambassador" },
  ];

  const telegramPhotoUrl =
    typeof window !== "undefined" &&
    (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const userPhotoUrl =
    telegramPhotoUrl || user?.profileImageUrl || user?.profileUrl || null;

  const isHomeActive = location === "/";

  const handlePlusClick = () => {
    setPanelOpen((prev) => !prev);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-black overflow-hidden">
      {/* Floating header — visible only on Home page (language button) */}
      {isHomeActive && <Header />}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ paddingBottom: "84px", paddingTop: "0px" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{
              duration: 0.22,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className="min-h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {!showSeasonEnd && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-[#101012] border-t border-white/10"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <nav className="flex items-stretch justify-around w-full h-16">

            {/* Home — avatar/photo logic untouched, just restyled to match the row */}
            <button
              onClick={handleHomeClick}
              className="flex-1 flex flex-col items-center justify-center gap-1"
              aria-label="Home"
            >
              <div className="relative w-6 h-6 rounded-full flex items-center justify-center">
                {/* Admin flash overlay */}
                <AnimatePresence>
                  {adminFlash && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.3 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="absolute inset-0 -m-1 rounded-full flex items-center justify-center z-10 bg-[#1C1C1E]"
                    >
                      <ShieldCheck className="w-4 h-4" style={{ color: "#ffffff", strokeWidth: 2 }} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {(!photoLoaded || photoError) && !adminFlash && (
                  <HomeIcon
                    className="w-6 h-6"
                    style={{ color: isHomeActive || location.startsWith("/admin") ? "#ffffff" : "#6E6E73" }}
                    strokeWidth={isHomeActive || location.startsWith("/admin") ? 2.5 : 2}
                  />
                )}
                {userPhotoUrl && !photoError && (
                  <img
                    src={userPhotoUrl}
                    alt="Profile"
                    onLoad={() => setPhotoLoaded(true)}
                    onError={() => {
                      setPhotoError(true);
                      setPhotoLoaded(false);
                    }}
                    className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-200 ${
                      photoLoaded ? "opacity-100" : "opacity-0"
                    } ${isHomeActive || location.startsWith("/admin") ? "ring-2 ring-white" : "ring-1 ring-white/20"}`}
                  />
                )}
              </div>
              <span
                className="text-[9px] font-medium leading-none tracking-wide transition-colors duration-150"
                style={{ color: isHomeActive || location.startsWith("/admin") ? "#ffffff" : "#6E6E73" }}
              >
                Home
              </span>
            </button>

            {/* Contest, Mission, Invite, Ambassador */}
            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;

              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <button className="w-full h-full flex flex-col items-center justify-center gap-1">
                    <Icon
                      className="w-6 h-6 transition-colors duration-150"
                      style={{ color: isActive ? "#ffffff" : "#6E6E73" }}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                    <span
                      className="text-[9px] font-medium leading-none tracking-wide transition-colors duration-150"
                      style={{ color: isActive ? "#ffffff" : "#6E6E73" }}
                    >
                      {item.label}
                    </span>
                  </button>
                </Link>
              );
            })}

            {/* Advertise — opens Create panel directly on the advertise form */}
            <button
              onClick={handlePlusClick}
              className="flex-1 flex flex-col items-center justify-center gap-1"
              aria-label="Advertise"
            >
              <Radio
                className="w-6 h-6 transition-colors duration-150"
                style={{ color: panelOpen ? "#ffffff" : "#6E6E73" }}
                strokeWidth={panelOpen ? 2.5 : 2}
              />
              <span
                className="text-[9px] font-medium leading-none tracking-wide transition-colors duration-150"
                style={{ color: panelOpen ? "#ffffff" : "#6E6E73" }}
              >
                Advertise
              </span>
            </button>
          </nav>
        </div>
      )}

      {/* Create Panel — admin only */}
      <CreatePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}
