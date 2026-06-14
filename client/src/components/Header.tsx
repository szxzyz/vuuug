import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

export default function Header() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const [location] = useLocation();
  const isHomePage = location === "/";

  if (isHomePage) return null;

  const usdBalance = parseFloat(user?.usdBalance || "0");
  const usdFormatted = usdBalance.toFixed(3);

  const starBalance = parseFloat(user?.starBalance || "0");
  const starFormatted = starBalance >= 1000000
    ? (starBalance / 1000000).toFixed(1) + 'M'
    : starBalance >= 1000
    ? (starBalance / 1000).toFixed(1) + 'k'
    : starBalance.toFixed(0);

  const powBalance = parseFloat(user?.balance || "0");
  const powAmount = powBalance < 1 ? Math.round(powBalance * 10000000) : Math.round(powBalance);
  const powFormatted = powAmount >= 1000000
    ? (powAmount / 1000000).toFixed(1) + 'M'
    : powAmount >= 1000
    ? (powAmount / 1000).toFixed(1) + 'k'
    : powAmount.toString();

  const ICON = 22;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-48px)] max-w-md h-12 bg-[#1C1C1E]/90 backdrop-blur-md rounded-[40px] shadow-2xl flex items-center px-4 gap-4">
      {/* STAR */}
      <div className="flex items-center gap-1.5">
        <img src="/star-bug.png" alt="STAR" style={{ width: ICON, height: ICON, objectFit: 'contain', flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{starFormatted}</span>
      </div>

      {/* divider */}
      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

      {/* POW */}
      <div className="flex items-center gap-1.5">
        <div style={{ width: ICON, height: ICON, borderRadius: '50%', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <img src="/pow-icon.png?v=2" alt="POW" style={{ width: '85%', height: '85%', objectFit: 'contain' }} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{powFormatted}</span>
      </div>

      {/* divider */}
      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

      {/* USD */}
      <div className="flex items-center gap-1.5">
        <img src="/usdt.png" alt="USD" style={{ width: ICON, height: ICON, objectFit: 'contain', flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{usdFormatted}</span>
      </div>
    </div>
  );
}
