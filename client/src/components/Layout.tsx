import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAdmin } from "@/hooks/useAdmin";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
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
    { href: "/affiliates", icon: HeartHandshake, label: "Friends" },
    { href: "/missions", icon: ListTodo, label: "Mission" },
  ];

  const telegramPhotoUrl =
    typeof window !== "undefined" &&
    (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const userPhotoUrl =
    telegramPhotoUrl || user?.profileImageUrl || user?.profileUrl || null;

  const isHomeActive = location === "/";
  const isCreateActive =
    location === "/task/create" || location === "/create-task";

  const handlePlusClick = () => {
    if (isAdmin) {
      navigate("/task/create");
    } else {
      setShowComingSoon(true);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-black overflow-hidden">
      {!showSeasonEnd && <Header />}

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ paddingBottom: "100px", paddingTop: "64px" }}
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
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            className="flex items-center justify-center rounded-full shadow-2xl flex-shrink-0"
            style={{
              width: "56px",
              height: "56px",
              background: isCreateActive
                ? "rgba(59,130,246,0.25)"
                : "rgba(28,28,30,0.9)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: isCreateActive
                ? "1px solid rgba(59,130,246,0.5)"
                : "none",
              transition: "all 0.25s ease",
            }}
            aria-label="Create Task"
          >
            <Plus
              style={{
                width: "24px",
                height: "24px",
                color: isCreateActive
                  ? "rgb(96,165,250)"
                  : "rgba(255,255,255,0.85)",
                strokeWidth: 2,
                transition: "color 0.22s ease",
              }}
            />
          </motion.button>
          )}
        </div>
      )}

      {/* Coming Soon popup */}
      <AnimatePresence>
        {showComingSoon && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[60]"
              style={{ background: "rgba(0,0,0,0.55)" }}
              onClick={() => setShowComingSoon(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
              className="fixed z-[61] bottom-28 left-1/2 -translate-x-1/2"
              style={{ minWidth: "220px" }}
            >
              <div
                className="flex flex-col items-center gap-3 text-center"
                style={{
                  background: "rgba(28,28,30,0.96)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "20px",
                  boxShadow:
                    "0 24px 48px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)",
                  padding: "20px 24px",
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <Plus
                    style={{
                      width: "22px",
                      height: "22px",
                      color: "rgba(255,255,255,0.7)",
                    }}
                  />
                </div>
                <div>
                  <p
                    style={{
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: "15px",
                      marginBottom: "4px",
                    }}
                  >
                    Coming Soon
                  </p>
                  <p
                    style={{
                      color: "rgba(255,255,255,0.45)",
                      fontSize: "13px",
                      lineHeight: 1.4,
                    }}
                  >
                    This feature is currently under development.
                  </p>
                </div>
                <button
                  onClick={() => setShowComingSoon(false)}
                  style={{
                    marginTop: "4px",
                    padding: "8px 28px",
                    borderRadius: "20px",
                    background: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.8)",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
