import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  CalendarCheck, 
  Users, 
  ChevronRight,
  Loader2,
  Check,
  Bot,
  MessageCircle,
  Link2,
  Globe,
  Bell,
  Flame,
  Clock,
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useState, useCallback, useEffect, useRef } from "react";
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

interface StreakStatus {
  streak: number;
  nextStreakDay: number;
  claimedToday: boolean;
  reward: { usd: number; pow: number };
  nextResetAt: string;
  lastDailyLoginDate: string | null;
}

const STREAK_TIERS = [
  { days: "Day 1–10",  usd: "$0.0005", pow: "5K POW"  },
  { days: "Day 11–20", usd: "$0.001",  pow: "10K POW" },
  { days: "Day 21–30", usd: "$0.0015", pow: "15K POW" },
  { days: "Day 31–40", usd: "$0.002",  pow: "20K POW" },
  { days: "Day 41–50", usd: "$0.0025", pow: "25K POW" },
  { days: "Day 51+",   usd: "$0.0025", pow: "25K POW" },
];

function useCountdown(targetIso: string | undefined, onReset?: () => void) {
  const [timeStr, setTimeStr] = useState("--:--:--");
  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (!targetIso) return;
    hasFiredRef.current = false;
    const targetMs = new Date(targetIso).getTime();

    const tick = () => {
      const diff = targetMs - Date.now();
      if (diff <= 1000) {
        setTimeStr("00:00:00");
        if (!hasFiredRef.current) { hasFiredRef.current = true; onReset?.(); }
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeStr(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  return timeStr;
}

export default function Missions() {
  const { isLoading } = useAuth();
  const queryClient = useQueryClient();
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
  const [streakClaimStep, setStreakClaimStep] = useState<'idle' | 'claiming'>('idle');
  
  const { runAdFlow } = useAdFlow();

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

  const { data: streakStatus, refetch: refetchStreak } = useQuery<StreakStatus>({
    queryKey: ['/api/daily-streak/status'],
    retry: false,
    refetchInterval: 60000,
  });

  const streakCountdown = useCountdown(streakStatus?.nextResetAt, () => {
    refetchStreak();
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

  const streakClaimMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/daily-streak/claim', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error((await response.json()).error || (await response.json()).message);
      return response.json();
    },
    onSuccess: (data) => {
      showNotification(`+${data.reward.pow.toLocaleString()} POW — Day ${data.newStreak} streak!`, 'success');
      setStreakClaimStep('idle');
      queryClient.invalidateQueries({ queryKey: ['/api/daily-streak/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      refetchStreak();
    },
    onError: (error: any) => {
      if (error?.alreadyClaimed || error?.message?.includes('Already claimed')) {
        showNotification("Streak already claimed today.", 'error');
      } else {
        showNotification(error?.message || "Could not claim streak.", 'error');
      }
      setStreakClaimStep('idle');
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
      showNotification(`+${parseInt(data.reward).toLocaleString()} POW claimed!`, "success");
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
      if (tgWebApp?.shareMessage) {
        try {
          const response = await fetch('/api/share/prepare-message', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await response.json();
          if (data.success && data.messageId) {
            tgWebApp.shareMessage(data.messageId, () => setShareWithFriendsStep('ready'));
            return;
          } else if (data.fallbackUrl) {
            tgWebApp.openTelegramLink(data.fallbackUrl);
            setShareWithFriendsStep('ready');
            return;
          }
        } catch {}
      }
      const shareTitle = `💸 Start earning money just by completing tasks & watching ads!`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareTitle)}`;
      if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
      setShareWithFriendsStep('ready');
    } catch {
      setShareWithFriendsStep('ready');
    }
  }, [missionStatus?.shareStory?.claimed, referralLink]);

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

  const handleCheckForUpdates = useCallback(() => {
    if (missionStatus?.checkForUpdates?.claimed || checkForUpdatesStep !== 'idle') return;
    const tgWebApp = window.Telegram?.WebApp as any;
    if (tgWebApp?.openTelegramLink) tgWebApp.openTelegramLink('https://t.me/PaidADsNews');
    else window.open('https://t.me/PaidADsNews', '_blank');
    setCheckForUpdatesStep('opened');
    setCheckForUpdatesCountdown(3);
    const id = setInterval(() => {
      setCheckForUpdatesCountdown(prev => {
        if (prev <= 1) { clearInterval(id); setCheckForUpdatesStep('ready'); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [missionStatus?.checkForUpdates?.claimed, checkForUpdatesStep]);

  const handleTaskClick = async (task: Task) => {
    if (!task.link || claimReadyTasks.has(task.id) || clickedTasks.has(task.id)) return;
    let linkToOpen = task.link.trim();
    if (!linkToOpen.startsWith('http')) linkToOpen = 'https://' + linkToOpen;
    if (window.Telegram?.WebApp) {
      const isTg = linkToOpen.includes('t.me/');
      if (isTg && window.Telegram.WebApp.openTelegramLink) window.Telegram.WebApp.openTelegramLink(linkToOpen);
      else if (window.Telegram.WebApp.openLink) window.Telegram.WebApp.openLink(linkToOpen);
      else window.open(linkToOpen, "_blank");
    } else window.open(linkToOpen, "_blank");
    setClickedTasks(prev => new Set(prev).add(task.id));
    setCountdownTasks(prev => new Map(prev).set(task.id, 3));
    const countdown = setInterval(() => {
      setCountdownTasks(prev => {
        const m = new Map(prev);
        const c = m.get(task.id) || 0;
        if (c <= 1) { clearInterval(countdown); m.delete(task.id); setClaimReadyTasks(p => new Set(p).add(task.id)); }
        else m.set(task.id, c - 1);
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
      case 'bot': return <Bot className="w-4 h-4 text-white" />;
      case 'channel': return <MessageCircle className="w-4 h-4 text-white" />;
      case 'partner': return <Link2 className="w-4 h-4 text-white" />;
      default: return <Globe className="w-4 h-4 text-white" />;
    }
  };

  const TaskItem = ({ task }: { task: Task }) => {
    const reward = getReward(task);
    const isLoad = loadingTaskId === task.id;
    const isClaimReady = claimReadyTasks.has(task.id);
    const countdown = countdownTasks.get(task.id);
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          task.taskType === 'bot' ? 'bg-purple-500/10 border border-purple-500/20' :
          task.taskType === 'channel' ? 'bg-blue-500/10 border border-blue-500/20' :
          'bg-green-500/10 border border-green-500/20'
        }`}>
          <span className={task.taskType === 'bot' ? 'text-purple-400' : task.taskType === 'channel' ? 'text-blue-400' : 'text-green-400'}>
            {getTaskBoxIcon(task.taskType)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{task.title}</p>
          <p className="text-[#4cd3ff] text-xs font-bold">+{reward} POW</p>
        </div>
        <Button
          onClick={() => isClaimReady ? clickTaskMutation.mutate(task.id) : handleTaskClick(task)}
          disabled={isLoad || (countdown !== undefined && countdown > 0)}
          className={`h-8 w-20 text-xs font-bold rounded-xl ${
            isLoad ? 'bg-[#4cd3ff]/50 text-black' :
            countdown ? 'bg-[#1C1C1E] text-gray-400 border border-white/10' :
            isClaimReady ? 'bg-green-500 hover:bg-green-600 text-white' :
            'bg-[#4cd3ff] hover:bg-[#3bc3ef] text-black'
          }`}
        >
          {isLoad ? <Loader2 className="w-3 h-3 animate-spin" /> :
           countdown ? `${countdown}s` : isClaimReady ? 'Claim' : 'Start'}
        </Button>
      </div>
    );
  };

  const TaskSection = ({ title, icon, iconColor, tasks }: { title: string; icon: React.ReactNode; iconColor: string; tasks: Task[] }) => {
    if (tasks.length === 0) return null;
    return (
      <div className="bg-[#1C1C1E] rounded-2xl p-3.5 mb-3 border border-white/5">
        <div className="flex items-center gap-2 mb-1">
          <div className={iconColor}>{icon}</div>
          <span className="text-white text-sm font-semibold">{title}</span>
        </div>
        <div className="px-0.5">
          {tasks.map(t => <TaskItem key={t.id} task={t} />)}
        </div>
      </div>
    );
  };

  const currentStreakDay = streakStatus?.claimedToday ? streakStatus.streak : (streakStatus?.nextStreakDay ?? 1);
  const streakClaimed = streakStatus?.claimedToday ?? false;
  const streakReward = streakStatus?.reward;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-16 bg-black">

        {/* Header — Affiliates style */}
        <div className="mb-4">
          <h1 className="text-2xl font-black text-white tracking-tight mb-1">
            Missions
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            Get rewards for completing tasks
          </p>
        </div>

        {/* Daily Rewards — Streak Section */}
        <div className="bg-[#1C1C1E] rounded-2xl p-4 mb-3 border border-white/5">
          <div className="flex items-center justify-between mb-1">
            <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Daily Rewards
            </p>
            <div className="flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-orange-400 text-sm font-black">Day {currentStreakDay}</span>
            </div>
          </div>
          <p className="text-[#666] text-xs mb-3 leading-relaxed">
            Return daily to keep your streak and earn bigger rewards!
          </p>

          {/* Tier table */}
          <div className="space-y-1.5 mb-3">
            {STREAK_TIERS.map((tier, i) => {
              const isActive = i === (
                currentStreakDay <= 10 ? 0 :
                currentStreakDay <= 20 ? 1 :
                currentStreakDay <= 30 ? 2 :
                currentStreakDay <= 40 ? 3 :
                currentStreakDay <= 50 ? 4 : 5
              );
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                    isActive
                      ? 'bg-orange-500/10 border border-orange-500/20'
                      : 'bg-black/20'
                  }`}
                >
                  <span className={`text-xs font-semibold ${isActive ? 'text-orange-300' : 'text-[#555]'}`}>
                    {tier.days}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${isActive ? 'text-white' : 'text-[#444]'}`}>
                      {tier.pow}
                    </span>
                    <span className={`text-[10px] ${isActive ? 'text-white/40' : 'text-[#333]'}`}>
                      {tier.usd}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timer + Claim */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-white/30" />
              <span className="text-xs font-mono text-white/40">{streakCountdown}</span>
              <span className="text-[10px] text-white/20">resets at 12:00 UTC</span>
            </div>
            {streakReward && !streakClaimed && (
              <span className="text-xs text-orange-400 font-bold">
                +{streakReward.pow.toLocaleString()} POW
              </span>
            )}
          </div>

          <button
            onClick={() => {
              if (streakClaimMutation.isPending || streakClaimed) return;
              setStreakClaimStep('claiming');
              streakClaimMutation.mutate();
            }}
            disabled={streakClaimMutation.isPending || streakClaimed}
            className={`btn-primary active:scale-95 transition-transform w-full ${
              streakClaimed ? 'opacity-40 cursor-not-allowed' : ''
            }`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '11px 0', borderRadius: 12, fontSize: 13, fontWeight: 700,
              cursor: streakClaimed ? 'not-allowed' : 'pointer',
              letterSpacing: '0.03em',
            }}
          >
            {streakClaimed
              ? `CLAIMED — DAY ${currentStreakDay} ✓`
              : streakClaimMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : `CLAIM DAY ${currentStreakDay} REWARD`}
          </button>
        </div>

        {/* Daily Tasks */}
        <div className="bg-[#1C1C1E] rounded-2xl p-3.5 mb-3 border border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center">
              <CalendarCheck className="w-3.5 h-3.5 text-yellow-400" />
            </div>
            <span className="text-white text-sm font-semibold">Daily Tasks</span>
          </div>

          <div className="space-y-2">
            {/* Share with Friends */}
            <div className="flex items-center justify-between bg-[#1C1C1E] rounded-xl p-2.5 border border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                  <Users className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Share with Friends</p>
                  <p className="text-green-400 text-xs font-bold">+5 POW</p>
                </div>
              </div>
              {missionStatus?.shareStory?.claimed ? (
                <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
              ) : shareWithFriendsStep === 'ready' || shareWithFriendsStep === 'claiming' ? (
                <Button
                  onClick={() => { if (!shareWithFriendsMutation.isPending) { setShareWithFriendsStep('claiming'); shareWithFriendsMutation.mutate(); } }}
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

            {/* Daily Check-in */}
            <div className="flex items-center justify-between bg-[#1C1C1E] rounded-xl p-2.5 border border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#4cd3ff]/10 border border-[#4cd3ff]/20 flex items-center justify-center">
                  <CalendarCheck className="w-4 h-4 text-[#4cd3ff]" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Daily Check-in</p>
                  <p className="text-[#4cd3ff] text-xs font-bold">+5 POW</p>
                </div>
              </div>
              {missionStatus?.dailyCheckin?.claimed ? (
                <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
              ) : dailyCheckinStep === 'ads' ? (
                <Button disabled className="h-8 w-20 text-xs font-bold rounded-lg bg-purple-600 text-white">
                  <Loader2 className="w-3 h-3 animate-spin" />
                </Button>
              ) : dailyCheckinStep === 'ready' || dailyCheckinStep === 'claiming' ? (
                <Button
                  onClick={() => { if (!dailyCheckinMutation.isPending) { setDailyCheckinStep('claiming'); dailyCheckinMutation.mutate(); } }}
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

            {/* Check for Updates */}
            <div className="flex items-center justify-between bg-[#1C1C1E] rounded-xl p-2.5 border border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Check for Updates</p>
                  <p className="text-orange-400 text-xs font-bold">+5 POW</p>
                </div>
              </div>
              {missionStatus?.checkForUpdates?.claimed ? (
                <div className="h-8 w-20 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-400" />
                </div>
              ) : checkForUpdatesStep === 'opened' ? (
                <Button disabled className="h-8 w-20 text-xs font-bold rounded-lg bg-gray-600 text-white">
                  {checkForUpdatesCountdown}s
                </Button>
              ) : checkForUpdatesStep === 'ready' || checkForUpdatesStep === 'claiming' ? (
                <Button
                  onClick={() => { if (!checkForUpdatesMutation.isPending) { setCheckForUpdatesStep('claiming'); checkForUpdatesMutation.mutate(); } }}
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
                  Go
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Advertiser Tasks */}
        <TaskSection
          title="Bot Tasks"
          icon={<Bot className="w-3.5 h-3.5" />}
          iconColor="text-purple-400"
          tasks={gameTasks}
        />
        <TaskSection
          title="Channel Tasks"
          icon={<MessageCircle className="w-3.5 h-3.5" />}
          iconColor="text-blue-400"
          tasks={socialTasks}
        />
        <TaskSection
          title="Partner Tasks"
          icon={<Link2 className="w-3.5 h-3.5" />}
          iconColor="text-green-400"
          tasks={partnerTasks}
        />

      </main>
    </Layout>
  );
}
