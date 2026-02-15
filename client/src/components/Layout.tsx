import { Link, useLocation } from "wouter";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAdmin } from "@/hooks/useAdmin";
import { motion, AnimatePresence } from "framer-motion";
import { HeartHandshake, CircleDollarSign, User, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Header";
import { useSeasonEnd } from "@/lib/SeasonEndContext";
import BanScreen from "@/components/BanScreen";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { isConnected } = useWebSocket();
  const { isAdmin } = useAdmin();
  const { showSeasonEnd } = useSeasonEnd();

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  if (user?.banned) {
    return <BanScreen reason={user.bannedReason} />;
  }

  const navItems = [
    { href: "/affiliates", icon: HeartHandshake, label: "INVITE" },
    { href: "/withdraw", icon: CircleDollarSign, label: "PAYOUT" },
  ];

  // Get photo from Telegram WebApp first, then fallback to user data
  const telegramPhotoUrl = typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  const userPhotoUrl = telegramPhotoUrl || user?.profileImageUrl || user?.profileUrl || null;
  const isHomeActive = location === "/";

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-black">
      {!showSeasonEnd && <Header />}
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: '80px', paddingTop: '60px' }}>
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
        <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-48px)] max-w-md h-14 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl border border-white/5">
          <div className="flex justify-around items-center h-full px-4">
            {/* WATCH with Profile Photo */}
            <Link href="/">
              <button
                onClick={() => isHomeActive && isAdmin && setLocation("/admin")}
                className={`flex flex-col items-center justify-center min-w-[64px] transition-all duration-300 ${
                  isHomeActive 
                    ? "text-white scale-105" 
                    : "text-[#6E6E73] hover:text-white/80"
                }`}
              >
                {userPhotoUrl ? (
                  <img 
                    src={userPhotoUrl} 
                    alt="Profile" 
                    className={`w-6 h-6 rounded-full object-cover transition-all mb-1 ${
                      isHomeActive ? "ring-2 ring-white" : ""
                    }`}
                  />
                ) : (
                  <div className={`w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mb-1 ${
                    isHomeActive ? "ring-2 ring-white" : ""
                  }`}>
                    <User className="w-4 h-4" />
                  </div>
                )}
                <span className={`text-[10px] font-semibold tracking-wide uppercase ${isHomeActive ? 'opacity-100' : 'opacity-70'}`}>
                  EARN
                </span>
              </button>
            </Link>

            {navItems.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              
              return (
                <Link key={item.href} href={item.href}>
                  <button
                    className={`flex flex-col items-center justify-center min-w-[64px] transition-all duration-300 ${
                      isActive 
                        ? "text-white scale-105" 
                        : "text-[#6E6E73] hover:text-white/80"
                    }`}
                  >
                    <Icon 
                      className="w-6 h-6 mb-1 transition-all"
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                    <span className={`text-[10px] font-semibold tracking-wide uppercase ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                      {item.label}
                    </span>
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
