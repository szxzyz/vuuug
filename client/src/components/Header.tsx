import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useLocation } from "wouter";
import { useAdmin } from "@/hooks/useAdmin";
import { useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";


export default function Header() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const [location, setLocation] = useLocation();
  const { isAdmin } = useAdmin();
  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();
  const isWalletConnected = !!connectedAddress;

  const isHomePage = location === "/";

  const photoUrl = typeof window !== 'undefined'
    ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url
    : null;

  const fallbackUrl = user?.profileImageUrl || user?.profileUrl || null;

  const usdBalance = parseFloat(user?.usdBalance || "0");
  const usdFormatted = usdBalance.toFixed(3);

  const starBalance = parseFloat(user?.starBalance || "0");
  const starFormatted = starBalance >= 1000000
    ? (starBalance / 1000000).toFixed(1) + 'M'
    : starBalance >= 1000
    ? (starBalance / 1000).toFixed(1) + 'k'
    : starBalance.toFixed(0);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-48px)] max-w-md h-14 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl flex items-center justify-between px-4">
      {/* Left — profile + balances */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => isAdmin && setLocation('/admin')}
          className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 active:scale-95 transition-transform"
        >
          {(photoUrl || fallbackUrl) ? (
            <img src={photoUrl || fallbackUrl} alt="Profile" className="w-full h-full object-cover rounded-full" />
          ) : (
            <div className="w-full h-full bg-white/10 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-gray-300" />
            </div>
          )}
        </button>

        <div className="flex items-center gap-1.5">
          <img src="/star-bug.png" alt="STAR" className="w-7 h-7 object-contain flex-shrink-0" />
          <span className="text-[15px] font-bold text-white leading-none">{starFormatted}</span>
        </div>

        {!isHomePage && (
          <div className="flex items-center gap-1.5">
            <img src="/usdt.png" alt="USDT" className="w-6 h-6 object-contain flex-shrink-0" />
            <span className="text-[15px] font-bold text-white leading-none">{usdFormatted}</span>
          </div>
        )}
      </div>

      {/* Right — TON Connect */}
      <button
        onClick={() => tonConnectUI.openModal()}
        className="flex items-center gap-1.5 h-8 px-3 rounded-full active:scale-95 transition-all"
        style={isWalletConnected
          ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }
          : { background: '#0098EA' }
        }
      >
        <img src="/images/ton.png" alt="TON" className="w-4 h-4 object-contain flex-shrink-0" />
        {isWalletConnected ? (
          <>
            <span className="text-[11px] font-bold text-white leading-none">
              {connectedAddress.slice(0, 4)}…{connectedAddress.slice(-4)}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
          </>
        ) : (
          <span className="text-[12px] font-bold text-white leading-none">Connect</span>
        )}
      </button>
    </div>
  );
}
