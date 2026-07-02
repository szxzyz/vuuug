import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAdmin } from "@/hooks/useAdmin";
import { motion, AnimatePresence } from "framer-motion";
import {
  HeartHandshake,
  ListTodo,
  Plus,
  User,
  ShieldCheck,
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
    { href: "/affiliates", icon: HeartHandshake, label: "Friends" },
    { href: "/missions", icon: ListTodo, label: "Mission" },
  ];

  const telegramPhotoUrl =
    typeof window !== "undefined" &&
    (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const userPhotoUrl =
    telegramPhotoUrl || user?.profileImageUrl || user?.profileUrl || null;

  const isHomeActive = location === "/";

  const handlePlusClick = () => {
    if (isAdmin) {
      setPanelOpen((prev) => !prev);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-black overflow-hidden">
      {/* Floating header — visible only on Home page (language button) */}
      <Header />
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ paddingBottom: "100px", paddingTop: "0px" }}
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
        <div className="fixed bottom-6 left-0 right-0 z-50 flex items-center justify-center gap-3 px-4">

          {/* Original-style nav pill — restored size, added text labels */}
          <nav className="flex justify-center items-center h-16 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl px-7 gap-8">

            {/* Home button — double-tap for admin panel */}
            <motion.button
              onClick={handleHomeClick}
              whileTap={{ scale: 0.82 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className={`flex flex-col items-center justify-center gap-1 ${
                isHomeActive || location.startsWith("/admin")
                  ? "text-white"
                  : "text-[#6E6E73]"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all relative bg-[#2a2a2a] ${
                  isHomeActive || location.startsWith("/admin") ? "ring-2 ring-white" : "ring-1 ring-white/20"
                }`}
              >
                {/* Admin flash overlay */}
                <AnimatePresence>
                  {adminFlash && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.3 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="absolute inset-0 rounded-full flex items-center justify-center z-10"
                      style={{ background: "rgba(28,28,30,0.92)" }}
                    >
                      <ShieldCheck className="w-5 h-5" style={{ color: "#ffffff", strokeWidth: 2 }} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {(!photoLoaded || photoError) && !adminFlash && (
                  <User className="w-5 h-5 text-[#6E6E73]" />
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
                    }`}
                  />
                )}
              </div>
              <span
                className="text-[9px] font-medium leading-none tracking-wide"
                style={{ color: isHomeActive || location.startsWith("/admin") ? "#fff" : "#6E6E73" }}
              >
                Home
              </span>
            </motion.button>

            {/* Other nav items */}
            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;

              return (
                <Link key={item.href} href={item.href}>
                  <motion.button
                    whileTap={{ scale: 0.82 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    className={`flex flex-col items-center justify-center gap-1 ${
                      isActive ? "text-white" : "text-[#6E6E73]"
                    }`}
                  >
                    <Icon
                      className="w-8 h-8 transition-all"
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                    <span
                      className="text-[9px] font-medium leading-none tracking-wide"
                      style={{ color: isActive ? "#fff" : "#6E6E73" }}
                    >
                      {item.label}
                    </span>
                  </motion.button>
                </Link>
              );
            })}
          </nav>

          {/* Floating "+" circular button — only shown for admins */}
          {isAdmin && (
            <motion.button
              onClick={handlePlusClick}
              whileTap={{ scale: 0.88 }}
              whileHover={{ scale: 1.06 }}
              animate={{ rotate: panelOpen ? 45 : 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 22 }}
              className="flex items-center justify-center rounded-full flex-shrink-0"
              style={{
                width: "56px",
                height: "56px",
                background: panelOpen
                  ? "rgba(255,255,255,0.14)"
                  : "rgba(28,28,30,0.9)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: panelOpen
                  ? "1px solid rgba(255,255,255,0.18)"
                  : "none",
                boxShadow: panelOpen
                  ? "0 0 0 6px rgba(255,255,255,0.05)"
                  : "0 8px 24px rgba(0,0,0,0.45)",
              }}
              aria-label="Create"
            >
              <Plus
                style={{
                  width: "24px",
                  height: "24px",
                  color: "rgba(255,255,255,0.9)",
                  strokeWidth: 2.2,
                }}
              />
            </motion.button>
          )}
        </div>
      )}

      {/* Create Panel — admin only */}
      <CreatePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}
