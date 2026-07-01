import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { showNotification } from '@/components/AppNotification';
import { Loader2, Check, Receipt, Clock, CheckCircle, XCircle, PlayCircle, UserPlus } from 'lucide-react';
import { getPaymentSystems } from '@/constants/paymentSystems';
import { useLocation } from 'wouter';
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
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');

  const { data: user, refetch: refetchUser } = useQuery<User>({
    queryKey: ['/api/auth/user'],
    retry: false,
    refetchOnMount: true,
  });

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
    refetchOnMount: true,
  });

  const { data: validReferralData, isLoading: isLoadingReferrals, isFetched: isReferralsFetched } = useQuery<{ validReferralCount: number }>({
    queryKey: ['/api/referrals/valid-count'],
    retry: false,
    gcTime: 300000,
    refetchOnMount: true,
  });

  const { data: withdrawalsResponse, refetch: refetchWithdrawals, isLoading: withdrawalsLoading } = useQuery<WithdrawalsResponse>({
    queryKey: ['/api/withdrawals'],
    retry: false,
    refetchOnMount: true,
  });

  const usdBalance = parseFloat(user?.usdBalance || '0');
  const validReferralCount = validReferralData?.validReferralCount ?? 0;

  const withdrawalAdRequirementEnabled = appSettings?.withdrawalAdRequirementEnabled === true;
  const MINIMUM_ADS_FOR_WITHDRAWAL = appSettings?.minimumAdsForWithdrawal ?? 100;
  const withdrawalInviteRequirementEnabled = appSettings?.withdrawalInviteRequirementEnabled === true;
  const MINIMUM_VALID_REFERRALS_REQUIRED = appSettings?.minimumInvitesForWithdrawal ?? 3;

  const minWithdraw: number = parseFloat(appSettings?.minimumWithdrawAmount ?? '0.20');
  const maxWithdraw: number = parseFloat(appSettings?.maximumWithdrawAmount ?? '0.50');
  const maxWithdrawalsPerDay: number = appSettings?.maxWithdrawalsPerDay ?? 1;

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

  const withdrawalsData = withdrawalsResponse?.withdrawals || [];
  const hasPendingWithdrawal = withdrawalsData.some(w => w.status === 'pending');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayWithdrawalCount = withdrawalsData.filter(w => {
    const created = new Date(w.createdAt || w.created_at || '');
    return created >= todayStart && w.status?.toLowerCase() !== 'rejected';
  }).length;
  const hasDailyLimitReached = todayWithdrawalCount >= maxWithdrawalsPerDay;

  useEffect(() => {
    refetchUser();
    refetchWithdrawals();
  }, [refetchUser, refetchWithdrawals]);

  const parsedAmount = parseFloat(withdrawAmount) || 0;
  const amountIsValid = parsedAmount >= minWithdraw && parsedAmount <= maxWithdraw && parsedAmount <= usdBalance;

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const withdrawalData: any = {
        method: selectedMethod,
        amount: parsedAmount,
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
      showNotification(t('withdrawal_request_sent'), 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/withdrawals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['/api/auth/user'] }),
        queryClient.refetchQueries({ queryKey: ['/api/user/stats'] }),
        queryClient.refetchQueries({ queryKey: ['/api/withdrawals'] }),
      ]);
      setWithdrawAmount('');
    },
    onError: (error: any) => {
      const msg = error.message || t('failed');
      if (msg.toLowerCase().includes('minimum')) {
        showNotification(`${t('minimum')} $${minWithdraw.toFixed(2)}`, 'error');
      } else if (msg.toLowerCase().includes('pending')) {
        showNotification(t('pending_withdrawal_warning'), 'error');
      } else if (msg.toLowerCase().includes('insufficient')) {
        showNotification(t('insufficient_balance'), 'error');
      } else {
        showNotification(msg, 'error');
      }
    },
  });

  const handleWithdraw = () => {
    if (!hasEnoughReferrals) {
      const remaining = MINIMUM_VALID_REFERRALS_REQUIRED - validReferralCount;
      showNotification(`${t('invite_friends')}: ${remaining} ${remaining !== 1 ? t('friends') : t('friend')}`, 'error');
      return;
    }
    if (!hasWatchedEnoughAds) {
      const remaining = MINIMUM_ADS_FOR_WITHDRAWAL - adsWatchedSinceLastWithdrawal;
      showNotification(`${t('watch')} ${remaining} ${t('ads_count')}`, 'error');
      return;
    }
    if (hasPendingWithdrawal) {
      showNotification(t('pending_withdrawal_warning'), 'error');
      return;
    }
    if (selectedMethod === 'TON' && !connectedAddress) {
      showNotification(t('connect') + ' TON wallet', 'error');
      return;
    }
    if (!withdrawAmount || parsedAmount <= 0) {
      showNotification(t('enter_withdrawal_amount'), 'error');
      return;
    }
    if (parsedAmount < minWithdraw) {
      showNotification(`${t('minimum')} $${minWithdraw.toFixed(2)}`, 'error');
      return;
    }
    if (parsedAmount > maxWithdraw) {
      showNotification(`Maximum $${maxWithdraw.toFixed(2)}`, 'error');
      return;
    }
    if (parsedAmount > usdBalance) {
      showNotification(t('insufficient_balance'), 'error');
      return;
    }
    withdrawMutation.mutate();
  };

  const paymentSystems = getPaymentSystems(appSettings);

  const getStatusIcon = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('approved') || s.includes('success') || s.includes('paid')) return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (s.includes('reject')) return <XCircle className="w-4 h-4 text-red-500" />;
    if (s.includes('pending')) return <Clock className="w-4 h-4 text-yellow-500" />;
    return <Loader2 className="w-4 h-4 text-gray-500" />;
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('approved') || s.includes('success') || s.includes('paid')) return 'text-green-500';
    if (s.includes('reject')) return 'text-red-500';
    if (s.includes('pending')) return 'text-yellow-500';
    return 'text-gray-500';
  };

  const getStatusLabel = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('approved') || s.includes('success') || s.includes('paid')) return t('completed');
    if (s.includes('reject')) return t('rejected');
    if (s.includes('pending')) return t('pending');
    return status;
  };

  const getFullAmount = (withdrawal: Withdrawal): string => {
    if (typeof withdrawal.details === 'object' && withdrawal.details?.totalDeducted) {
      return withdrawal.details.totalDeducted;
    }
    return withdrawal.amount;
  };

  const getButtonLabel = () => {
    if (withdrawMutation.isPending) return t('processing');
    if (!withdrawAmount || parsedAmount <= 0) return t('enter_withdrawal_amount');
    if (parsedAmount < minWithdraw) return `${t('minimum')} $${minWithdraw.toFixed(2)}`;
    if (parsedAmount > maxWithdraw) return `Maximum $${maxWithdraw.toFixed(2)}`;
    if (parsedAmount > usdBalance) return t('insufficient_balance');
    if (!hasEnoughReferrals || !hasWatchedEnoughAds) return t('requirements_not_met');
    return `${t('withdraw')} $${parsedAmount.toFixed(2)} ${t('via')} ${selectedMethod}`;
  };

  const isButtonDisabled =
    withdrawMutation.isPending ||
    hasPendingWithdrawal ||
    hasDailyLimitReached ||
    !amountIsValid ||
    !hasEnoughReferrals ||
    !hasWatchedEnoughAds;

  const selectedPaymentSystem = paymentSystems.find(s => s.id === selectedMethod);
  const feePercent = selectedPaymentSystem?.fee ?? 5;
  const netAmount = parsedAmount > 0 ? parsedAmount * (1 - feePercent / 100) : 0;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-3">
        <div className="space-y-4">

          {isLoadingRequirements && (
            <div className="p-6 flex items-center justify-center bg-[#1C1C1E] rounded-xl">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <span className="text-gray-400 text-sm">{t('checking_requirements')}</span>
              </div>
            </div>
          )}

          {hasPendingWithdrawal && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-xs text-yellow-500">{t('pending_withdrawal_warning')}</p>
            </div>
          )}

          {hasDailyLimitReached && !hasPendingWithdrawal && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2">
              <span className="text-red-400 mt-0.5">🚫</span>
              <p className="text-xs text-red-400">
                Daily limit reached — you can only withdraw <strong>{maxWithdrawalsPerDay}</strong> time{maxWithdrawalsPerDay !== 1 ? 's' : ''} per day. Try again tomorrow.
              </p>
            </div>
          )}

          {!isLoadingRequirements && (
            <>
              <div className="space-y-3">
                {/* Payment method selection */}
                <div className="space-y-2">
                  {paymentSystems.map((system) => (
                    <div key={system.id} className="relative">
                      <button
                        onClick={() => {
                          setSelectedMethod(system.id);
                          if (system.id === 'TON' && !isWalletConnected) tonConnectUI.openModal();
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
                      </button>

                      {system.id === 'TON' && isWalletConnected && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await tonConnectUI.disconnect();
                          }}
                          title="Disconnect wallet"
                          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                            <polyline points="16 17 21 12 16 7"/>
                            <line x1="21" y1="12" x2="9" y2="12"/>
                          </svg>
                          Change
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Custom amount input */}
                <div className="p-4 bg-[#1C1C1E] rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#aaa]">{t('enter_withdrawal_amount')}</span>
                    <span className="text-xs text-[#aaa]">
                      {t('available')}: <span className="text-white font-semibold">${usdBalance.toFixed(3)}</span>
                    </span>
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white font-bold text-lg">$</span>
                    <input
                      type="number"
                      min={minWithdraw}
                      max={Math.min(maxWithdraw, usdBalance)}
                      step="0.01"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Enter amount"
                      className="w-full bg-[#0d0d0d] text-white text-lg font-bold rounded-lg pl-8 pr-4 py-3 outline-none border border-white/10 focus:border-[#4cd3ff]/50 transition-colors placeholder:text-gray-600"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#666]">Min: <span className="text-[#aaa]">${minWithdraw.toFixed(2)}</span></span>
                    <button
                      onClick={() => setWithdrawAmount(Math.min(maxWithdraw, usdBalance).toFixed(2))}
                      className="text-[#4cd3ff] font-semibold hover:underline text-xs"
                    >
                      Max ${Math.min(maxWithdraw, usdBalance).toFixed(2)}
                    </button>
                    <span className="text-[#666]">Max: <span className="text-[#aaa]">${maxWithdraw.toFixed(2)}</span></span>
                  </div>

                  {/* Requirements */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2 text-xs text-[#aaa]">
                      <span>💸</span>
                      <span>{feePercent}% {t('fee_label')}</span>
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

                {/* You will receive */}
                {parsedAmount > 0 && (
                  <div className="p-3 bg-[#0d0d0d] rounded-xl border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[#aaa] text-xs">You will receive</span>
                      <span className="text-xs text-[#555]">({feePercent}% fee deducted)</span>
                    </div>
                    <span className={`text-base font-bold ${amountIsValid ? 'text-green-400' : 'text-gray-500'}`}>
                      ${netAmount.toFixed(3)}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <Button
                  onClick={handleWithdraw}
                  disabled={isButtonDisabled}
                  className="w-full bg-[#4cd3ff] hover:bg-[#6ddeff] text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {withdrawMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('processing')}
                    </>
                  ) : getButtonLabel()}
                </Button>
              </div>
            </>
          )}

          {/* Withdrawal history */}
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
                          ${parseFloat(getFullAmount(withdrawal)).toFixed(2)}
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
