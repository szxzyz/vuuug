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
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-48px)] max-w-md h-14 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl border border-white/5">
      <div className="flex items-center justify-center h-full px-6 gap-3">
        <div className="flex items-center gap-2 bg-white/5 px-3 h-9 rounded-full border border-white/5 min-w-[85px]">
          <DiamondIcon size={16} withGlow />
          <span className="text-sm text-white font-bold truncate">
            {formatBalance(padBalance)}
          </span>
        </div>
        
        <div className="flex items-center gap-2 bg-white/5 px-3 h-9 rounded-full border border-white/5 min-w-[75px]">
          <Bug className="w-4 h-4 text-green-400 flex-shrink-0" />
          <span className="text-sm text-white font-bold truncate">
            {formatBalance(bugBalance)}
          </span>
        </div>

        <div className="flex items-center gap-2 bg-white/5 px-4 h-9 rounded-full border border-white/5 min-w-[90px]">
          <span className="text-green-400 font-bold text-sm">$</span>
          <span className="text-sm text-white font-bold">
            {usdBalance.toFixed(3)}
          </span>
        </div>
      </div>
      {showSettings && <SettingsPopup onClose={() => setShowSettings(false)} />}
    </div>
  );
}
