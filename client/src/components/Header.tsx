import { useQuery } from "@tanstack/react-query";
import { Settings, User, Gift } from "lucide-react";
import { useLocation } from "wouter";
import { useAdmin } from "@/hooks/useAdmin";
import { useState } from "react";
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

  const photoUrl = typeof window !== 'undefined'
    ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url
    : null;

  const fallbackUrl = user?.profileImageUrl || user?.profileUrl || null;

  const usdBalance = parseFloat(user?.usdBalance || "0");
  const usdFormatted = usdBalance.toFixed(3);

  const bugBalance = parseFloat(user?.bugBalance || "0");
  const bugFormatted = bugBalance >= 1000000
    ? (bugBalance / 1000000).toFixed(1) + 'M'
    : bugBalance >= 1000
    ? (bugBalance / 1000).toFixed(1) + 'k'
    : bugBalance.toFixed(0);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-16 bg-transparent">

        {/* Left: Avatar + balances */}
        <div className="flex items-center gap-2">
          {/* Profile photo */}
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

          {/* BUG balance — same height as avatar (h-10) */}
          <div className="h-10 flex items-center gap-1.5 bg-white/10 rounded-full px-3">
            <img src="/star-bug.png" alt="STAR" className="w-8 h-8 object-contain flex-shrink-0" />
            <span className="text-[13px] font-bold text-white leading-none">{bugFormatted}</span>
          </div>

          {/* USD balance — same height as avatar (h-10) */}
          <div className="h-10 flex items-center gap-1.5 bg-white/10 rounded-full px-3">
            <img src="/usdt.png" alt="USDT" className="w-6 h-6 object-contain flex-shrink-0" />
            <span className="text-[13px] font-bold text-white leading-none">{usdFormatted}</span>
          </div>
        </div>

        {/* Right: Gift + Settings — same size as avatar (w-10 h-10) */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPromo(true)}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-95 transition-all duration-200 relative"
            title="Promo Code"
          >
            <Gift className="w-5 h-5 text-white" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-green-400 rounded-full border border-black animate-pulse" />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-95 transition-all duration-200"
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
