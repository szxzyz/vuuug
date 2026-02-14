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
    <div className="h-screen w-full flex flex-col bg-black overflow-hidden">
      {!showSeasonEnd && <Header />}
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: '140px', paddingTop: '84px' }}>
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
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black border-t border-[#1A1A1A] pb-[env(safe-area-inset-bottom,12px)]">
          <div className="max-w-md mx-auto px-4">
            <div className="flex justify-around items-center py-3 pb-12">
              {/* WATCH with Profile Photo */}
              <Link href="/">
                <button
                  className={`flex flex-col items-center justify-center min-w-[60px] min-h-[52px] transition-all ${
                    isHomeActive 
                      ? "text-[#007BFF]" 
                      : "text-[#AAAAAA] hover:text-[#FFFFFF]"
                  }`}
                >
                  {userPhotoUrl ? (
                    <img 
                      src={userPhotoUrl} 
                      alt="Profile" 
                      className={`w-7 h-7 rounded-full object-cover transition-all mb-[8px] ${
                        isHomeActive ? "ring-2 ring-[#007BFF]" : ""
                      }`}
                    />
                  ) : (
                    <div className={`w-7 h-7 rounded-full bg-[#2a2a2a] flex items-center justify-center mb-[8px] ${
                      isHomeActive ? "ring-2 ring-[#007BFF]" : ""
                    }`}>
                      <User className="w-4 h-4" />
                    </div>
                  )}
                  <span className={`text-[11px] font-medium ${isHomeActive ? 'font-semibold' : ''}`}>
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
                      className={`flex flex-col items-center justify-center min-w-[60px] min-h-[52px] transition-all ${
                        isActive 
                          ? "text-[#007BFF]" 
                          : "text-[#AAAAAA] hover:text-[#FFFFFF]"
                      }`}
                    >
                      <Icon 
                        className="w-7 h-7 transition-all mb-[8px]"
                        strokeWidth={isActive ? 2.5 : 2}
                      />
                      <span className={`text-[11px] font-medium ${isActive ? 'font-semibold' : ''}`}>
                        {item.label}
                      </span>
                    </button>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      )}
    </div>
  );
}
