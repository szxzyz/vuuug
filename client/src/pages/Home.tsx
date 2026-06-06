import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import Header from "@/components/Header";
import AdWatchingSection from "@/components/AdWatchingSection";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { useAdmin } from "@/hooks/useAdmin";
import { useAdFlow } from "@/hooks/useAdFlow";
import { useLocation } from "wouter";
import { Award, Wallet, RefreshCw, Flame, Ticket, Clock, Loader2, Gift, Rocket, X, Bug, DollarSign, Coins, Send, Users, Check, ExternalLink, Plus, CalendarCheck, Bell, Star, Play, Sparkles, Zap, ListChecks, ArrowUpFromLine, ArrowLeftRight } from "lucide-react";
import { DiamondIcon } from "@/components/DiamondIcon";
import { Button } from "@/components/ui/button";
import { showNotification } from "@/components/AppNotification";
import { apiRequest, getTelegramInitData } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { AnimatePresence, motion } from "framer-motion";

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
  const [convertPopupOpen, setConvertPopupOpen] = useState(false);
  const [boosterPopupOpen, setBoosterPopupOpen] = useState(false);
  const [selectedConvertType, setSelectedConvertType] = useState<'USD' | 'BUG'>('USD');
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
      showNotification(`+${padReward.toLocaleString()} PAD earned!`, 'success');
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
    
    try {
      const monetagResult = await showMonetagRewardedAd();
      
      if (!monetagResult.unavailable && !monetagResult.success) {
        showNotification("Please watch the ad to convert.", "error");
        setIsConverting(false);
        return;
      }

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

  const usdFormatted = balanceUSD.toFixed(3);
  const [usdInt, usdDec] = usdFormatted.split('.');

  return (
    <Layout>
      <Header />
      <main className="max-w-md mx-auto px-4 pt-0 bg-black text-white">
        {/* Balance Section — left aligned */}
        <div className="mb-4 pt-2 px-1">
          <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
            Balance
          </p>

          {/* Main USD balance */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 2 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: 'rgba(255,255,255,0.65)', lineHeight: 1 }}>$</span>
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
            <span style={{ fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.45)', lineHeight: 1 }}>.{usdDec}</span>
          </div>

          {/* PAD sub-value */}
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 500, marginBottom: 16 }}>
            {formatBalance(balancePAD)} PAD
          </p>

          {/* Equal-width buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setLocation('/withdraw')}
              className="btn-primary active:scale-95 transition-transform"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v14M5 9l7 7 7-7"/><path d="M3 20h18"/>
              </svg>
              WITHDRAW
            </button>

            <button
              onClick={handleConvertClick}
              className="active:scale-95 transition-transform"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', border: 'none' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
              SWAP
            </button>
          </div>
        </div>


        <div className="mt-4">
          <AdWatchingSection user={user as User} />
        </div>

        <div className="mt-3 px-0">
          <div className="bg-[#0d0d0d] rounded-xl p-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <ListChecks className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-base font-bold text-white tracking-tight">Active Tasks</span>
              </div>
            
            <div className="flex flex-col gap-2">
              <AnimatePresence mode="popLayout">
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
                ) : (unifiedTasksData?.tasks && unifiedTasksData.tasks.length > 0) ? (
                  unifiedTasksData.tasks.map((task) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="bg-[#1a1a1a] rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-green-500/20">
                            <span className="text-green-400">
                              {getTaskIcon(task)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-white font-medium text-sm truncate">{task.title}</h3>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <DiamondIcon size={12} />
                                <span className="text-xs font-semibold text-[#4cd3ff]">+{task.rewardPAD.toLocaleString()}</span>
                              </div>
                              {task.rewardBUG && task.rewardBUG > 0 && (
                                <div className="flex items-center gap-1">
                                  <Bug className="w-3 h-3 text-purple-400" />
                                  <span className="text-xs font-semibold text-purple-400">+{task.rewardBUG}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          onClick={() => handleUnifiedTask(task)}
                          disabled={isTaskPending || claimAdvertiserTaskMutation.isPending || completedTasks.has(task.id)}
                          className={`h-8 px-4 text-xs font-bold rounded-lg transition-all ${
                            completedTasks.has(task.id)
                              ? "bg-green-500/20 text-green-400 border border-green-500/30"
                              : clickedTasks.has(task.id)
                                ? "bg-blue-500 text-white"
                                : "bg-green-400 hover:bg-green-300 text-black"
                          }`}
                        >
                          {completedTasks.has(task.id) ? (
                            <div className="flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              <span>Done</span>
                            </div>
                          ) : (isTaskPending || claimAdvertiserTaskMutation.isPending) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : clickedTasks.has(task.id) ? (
                            "Claim"
                          ) : (
                            "Start"
                          )}
                        </Button>
                      </div>
                    </motion.div>
                  ))
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
        </div>
      </main>


      {boosterPopupOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 px-4">
          <div className="bg-[#0d0d0d] rounded-2xl p-6 w-full max-w-sm border border-[#1a1a1a] relative">
            <div className="flex items-center justify-center gap-3 mb-6">
              <CalendarCheck className="w-6 h-6 text-blue-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Daily Missions</h2>
            </div>
            
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-3 hover:bg-[#222] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Share with Friends</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">{appSettings?.referralRewardPAD || '5'} PAD</span></p>
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

              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-3 hover:bg-[#222] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarCheck className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Daily Check-in</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">{appSettings?.dailyCheckinReward || '5'} PAD</span></p>
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

              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-3 hover:bg-[#222] transition">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Bell className="w-4 h-4 text-[#4cd3ff]" />
                    <p className="text-white text-sm font-medium truncate">Check for Updates</p>
                  </div>
                  <div className="text-xs text-gray-400 ml-6">
                    <p>Reward: <span className="text-white font-medium">{appSettings?.checkForUpdatesReward || '5'} PAD</span></p>
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


      <AnimatePresence>
        {convertPopupOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConvertPopupOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-[90%] max-w-[320px] bg-[#1a1a1a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-5 space-y-5">
                <div className="text-center space-y-0.5">
                  <h2 className="text-lg font-bold text-white">Convert Currency</h2>
                  <p className="text-xs text-white/50">Convert your PAD to other currencies</p>
                </div>

                <div className="space-y-3">
                  <div className="flex p-0.5 bg-white/5 rounded-lg border border-white/5">
                    <button
                      onClick={() => setSelectedConvertType('USD')}
                      className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md transition-all ${
                        selectedConvertType === 'USD'
                          ? 'bg-blue-500 text-white shadow-md'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold">USD</span>
                    </button>
                    <button
                      onClick={() => setSelectedConvertType('BUG')}
                      className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md transition-all ${
                        selectedConvertType === 'BUG'
                          ? 'bg-blue-500 text-white shadow-md'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      <Bug className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold">BUG</span>
                    </button>
                  </div>

                  <div className="relative">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2">
                      <Coins className="w-4 h-4 text-blue-400" />
                    </div>
                    <Input
                      type="number"
                      placeholder="Enter PAD amount"
                      value={convertAmount}
                      onChange={(e) => setConvertAmount(e.target.value)}
                      className="w-full bg-white/5 border-white/10 h-11 pl-10 pr-16 text-sm font-bold text-white rounded-xl focus:ring-1 focus:ring-blue-500/50 transition-all"
                    />
                    <button
                      onClick={() => setConvertAmount(balancePAD.toString())}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-bold rounded-md hover:bg-blue-500/20 transition-colors"
                    >
                      MAX
                    </button>
                  </div>

                  <div className="flex items-center justify-between px-1 text-[9px] font-medium uppercase tracking-wider text-white/40">
                    <span>Min: {selectedConvertType === 'USD'
                        ? (appSettings?.minimumConvertPAD || 100).toLocaleString()
                        : (appSettings?.minimumConvertPadToBug || 1000).toLocaleString()} PAD</span>
                    <span>Bal: {balancePAD.toLocaleString()}</span>
                  </div>
                </div>

                <Button
                  onClick={handleConvertConfirm}
                  disabled={isConverting || convertMutation.isPending || !convertAmount || parseFloat(convertAmount) <= 0}
                  className="w-full h-11 bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md shadow-blue-500/10 transition-all disabled:opacity-50"
                >
                  {isConverting || convertMutation.isPending ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </div>
                  ) : (
                    "Convert Now"
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Layout>
  );
}
