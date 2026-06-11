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
  
  // Dynamic BUG requirement: scales with selected package or full balance
  const withdrawalStarRequirementEnabled = appSettings?.withdrawalStarRequirementEnabled !== false;
  const starPerUsd = appSettings?.starPerUsd ?? 10000;
  
  // Withdrawal packages from admin settings - compute BUG requirements using starPerUsd
  const defaultPackages = [
    {usd: 0.2},
    {usd: 0.4},
    {usd: 0.8}
  ];
  const rawPackages = appSettings?.withdrawalPackages || defaultPackages;
  const withdrawalPackages = rawPackages.map((pkg: {usd: number, bug?: number}) => ({
    usd: pkg.usd,
    bug: pkg.bug ?? Math.ceil(pkg.usd * starPerUsd)
  }));
  
  // Get the withdrawal amount based on selected package
  const getWithdrawalUsdAmount = () => {
    if (selectedPackage === 'FULL') {
      return usdBalance;
    }
    return selectedPackage;
  };
  
  // Calculate BUG requirement based on selected package - always use starPerUsd for consistency
  const getBugRequirementForAmount = (usdAmount: number) => {
    return Math.ceil(usdAmount * starPerUsd);
  };
  
  const getPackageBugRequirement = () => {
    if (selectedPackage === 'FULL') {
      return getBugRequirementForAmount(usdBalance);
    }
    return getBugRequirementForAmount(selectedPackage as number);
  };
  
  const minimumStarForWithdrawal = getPackageBugRequirement();
  
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
  const hasEnoughBug = !withdrawalStarRequirementEnabled || starBalance >= minimumStarForWithdrawal;

  const botUsername = import.meta.env.VITE_BOT_USERNAME || '';
  // Use bot deep link format (?start=) for reliable referral tracking
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
            tgWebApp.shareMessage(data.messageId, (success: boolean) => {
              setIsSharing(false);
            });
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
        throw new Error(data.message || 'Failed to submit withdrawal request');
      }
      
      return data;
    },
    onSuccess: async () => {
      showNotification("You have sent a withdrawal request.", "success");
      
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
      const errorMessage = error.message || "Failed to submit withdrawal request";
      
      if (errorMessage.toLowerCase().includes("minimum") || errorMessage === "minimum withdrawal") {
        const minAmount = selectedPaymentSystem?.minWithdrawal || 1;
        showNotification(`minimum $${minAmount}`, "error");
      } else if (errorMessage.toLowerCase().includes("pending")) {
        showNotification("You already have a pending withdrawal. Please wait for it to be processed.", "error");
      } else if (errorMessage.toLowerCase().includes("insufficient")) {
        showNotification("Insufficient balance for withdrawal. Please convert POW to USD first.", "error");
      } else {
        showNotification(errorMessage, "error");
      }
    },
  });

  const handleWithdraw = () => {
    if (!hasEnoughReferrals) {
      const remaining = MINIMUM_VALID_REFERRALS_REQUIRED - validReferralCount;
      showNotification(`Invite ${remaining} more friend${remaining !== 1 ? 's' : ''} who watch${remaining !== 1 ? '' : 'es'} at least 1 ad to unlock withdrawals.`, "error");
      return;
    }
    
    if (!hasWatchedEnoughAds) {
      const remaining = MINIMUM_ADS_FOR_WITHDRAWAL - adsWatchedSinceLastWithdrawal;
      showNotification(`Watch ${remaining} more ad${remaining !== 1 ? 's' : ''} to unlock this withdrawal.`, "error");
      return;
    }
    
    if (!hasEnoughBug) {
      const remaining = Math.ceil(minimumStarForWithdrawal - starBalance);
      showNotification(`You need ${remaining.toLocaleString()} more STAR to withdraw. Watch ads or complete tasks to earn STAR.`, "error");
      return;
    }

    if (hasPendingWithdrawal) {
      showNotification("Cannot create new request until current one is processed.", "error");
      return;
    }

    if (selectedMethod === 'TON' && !connectedAddress) {
      showNotification("Please connect your TON wallet first using the Connect button at the top.", "error");
      return;
    }

    const withdrawAmount = getWithdrawalUsdAmount();
    if (withdrawAmount <= 0 || usdBalance < withdrawAmount) {
      showNotification("Insufficient balance for this withdrawal package", "error");
      return;
    }

    console.log('💸 Submitting withdrawal:', {
      method: selectedMethod,
      package: selectedPackage,
      tonWalletAddress: connectedAddress ? `${connectedAddress.slice(0, 8)}...` : 'not connected',
    });

    withdrawMutation.mutate();
  };

  const paymentSystems = getPaymentSystems(appSettings);
  const selectedPaymentSystem = paymentSystems.find(p => p.id === selectedMethod);
  
  const calculateWithdrawalAmount = () => {
    const feePercent = selectedPaymentSystem?.fee || 5;
    const withdrawAmount = getWithdrawalUsdAmount();
    return withdrawAmount * (1 - feePercent / 100);
  };
  
  // Check if user can afford a package
  const canAffordPackage = (pkgUsd: number | 'FULL') => {
    if (pkgUsd === 'FULL') return usdBalance > 0;
    return usdBalance >= pkgUsd;
  };
  
  // Check if user has enough BUG for a package - use consistent starPerUsd calculation
  const hasEnoughBugForPackage = (pkgUsd: number | 'FULL') => {
    if (!withdrawalStarRequirementEnabled) return true;
    const usdAmount = pkgUsd === 'FULL' ? usdBalance : pkgUsd;
    const required = getBugRequirementForAmount(usdAmount);
    return starBalance >= required;
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

  const formatUSD = (amount: string) => {
    return parseFloat(amount).toFixed(2);
  };

  const getFullAmount = (withdrawal: Withdrawal): string => {
    if (typeof withdrawal.details === 'object' && withdrawal.details?.totalDeducted) {
      return withdrawal.details.totalDeducted;
    }
    return withdrawal.amount;
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
                    <span className="text-gray-400 text-sm">Checking requirements...</span>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {hasPendingWithdrawal && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-xs text-yellow-500">
                  You have a pending withdrawal. Please wait for it to be processed.
                </p>
              </div>
            )}

            {!isLoadingRequirements && (
            <>
            {/* Wallet Status Banner */}
            {selectedMethod === 'TON' && !isWalletConnected && (
              <div className="p-3 bg-orange-500/10 border border-orange-500/25 rounded-xl flex items-start gap-3">
                <Wallet className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-orange-400">Wallet Not Connected</p>
                  <p className="text-xs text-orange-300/70 mt-0.5">Tap the <strong>Connect</strong> button at the top to link your TON wallet before withdrawing.</p>
                </div>
              </div>
            )}
            {selectedMethod === 'TON' && isWalletConnected && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3">
                <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                <p className="text-xs text-green-400 font-medium">
                  Wallet connected: {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
                </p>
              </div>
            )}
            <div className="space-y-3">
              <div className="space-y-2">
                {paymentSystems.map((system) => (
                  <button
                    key={system.id}
                    onClick={() => setSelectedMethod(system.id)}
                    className={`w-full flex items-center space-x-2 p-3 rounded-lg transition-all ${
                      selectedMethod === system.id
                        ? 'bg-[#4cd3ff]/10 ring-1 ring-[#4cd3ff]'
                        : 'bg-[#1C1C1E] hover:bg-[#2C2C2E]'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selectedMethod === system.id ? 'border-[#4cd3ff] bg-[#4cd3ff]' : 'border-[#aaa]'
                    }`}>
                      {selectedMethod === system.id && <Check className="w-3 h-3 text-black" />}
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center">
                        <img src="/images/ton.png" alt="TON" className="w-6 h-6 object-cover" />
                      </div>
                      <span className="text-white">{system.name}</span>
                      <span className="text-xs text-[#aaa] ml-auto">({system.fee}% fee)</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="p-3 bg-[#1C1C1E] rounded-xl space-y-3">
                <div className="text-xs text-[#aaa]">Select Withdrawal Package</div>
                
                <div className="grid grid-cols-3 gap-2">
                  {withdrawalPackages.map((pkg) => {
                    const isSelected = selectedPackage === pkg.usd;
                    const canAfford = canAffordPackage(pkg.usd);
                    const hasBug = hasEnoughBugForPackage(pkg.usd);
                    const bugRequired = getBugRequirementForAmount(pkg.usd);
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
                        {withdrawalStarRequirementEnabled && (
                          <div className={`text-[10px] flex items-center justify-center gap-0.5 ${hasBug ? 'text-green-400' : 'text-red-400'}`}>
                            <div className="w-3 h-3 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                              <img src="/star-bug.png" alt="STAR" className="w-3 h-3 object-cover" />
                            </div>
                            {bugRequired.toLocaleString()}
                          </div>
                        )}
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
                  <div className="text-sm font-bold text-white">FULL BALANCE</div>
                  <div className="text-[10px] text-gray-400">${usdBalance.toFixed(2)}</div>
                  {withdrawalStarRequirementEnabled && (
                    <div className={`text-[10px] flex items-center justify-center gap-0.5 ${hasEnoughBugForPackage('FULL') ? 'text-green-400' : 'text-red-400'}`}>
                      <div className="w-3 h-3 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                        <img src="/star-bug.png" alt="STAR" className="w-3 h-3 object-cover" />
                      </div>
                      {Math.ceil(usdBalance * starPerUsd).toLocaleString()} STAR
                    </div>
                  )}
                </button>
                
                <div className="pt-3 space-y-2">
                  <div>
                    <div className="text-xs text-[#aaa]">You will receive</div>
                    <div className="text-2xl font-bold text-white">${calculateWithdrawalAmount().toFixed(2)}</div>
                  </div>
                  <div className="text-xs text-[#aaa]">
                    {selectedPackage === 'FULL' ? 'Full balance' : `$${(selectedPackage as number).toFixed(2)}`} withdrawal ({selectedPaymentSystem?.fee}% fee deducted)
                  </div>
                  <div className="text-xs text-yellow-400/80">
                    Withdrawal method: {selectedMethod}
                  </div>
                  
                  {withdrawalStarRequirementEnabled && getWithdrawalUsdAmount() > 0 && (
                    <div className={`flex items-center gap-2 text-xs ${hasEnoughBug ? 'text-green-400' : 'text-red-400'}`}>
                      <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                        <img src="/star-bug.png" alt="STAR" className="w-4 h-4 object-cover" />
                      </div>
                      <span>STAR Required: {minimumStarForWithdrawal.toLocaleString()} (You have: {Math.floor(starBalance).toLocaleString()})</span>
                      {hasEnoughBug && <Check className="w-3 h-3" />}
                    </div>
                  )}
                  
                  {withdrawalInviteRequirementEnabled && (
                    <div className={`flex items-center gap-2 text-xs ${hasEnoughReferrals ? 'text-green-400' : 'text-red-400'}`}>
                      <UserPlus className="w-4 h-4" />
                      <span>To withdraw you need: {MINIMUM_VALID_REFERRALS_REQUIRED} friend{MINIMUM_VALID_REFERRALS_REQUIRED !== 1 ? 's' : ''}</span>
                      {hasEnoughReferrals && <Check className="w-3 h-3" />}
                    </div>
                  )}
                  
                  {withdrawalAdRequirementEnabled && (
                    <div className={`flex items-center gap-2 text-xs ${hasWatchedEnoughAds ? 'text-green-400' : 'text-red-400'}`}>
                      <PlayCircle className="w-4 h-4" />
                      <span>To withdraw you need: {MINIMUM_ADS_FOR_WITHDRAWAL} ads</span>
                      {hasWatchedEnoughAds && <Check className="w-3 h-3" />}
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
                  !hasWatchedEnoughAds ||
                  !hasEnoughBug
                }
                className="w-full bg-[#4cd3ff] hover:bg-[#6ddeff] text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {withdrawMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : getWithdrawalUsdAmount() <= 0 ? 'Select a Package' : usdBalance < getWithdrawalUsdAmount() ? 'Insufficient Balance' : (!hasEnoughReferrals || !hasWatchedEnoughAds || !hasEnoughBug) ? 'Requirements Not Met' : `Withdraw $${getWithdrawalUsdAmount().toFixed(2)} via ${selectedMethod}`}
              </Button>
            </div>
            </>
            )}

            <div className="mt-6 pt-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-[#4cd3ff]" />
                Wallet Activity
              </h3>
              {withdrawalsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4cd3ff]" />
                </div>
              ) : withdrawalsData.length === 0 ? (
                <div className="text-center py-6 bg-[#1C1C1E]/50 rounded-xl">
                  <Receipt className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">No transactions yet</p>
                  <p className="text-gray-600 text-xs mt-1">Your withdrawal history will appear here</p>
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
                          {withdrawal.status}
                        </span>
                        <p className="text-xs text-gray-500">
                          {withdrawal.method || 'TON'}
                        </p>
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
