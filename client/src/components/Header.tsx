import { useQuery } from "@tanstack/react-query";
import { Settings, User, Gift } from "lucide-react";
import { useLocation } from "wouter";
import { useAdmin } from "@/hooks/useAdmin";
import { useState, useEffect } from "react";
import { SettingsPopup } from "./SettingsPopup";
import PromoCodeDialog from "./PromoCodeDialog";

export default function Header() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const [location, setLocation] = useLocation();
  const { isAdmin } = useAdmin();
  const [showSettings, setShowSettings] = useState(false);
  const [showPromo, setShowPromo] = useState(false);
  const isHome = location === "/";

  const photoUrl = typeof window !== 'undefined'
    ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url
    : null;

  const fallbackUrl = user?.profileImageUrl || user?.profileUrl || null;

  const usdBalance = parseFloat(user?.usdBalance || "0");
  const usdFormatted = usdBalance.toFixed(3);

  return (
    <>
      <div
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-16"
        style={{ background: '#000000' }}
      >
        {/* Left: Avatar + balance */}
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
              <div className="w-full h-full bg-white/10 rounded-full flex items-center justify-center border border-white/10">
                <User className="w-5 h-5 text-gray-300" />
              </div>
            )}
          </button>

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

        {/* Right: Gift (promo) + Settings */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPromo(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all duration-200 relative group"
            title="Promo Code"
          >
            <Gift className="w-5 h-5 text-white" />
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-black animate-pulse" />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all duration-200"
            >
            <Settings className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {showSettings && <SettingsPopup onClose={() => setShowSettings(false)} />}
      <PromoCodeDialog open={showPromo} onOpenChange={setShowPromo} />
    </>
  );
}
