import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import IncomeChart from '@/components/IncomeChart';
import { Copy, Share2 } from 'lucide-react';

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

  const { data: botInfo } = useQuery<{ username: string }>({
    queryKey: ['/api/bot-info'],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const botUsername = botInfo?.username || import.meta.env.VITE_BOT_USERNAME || 'PaidAdzbot';
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}?start=${user.referralCode}`
    : '';

  const l1Percent = appSettings?.l1CommissionPercent ?? 20;
  const l2Percent = appSettings?.l2CommissionPercent ?? 4;

  const referralRewardPOWEnabled = appSettings?.referralRewardPOWEnabled;
  const referralRewardUSDEnabled = appSettings?.referralRewardUSDEnabled;

  const totalUsdEarned: number = stats?.totalUsdEarned ?? 0;
  const totalPowEarned: number = stats?.totalPowEarned ?? stats?.totalStarEarned ?? 0;

  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    showNotification('Link copied!', 'success');
  };

  const shareLink = async () => {
    if (isSharing || !referralLink) return;
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

  const rewardPOW = appSettings?.referralRewardPOW ?? 0;
  const rewardUSD = appSettings?.referralRewardUSD ?? 0;
  const powActive = referralRewardPOWEnabled;
  const usdActive = referralRewardUSDEnabled;
  const bonusLabel = (powActive || usdActive)
    ? [powActive && rewardPOW > 0 ? `${rewardPOW} POW` : null, usdActive && rewardUSD > 0 ? `$${rewardUSD}` : null]
        .filter(Boolean).join(' + ') || null
    : null;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 bg-black">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white tracking-tight mb-2">
            Affiliates Program
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            We pay out up to{' '}
            <span className="text-white font-semibold">{l1Percent}%</span>{' '}
            from the income of referrals of the 1st level and up to{' '}
            <span className="text-white font-semibold">{l2Percent}%</span>{' '}
            from the income of referrals of the 2nd level.
          </p>
        </div>

        {/* Copy + Share buttons */}
        <div className="mb-4 flex items-center gap-3">
          {/* Wide pill Copy button */}
          <button
            onClick={copyLink}
            disabled={!user?.referralCode}
            className="flex-1 h-14 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.12)' }}
            title="Copy referral link"
          >
            <Copy className="w-5 h-5 text-white/70" />
            <span className="text-white font-bold tracking-widest text-sm">COPY</span>
          </button>

          {/* Circle Share button */}
          <button
            onClick={shareLink}
            disabled={isSharing || !user?.referralCode}
            className="w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.12)' }}
            title="Share referral link"
          >
            <Share2 className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Referral counts */}
        <div className="bg-[#1C1C1E] rounded-2xl p-4 mb-3 border border-white/5">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">Level 1 Referrals</p>
              <p className="text-[#888] text-xs mt-0.5">Get {l1Percent}% of your friends POW</p>
            </div>
            <span className="text-white text-xl font-black">{l1Count}</span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">Level 2 Referrals</p>
              <p className="text-[#888] text-xs mt-0.5">Get {l2Percent}% from their friends</p>
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

        {/* Total Affiliate Earnings */}
        <div className="bg-[#1C1C1E] rounded-2xl p-4 mb-3 border border-white/5">
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Total Affiliate Earnings</p>
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">USD Earned</p>
              <p className="text-[#888] text-xs mt-0.5">Total from all referrals</p>
            </div>
            <span className="text-green-400 text-lg font-black">
              ${totalUsdEarned > 0 ? totalUsdEarned.toFixed(5) : '0.00000'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-white text-sm font-semibold">POW Earned</p>
              <p className="text-[#888] text-xs mt-0.5">Total POW from L1 + L2 commissions</p>
            </div>
            <span className="text-white text-lg font-black">
              {totalPowEarned > 0 ? Math.round(totalPowEarned).toLocaleString() : '0'} <span className="text-xs text-[#888] font-normal">POW</span>
            </span>
          </div>
        </div>

        {/* Referral Income Chart */}
        <div className="mt-2 pb-0">
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
