import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import IncomeChart from '@/components/IncomeChart';
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

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
    staleTime: 60000,
  });

  const [isSharing, setIsSharing] = useState(false);

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'MoneyAdzbot';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}?start=${user.referralCode}`
    : 'https://t.me/MoneyAdzbot?start=XXXXXXXX';

  const l1Percent = appSettings?.l1CommissionPercent ?? 20;
  const l2Percent = appSettings?.l2CommissionPercent ?? 4;

  const referralRewardPADEnabled = appSettings?.referralRewardPADEnabled;
  const referralRewardUSDEnabled = appSettings?.referralRewardUSDEnabled;

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

  // Bonus label from admin settings (using per-currency toggles)
  const rewardPAD = appSettings?.referralRewardPAD ?? 0;
  const rewardUSD = appSettings?.referralRewardUSD ?? 0;
  const padActive = referralRewardPADEnabled;
  const usdActive = referralRewardUSDEnabled;
  const bonusLabel = (padActive || usdActive)
    ? [padActive && rewardPAD > 0 ? `${rewardPAD} PAD` : null, usdActive && rewardUSD > 0 ? `$${rewardUSD}` : null]
        .filter(Boolean).join(' + ') || null
    : null;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 bg-black">

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-black text-white tracking-tight mb-2">
            Affiliates Program
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            Earn <span className="text-white font-semibold">{l1Percent}%</span> from your direct referrals and{' '}
            <span className="text-white font-semibold">{l2Percent}%</span> from their referrals.
          </p>
        </div>

        {/* Direct link section */}
        <div className="mb-4">
          <p className="text-[#888] text-xs font-semibold uppercase tracking-widest mb-3">
            Direct link in TG bot
          </p>

          {/* Link display */}
          <div className="bg-[#1C1C1E] rounded-xl px-3 py-3 mb-3 overflow-hidden">
            <p className="text-white/60 text-xs font-mono truncate">
              {referralLink}
            </p>
          </div>

          {/* Buttons side by side */}
          <div className="flex gap-2">
            <button
              onClick={copyLink}
              disabled={!user?.referralCode}
              className="flex-1 py-3.5 rounded-xl text-sm font-bold tracking-wide btn-primary active:scale-95 transition-transform disabled:opacity-50"
            >
              Copy the link
            </button>

            <button
              onClick={shareLink}
              disabled={isSharing}
              className="flex-1 py-3.5 rounded-xl text-sm font-bold tracking-wide active:scale-95 transition-transform flex items-center justify-center gap-2"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}
            >
              {isSharing && <Loader2 className="w-4 h-4 animate-spin" />}
              Send
            </button>
          </div>
        </div>

        {/* Referral counts */}
        <div className="bg-[#1C1C1E] rounded-2xl p-4 mb-3 border border-white/5">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">Level 1 Referrals</p>
              <p className="text-[#888] text-xs mt-0.5">Users you invited directly · {l1Percent}% commission</p>
            </div>
            <span className="text-white text-xl font-black">{l1Count}</span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">Level 2 Referrals</p>
              <p className="text-[#888] text-xs mt-0.5">Invited by your referrals · {l2Percent}% commission</p>
            </div>
            <span className="text-white text-xl font-black">{l2Count}</span>
          </div>

          <div className="flex items-center justify-between pt-3">
            <div>
              <p className="text-white text-sm font-semibold">Bonus</p>
              <p className="text-[#888] text-xs mt-0.5">When your friend watches 1 ad</p>
            </div>
            {bonusLabel ? (
              <span className="text-green-400 text-sm font-bold">{bonusLabel}</span>
            ) : (
              <span className="text-white/30 text-sm font-semibold">Disabled</span>
            )}
          </div>
        </div>

        {/* Referral Income Chart */}
        <div className="mt-2 pb-2">
          <IncomeChart
            title="REFERRAL INCOME"
            subtitle="Earnings from friends — L1 and L2 commissions"
            apiEndpoint="/api/referrals/earnings/chart"
          />
        </div>

      </main>
    </Layout>
  );
}
