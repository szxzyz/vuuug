import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@/components/AppNotification';
import Layout from '@/components/Layout';
import { Copy, Users, Send } from 'lucide-react';
import { formatLargePAD } from '@/lib/utils';
import { useLanguage } from '@/hooks/useLanguage';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';

function StatSkeleton() {
  return (
    <div
      style={{
        height: 24,
        width: 56,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 6,
        display: 'inline-block',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

export default function Affiliates() {
  const { t } = useLanguage();
  const [referralsOpen, setReferralsOpen] = useState(false);

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery<any>({
    queryKey: ['/api/referrals/stats'],
    retry: false,
  });

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  const { data: myReferralsData, isLoading: isLoadingReferrals } = useQuery<any>({
    queryKey: ['/api/referrals/my-referrals'],
    retry: false,
    enabled: referralsOpen,
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

  // Copy referral link (was the main button, now the small circular button)
  const copyLink = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    showNotification(t('link_copied'), 'success');
  };

  // Invite Friends — opens Telegram's native share dialog (was the circular share button, now the main button)
  const inviteFriends = async () => {
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

  const myReferrals: any[] = myReferralsData?.referrals ?? [];

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

        {/* Main: Invite Friends button + Copy circular button */}
        <div className="mb-4 flex items-center gap-3">
          {/* PRIMARY: Invite Friends — opens Telegram share sheet */}
          <button
            onClick={inviteFriends}
            disabled={isSharing || !user?.referralCode}
            className="flex-1 h-14 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.12)' }}
          >
            <Send className="w-5 h-5 text-white/70" />
            <span className="text-white font-bold tracking-widest text-sm">Invite Friends</span>
          </button>

          {/* SECONDARY: Copy referral link — circular icon */}
          <button
            onClick={copyLink}
            disabled={!user?.referralCode}
            className="w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.12)' }}
            title="Copy referral link"
          >
            <Copy className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Referral counts */}
        <div className="rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">{t('level1_referrals')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('get_label')} {l1Percent}% {t('of_friends_pow')}</p>
            </div>
            {isLoadingStats ? <StatSkeleton /> : <span className="text-white text-xl font-black">{l1Count}</span>}
          </div>

          <div className="flex items-center justify-between py-3 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">{t('level2_referrals')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('get_label')} {l2Percent}% {t('from_their_friends')}</p>
            </div>
            {isLoadingStats ? <StatSkeleton /> : <span className="text-white text-xl font-black">{l2Count}</span>}
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
        <div className="rounded-2xl p-4 mb-3">
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">{t('total_affiliate_earnings')}</p>
          <div className="flex items-center justify-between py-2 border-b border-white/5">
            <div>
              <p className="text-white text-sm font-semibold">{t('usd_earned')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('total_from_referrals')}</p>
            </div>
            {isLoadingStats ? (
              <StatSkeleton />
            ) : (
              <span className="text-green-400 text-lg font-black">
                ${totalUsdEarned > 0 ? totalUsdEarned.toFixed(3) : '0.000'}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-white text-sm font-semibold">{t('pow_earned')}</p>
              <p className="text-[#888] text-xs mt-0.5">{t('total_pow_l1')}</p>
            </div>
            {isLoadingStats ? (
              <StatSkeleton />
            ) : (
              <span className="text-white text-lg font-black">
                {formatLargePAD(totalPowEarned, false)} <span className="text-xs text-[#888] font-normal">POW</span>
              </span>
            )}
          </div>
        </div>

        {/* My Referrals button */}
        <button
          onClick={() => setReferralsOpen(true)}
          className="w-full h-12 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-transform mb-6"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        >
          <Users className="w-5 h-5 text-white/70" />
          <span className="text-white font-semibold text-sm">My Referrals</span>
        </button>

      </main>

      {/* My Referrals Bottom Drawer */}
      <Drawer open={referralsOpen} onOpenChange={setReferralsOpen}>
        <DrawerContent className="bg-[#111] border-none max-h-[80vh]">
          <DrawerHeader className="flex items-center justify-between pb-2">
            <DrawerTitle className="text-white font-bold text-lg">My Referrals</DrawerTitle>
            <DrawerClose asChild>
              <button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">
                Close
              </button>
            </DrawerClose>
          </DrawerHeader>

          <div className="px-4 pb-6 overflow-y-auto">
            {isLoadingReferrals ? (
              <div className="flex items-center justify-center py-10">
                <div className="text-white/40 text-sm">Loading…</div>
              </div>
            ) : myReferrals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Users className="w-10 h-10 text-white/20" />
                <p className="text-white/40 text-sm">No referrals yet</p>
                <p className="text-white/25 text-xs">Invite friends to get started</p>
              </div>
            ) : (
              <>
                {/* Header row */}
                <div className="grid grid-cols-2 gap-2 pb-2 border-b border-white/10 mb-2">
                  <span className="text-[#888] text-xs font-semibold uppercase tracking-wider">Friend</span>
                  <span className="text-[#888] text-xs font-semibold uppercase tracking-wider text-right">Status</span>
                </div>
                {/* Referral rows */}
                <div className="space-y-2">
                  {myReferrals.map((ref: any) => (
                    <div key={ref.id} className="grid grid-cols-2 gap-2 items-center py-2 border-b border-white/5">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {ref.username ? `@${ref.username}` : ref.displayName}
                        </p>
                        {ref.username && ref.displayName && ref.displayName !== ref.username && (
                          <p className="text-[#888] text-xs truncate">{ref.displayName}</p>
                        )}
                      </div>
                      <div className="flex justify-end">
                        {ref.status === 'success' ? (
                          <Badge className="bg-green-600/20 text-green-400 border-green-600/30 text-[11px] px-2">
                            Success
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[11px] px-2">
                            Pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[#666] text-xs mt-4 text-center">
                  {myReferrals.length} referral{myReferrals.length !== 1 ? 's' : ''}
                </p>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </Layout>
  );
}
