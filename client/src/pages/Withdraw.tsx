import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';
import { Loader2, Check, Wallet, HelpCircle, Info, Lock, UserPlus, PlayCircle, Receipt, Clock, CheckCircle, XCircle, ExternalLink, Link2Off } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { getPaymentSystems } from '@/constants/paymentSystems';
import { useLocation } from 'wouter';
import { shortenAddress } from '@/lib/utils';
import { format } from 'date-fns';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { useLanguage } from '@/hooks/useLanguage';

interface User {
  id: string;
  balance: string;
  usdBalance?: string;
  starBalance?: string;
  friendsInvited?: number;
  cwalletId?: string;
  adsWatched?: number;
  adsWatchedSinceLastWithdrawal?: number;
  referralCode?: string;
}

interface WithdrawalDetails {
  totalDeducted?: string;
  fee?: string;
  paymentDetails?: string;
  walletAddress?: string;
  tonWalletAddress?: string;
  usdtWalletAddress?: string;
  telegramUsername?: string;
}

interface Withdrawal {
  id: string;
  amount: string;
  details: WithdrawalDetails | string;
  status: string;
  createdAt: string;
  comment?: string;
  method?: string;
}

interface WithdrawalsResponse {
  success: boolean;
  withdrawals: Withdrawal[];
}

export default function Withdraw() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { t } = useLanguage();

  const [tonConnectUI] = useTonConnectUI();
  const connectedAddress = useTonAddress();
  const isWalletConnected = !!connectedAddress;
  
  const [selectedMethod, setSelectedMethod] = useState<string>('TON');
  const [selectedPackage, setSelectedPackage] = useState<number | 'FULL'>('FULL');

  const { data: user, refetch: refetchUser } = useQuery<User>({
    queryKey: ['/api/auth/user'],
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: validReferralData, isLoading: isLoadingReferrals, isFetched: isReferralsFetched } = useQuery<{ validReferralCount: number }>({
    queryKey: ['/api/referrals/valid-count'],
    retry: false,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: withdrawalsResponse, refetch: refetchWithdrawals, isLoading: withdrawalsLoading } = useQuery<WithdrawalsResponse>({
    queryKey: ['/api/withdrawals'],
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  const powBalance = parseFloat(user?.balance || "0");
  const usdBalance = parseFloat(user?.usdBalance || "0");
  const starBalance = parseFloat(user?.starBalance || "0");
  const validReferralCount = validReferralData?.validReferralCount ?? 0;
  
  const withdrawalAdRequirementEnabled = appSettings?.withdrawalAdRequirementEnabled === true;
  const MINIMUM_ADS_FOR_WITHDRAWAL = appSettings?.minimumAdsForWithdrawal ?? 100;
  const withdrawalInviteRequirementEnabled = appSettings?.withdrawalInviteRequirementEnabled === true;
  const MINIMUM_VALID_REFERRALS_REQUIRED = appSettings?.minimumInvitesForWithdrawal ?? 3;
  
  const defaultPackages = [
    {usd: 0.2},
    {usd: 0.4},
    {usd: 0.8}
  ];
  const rawPackages = appSettings?.withdrawalPackages || defaultPackages;
  const withdrawalPackages = rawPackages.map((pkg: {usd: number}) => ({
    usd: pkg.usd
  }));
  
  const getWithdrawalUsdAmount = () => {
    if (selectedPackage === 'FULL') {
      return usdBalance;
    }
    return selectedPackage;
  };

  const { data: withdrawalEligibility, isLoading: isLoadingEligibility, isFetched: isEligibilityFetched } = useQuery<{ adsWatchedSinceLastWithdrawal: number; canWithdraw: boolean }>({
    queryKey: ['/api/withdrawal-eligibility'],
    retry: false,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  
  const adsWatchedSinceLastWithdrawal = withdrawalEligibility?.adsWatchedSinceLastWithdrawal ?? (user as any)?.adsWatchedSinceLastWithdrawal ?? 0;
  
  const isLoadingAdRequirement = withdrawalAdRequirementEnabled && (!isEligibilityFetched || isLoadingEligibility);
  const isLoadingInviteRequirement = withdrawalInviteRequirementEnabled && (!isReferralsFetched || isLoadingReferrals);
  const isLoadingRequirements = isLoadingAdRequirement || isLoadingInviteRequirement;
  
  const hasWatchedEnoughAds = !withdrawalAdRequirementEnabled || adsWatchedSinceLastWithdrawal >= MINIMUM_ADS_FOR_WITHDRAWAL;
  const hasEnoughReferrals = !withdrawalInviteRequirementEnabled || validReferralCount >= MINIMUM_VALID_REFERRALS_REQUIRED;

  const botUsername = import.meta.env.VITE_BOT_USERNAME || '';
  const referralLink = user?.referralCode 
    ? `https://t.me/${botUsername}?start=${user.referralCode}`
    : '';

  const [isSharing, setIsSharing] = useState(false);

  const openShareSheet = async () => {
    if (!referralLink || isSharing) return;
    setIsSharing(true);
    try {
      const tgWebApp = window.Telegram?.WebApp as any;
      if (tgWebApp?.shareMessage) {
        try {
          const response = await fetch('/api/share/prepare-message', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await response.json();
          if (data.success && data.messageId) {
            tgWebApp.shareMessage(data.messageId, (success: boolean) => { setIsSharing(false); });
            return;
          } else if (data.fallbackUrl) {
            tgWebApp.openTelegramLink(data.fallbackUrl);
            setIsSharing(false);
            return;
          }
        } catch (error) {
          console.error('Prepare message error:', error);
        }
      }
      const shareTitle = `Start earning money just by completing tasks & watching ads!`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareTitle)}`;
      if (tgWebApp?.openTelegramLink) {
        tgWebApp.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, '_blank');
      }
    } catch (error) {
      console.error('Share error:', error);
    }
    setIsSharing(false);
  };

  const withdrawalsData = withdrawalsResponse?.withdrawals || [];
  const hasPendingWithdrawal = withdrawalsData.some(w => w.status === 'pending');

  useEffect(() => {
    refetchUser();
    refetchWithdrawals();
  }, [refetchUser, refetchWithdrawals]);

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      let withdrawalData: any = {
        method: selectedMethod,
        withdrawalPackage: selectedPackage,
        tonWalletAddress: connectedAddress || undefined,
      };

      const response = await apiRequest('POST', '/api/withdrawals', withdrawalData);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || t('failed'));
      }
      
      return data;
    },
    onSuccess: async () => {
      showNotification(t('withdrawal_request_sent'), "success");
      
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
      
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['/api/auth/user'] }),
        queryClient.refetchQueries({ queryKey: ['/api/user/stats'] }),
        queryClient.refetchQueries({ queryKey: ['/api/withdrawals'] })
      ]);
      
      setSelectedMethod('TON');
      setSelectedPackage('FULL');
    },
    onError: (error: any) => {
      const errorMessage = error.message || t('failed');
      
      if (errorMessage.toLowerCase().includes("minimum") || errorMessage === "minimum withdrawal") {
        const minAmount = selectedPaymentSystem?.minWithdrawal || 1;
        showNotification(`${t('minimum')} $${minAmount}`, "error");
      } else if (errorMessage.toLowerCase().includes("pending")) {
        showNotification(t('pending_withdrawal_warning'), "error");
      } else if (errorMessage.toLowerCase().includes("insufficient")) {
        showNotification(t('insufficient_balance'), "error");
      } else {
        showNotification(errorMessage, "error");
      }
    },
  });

  const handleWithdraw = () => {
    if (!hasEnoughReferrals) {
      const remaining = MINIMUM_VALID_REFERRALS_REQUIRED - validReferralCount;
      showNotification(`${t('invite_friends')}: ${remaining} ${remaining !== 1 ? t('friends') : t('friend')}`, "error");
      return;
    }
    
    if (!hasWatchedEnoughAds) {
      const remaining = MINIMUM_ADS_FOR_WITHDRAWAL - adsWatchedSinceLastWithdrawal;
      showNotification(`${t('watch')} ${remaining} ${t('ads_count')}`, "error");
      return;
    }
    
    if (hasPendingWithdrawal) {
      showNotification(t('pending_withdrawal_warning'), "error");
      return;
    }

    if (selectedMethod === 'TON' && !connectedAddress) {
      showNotification(t('connect') + " TON wallet", "error");
      return;
    }

    const withdrawAmount = getWithdrawalUsdAmount();
    if (withdrawAmount <= 0 || usdBalance < withdrawAmount) {
      showNotification(t('insufficient_balance'), "error");
      return;
    }

    withdrawMutation.mutate();
  };

  const paymentSystems = getPaymentSystems(appSettings);
  const selectedPaymentSystem = paymentSystems.find(p => p.id === selectedMethod);
  
  const calculateWithdrawalAmount = () => {
    const feePercent = selectedPaymentSystem?.fee || 5;
    const withdrawAmount = getWithdrawalUsdAmount();
    return withdrawAmount * (1 - feePercent / 100);
  };
  
  const canAffordPackage = (pkgUsd: number | 'FULL') => {
    if (pkgUsd === 'FULL') return usdBalance > 0;
    return usdBalance >= pkgUsd;
  };
  
  const getStatusIcon = (status: string) => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('approved') || lowerStatus.includes('success') || lowerStatus.includes('paid')) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    } else if (lowerStatus.includes('reject')) {
      return <XCircle className="w-4 h-4 text-red-500" />;
    } else if (lowerStatus.includes('pending')) {
      return <Clock className="w-4 h-4 text-yellow-500" />;
    }
    return <Loader2 className="w-4 h-4 text-gray-500" />;
  };

  const getStatusColor = (status: string) => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('approved') || lowerStatus.includes('success') || lowerStatus.includes('paid')) {
      return 'text-green-500';
    } else if (lowerStatus.includes('reject')) {
      return 'text-red-500';
    } else if (lowerStatus.includes('pending')) {
      return 'text-yellow-500';
    }
    return 'text-gray-500';
  };

  const getStatusLabel = (status: string) => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('approved') || lowerStatus.includes('success') || lowerStatus.includes('paid')) return t('completed');
    if (lowerStatus.includes('reject')) return t('rejected');
    if (lowerStatus.includes('pending')) return t('pending');
    return status;
  };

  const formatUSD = (amount: string) => {
    return parseFloat(amount).toFixed(2);
  };

  const getFullAmount = (withdrawal: Withdrawal): string => {
    if (typeof withdrawal.details === 'object' && withdrawal.details?.totalDeducted) {
      return withdrawal.details.totalDeducted;
    }
    return withdrawal.amount;
  };

  const getWithdrawButtonLabel = () => {
    if (withdrawMutation.isPending) return t('processing');
    if (getWithdrawalUsdAmount() <= 0) return t('select_package');
    if (usdBalance < getWithdrawalUsdAmount()) return t('insufficient_balance');
    if (!hasEnoughReferrals || !hasWatchedEnoughAds) return t('requirements_not_met');
    return `${t('withdraw')} $${getWithdrawalUsdAmount().toFixed(2)} ${t('via')} ${selectedMethod}`;
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-3">

        <div className="space-y-4">
            {isLoadingRequirements && (
              <Card className="bg-[#1C1C1E] border-0 overflow-hidden">
                <CardContent className="p-6 flex items-center justify-center">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    <span className="text-gray-400 text-sm">{t('checking_requirements')}</span>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {hasPendingWithdrawal && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-xs text-yellow-500">
                  {t('pending_withdrawal_warning')}
                </p>
              </div>
            )}

            {!isLoadingRequirements && (
            <>
            <div className="space-y-3">
              <div className="space-y-2">
                {paymentSystems.map((system) => (
                  <button
                    key={system.id}
                    onClick={() => {
                      setSelectedMethod(system.id);
                      if (system.id === 'TON') tonConnectUI.openModal();
                    }}
                    className={`w-full flex items-center p-3 rounded-lg transition-all ${
                      selectedMethod === system.id
                        ? 'bg-[#4cd3ff]/10 ring-1 ring-[#4cd3ff]'
                        : 'bg-[#1C1C1E] hover:bg-[#2C2C2E]'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      selectedMethod === system.id ? 'border-[#4cd3ff] bg-[#4cd3ff]' : 'border-[#aaa]'
                    }`}>
                      {selectedMethod === system.id && <Check className="w-3 h-3 text-black" />}
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-1">
                      <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                        <img src="/images/ton.png" alt="TON" className="w-6 h-6 object-cover" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{system.name}</span>
                        {system.id === 'TON' && (
                          <span className="text-xs font-semibold" style={{ color: isWalletConnected ? '#4ade80' : '#0098EA' }}>
                            {isWalletConnected
                              ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
                              : t('connect')}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-[#aaa] flex-shrink-0">({system.fee}% {t('fee_label')})</span>
                  </button>
                ))}
              </div>

              <div className="p-3 bg-[#1C1C1E] rounded-xl space-y-3">
                <div className="text-xs text-[#aaa]">{t('select_withdrawal_package')}</div>
                
                <div className="grid grid-cols-3 gap-2">
                  {withdrawalPackages.map((pkg) => {
                    const isSelected = selectedPackage === pkg.usd;
                    const canAfford = canAffordPackage(pkg.usd);
                    const isDisabled = !canAfford;
                    
                    return (
                      <button
                        key={pkg.usd}
                        onClick={() => !isDisabled && setSelectedPackage(pkg.usd)}
                        disabled={isDisabled}
                        className={`relative p-2 rounded-lg transition-all text-center ${
                          isSelected
                            ? 'bg-[#4cd3ff]/10 ring-1 ring-[#4cd3ff]'
                            : isDisabled
                              ? 'bg-[#0d0d0d] opacity-40 cursor-not-allowed'
                              : 'bg-[#0d0d0d] hover:bg-[#111]'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#4cd3ff] rounded-full flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-black" />
                          </div>
                        )}
                        <div className="text-sm font-bold text-white">${pkg.usd.toFixed(2)}</div>
                      </button>
                    );
                  })}
                </div>
                  
                <button
                  onClick={() => usdBalance > 0 && setSelectedPackage('FULL')}
                  disabled={usdBalance <= 0}
                  className={`relative w-full p-2 rounded-lg transition-all text-center ${
                    selectedPackage === 'FULL'
                      ? 'bg-[#4cd3ff]/10 ring-1 ring-[#4cd3ff]'
                      : usdBalance <= 0
                        ? 'bg-[#0d0d0d] opacity-40 cursor-not-allowed'
                        : 'bg-[#0d0d0d] hover:bg-[#111]'
                  }`}
                >
                  {selectedPackage === 'FULL' && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#4cd3ff] rounded-full flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-black" />
                    </div>
                  )}
                  <div className="text-sm font-bold text-white">{t('full_balance')}</div>
                  <div className="text-[10px] text-gray-400">${usdBalance.toFixed(2)}</div>
                </button>
                
                <div className="pt-3 space-y-2">
                  <div>
                    <div className="text-xs text-[#aaa]">{t('you_will_receive')}</div>
                    <div className="text-2xl font-bold text-white">${calculateWithdrawalAmount().toFixed(2)}</div>
                  </div>
                  <div className="text-xs text-[#aaa]">
                    {selectedPackage === 'FULL' ? t('full_balance_lower') : `$${(selectedPackage as number).toFixed(2)}`} ({selectedPaymentSystem?.fee}% {t('fee_label')})
                  </div>
                  <div className="text-xs text-yellow-400/80">
                    {t('withdrawal_method')}: {selectedMethod}
                  </div>
                  
                  {withdrawalInviteRequirementEnabled && (
                    <div className={`flex items-center gap-2 text-xs ${hasEnoughReferrals ? 'text-green-400' : 'text-red-400'}`}>
                      <UserPlus className="w-4 h-4" />
                      <span>{t('to_withdraw_need')} {MINIMUM_VALID_REFERRALS_REQUIRED} {MINIMUM_VALID_REFERRALS_REQUIRED !== 1 ? t('friends') : t('friend')}</span>
                      {hasEnoughReferrals && <Check className="w-3 h-3" />}
                    </div>
                  )}
                  
                  {withdrawalAdRequirementEnabled && (
                    <div className="space-y-1.5">
                      <div className={`flex items-center justify-between text-xs ${hasWatchedEnoughAds ? 'text-green-400' : 'text-orange-400'}`}>
                        <div className="flex items-center gap-1.5">
                          <PlayCircle className="w-4 h-4 flex-shrink-0" />
                          <span className="font-semibold">
                            {adsWatchedSinceLastWithdrawal}/{MINIMUM_ADS_FOR_WITHDRAWAL} {t('ads_watched_progress')}
                          </span>
                        </div>
                        {hasWatchedEnoughAds
                          ? <Check className="w-3.5 h-3.5" />
                          : <span className="text-gray-400">{MINIMUM_ADS_FOR_WITHDRAWAL - adsWatchedSinceLastWithdrawal} {t('more_ads_to_watch')}</span>
                        }
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${hasWatchedEnoughAds ? 'bg-green-400' : 'bg-orange-400'}`}
                          style={{ width: `${Math.min(100, (adsWatchedSinceLastWithdrawal / MINIMUM_ADS_FOR_WITHDRAWAL) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Button
                onClick={handleWithdraw}
                disabled={
                  withdrawMutation.isPending || 
                  hasPendingWithdrawal || 
                  usdBalance < getWithdrawalUsdAmount() ||
                  getWithdrawalUsdAmount() <= 0 ||
                  !hasEnoughReferrals ||
                  !hasWatchedEnoughAds
                }
                className="w-full bg-[#4cd3ff] hover:bg-[#6ddeff] text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {withdrawMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('processing')}
                  </>
                ) : getWithdrawButtonLabel()}
              </Button>
            </div>
            </>
            )}

            <div className="mt-6 pt-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-[#4cd3ff]" />
                {t('wallet_activity')}
              </h3>
              {withdrawalsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4cd3ff]" />
                </div>
              ) : withdrawalsData.length === 0 ? (
                <div className="text-center py-6 bg-[#1C1C1E]/50 rounded-xl">
                  <Receipt className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">{t('no_transactions_yet')}</p>
                  <p className="text-gray-600 text-xs mt-1">{t('withdrawal_history_here')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {withdrawalsData.map((withdrawal) => (
                    <div 
                      key={withdrawal.id}
                      className="flex items-center justify-between p-3 bg-[#1C1C1E]/50 rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        {getStatusIcon(withdrawal.status)}
                        <div>
                          <p className="text-sm text-white font-medium">
                            ${formatUSD(getFullAmount(withdrawal))}
                          </p>
                          <p className="text-xs text-gray-500">
                            {format(new Date(withdrawal.createdAt), 'MMM dd, yyyy')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs font-medium capitalize ${getStatusColor(withdrawal.status)}`}>
                          {getStatusLabel(withdrawal.status)}
                        </span>
                        {withdrawal.method && (
                          <p className="text-xs text-gray-500">{withdrawal.method}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

        </div>
      </main>
    </Layout>
  );
}
