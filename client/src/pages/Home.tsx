import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import Header from "@/components/Header";
import IncomeStatistics from "@/components/IncomeStatistics";
import AdWatchingSection from "@/components/AdWatchingSection";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useAdmin } from "@/hooks/useAdmin";
import { useAdFlow } from "@/hooks/useAdFlow";
import { useLocation } from "wouter";
import { Award, Wallet, RefreshCw, Flame, Ticket, Clock, Loader2, Gift, Rocket, X, Send, Users, Check, ExternalLink, Plus, CalendarCheck, Bell, Star, Play, Sparkles, Zap, ListChecks, ArrowUpFromLine, ArrowLeftRight } from "lucide-react";
import { FaTrophy, FaMedal } from "react-icons/fa";
import { DiamondIcon } from "@/components/DiamondIcon";
import { Button } from "@/components/ui/button";
import { showNotification } from "@/components/AppNotification";
import { apiRequest, getTelegramInitData } from "@/lib/queryClient";

// Unified Task Interface
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
  const [boosterPopupOpen, setBoosterPopupOpen] = useState(false);
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
        body: JSON.stringify({ powAmount: amount, convertTo }),
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
        showNotification(`You've claimed +${earnedPAD} POW!`, "success");
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

  const [clickedTasks, setClickedTasks] = useState<Set<string>>(new Set());

  const advertiserTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/advertiser-tasks/${taskId}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to start task');
      return data;
    },
    onSuccess: async (data, taskId) => {
      setClickedTasks(prev => new Set(prev).add(taskId));
      showNotification("Task started! Click the claim button to earn your reward.", "info");
    },
    onError: (error: any) => {
      showNotification(error.message || 'Failed to start task', 'error');
    },
  });

  const claimAdvertiserTaskMutation = useMutation({
    mutationFn: async ({ taskId, taskType, link }: { taskId: string, taskType: string, link: string | null }) => {
      // Step 1: Real-time verification for channel tasks
      if (taskType === 'channel' && link) {
        const username = link.replace('https://t.me/', '').split('?')[0];
        const currentTelegramData = getTelegramInitData();
        
        const resVerify = await fetch('/api/tasks/verify/channel', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-telegram-data': currentTelegramData || ''
          },
          body: JSON.stringify({ channelId: `@${username}` }),
          credentials: 'include',
        });
        
        const verifyData = await resVerify.json();
        if (!resVerify.ok || !verifyData.isJoined) {
          throw new Error('Please join the channel to complete this task.');
        }
      }

      // Step 2: Claim reward
      const res = await fetch(`/api/advertiser-tasks/${taskId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to claim reward');
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      await queryClient.refetchQueries({ queryKey: ['/api/tasks/home/unified'] });
      const padReward = Number(data.reward ?? 0);
      showNotification(`+${padReward.toLocaleString()} POW earned!`, 'success');
    },
    onError: (error: any) => {
      showNotification(error.message || 'Failed to claim reward', 'error');
    },
  });

  const handleUnifiedTask = (task: UnifiedTask) => {
    if (!task) return;
    
    if (clickedTasks.has(task.id)) {
      claimAdvertiserTaskMutation.mutate({ taskId: task.id, taskType: task.taskType, link: task.link });
      return;
    }

    if (task.link) {
      window.open(task.link, '_blank');
      advertiserTaskMutation.mutate(task.id);
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
    if (convertMutation.isPending) return;
    const minimumConvertPAD = appSettings?.minimumConvertPAD || 10000;
    if (balancePAD <= 0) {
      showNotification("No POW balance to swap.", "error");
      return;
    }
    if (balancePAD < minimumConvertPAD) {
      showNotification(`Minimum ${minimumConvertPAD.toLocaleString()} POW required to swap.`, "error");
      return;
    }
    convertMutation.mutate({ amount: balancePAD, convertTo: 'USD' });
  };

  const handleClaimStreak = async () => {
    if (isClaimingStreak || hasClaimed) return;
    
    setIsClaimingStreak(true);
    
    try {
      const monetagResult = await showMonetagRewardedAd();
      
      if (!monetagResult.unavailable && !monetagResult.success) {
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

  useEffect(() => {
    if (checkForUpdatesStep === 'countdown' && checkForUpdatesCountdown > 0) {
      const timer = setTimeout(() => setCheckForUpdatesCountdown(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    } else if (checkForUpdatesStep === 'countdown' && checkForUpdatesCountdown === 0) {
      setCheckForUpdatesStep('ready');
    }
  }, [checkForUpdatesStep, checkForUpdatesCountdown]);

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      showNotification("Please enter a promo code", "error");
      return;
    }

    if (isApplyingPromo || redeemPromoMutation.isPending) return;
    
    setIsApplyingPromo(true);
    
    try {
      const monetagResult = await showMonetagRewardedAd();
      
      if (!monetagResult.unavailable && !monetagResult.success) {
        showNotification("Please watch the ad to claim your promo code.", "error");
        setIsApplyingPromo(false);
        return;
      }
      
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
  
  const userUID = (user as User)?.telegramId || (user as User)?.referralCode || "00000";

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
      showNotification(`+${data.reward} POW claimed!`, 'success');
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
      showNotification(`+${data.reward} POW claimed!`, 'success');
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
      // Step 1: Real-time verification via Telegram Bot API
      const resVerify = await fetch('/api/tasks/verify/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: '@MoneyAdz' }),
        credentials: 'include',
      });
      
      const verifyData = await resVerify.json();
      if (!resVerify.ok || !verifyData.isJoined) {
        throw new Error('Please join the channel to complete this task.');
      }

      // Step 2: Claim reward if verified
      const response = await fetch('/api/missions/check-for-updates/claim', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      return response.json();
    },
    onSuccess: (data) => {
      showNotification(`+${data.reward} POW claimed!`, 'success');
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
      const shareTitle = `💵 Get paid for completing tasks and watching ads.`;
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

  const formatBalance = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toLocaleString();
  };

  const usdFormatted = balanceUSD >= 0.01
    ? balanceUSD.toFixed(2)
    : balanceUSD >= 0.0001
      ? balanceUSD.toFixed(4)
      : balanceUSD.toFixed(6);
  const [usdInt, usdDec] = usdFormatted.split('.');

  return (
    <Layout>
      <Header />
      <main className="max-w-md mx-auto px-4 bg-black text-white" style={{ paddingTop: 10 }}>
        {/* Balance Section — left aligned */}
        <div className="mb-3 px-1">
          <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.38)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Balance
          </p>

          {/* Main USD balance */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.55)', lineHeight: 1 }}>$</span>
            <span style={{
              fontSize: balanceUSD >= 1000 ? 38 : 44,
              fontWeight: 800,
              color: '#fff',
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: '-1.5px',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}>
              {usdInt}
            </span>
            <span style={{ fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.38)', lineHeight: 1 }}>.{usdDec}</span>
          </div>

          {/* POW & STAR — stacked vertically */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <img src="/pow-icon.png?v=2" alt="POW" style={{ width: '85%', height: '85%', objectFit: 'contain' }} />
              </div>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', fontWeight: 700 }}>
                {formatBalance(balancePAD)} <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>POW</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <img src="/star-bug.png" alt="STAR" style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', fontWeight: 700 }}>
                {formatBalance(parseFloat((user as any)?.starBalance || "0"))} <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>STAR</span>
              </span>
            </div>
          </div>

          {/* Equal-width buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setLocation('/withdraw')}
              className="btn-primary active:scale-95 transition-transform"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em' }}
            >
              WITHDRAW
            </button>

            <button
              onClick={handleConvertClick}
              className="active:scale-95 transition-transform"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', border: 'none' }}
            >
              SWAP
            </button>
          </div>
        </div>

        {/* Weekly Contest Banner */}
        <div
          className="mt-4 mb-2 rounded-2xl overflow-hidden relative cursor-pointer"
          style={{ height: 96 }}
          onClick={() => window.location.href = '/leaderboard'}
        >
          <img
            src="/daily-contest-banner.jpg"
            alt="Weekly Contest"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 85%' }}
          />
          {/* Dark overlay stronger on left, fades to right so ninjas show */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0.15) 100%)' }} />

          {/* Left: title + subtitle */}
          <div className="absolute inset-0 flex items-center justify-between" style={{ padding: '0 14px' }}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <FaMedal style={{ color: '#FFD700', fontSize: 13 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#FFD700', letterSpacing: '0.18em', textTransform: 'uppercase', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                  Weekly Contest
                </span>
              </div>
              <span style={{ fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px', textShadow: '0 2px 8px rgba(0,0,0,0.95)', lineHeight: 1.15 }}>
                Top Earners
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', lineHeight: 1.2 }}>
                take the prize
              </span>
            </div>

            {/* Right: prize block */}
            <div className="flex flex-col items-center gap-0.5">
              <FaTrophy style={{ color: '#FFD700', fontSize: 22, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }} />
              <span style={{ fontSize: 20, fontWeight: 900, color: 'rgba(180,180,180,0.9)', textShadow: '0 2px 6px rgba(0,0,0,0.9)', lineHeight: 1 }}>
                ${appSettings?.weeklyGiveawayAmount ?? 10}
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.05em' }}>
                PRIZE POOL
              </span>
            </div>
          </div>
        </div>

        {/* Ad Watch Section */}
        <div className="mt-3">
          <AdWatchingSection user={user} />
        </div>

        {/* Statistics Section */}
        <IncomeStatistics />

      </main>


      {boosterPopupOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 px-4">
          <div className="bg-[#1C1C1E] rounded-2xl p-6 w-full max-w-sm border border-[#2C2C2E] relative">
            <div className="flex items-center justify-center gap-3 mb-6">
              <CalendarCheck className="w-6 h-6 text-blue-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Daily Missions</h2>
            </div>
            
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
              <div className="flex items-center justify-between bg-[#1C1C1E] rounded-lg p-3 hover:bg-[#2C2C2E] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Share with Friends</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">{appSettings?.referralRewardPAD || '5'} POW</span></p>
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
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-sm"
                    >
                      Share
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#1C1C1E] rounded-lg p-3 hover:bg-[#2C2C2E] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarCheck className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Daily Check-in</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">{appSettings?.dailyCheckinReward || '5'} POW</span></p>
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
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-sm"
                    >
                      Go
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#1C1C1E] rounded-lg p-3 hover:bg-[#2C2C2E] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Bell className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Check for Updates</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">{appSettings?.checkForUpdatesReward || '5'} POW</span></p>
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
                      {checkForUpdatesMutation.isPending || checkForUpdatesStep === 'claiming' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Claim'}
                    </Button>
                  ) : checkForUpdatesStep === 'opened' || checkForUpdatesStep === 'countdown' ? (
                    <Button
                      disabled={true}
                      className="h-8 w-20 text-xs font-bold rounded-lg bg-blue-500/50 text-white"
                    >
                      {checkForUpdatesStep === 'countdown' ? `${checkForUpdatesCountdown}s` : <Loader2 className="w-3 h-3 animate-spin" />}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleCheckForUpdates}
                      className="h-8 w-16 text-xs font-bold rounded-lg bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      Go
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



    </Layout>
  );
}
