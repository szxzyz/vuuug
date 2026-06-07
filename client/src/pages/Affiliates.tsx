import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import Header from '@/components/Header';
import { Loader2 } from 'lucide-react';

export default function Affiliates() {
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 60000,
  });

  const { data: stats } = useQuery<any>({
    queryKey: ['/api/referrals/stats'],
    retry: false,
    staleTime: 60000,
  });

  const [isSharing, setIsSharing] = useState(false);

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'MoneyAdzbot';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}?start=${user.referralCode}`
    : 'https://t.me/MoneyAdzbot?start=XXXXXXXX';

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    showNotification('Link copied!', 'success');
  };

  const shareLink = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const tgWebApp = (window as any).Telegram?.WebApp;
      const shareTitle = `💵 Get paid for watching ads on Telegram.`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareTitle)}`;
      if (tgWebApp?.openTelegramLink) {
        tgWebApp.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, '_blank');
      }
    } catch (e) {
      console.error(e);
    }
    setIsSharing(false);
  };

  const l1Count = stats?.totalInvites ?? 0;
  const l2Count = stats?.l2Count ?? 0;

  return (
    <Layout>
      <Header />
      <main className="max-w-md mx-auto px-4 pt-4 bg-black min-h-screen">

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-black text-white tracking-tight mb-2">
            Affiliates Program
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            We Pay out up to <span className="text-white font-semibold">20%</span> from the income of referrals of the 1st level and up to{' '}
            <span className="text-white font-semibold">4%</span> from the income of referrals of the 2nd level.
          </p>
        </div>

        {/* Direct link section */}
        <div className="bg-[#111] rounded-2xl p-4 mb-3 border border-white/5">
          <p className="text-[#888] text-xs font-semibold uppercase tracking-widest mb-3">
            Direct link in TG bot
          </p>

          {/* Link display */}
          <div className="bg-[#1C1C1E] rounded-xl px-3 py-3 mb-3 overflow-hidden">
            <p className="text-white/60 text-xs font-mono truncate">
              {referralLink}
            </p>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2">
            <button
              onClick={copyLink}
              disabled={!user?.referralCode}
              className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide btn-primary active:scale-95 transition-transform disabled:opacity-50"
            >
              Copy the link
            </button>

            <button
              onClick={shareLink}
              disabled={isSharing}
              className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide active:scale-95 transition-transform flex items-center justify-center gap-2"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}
            >
              {isSharing && <Loader2 className="w-4 h-4 animate-spin" />}
              Send the link as a message
            </button>
          </div>
        </div>

        {/* Referral counts */}
        <div className="bg-[#111] rounded-2xl p-4 mb-3 border border-white/5">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">Referrals of the 1st level</p>
              <p className="text-[#888] text-xs mt-0.5">Users you invited directly</p>
            </div>
            <span className="text-white text-xl font-black">{l1Count}</span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">Referrals of the 2nd level</p>
              <p className="text-[#888] text-xs mt-0.5">Users invited by your referrals</p>
            </div>
            <span className="text-white text-xl font-black">{l2Count}</span>
          </div>

          <div className="flex items-center justify-between pt-3">
            <div>
              <p className="text-white text-sm font-semibold">Bonus</p>
              <p className="text-[#888] text-xs mt-0.5">Total referral earnings</p>
            </div>
            <span className="text-white/40 text-sm font-semibold">Coming soon</span>
          </div>
        </div>

        {/* Commission info */}
        <div className="bg-[#111] rounded-2xl p-4 border border-white/5">
          <div className="flex items-center justify-between py-2">
            <span className="text-[#888] text-xs">Level 1 commission</span>
            <span className="text-green-400 font-bold text-sm">20%</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-[#888] text-xs">Level 2 commission</span>
            <span className="text-green-400 font-bold text-sm">4%</span>
          </div>
        </div>

      </main>
    </Layout>
  );
}
