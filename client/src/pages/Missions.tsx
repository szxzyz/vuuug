import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  ListTodo,
  CalendarCheck, 
  Gamepad2, 
  Users, 
  Handshake, 
  ChevronRight,
  Sparkles,
  Loader2,
  Check,
  Bot,
  MessageCircle,
  Link2,
  Megaphone,
  Globe,
  Bell
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAdFlow } from "@/hooks/useAdFlow";

interface Task {
  id: string;
  taskType: string;
  title: string;
  link: string;
  totalClicksRequired: number;
  currentClicks: number;
  costPerClick: string;
  totalCost: string;
  status: string;
  advertiserId: string;
  createdAt: string;
  completedAt?: string;
}

interface MissionStatus {
  shareStory: { completed: boolean; claimed: boolean };
  dailyCheckin: { completed: boolean; claimed: boolean };
  checkForUpdates: { completed: boolean; claimed: boolean };
}

interface AppSettings {
  channelTaskReward?: number;
  botTaskReward?: number;
  partnerTaskReward?: number;
  [key: string]: any;
}

export default function Missions() {
  const { isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [clickedTasks, setClickedTasks] = useState<Set<string>>(new Set());
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const [claimReadyTasks, setClaimReadyTasks] = useState<Set<string>>(new Set());
  const [countdownTasks, setCountdownTasks] = useState<Map<string, number>>(new Map());
  
  const [shareWithFriendsStep, setShareWithFriendsStep] = useState<'idle' | 'sharing' | 'countdown' | 'ready' | 'claiming'>('idle');
  const [shareCountdown, setShareCountdown] = useState(3);
  const [dailyCheckinStep, setDailyCheckinStep] = useState<'idle' | 'ads' | 'countdown' | 'ready' | 'claiming'>('idle');
  const [dailyCheckinCountdown, setDailyCheckinCountdown] = useState(3);
  const [checkForUpdatesStep, setCheckForUpdatesStep] = useState<'idle' | 'opened' | 'countdown' | 'ready' | 'claiming'>('idle');
  const [checkForUpdatesCountdown, setCheckForUpdatesCountdown] = useState(3);
  
  const { isShowingAds, adStep, runAdFlow } = useAdFlow();

  const { data: missionStatus, refetch: refetchMissions } = useQuery<{ success: boolean } & MissionStatus>({
    queryKey: ['/api/missions/status'],
    retry: false,
  });

  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  const { data: tasksData, refetch: refetchTasks } = useQuery<{ success: boolean; tasks: Task[] }>({
    queryKey: ["/api/advertiser-tasks"],
    retry: false,
  });

  const { data: user } = useQuery<{ referralCode?: string }>({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 30000,
  });

  const botUsername = import.meta.env.VITE_BOT_USERNAME || 'PaidAdzbot';
  const webAppName = import.meta.env.VITE_WEBAPP_NAME || 'app';
  const referralLink = user?.referralCode 
    ? `https://t.me/${botUsername}/${webAppName}?startapp=${user.referralCode}`
    : '';

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

  const clickTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      setLoadingTaskId(taskId);
      const response = await fetch(`/api/advertiser-tasks/${taskId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message);
      return data;
    },
    onSuccess: (data, taskId) => {
      showNotification(`+${parseInt(data.reward).toLocaleString()} PAD claimed!`, "success");
      setCompletedTaskIds(prev => new Set(prev).add(taskId));
      setClickedTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
      setClaimReadyTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
      setLoadingTaskId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
    },
    onError: (error: Error) => {
      showNotification(error.message, "error");
      setLoadingTaskId(null);
    },
  });

  const handleShareWithFriends = useCallback(async () => {
    if (missionStatus?.shareStory?.claimed || !referralLink) return;
    
    setShareWithFriendsStep('sharing');
    
    try {
      const tgWebApp = window.Telegram?.WebApp as any;
      
      // Native Telegram share dialog using shareMessage() with prepared message
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
      
      // Fallback: Use Telegram's native share URL dialog
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
    
    if (!adResult.adsgramWatched) {
      showNotification("Please complete all ads to claim your reward!", "error");
      setDailyCheckinStep('idle');
      return;
    }
    
    setDailyCheckinStep('ready');
  }, [missionStatus?.dailyCheckin?.claimed, dailyCheckinStep, runAdFlow]);

  const handleCheckForUpdates = useCallback(() => {
    if (missionStatus?.checkForUpdates?.claimed || checkForUpdatesStep !== 'idle') return;
    
    const tgWebApp = window.Telegram?.WebApp as any;
    if (tgWebApp?.openTelegramLink) {
      tgWebApp.openTelegramLink('https://t.me/PaidADsNews');
    } else if (tgWebApp?.openLink) {
      tgWebApp.openLink('https://t.me/PaidADsNews');
    } else {
      window.open('https://t.me/PaidADsNews', '_blank');
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

  const handleClaimDailyCheckin = useCallback(() => {
    if (dailyCheckinMutation.isPending) return;
    setDailyCheckinStep('claiming');
    dailyCheckinMutation.mutate();
  }, [dailyCheckinMutation]);

  const handleTaskClick = async (task: Task) => {
    if (!task.link || claimReadyTasks.has(task.id) || clickedTasks.has(task.id)) return;

    let linkToOpen = task.link.trim();
    if (!linkToOpen.startsWith('http')) linkToOpen = 'https://' + linkToOpen;

    if (window.Telegram?.WebApp) {
      const isTg = linkToOpen.includes('t.me/');
      if (isTg && window.Telegram.WebApp.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(linkToOpen);
      } else if (window.Telegram.WebApp.openLink) {
        window.Telegram.WebApp.openLink(linkToOpen);
      } else {
        window.open(linkToOpen, "_blank");
      }
    } else {
      window.open(linkToOpen, "_blank");
    }

    setClickedTasks(prev => new Set(prev).add(task.id));
    setCountdownTasks(prev => new Map(prev).set(task.id, 3));

    const countdown = setInterval(() => {
      setCountdownTasks(prev => {
        const m = new Map(prev);
        const c = m.get(task.id) || 0;
        if (c <= 1) {
          clearInterval(countdown);
          m.delete(task.id);
          setClaimReadyTasks(p => new Set(p).add(task.id));
        } else {
          m.set(task.id, c - 1);
        }
        return m;
      });
    }, 1000);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 rounded-full bg-[#4cd3ff] animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      </Layout>
    );
  }

  const allTasks = tasksData?.tasks || [];
  const gameTasks = allTasks.filter(t => t.taskType === 'bot' && !completedTaskIds.has(t.id));
  const socialTasks = allTasks.filter(t => t.taskType === 'channel' && !completedTaskIds.has(t.id));
  const partnerTasks = allTasks.filter(t => t.taskType === 'partner' && !completedTaskIds.has(t.id));

  const channelReward = appSettings?.channelTaskReward || 30;
  const botReward = appSettings?.botTaskReward || 20;
  const partnerReward = appSettings?.partnerTaskReward || 5;

  const getReward = (t: Task) => t.taskType === 'partner' ? partnerReward : t.taskType === 'channel' ? channelReward : botReward;

  const getTaskBoxIcon = (taskType: string) => {
    switch (taskType) {
      case 'bot':
        return <Bot className="w-4 h-4 text-white" />;
      case 'channel':
        return <MessageCircle className="w-4 h-4 text-white" />;
      case 'partner':
        return <Link2 className="w-4 h-4 text-white" />;
      default:
        return <Globe className="w-4 h-4 text-white" />;
    }
  };

  const getTaskIconBg = (taskType: string) => {
    switch (taskType) {
      case 'bot':
        return 'from-purple-500 to-purple-600';
      case 'channel':
        return 'from-blue-500 to-blue-600';
      case 'partner':
        return 'from-green-500 to-green-600';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const TaskItem = ({ task }: { task: Task }) => {
    const reward = getReward(task);
    const isLoading = loadingTaskId === task.id;
    const isClaimReady = claimReadyTasks.has(task.id);
    const countdown = countdownTasks.get(task.id);

    return (
      <div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${getTaskIconBg(task.taskType)} flex items-center justify-center flex-shrink-0`}>
          {getTaskBoxIcon(task.taskType)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{task.title}</p>
          <p className="text-[#4cd3ff] text-xs font-bold">+{reward} PAD</p>
        </div>
        <Button
          onClick={() => isClaimReady ? clickTaskMutation.mutate(task.id) : handleTaskClick(task)}
          disabled={isLoading || (countdown !== undefined && countdown > 0)}
          className={`h-8 w-20 text-xs font-bold rounded-lg ${
            isLoading ? 'bg-[#4cd3ff]/50' :
            countdown ? 'bg-gray-600' :
            isClaimReady ? 'bg-green-500 hover:bg-green-600 text-white' :
            'bg-[#4cd3ff] hover:bg-[#3bc3ef] text-black'
          }`}
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> :
           countdown ? `${countdown}s` :
           isClaimReady ? 'Claim' : 'Start'}
        </Button>
      </div>
    );
  };

  const TaskSection = ({ title, icon, iconColor, tasks }: { 
    title: string; 
    icon: React.ReactNode; 
    iconColor: string;
    tasks: Task[];
  }) => {
    if (tasks.length === 0) return null;
    
    return (
      <div className="bg-[#111] rounded-xl p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <div className={iconColor}>{icon}</div>
          <span className="text-white text-sm font-semibold">{title}</span>
        </div>
        <div className="px-1">
          {tasks.map(t => <TaskItem key={t.id} task={t} />)}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-3 pb-16">
        <div className="flex items-center gap-2 mb-4">
          <ListTodo className="w-5 h-5 text-[#4cd3ff]" />
          <h1 className="text-lg font-bold text-white">Missions</h1>
        </div>

        <div 
          className="bg-[#111] rounded-xl p-3 mb-3 cursor-pointer active:scale-[0.98] transition-transform"
          onClick={() => setLocation("/task/create")}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4cd3ff] to-[#007BFF] flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-sm">Create My Task</h3>
              <p className="text-gray-400 text-xs">Promote your channel or bot</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-500" />
          </div>
        </div>

        <div className="bg-[#111] rounded-xl p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <CalendarCheck className="w-4 h-4 text-yellow-400" />
            <span className="text-white text-sm font-semibold">Daily Tasks</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                  <Users className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Share with Friends</p>
                  <p className="text-green-400 text-xs font-bold">+5 PAD</p>
                </div>
              </div>
              {missionStatus?.shareStory?.claimed ? (
                <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
              ) : shareWithFriendsStep === 'countdown' ? (
                <Button
                  disabled={true}
                  className="h-8 w-20 text-xs font-bold rounded-lg bg-gray-600 text-white"
                >
                  {shareCountdown}s
                </Button>
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
                  className="h-8 w-20 text-xs font-bold rounded-lg bg-green-500 hover:bg-green-600 text-white"
                >
                  Share
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                  <CalendarCheck className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Daily Check-in</p>
                  <p className="text-cyan-400 text-xs font-bold">+5 PAD</p>
                </div>
              </div>
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
              ) : dailyCheckinStep === 'countdown' ? (
                <Button
                  disabled={true}
                  className="h-8 w-20 text-xs font-bold rounded-lg bg-gray-600 text-white"
                >
                  {dailyCheckinCountdown}s
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
                  className="h-8 w-20 text-xs font-bold rounded-lg bg-cyan-500 hover:bg-cyan-600 text-black"
                >
                  Go
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg p-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Check for Updates</p>
                  <p className="text-orange-400 text-xs font-bold">+5 PAD</p>
                </div>
              </div>
              {missionStatus?.checkForUpdates?.claimed ? (
                <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
              ) : checkForUpdatesStep === 'opened' ? (
                <Button
                  disabled={true}
                  className="h-8 w-20 text-xs font-bold rounded-lg bg-gray-600 text-white"
                >
                  {checkForUpdatesCountdown}s
                </Button>
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
                  className="h-8 w-20 text-xs font-bold rounded-lg bg-orange-500 hover:bg-orange-600 text-white"
                >
                  Check
                </Button>
              )}
            </div>

          </div>
        </div>

        <TaskSection 
          title="Game Tasks" 
          icon={<Gamepad2 className="w-4 h-4" />}
          iconColor="text-purple-400"
          tasks={gameTasks}
        />

        <TaskSection 
          title="Social Tasks" 
          icon={<Megaphone className="w-4 h-4" />}
          iconColor="text-blue-400"
          tasks={socialTasks}
        />

        <TaskSection 
          title="Partner Tasks" 
          icon={<Handshake className="w-4 h-4" />}
          iconColor="text-green-400"
          tasks={partnerTasks}
        />

        {gameTasks.length === 0 && socialTasks.length === 0 && partnerTasks.length === 0 && (
          <div className="bg-[#111] rounded-xl p-6 text-center">
            <p className="text-gray-400 text-sm">No tasks available right now</p>
            <p className="text-gray-500 text-xs mt-1">Check back later for new tasks!</p>
          </div>
        )}
      </main>
    </Layout>
  );
}
