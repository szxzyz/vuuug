import { useQuery } from "@tanstack/react-query";
import { DiamondIcon } from "@/components/DiamondIcon";
import { Bug, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { useAdmin } from "@/hooks/useAdmin";
import { useState } from "react";
import { SettingsPopup } from "./SettingsPopup";

export default function Header() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });
  
  const [, setLocation] = useLocation();
  const { isAdmin } = useAdmin();
  const [showSettings, setShowSettings] = useState(false);

  const usdBalance = parseFloat(user?.usdBalance || "0");
  const rawBalance = parseFloat(user?.balance || "0");
  const padBalance = rawBalance < 1 ? Math.round(rawBalance * 10000000) : Math.round(rawBalance);
  const bugBalance = parseFloat(user?.bugBalance || "0");

  const formatBalance = (balance: number) => {
    if (balance >= 1000000) {
      return (balance / 1000000).toFixed(1) + 'M';
    } else if (balance >= 1000) {
      return (balance / 1000).toFixed(1) + 'k';
    }
    return Math.round(balance).toLocaleString();
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-black border-b border-[#1A1A1A] pt-[env(safe-area-inset-top,8px)]">
      <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-[#1A1A1A] px-3 h-8 rounded-lg min-w-[80px] max-w-[110px]">
            <DiamondIcon size={16} withGlow />
            <span className="text-sm text-white font-semibold truncate">
              {formatBalance(padBalance)}
            </span>
          </div>
          
          <div className="flex items-center gap-2 bg-[#1A1A1A] px-3 h-8 rounded-lg min-w-[70px] max-w-[100px]">
            <Bug className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-sm text-white font-semibold truncate">
              {formatBalance(bugBalance)}
            </span>
          </div>

          <div className="flex items-center gap-2 bg-[#1A1A1A] px-5 h-8 rounded-lg min-w-[80px]">
            <span className="text-green-400 font-semibold text-sm">$</span>
            <span className="text-sm text-white font-semibold">
              {usdBalance.toFixed(3)}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-[#1A1A1A] rounded-lg transition-colors"
            title="Settings"
          >
            <Settings className="w-5 h-5 text-[#4cd3ff] hover:text-[#6ddeff]" />
          </button>
        </div>
      </div>
      {showSettings && <SettingsPopup onClose={() => setShowSettings(false)} />}
    </div>
  );
}
