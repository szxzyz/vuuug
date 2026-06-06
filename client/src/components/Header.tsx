import { useQuery } from "@tanstack/react-query";
import { Settings, Bell, User } from "lucide-react";
import { useLocation } from "wouter";
import { useAdmin } from "@/hooks/useAdmin";
import { useState } from "react";
import { SettingsPopup } from "./SettingsPopup";

export default function Header() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const [location, setLocation] = useLocation();
  const { isAdmin } = useAdmin();
  const [showSettings, setShowSettings] = useState(false);

  const isHome = location === "/";

  const photoUrl = typeof window !== 'undefined'
    ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url
    : null;

  const fallbackUrl = user?.profileImageUrl || user?.profileUrl || null;

  const usdBalance = parseFloat(user?.usdBalance || "0");
  const usdFormatted = usdBalance.toFixed(7);

  return (
    <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-16">

      {/* Left side: avatar + balance (non-home) */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => isAdmin && setLocation('/admin')}
          className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 active:scale-95 transition-transform"
        >
          {(photoUrl || fallbackUrl) ? (
            <img
              src={photoUrl || fallbackUrl}
              alt="Profile"
              className="w-full h-full object-cover rounded-full"
            />
          ) : (
            <div className="w-full h-full bg-[#1C1C1E] rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-gray-400" />
            </div>
          )}
        </button>

        {/* Balance block — only on non-home pages */}
        {!isHome && (
          <div className="flex flex-col justify-center leading-tight">
            <span className="text-[11px] font-medium text-white/50 tracking-wide">
              Balance
            </span>
            <span className="text-[17px] font-bold text-white tracking-tight">
              ${usdFormatted}
            </span>
          </div>
        )}
      </div>

      {/* Right side: settings + bell */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSettings(true)}
          className="w-10 h-10 rounded-full bg-[#1C1C1E] flex items-center justify-center active:scale-95 transition-transform"
        >
          <Settings className="w-5 h-5 text-white" />
        </button>
        <button
          className="w-10 h-10 rounded-full bg-[#1C1C1E] flex items-center justify-center active:scale-95 transition-transform"
        >
          <Bell className="w-5 h-5 text-white" />
        </button>
      </div>

      {showSettings && <SettingsPopup onClose={() => setShowSettings(false)} />}
    </div>
  );
}
