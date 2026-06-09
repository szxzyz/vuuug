import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Loader2,
  Bot,
  MessageCircle,
  Link2,
  Globe,
  Play,
  Tv,
  Zap
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAdFlow } from "@/hooks/useAdFlow";
import PromoCodeInput from "@/components/PromoCodeInput";

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

interface AppSettings {
  channelTaskReward?: number;
  botTaskReward?: number;
  partnerTaskReward?: number;
  monetagMissionReward?: number;
  monetagMissionLimit?: number;
  gigaPubMissionReward?: number;
  gigaPubMissionLimit?: number;
  adexiumMissionReward?: number;
  adexiumMissionLimit?: number;
  [key: string]: any;
}

function getDailyKey(platform: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `mission_ads_${platform}_${today}`;
}

function getPlatformCount(platform: string): number {
  try {
    return parseInt(localStorage.getItem(getDailyKey(platform)) || '0', 10);
  } catch { return 0; }
}

function incPlatformCount(platform: string) {
  try {
    const key = getDailyKey(platform);
    const val = getPlatformCount(platform) + 1;
    localStorage.setItem(key, String(val));
  } catch {}
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
  const [adLoadingPlatform, setAdLoadingPlatform] = useState<string | null>(null);
  const [platformCounts, setPlatformCounts] = useState({
    monetag: getPlatformCount('monetag'),
    gigapub: getPlatformCount('gigapub'),
    adexium: getPlatformCount('adexium'),
  });

  const { showMonetagAd, showGigaPubAd, showAdexiumAd } = useAdFlow();

  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ['/api/app-settings'],
    retry: false,
  });

  const { data: tasksData, refetch: refetchTasks } = useQuery<{ success: boolean; tasks: Task[] }>({
    queryKey: ["/api/advertiser-tasks"],
    retry: false,
  });

  const monetagReward = appSettings?.monetagMissionReward ?? 50;
  const monetagLimit = appSettings?.monetagMissionLimit ?? 10;
  const gigaPubReward = appSettings?.gigaPubMissionReward ?? 50;
  const gigaPubLimit = appSettings?.gigaPubMissionLimit ?? 10;
  const adexiumReward = appSettings?.adexiumMissionReward ?? 50;
  const adexiumLimit = appSettings?.adexiumMissionLimit ?? 10;

  const channelReward = appSettings?.channelTaskReward || 30;
  const botReward = appSettings?.botTaskReward || 20;
  const partnerReward = appSettings?.partnerTaskReward || 5;

  const claimMissionAdMutation = useMutation({
    mutationFn: async (platform: string) => {
      const response = await fetch('/api/missions/ads/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platform }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || 'Failed to claim reward');
      return data;
    },
    onSuccess: (data, platform) => {
      incPlatformCount(platform);
      setPlatformCounts(prev => ({ ...prev, [platform]: getPlatformCount(platform) }));
      showNotification(`+${data.reward} POW claimed!`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (error: Error) => {
      showNotification(error.message, 'error');
    },
  });

  const handleWatchAd = useCallback(async (platform: 'monetag' | 'gigapub' | 'adexium') => {
    const limits = { monetag: monetagLimit, gigapub: gigaPubLimit, adexium: adexiumLimit };
    const limit = limits[platform];
    const count = getPlatformCount(platform);
    if (count >= limit) {
      showNotification(`Daily limit reached (${limit}/day)`, 'info');
      return;
    }
    if (adLoadingPlatform) return;
    setAdLoadingPlatform(platform);
    try {
      let result: { success: boolean; unavailable: boolean };
      if (platform === 'monetag') {
        const r = await showMonetagAd();
        result = { success: r.success && r.watchedFully, unavailable: r.unavailable };
      } else if (platform === 'gigapub') {
        result = await showGigaPubAd();
      } else {
        result = await showAdexiumAd();
      }
      if (result.unavailable) {
        showNotification('Ad not available right now', 'info');
        return;
      }
      if (!result.success) {
        showNotification('Please watch the full ad to earn', 'error');
        return;
      }
      await claimMissionAdMutation.mutateAsync(platform);
    } catch (err: any) {
      showNotification(err?.message || 'Something went wrong', 'error');
    } finally {
      setAdLoadingPlatform(null);
    }
  }, [monetagLimit, gigaPubLimit, adexiumLimit, adLoadingPlatform, showMonetagAd, showGigaPubAd, showAdexiumAd, claimMissionAdMutation]);

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

  const getReward = (t: Task) => t.taskType === 'partner' ? partnerReward : t.taskType === 'channel' ? channelReward : botReward;

  const getTaskIcon = (taskType: string) => {
    switch (taskType) {
      case 'bot': return <Bot className="w-4 h-4 text-purple-400" />;
      case 'channel': return <MessageCircle className="w-4 h-4 text-blue-400" />;
      case 'partner': return <Link2 className="w-4 h-4 text-green-400" />;
      default: return <Globe className="w-4 h-4 text-gray-400" />;
    }
  };

  const TaskItem = ({ task }: { task: Task }) => {
    const reward = getReward(task);
    const loading = loadingTaskId === task.id;
    const isClaimReady = claimReadyTasks.has(task.id);
    const countdown = countdownTasks.get(task.id);
    return (
      <div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/5">
          {getTaskIcon(task.taskType)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{task.title}</p>
          <p className="text-[#4cd3ff] text-xs font-bold">+{reward} POW</p>
        </div>
        <Button
          onClick={() => isClaimReady ? clickTaskMutation.mutate(task.id) : handleTaskClick(task)}
          disabled={loading || (countdown !== undefined && countdown > 0)}
          className={`h-8 w-20 text-xs font-bold rounded-xl ${
            loading ? 'bg-[#4cd3ff]/50 text-black' :
            countdown ? 'bg-white/5 text-gray-400 border border-white/10' :
            isClaimReady ? 'bg-green-500 hover:bg-green-600 text-white' :
            'bg-[#4cd3ff] hover:bg-[#3bc3ef] text-black'
          }`}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> :
           countdown ? `${countdown}s` :
           isClaimReady ? 'Claim' : 'Go'}
        </Button>
      </div>
    );
  };

  const adPlatforms = [
    {
      id: 'monetag' as const,
      name: 'Monetag',
      reward: monetagReward,
      limit: monetagLimit,
      count: platformCounts.monetag,
      color: 'text-orange-400',
    },
    {
      id: 'gigapub' as const,
      name: 'GiGaPub',
      reward: gigaPubReward,
      limit: gigaPubLimit,
      count: platformCounts.gigapub,
      color: 'text-purple-400',
    },
    {
      id: 'adexium' as const,
      name: 'Adexium',
      reward: adexiumReward,
      limit: adexiumLimit,
      count: platformCounts.adexium,
      color: 'text-blue-400',
    },
  ];

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-3 pb-24">

        {/* Page Title */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-white">Mission</h1>
          <p className="text-sm text-white/40 mt-0.5">Get rewards for completing task</p>
        </div>

        {/* Spider-Man Banner */}
        <div
          className="mb-5 rounded-2xl overflow-hidden relative cursor-pointer active:scale-[0.98] transition-transform"
          style={{ height: 96 }}
          onClick={() => setLocation("/task/create")}
        >
          <img
            src="/spiderman-banner.jpg"
            alt="Create Task"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 35%' }}
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.1) 100%)' }} />
          <div className="absolute inset-0 flex flex-col justify-center px-4">
            <span style={{ fontSize: 16, fontWeight: 900, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.95)', lineHeight: 1.2 }}>
              I want my task here
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500, marginTop: 3 }}>
              create your own task
            </span>
          </div>
        </div>

        {/* Earn Extra With ADS */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Tv className="w-4 h-4 text-[#4cd3ff]" />
            <span className="text-sm font-bold text-white">Earn Extra With ADS</span>
          </div>

          {adPlatforms.map((p) => {
            const done = p.count >= p.limit;
            const loading = adLoadingPlatform === p.id;
            return (
              <div key={p.id} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                    <Play className={`w-4 h-4 ${p.color}`} />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{p.name}</p>
                    <p className={`text-xs font-bold ${p.color}`}>
                      +{p.reward} POW &nbsp;·&nbsp; {p.count}/{p.limit} today
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => handleWatchAd(p.id)}
                  disabled={loading || done || !!adLoadingPlatform}
                  className={`h-8 w-16 text-xs font-bold rounded-xl ${
                    done ? 'bg-white/5 text-white/30' :
                    loading ? 'bg-[#4cd3ff]/50 text-black' :
                    'bg-[#4cd3ff] hover:bg-[#3bc3ef] text-black'
                  }`}
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : done ? 'Done' : 'Earn'}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Advertiser Tasks */}
        {(gameTasks.length > 0 || socialTasks.length > 0 || partnerTasks.length > 0) && (
          <div className="mb-4">
            <p className="text-sm font-bold text-white mb-3">Tasks</p>
            {[...gameTasks, ...socialTasks, ...partnerTasks].map(t => (
              <TaskItem key={t.id} task={t} />
            ))}
          </div>
        )}

        {/* Promo Code */}
        <div className="mb-4">
          <p className="text-sm font-bold text-white mb-3">Promo Code</p>
          <PromoCodeInput />
        </div>

      </main>
    </Layout>
  );
}
