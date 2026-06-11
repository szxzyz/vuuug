import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import AdWatchingSection from "@/components/AdWatchingSection";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useAdmin } from "@/hooks/useAdmin";
import { useAdFlow } from "@/hooks/useAdFlow";
import { useLocation } from "wouter";
import { Award, Wallet, RefreshCw, Flame, Ticket, Clock, Loader2, Gift, Rocket, X, Bug, DollarSign, Coins, Send, Users, Check, ExternalLink, Plus, CalendarCheck, Bell } from "lucide-react";
import { DiamondIcon } from "@/components/DiamondIcon";
import { Button } from "@/components/ui/button";
import { showNotification } from "@/components/AppNotification";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { AnimatePresence, motion } from "framer-motion";

interface UnifiedTask {
  id: string;
  type: 'advertiser';
  taskType: string;
  title: string;
  link: string | null;
  rewardPAD: number;
  rewardBUG?: number;
  rewardType: string;
  isAdminTask: boolean;
  isAdvertiserTask?: boolean;
  priority: number;
}

declare global {
  interface Window {
    show_10401872: (type?: string | { type: string; inAppSettings: any }) => Promise<void>;
    Adsgram: {
      init: (config: { blockId: string }) => {
        show: () => Promise<void>;
      };
    };
  }
}

interface User {
  id?: string;
  telegramId?: string;
  balance?: string;
  usdBalance?: string;
  bugBalance?: string;
  lastStreakDate?: string;
  username?: string;
  firstName?: string;
  telegramUsername?: string;
  referralCode?: string;
  [key: string]: any;
}

export default function Home() {
  const { user, isLoading } = useAuth();
  const { isAdmin } = useAdmin();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [isConverting, setIsConverting] = useState(false);
  const [isClaimingStreak, setIsClaimingStreak] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [hasClaimed, setHasClaimed] = useState(false);
  const [timeUntilNextClaim, setTimeUntilNextClaim] = useState<string>("");
  
  const [promoPopupOpen, setPromoPopupOpen] = useState(false);
  const [convertPopupOpen, setConvertPopupOpen] = useState(false);
  const [boosterPopupOpen, setBoosterPopupOpen] = useState(false);
  const [selectedConvertType, setSelectedConvertType] = useState<'USD' | 'TON' | 'BUG'>('USD');
  const [convertAmount, setConvertAmount] = useState<string>("");
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  
  const [shareWithFriendsStep, setShareWithFriendsStep] = useState<'idle' | 'sharing' | 'countdown' | 'ready' | 'claiming'>('idle');
  const [dailyCheckinStep, setDailyCheckinStep] = useState<'idle' | 'ads' | 'countdown' | 'ready' | 'claiming'>('idle');
  const [checkForUpdatesStep, setCheckForUpdatesStep] = useState<'idle' | 'opened' | 'countdown' | 'ready' | 'claiming'>('idle');
  const [checkForUpdatesCountdown, setCheckForUpdatesCountdown] = useState(3);

  const { runAdFlow } = useAdFlow();

  const { data: leaderboardData } = useQuery<{
    userEarnerRank?: { rank: number; totalEarnings: string } | null;
  }>({
    queryKey: ['/api/leaderboard/monthly'],
    retry: false,
  });

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  const { data: unifiedTasksData, isLoading: isLoadingTasks } = useQuery<{
    success: boolean;
    tasks: UnifiedTask[];
    completedTaskIds: string[];
    referralCode?: string;
  }>({
    queryKey: ['/api/tasks/home/unified'],
    queryFn: async () => {
      const res = await fetch('/api/tasks/home/unified', { credentials: 'include' });
      if (!res.ok) return { success: true, tasks: [], completedTaskIds: [] };
      return res.json();
    },
    retry: false,
  });

  const { data: missionStatus } = useQuery<any>({
    queryKey: ['/api/missions/status'],
    retry: false,
  });

  const { data: userData } = useQuery<{ referralCode?: string }>({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 30000,
  });

  useEffect(() => {
    if (unifiedTasksData?.completedTaskIds) {
      setCompletedTasks(new Set(unifiedTasksData.completedTaskIds));
    } else {
      setCompletedTasks(new Set());
    }
  }, [unifiedTasksData]);

  const currentTask = unifiedTasksData?.tasks?.[0] || null;

  React.useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const typedUser = user as User;
      
      if (typedUser?.id) {
        const claimedTimestamp = localStorage.getItem(`streak_claimed_${typedUser.id}`);
        if (claimedTimestamp) {
          const claimedDate = new Date(claimedTimestamp);
          const nextClaimTime = new Date(claimedDate.getTime() + 5 * 60 * 1000);
          
          if (now.getTime() < nextClaimTime.getTime()) {
            setHasClaimed(true);
            const diff = nextClaimTime.getTime() - now.getTime();
            const minutes = Math.floor(diff / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            setTimeUntilNextClaim(`${minutes}:${seconds.toString().padStart(2, '0')}`);
            return;
          } else {
            setHasClaimed(false);
            localStorage.removeItem(`streak_claimed_${typedUser.id}`);
          }
        }
      }
      
      if ((user as User)?.lastStreakDate) {
        const lastClaim = new Date((user as User).lastStreakDate!);
        const minutesSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1000 * 60);
        
        if (minutesSinceLastClaim < 5) {
          setHasClaimed(true);
          const nextClaimTime = new Date(lastClaim.getTime() + 5 * 60 * 1000);
          const diff = nextClaimTime.getTime() - now.getTime();
          const minutes = Math.floor(diff / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setTimeUntilNextClaim(`${minutes}:${seconds.toString().padStart(2, '0')}`);
          return;
        }
      }
      
      setHasClaimed(false);
      setTimeUntilNextClaim("Available now");
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [(user as User)?.lastStreakDate, (user as User)?.id]);

  const convertMutation = useMutation({
    mutationFn: async ({ amount, convertTo }: { amount: number; convertTo: string }) => {
      const res = await fetch("/api/convert-to-usd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ padAmount: amount, convertTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to convert");
      }
      return data;
    },
    onSuccess: async () => {
      showNotification("Convert successful.", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setConvertPopupOpen(false);
    },
    onError: (error: Error) => {
      showNotification(error.message, "error");
    },
  });

  const claimStreakMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/streak/claim");
      if (!response.ok) {
        const error = await response.json();
        const errorObj = new Error(error.message || 'Failed to claim streak');
        (errorObj as any).isAlreadyClaimed = error.message === "Please wait 5 minutes before claiming again!";
        throw errorObj;
      }
      return response.json();
    },
    onSuccess: (data) => {
      setHasClaimed(true);
      const typedUser = user as User;
      if (typedUser?.id) {
        localStorage.setItem(`streak_claimed_${typedUser.id}`, new Date().toISOString());
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      const rewardAmount = parseFloat(data.rewardEarned || '0');
      if (rewardAmount > 0) {
        const earnedPAD = Math.round(rewardAmount);
        showNotification(`You've claimed +${earnedPAD} PAD!`, "success");
      } else {
        showNotification("You've claimed your streak bonus!", "success");
      }
    },
    onError: (error: any) => {
      const notificationType = error.isAlreadyClaimed ? "info" : "error";
      showNotification(error.message || "Failed to claim streak", notificationType);
      if (error.isAlreadyClaimed) {
        setHasClaimed(true);
        const typedUser = user as User;
        if (typedUser?.id) {
          localStorage.setItem(`streak_claimed_${typedUser.id}`, new Date().toISOString());
        }
      }
    },
    onSettled: () => {
      setIsClaimingStreak(false);
    },
  });

  const redeemPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Invalid promo code");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      setPromoPopupOpen(false);
      setIsApplyingPromo(false);
      showNotification(data.message || "Promo applied successfully!", "success");
    },
    onError: (error: any) => {
      const message = error.message || "Invalid promo code";
      showNotification(message, "error");
      setIsApplyingPromo(false);
    },
  });

  const advertiserTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/advertiser-tasks/${taskId}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to complete task');
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      await queryClient.refetchQueries({ queryKey: ['/api/tasks/home/unified'] });
      const padReward = Number(data.reward ?? 0);
      const bugReward = Number(data.bugReward ?? 0);
      if (bugReward > 0) {
        showNotification(`+${padReward.toLocaleString()} PAD, +${bugReward} BUG`, 'success');
      } else {
        showNotification(`+${padReward.toLocaleString()} PAD`, 'success');
      }
    },
    onError: (error: any) => {
      showNotification(error.message || 'Failed to complete task', 'error');
    },
  });

  const handleUnifiedTask = (task: UnifiedTask) => {
    if (!task) return;
    
    if (task.link) {
      window.open(task.link, '_blank');
      setTimeout(() => advertiserTaskMutation.mutate(task.id), 2000);
    } else {
      advertiserTaskMutation.mutate(task.id);
    }
  };

  const getTaskIcon = (task: UnifiedTask) => {
    return task.taskType === 'channel' ? <Send className="w-4 h-4" /> : 
           task.taskType === 'bot' ? <ExternalLink className="w-4 h-4" /> :
           <ExternalLink className="w-4 h-4" />;
  };

  const isTaskPending = advertiserTaskMutation.isPending;

  const showAdsgramAd = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (window.Adsgram) {
        try {
          await window.Adsgram.init({ blockId: "int-20373" }).show();
          resolve(true);
        } catch (error) {
          console.error('Adsgram ad error:', error);
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  };

  const showMonetagAd = (): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      if (typeof window.show_10401872 === 'function') {
        window.show_10401872()
          .then(() => {
            resolve({ success: true, unavailable: false });
          })
          .catch((error) => {
            console.error('Monetag ad error:', error);
            resolve({ success: false, unavailable: false });
          });
      } else {
        resolve({ success: false, unavailable: true });
      }
    });
  };

  const showMonetagRewardedAd = (): Promise<{ success: boolean; unavailable: boolean }> => {
    return new Promise((resolve) => {
      console.log('🎬 Attempting to show Monetag rewarded ad...');
      if (typeof window.show_10401872 === 'function') {
        console.log('✅ Monetag SDK found, calling rewarded ad...');
        window.show_10401872()
          .then(() => {
            console.log('✅ Monetag rewarded ad completed successfully');
            resolve({ success: true, unavailable: false });
          })
          .catch((error) => {
            console.error('❌ Monetag rewarded ad error:', error);
            resolve({ success: false, unavailable: false });
          });
      } else {
        console.log('⚠️ Monetag SDK not available, skipping ad');
        resolve({ success: false, unavailable: true });
      }
    });
  };

  const handleConvertClick = () => {
    setConvertPopupOpen(true);
  };

  const handleConvertConfirm = async () => {
    const amount = parseFloat(convertAmount);
    if (isNaN(amount) || amount <= 0) {
      showNotification("Please enter a valid amount", "error");
      return;
    }

    const minimumConvertPAD = selectedConvertType === 'USD' 
      ? (appSettings?.minimumConvertPAD || 10000)
      : selectedConvertType === 'TON'
        ? (appSettings?.minimumConvertPadToTon || 10000)
        : (appSettings?.minimumConvertPadToBug || 1000);
    
    if (amount < minimumConvertPAD) {
      showNotification(`Minimum ${minimumConvertPAD.toLocaleString()} PAD required.`, "error");
      return;
    }

    if (balancePAD < amount) {
      showNotification("Insufficient PAD balance", "error");
      return;
    }

    if (isConverting || convertMutation.isPending) return;
    
    setIsConverting(true);
    console.log('💱 Convert started, showing AdsGram ad first...');
    
    try {
      // Show AdsGram int-20373 first
      const adsgramSuccess = await showAdsgramAd();
      
      if (!adsgramSuccess) {
        showNotification("Please watch the ad to convert.", "error");
        setIsConverting(false);
        return;
      }
      
      // Then show Monetag rewarded ad
      console.log('🎬 AdsGram complete, showing Monetag rewarded...');
      const monetagResult = await showMonetagRewardedAd();
      
      if (monetagResult.unavailable) {
        // If Monetag unavailable, proceed with just AdsGram
        console.log('⚠️ Monetag unavailable, proceeding with convert');
        convertMutation.mutate({ amount, convertTo: selectedConvertType });
        return;
      }
      
      if (!monetagResult.success) {
        showNotification("Please watch the ad to convert.", "error");
        setIsConverting(false);
        return;
      }
      
      console.log('✅ Both ads watched, converting');
      convertMutation.mutate({ amount, convertTo: selectedConvertType });
      
    } catch (error) {
      console.error('Convert error:', error);
      showNotification("Something went wrong. Please try again.", "error");
    } finally {
      setIsConverting(false);
    }
  };

  const handleClaimStreak = async () => {
    if (isClaimingStreak || hasClaimed) return;
    
    setIsClaimingStreak(true);
    
    try {
      // Show AdsGram int-20373 first
      const adsgramSuccess = await showAdsgramAd();
      
      if (!adsgramSuccess) {
        showNotification("Please watch the ad completely to claim your bonus.", "error");
        setIsClaimingStreak(false);
        return;
      }
      
      // Then show Monetag rewarded ad
      const monetagResult = await showMonetagRewardedAd();
      
      if (monetagResult.unavailable) {
        // If Monetag unavailable, proceed with just AdsGram
        claimStreakMutation.mutate();
        return;
      }
      
      if (!monetagResult.success) {
        showNotification("Please watch the ad completely to claim your bonus.", "error");
        setIsClaimingStreak(false);
        return;
      }
      
      claimStreakMutation.mutate();
    } catch (error) {
      console.error('Streak claim failed:', error);
      showNotification("Failed to claim streak. Please try again.", "error");
      setIsClaimingStreak(false);
    }
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      showNotification("Please enter a promo code", "error");
      return;
    }

    if (isApplyingPromo || redeemPromoMutation.isPending) return;
    
    setIsApplyingPromo(true);
    console.log('🎫 Promo code claim started, showing AdsGram ad first...');
    
    try {
      // Show AdsGram int-20373 first
      const adsgramSuccess = await showAdsgramAd();
      
      if (!adsgramSuccess) {
        showNotification("Please watch the ad to claim your promo code.", "error");
        setIsApplyingPromo(false);
        return;
      }
      
      // Then show Monetag rewarded ad
      console.log('🎬 AdsGram complete, showing Monetag rewarded...');
      const monetagResult = await showMonetagRewardedAd();
      
      if (monetagResult.unavailable) {
        // If Monetag unavailable, proceed with just AdsGram
        console.log('⚠️ Monetag unavailable, proceeding with promo claim');
        redeemPromoMutation.mutate(promoCode.trim().toUpperCase());
        return;
      }
      
      if (!monetagResult.success) {
        showNotification("Please watch the ad to claim your promo code.", "error");
        setIsApplyingPromo(false);
        return;
      }
      
      console.log('✅ Both ads watched, claiming promo code');
      redeemPromoMutation.mutate(promoCode.trim().toUpperCase());
    } catch (error) {
      console.error('Promo claim error:', error);
      showNotification("Something went wrong. Please try again.", "error");
      setIsApplyingPromo(false);
    }
  };

  const handleBoosterClick = () => {
    setBoosterPopupOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1 justify-center mb-4">
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
          <div className="text-foreground font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  const rawBalance = parseFloat((user as User)?.balance || "0");
  const balancePAD = rawBalance < 1 ? Math.round(rawBalance * 10000000) : Math.round(rawBalance);
  const balanceUSD = parseFloat((user as User)?.usdBalance || "0");
  const balanceBUG = parseFloat((user as User)?.bugBalance || "0");
  
  const userUID = (user as User)?.referralCode || "00000";

  const photoUrl = typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.photo_url;
  
  const getDisplayName = (): string => {
    const typedUser = user as User;
    if (typedUser?.firstName) {
      return typedUser.firstName;
    }
    return 'Guest';
  };
  
  const displayName = getDisplayName();
  const userRank = leaderboardData?.userEarnerRank?.rank;
  const canClaimStreak = timeUntilNextClaim === "Available now" && !hasClaimed;

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'PaidAdzbot';
  const webAppName = import.meta.env.VITE_WEBAPP_NAME || 'app';
  const referralLink = userData?.referralCode 
    ? `https://t.me/${botUsername}/${webAppName}?startapp=${userData.referralCode}`
    : '';

  // Mutation handlers for Daily Tasks
  const shareWithFriendsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/missions/share-story/claim', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      return response.json();
    },
    onSuccess: (data) => {
      showNotification(`+${data.reward} PAD claimed!`, 'success');
      setShareWithFriendsStep('idle');
      queryClient.invalidateQueries({ queryKey: ['/api/missions/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (error: Error) => {
      showNotification(error.message, 'error');
      setShareWithFriendsStep('idle');
    },
  });

  const dailyCheckinMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/missions/daily-checkin/claim', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      return response.json();
    },
    onSuccess: (data) => {
      showNotification(`+${data.reward} PAD claimed!`, 'success');
      setDailyCheckinStep('idle');
      queryClient.invalidateQueries({ queryKey: ['/api/missions/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (error: Error) => {
      showNotification(error.message, 'error');
      setDailyCheckinStep('idle');
    },
  });

  const checkForUpdatesMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/missions/check-for-updates/claim', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      return response.json();
    },
    onSuccess: (data) => {
      showNotification(`+${data.reward} PAD claimed!`, 'success');
      setCheckForUpdatesStep('idle');
      queryClient.invalidateQueries({ queryKey: ['/api/missions/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (error: Error) => {
      showNotification(error.message, 'error');
      setCheckForUpdatesStep('idle');
    },
  });

  const handleShareWithFriends = useCallback(async () => {
    if (missionStatus?.shareStory?.claimed || !referralLink) return;
    setShareWithFriendsStep('sharing');
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
              setShareWithFriendsStep('ready');
            });
            return;
          } else if (data.fallbackUrl) {
            tgWebApp.openTelegramLink(data.fallbackUrl);
            setShareWithFriendsStep('ready');
            return;
          }
        } catch (error) {
          console.error('Prepare message error:', error);
        }
      }
      const shareTitle = `💸 Start earning money just by completing tasks & watching ads!`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareTitle)}`;
      if (tgWebApp?.openTelegramLink) {
        tgWebApp.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, '_blank');
      }
      setShareWithFriendsStep('ready');
    } catch (error) {
      console.error('Share error:', error);
      setShareWithFriendsStep('ready');
    }
  }, [missionStatus?.shareStory?.claimed, referralLink]);

  const handleClaimShareWithFriends = useCallback(() => {
    if (shareWithFriendsMutation.isPending) return;
    setShareWithFriendsStep('claiming');
    shareWithFriendsMutation.mutate();
  }, [shareWithFriendsMutation]);

  const handleDailyCheckin = useCallback(async () => {
    if (missionStatus?.dailyCheckin?.claimed || dailyCheckinStep !== 'idle') return;
    setDailyCheckinStep('ads');
    const adResult = await runAdFlow();
    if (!adResult.monetagWatched) {
      showNotification("Please watch the ads completely to claim!", "error");
      setDailyCheckinStep('idle');
      return;
    }
    setDailyCheckinStep('ready');
  }, [missionStatus?.dailyCheckin?.claimed, dailyCheckinStep, runAdFlow]);

  const handleClaimDailyCheckin = useCallback(() => {
    if (dailyCheckinMutation.isPending) return;
    setDailyCheckinStep('claiming');
    dailyCheckinMutation.mutate();
  }, [dailyCheckinMutation]);

  const handleCheckForUpdates = useCallback(() => {
    if (missionStatus?.checkForUpdates?.claimed || checkForUpdatesStep !== 'idle') return;
    const tgWebApp = window.Telegram?.WebApp as any;
    const channelUrl = 'https://t.me/MoneyAdz';
    if (tgWebApp?.openTelegramLink) {
      tgWebApp.openTelegramLink(channelUrl);
    } else if (tgWebApp?.openLink) {
      tgWebApp.openLink(channelUrl);
    } else {
      window.open(channelUrl, '_blank');
    }
    setCheckForUpdatesStep('opened');
    setCheckForUpdatesCountdown(3);
    const countdownInterval = setInterval(() => {
      setCheckForUpdatesCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          setCheckForUpdatesStep('ready');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [missionStatus?.checkForUpdates?.claimed, checkForUpdatesStep]);

  const handleClaimCheckForUpdates = useCallback(() => {
    if (checkForUpdatesMutation.isPending) return;
    setCheckForUpdatesStep('claiming');
    checkForUpdatesMutation.mutate();
  }, [checkForUpdatesMutation]);

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-[14px]">
        <div className="flex flex-col items-center mb-3">
          {photoUrl ? (
            <img 
              src={photoUrl} 
              alt="Profile" 
              className={`w-24 h-24 rounded-full border-4 border-[#4cd3ff] shadow-[0_0_20px_rgba(76,211,255,0.5)] ${isAdmin ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
              onClick={() => isAdmin && setLocation("/admin")}
            />
          ) : (
            <div 
              className={`w-24 h-24 rounded-full bg-gradient-to-br from-[#4cd3ff] to-[#b8b8b8] flex items-center justify-center border-4 border-[#4cd3ff] shadow-[0_0_20px_rgba(76,211,255,0.5)] ${isAdmin ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
              onClick={() => isAdmin && setLocation("/admin")}
            >
              <span className="text-black font-bold text-3xl">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          
          {userRank && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-[#4cd3ff]/20 to-[#b8b8b8]/20 border border-[#4cd3ff]/30 -mt-2">
              <Award className="w-3 h-3 text-[#4cd3ff]" />
              <span className="text-[10px] font-bold text-[#4cd3ff]">#{userRank}</span>
            </div>
          )}
          
          <h1 className="text-lg font-bold text-white mt-1">{displayName}</h1>
          <p className="text-xs text-gray-400 -mt-0.5">UID: {userUID}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button
            onClick={handleConvertClick}
            disabled={isConverting || convertMutation.isPending}
            className="h-12 bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-[#4cd3ff]/30 hover:border-[#4cd3ff] hover:bg-[#4cd3ff]/10 transition-all rounded-full flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
          >
            {isConverting || convertMutation.isPending ? (
              <>
                <Clock className="w-4 h-4 text-[#4cd3ff] animate-spin" />
                <span className="text-white font-medium text-xs">Converting...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 text-[#4cd3ff]" />
                <span className="text-white font-medium text-xs">Convert</span>
              </>
            )}
          </Button>

          <Button
            onClick={handleClaimStreak}
            disabled={isClaimingStreak || !canClaimStreak}
            className="h-12 bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-[#4cd3ff]/30 hover:border-[#4cd3ff] hover:bg-[#4cd3ff]/10 transition-all rounded-full flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
          >
            {isClaimingStreak ? (
              <>
                <Loader2 className="w-4 h-4 text-[#4cd3ff] animate-spin" />
                <span className="text-white font-medium text-xs">Claiming...</span>
              </>
            ) : canClaimStreak ? (
              <>
                <Flame className="w-4 h-4 text-[#4cd3ff]" />
                <span className="text-white font-medium text-xs">Claim Bonus</span>
              </>
            ) : (
              <>
                <Flame className="w-4 h-4 text-[#4cd3ff] opacity-50" />
                <span className="text-white font-medium text-xs opacity-70">{timeUntilNextClaim}</span>
              </>
            )}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button
            onClick={() => setPromoPopupOpen(true)}
            className="h-12 bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-purple-500/30 hover:border-purple-500 hover:bg-purple-500/10 transition-all rounded-full flex items-center justify-center gap-2 shadow-lg"
          >
            <Gift className="w-4 h-4 text-purple-400" />
            <span className="text-white font-medium text-xs">Promo</span>
          </Button>

          <Button
            onClick={handleBoosterClick}
            className="h-12 bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/10 transition-all rounded-full flex items-center justify-center gap-2 shadow-lg"
          >
            <CalendarCheck className="w-4 h-4 text-orange-400" />
            <span className="text-white font-medium text-xs">Daily Task</span>
          </Button>
        </div>

        <div className="mt-3">
          <AdWatchingSection user={user as User} />
        </div>

        <div className="mt-3 px-0">
          <div className="bg-[#0d0d0d] rounded-xl border border-[#1a1a1a] p-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-[#4cd3ff]/20 flex items-center justify-center">
                <Flame className="w-3.5 h-3.5 text-[#4cd3ff]" />
              </div>
              <span className="text-sm font-semibold text-white">Tasks</span>
            </div>
            
            <AnimatePresence mode="wait">
              {isLoadingTasks ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-[#1a1a1a] rounded-lg p-4 text-center"
                >
                  <Loader2 className="w-5 h-5 text-[#4cd3ff] animate-spin mx-auto" />
                </motion.div>
              ) : currentTask ? (
                <motion.div
                  key={currentTask.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="bg-[#1a1a1a] rounded-lg p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-green-500/20">
                        <span className="text-green-400">
                          {getTaskIcon(currentTask)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-medium text-sm truncate">{currentTask.title}</h3>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <DiamondIcon size={12} />
                            <span className="text-xs font-semibold text-[#4cd3ff]">+{currentTask.rewardPAD.toLocaleString()}</span>
                          </div>
                          {currentTask.rewardBUG && currentTask.rewardBUG > 0 && (
                            <div className="flex items-center gap-1">
                              <Bug className="w-3 h-3 text-purple-400" />
                              <span className="text-xs font-semibold text-purple-400">+{currentTask.rewardBUG}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleUnifiedTask(currentTask)}
                      disabled={isTaskPending}
                      className="h-8 px-4 text-xs font-semibold rounded-lg text-black bg-green-400 hover:bg-green-300"
                    >
                      {isTaskPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "Start"
                      )}
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="no-tasks"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className="bg-[#1a1a1a] rounded-lg p-4 text-center"
                >
                  <span className="text-gray-400 text-sm">No tasks available</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {boosterPopupOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 px-4">
          <div className="bg-[#0d0d0d] rounded-2xl p-6 w-full max-w-sm border border-[#1a1a1a] relative">
            <div className="flex items-center justify-center gap-2 mb-6">
              <CalendarCheck className="w-5 h-5 text-[#4cd3ff]" />
              <h2 className="text-lg font-bold text-white">Daily Tasks</h2>
            </div>
            
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-3 hover:bg-[#222] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Share with Friends</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">5 PAD</span></p>
                  </div>
                </div>
                <div className="ml-3 flex-shrink-0">
                  {missionStatus?.shareStory?.claimed ? (
                    <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                      <Check className="w-4 h-4 text-green-400" />
                    </div>
                  ) : shareWithFriendsStep === 'ready' || shareWithFriendsStep === 'claiming' ? (
                    <Button
                      onClick={handleClaimShareWithFriends}
                      disabled={shareWithFriendsMutation.isPending}
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-green-500 hover:bg-green-600 text-white"
                    >
                      {shareWithFriendsMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Claim'}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleShareWithFriends}
                      disabled={!referralLink}
                      className="h-8 w-16 text-xs font-bold rounded-lg bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      Share
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-3 hover:bg-[#222] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarCheck className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Daily Check-in</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">5 PAD</span></p>
                  </div>
                </div>
                <div className="ml-3 flex-shrink-0">
                  {missionStatus?.dailyCheckin?.claimed ? (
                    <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                      <Check className="w-4 h-4 text-green-400" />
                    </div>
                  ) : dailyCheckinStep === 'ads' ? (
                    <Button
                      disabled={true}
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-purple-600 text-white"
                    >
                      <Loader2 className="w-3 h-3 animate-spin" />
                    </Button>
                  ) : dailyCheckinStep === 'ready' || dailyCheckinStep === 'claiming' ? (
                    <Button
                      onClick={handleClaimDailyCheckin}
                      disabled={dailyCheckinMutation.isPending}
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-green-500 hover:bg-green-600 text-white"
                    >
                      {dailyCheckinMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Claim'}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleDailyCheckin}
                      className="h-8 w-16 text-xs font-bold rounded-lg bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      Go
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-3 hover:bg-[#222] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Bell className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Check for Updates</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">5 PAD</span></p>
                  </div>
                </div>
                <div className="ml-3 flex-shrink-0">
                  {missionStatus?.checkForUpdates?.claimed ? (
                    <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                      <Check className="w-4 h-4 text-green-400" />
                    </div>
                  ) : checkForUpdatesStep === 'ready' || checkForUpdatesStep === 'claiming' ? (
                    <Button
                      onClick={handleClaimCheckForUpdates}
                      disabled={checkForUpdatesMutation.isPending}
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-green-500 hover:bg-green-600 text-white"
                    >
                      {checkForUpdatesMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Claim'}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleCheckForUpdates}
                      className="h-8 w-16 text-xs font-bold rounded-lg bg-orange-500 hover:bg-orange-600 text-white"
                    >
                      Check
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <Button
              onClick={() => setBoosterPopupOpen(false)}
              className="w-full mt-6 h-11 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white font-semibold rounded-xl border border-[#2a2a2a]"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Static Create Task Button - Only on Home Page */}
      <div className="fixed bottom-6 right-4 z-50">
        <button
          onClick={() => setLocation('/task/create')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-black text-white font-semibold text-sm border border-gray-700"
        >
          <Plus className="w-4 h-4" />
          Create Task
        </button>
      </div>

      {promoPopupOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 px-4">
          <div className="bg-[#0d0d0d] rounded-2xl p-6 w-full max-w-sm border border-[#1a1a1a]">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Gift className="w-5 h-5 text-[#4cd3ff]" />
              <h2 className="text-lg font-bold text-white">Enter Promo Code</h2>
            </div>
            
            <Input
              placeholder="Enter code here"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              disabled={redeemPromoMutation.isPending || isApplyingPromo}
              className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl text-white placeholder:text-gray-500 px-4 py-3 h-12 text-center text-lg font-semibold tracking-wider focus:border-[#4cd3ff] focus:ring-0 mb-4"
            />
            
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setPromoPopupOpen(false);
                  setPromoCode("");
                }}
                className="flex-1 h-11 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white font-semibold rounded-xl border border-[#2a2a2a]"
              >
                Close
              </Button>
              <Button
                onClick={handleApplyPromo}
                disabled={redeemPromoMutation.isPending || isApplyingPromo || !promoCode.trim()}
                className="flex-1 h-11 bg-[#4cd3ff] hover:bg-[#6ddeff] text-black font-semibold rounded-xl disabled:opacity-50"
              >
                {redeemPromoMutation.isPending || isApplyingPromo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Apply"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {convertPopupOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 px-4">
          <div className="bg-[#0d0d0d] rounded-2xl p-6 w-full max-w-sm border border-[#1a1a1a]">
            <div className="flex items-center justify-center gap-2 mb-2">
              <RefreshCw className="w-5 h-5 text-[#4cd3ff]" />
              <h2 className="text-lg font-bold text-white">Convert PAD</h2>
            </div>
            <div className="flex items-center justify-center gap-1.5 mb-4">
              <DiamondIcon size={14} />
              <p className="text-gray-400 text-sm">
                Available: {balancePAD.toLocaleString()} PAD
              </p>
            </div>
            
            <div className="space-y-2 mb-4">
              <Input
                type="number"
                placeholder="Enter amount"
                value={convertAmount}
                onChange={(e) => setConvertAmount(e.target.value)}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl text-white placeholder:text-gray-500 px-4 py-3 h-12 focus:border-[#4cd3ff] focus:ring-0 mb-3"
              />
              
              <button
                onClick={() => setSelectedConvertType('USD')}
                className={`w-full p-3 rounded-xl border transition-all flex items-center gap-3 ${
                  selectedConvertType === 'USD' 
                    ? 'border-[#4cd3ff] bg-[#4cd3ff]/10' 
                    : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center">
                  <span className="text-green-400 font-bold text-sm">$</span>
                </div>
                <div className="text-left flex-1">
                  <div className="flex items-center gap-1.5">
                    <DiamondIcon size={12} />
                    <span className="text-gray-400 text-xs">→</span>
                    <span className="text-green-400 font-bold text-xs">USD</span>
                  </div>
                  <p className="text-xs text-gray-500">Min: {(appSettings?.minimumConvertPAD || 10000).toLocaleString()} PAD</p>
                </div>
              </button>
              
              <button
                onClick={() => setSelectedConvertType('BUG')}
                className={`w-full p-3 rounded-xl border transition-all flex items-center gap-3 ${
                  selectedConvertType === 'BUG' 
                    ? 'border-[#4cd3ff] bg-[#4cd3ff]/10' 
                    : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center">
                  <Bug className="w-4 h-4 text-green-400" />
                </div>
                <div className="text-left flex-1">
                  <div className="flex items-center gap-1.5">
                    <DiamondIcon size={12} />
                    <span className="text-gray-400 text-xs">→</span>
                    <Bug className="w-3 h-3 text-green-400" />
                    <span className="text-green-400 font-bold text-xs">BUG</span>
                  </div>
                  <p className="text-xs text-gray-500">Min: {(appSettings?.minimumConvertPadToBug || 1000).toLocaleString()} PAD</p>
                </div>
              </button>
            </div>
            
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setConvertPopupOpen(false);
                  setConvertAmount("");
                }}
                className="flex-1 h-11 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white font-semibold rounded-xl border border-[#2a2a2a]"
              >
                Close
              </Button>
              <Button
                onClick={handleConvertConfirm}
                disabled={isConverting || convertMutation.isPending}
                className="flex-1 h-11 bg-[#4cd3ff] hover:bg-[#6ddeff] text-black font-semibold rounded-xl disabled:opacity-50"
              >
                {isConverting || convertMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Convert"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
