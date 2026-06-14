import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import { Copy, Share2 } from 'lucide-react';
import { formatLargePAD } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';

export default function Affiliates() {
  const { t } = useLanguage();

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
    showNotification(t('link_copied'), 'success');
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
            {t('affiliates_program')}
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            {t('we_pay_out')}{' '}
            <span className="text-white font-semibold">{l1Percent}%</span>{' '}
            {t('from_l1_income')}{' '}
            <span className="text-white font-semibold">{l2Percent}%</span>{' '}
            {t('from_l2_income')}
          </p>
        </div>

        {/* Copy + Share buttons */}
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={copyLink}
            disabled={!user?.referralCode}
            className="flex-1 h-14 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.12)' }}
          >
            <Copy className="w-5 h-5 text-white/70" />
            <span className="text-white font-bold tracking-widest text-sm">{t('copy')}</span>
          </button>

          <button
            onClick={shareLink}
            disabled={isSharing || !user?.referralCode}
            className="w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.12)' }}
          >
            <Share2 className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Referral counts */}
        <div className="bg-[#1C1C1E] rounded-2xl p-4 mb-3 border border-white/5">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">{t('level1_referrals')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('get_label')} {l1Percent}% {t('of_friends_pow')}</p>
            </div>
            <span className="text-white text-xl font-black">{l1Count}</span>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">{t('level2_referrals')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('get_label')} {l2Percent}% {t('from_their_friends')}</p>
            </div>
            <span className="text-white text-xl font-black">{l2Count}</span>
          </div>

          <div className="flex items-center justify-between pt-3">
            <div>
              <p className="text-white text-sm font-semibold">{t('bonus')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('when_friend_watches')}</p>
            </div>
            {bonusLabel ? (
              <span className="text-green-400 text-sm font-bold">{bonusLabel}</span>
            ) : (
              <span className="text-white/30 text-sm font-semibold">{t('disabled')}</span>
            )}
          </div>
        </div>

        {/* Total Affiliate Earnings */}
        <div className="bg-[#1C1C1E] rounded-2xl p-4 mb-3 border border-white/5">
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">{t('total_affiliate_earnings')}</p>
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">{t('usd_earned')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('total_from_referrals')}</p>
            </div>
            <span className="text-green-400 text-lg font-black">
              ${totalUsdEarned > 0 ? totalUsdEarned.toFixed(3) : '0.000'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-white text-sm font-semibold">{t('pow_earned')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('total_pow_l1')}</p>
            </div>
            <span className="text-white text-lg font-black">
              {formatLargePAD(totalPowEarned, false)} <span className="text-xs text-[#888] font-normal">POW</span>
            </span>
          </div>
        </div>

      </main>
    </Layout>
  );
}
