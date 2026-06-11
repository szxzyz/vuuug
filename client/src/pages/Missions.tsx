import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAdFlow } from "@/hooks/useAdFlow";
import PromoCodeInput from "@/components/PromoCodeInput";
import { FaBullhorn, FaRobot, FaHandshake } from "react-icons/fa";

const BLUE   = '#3b82f6';
const BLUE_D = '#2563eb';
const TEXT     = '#fff';
const TEXT_DIM = 'rgba(255,255,255,0.35)';
const CARD     = 'rgba(255,255,255,0.07)';

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
  monetixMissionReward?: number;
  monetixMissionLimit?: number;
  [key: string]: any;
}

function getDailyKey(platform: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `mission_ads_${platform}_${today}`;
}
function getPlatformCount(platform: string): number {
  try { return parseInt(localStorage.getItem(getDailyKey(platform)) || '0', 10); } catch { return 0; }
}
function incPlatformCount(platform: string) {
  try {
    const key = getDailyKey(platform);
    localStorage.setItem(key, String(getPlatformCount(platform) + 1));
  } catch {}
}

/* ─── Section Label ─── */
function SectionLabel({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>{title}</span>
    </div>
  );
}

/* ─── Empty state ─── */
function EmptyRow({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 16px' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 12 }}>{label}</span>
    </div>
  );
}

/* ─── Loading Row ─── */
function LoadingRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.06)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 12, width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: 6, marginBottom: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: 10, width: '40%', background: 'rgba(255,255,255,0.04)', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

/* ─── Ad platform icon ─── */
const PLATFORM_LOGOS: Record<string, string> = {
  monetag: '/monetag-logo.jpg',
  gigapub: '/gigapub-logo.jpg',
  monetix: '/monetix-logo-loading.jpg',
};
function AdIcon({ platform, done }: { platform: string; done: boolean }) {
  if (done) {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    );
  }
  const src = PLATFORM_LOGOS[platform];
  if (!src) {
    return (
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.1)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>{platform[0].toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img src={src} alt={platform} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
      onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
  );
}

/* ─── Ad Row ─── */
function AdRow({ platform, name, reward, limit, count, loading, disabled, onWatch, isLast }: {
  platform: string; name: string; reward: number; limit: number; count: number;
  loading: boolean; disabled: boolean; onWatch: () => void; isLast: boolean;
}) {
  const done = count >= limit;
  const busy = loading;
  const btnLabel = busy ? 'Loading…' : done ? 'DONE' : 'WATCH';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
        <AdIcon platform={platform} done={done} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' as const }}>
            <span style={{ color: TEXT, fontSize: 14, fontWeight: 800 }}>{name}</span>
            <span style={{ background: `${BLUE}22`, borderRadius: 5, color: BLUE, fontSize: 10, fontWeight: 800, padding: '2px 6px' }}>+{reward} POW</span>
          </div>
          <div style={{ color: TEXT_DIM, fontSize: 12, marginTop: 2 }}>
            {done ? `${limit}/${limit} — come back tomorrow` : `${count}/${limit} today`}
          </div>
        </div>
        <button
          onClick={onWatch}
          disabled={busy || done || disabled}
          style={{
            flexShrink: 0,
            background: done ? 'rgba(255,255,255,0.06)' : busy ? 'rgba(255,255,255,0.06)' : `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
            color: done ? 'rgba(255,255,255,0.3)' : busy ? 'rgba(255,255,255,0.4)' : '#fff',
            border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 800,
            cursor: busy || done || disabled ? 'not-allowed' : 'pointer',
            boxShadow: busy || done || disabled ? 'none' : `0 2px 12px rgba(37,99,235,0.4)`,
            display: 'flex', alignItems: 'center', gap: 5, letterSpacing: '0.03em',
          }}
          className={busy || done || disabled ? '' : 'active:scale-95 transition-transform'}
        >
          {busy && <span style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
          {btnLabel}
        </button>
      </div>
      {!isLast && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
    </>
  );
}


/* ─── Advertiser Task Row ─── */
function TaskRow({ task, reward, loading, clickedTasks, claimReadyTasks, countdownTasks, onGo, onClaim, isLast }: {
  task: Task; reward: number; loading: boolean;
  clickedTasks: Set<string>; claimReadyTasks: Set<string>; countdownTasks: Map<string, number>;
  onGo: (task: Task) => void; onClaim: (taskId: string) => void; isLast: boolean;
}) {
  const isClaimReady = claimReadyTasks.has(task.id);
  const isClicked = clickedTasks.has(task.id);
  const countdown = countdownTasks.get(task.id);

  const iconSvg = task.taskType === 'channel' ? (
    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <FaBullhorn size={16} color="#3b82f6" />
    </div>
  ) : task.taskType === 'partner' ? (
    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(236,72,153,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <FaHandshake size={16} color="#ec4899" />
    </div>
  ) : (
    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <FaRobot size={16} color="#8b5cf6" />
    </div>
  );

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px', cursor: isClaimReady || isClicked ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent' }}
        onClick={() => !isClaimReady && !isClicked && onGo(task)}
      >
        {iconSvg}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: TEXT, fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block' }}>{task.title}</span>
          <span style={{ color: TEXT_DIM, fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            {task.taskType === 'channel'
              ? <><FaBullhorn size={10} color="#3b82f6" /> Channel</>
              : task.taskType === 'partner'
              ? <><FaHandshake size={10} color="#ec4899" /> Partner</>
              : <><FaRobot size={10} color="#8b5cf6" /> Bot / Website</>}
          </span>
        </div>
        <div style={{ flexShrink: 0 }}>
          {!isClicked ? (
            <span style={{ background: `${BLUE}22`, borderRadius: 8, color: BLUE, fontSize: 11, fontWeight: 800, padding: '5px 9px', display: 'inline-block' }}>+{reward} POW</span>
          ) : countdown !== undefined ? (
            <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 800, color: TEXT_DIM, display: 'inline-block' }}>{countdown}s</span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onClaim(task.id); }}
              disabled={loading}
              style={{ background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #16a34a, #22c55e)', border: 'none', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 800, color: loading ? TEXT_DIM : '#fff', cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 2px 12px rgba(34,197,94,0.35)' }}
              className="active:scale-95 transition-transform"
            >
              {loading ? '…' : 'CLAIM'}
            </button>
          )}
        </div>
      </div>
      {!isLast && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />}
    </>
  );
}

/* ─── Category Tabs ─── */
type CategoryTab = 'channel' | 'bot' | 'partner';

const CATEGORY_TABS: { id: CategoryTab; label: string; Icon: React.ElementType; color: string }[] = [
  { id: 'channel', label: 'Channels',  Icon: FaBullhorn,  color: '#3b82f6' },
  { id: 'bot',     label: 'Bots & Web', Icon: FaRobot,    color: '#8b5cf6' },
  { id: 'partner', label: 'Partners',  Icon: FaHandshake, color: '#ec4899' },
];

function CategoryTabs({ active, onChange, counts }: {
  active: CategoryTab;
  onChange: (tab: CategoryTab) => void;
  counts: Record<CategoryTab, number>;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      {CATEGORY_TABS.map(tab => {
        const isActive = active === tab.id;
        const count = counts[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column' as const,
              alignItems: 'center',
              gap: 4,
              padding: '10px 6px',
              borderRadius: 12,
              border: isActive ? `1px solid ${tab.color}55` : '1px solid rgba(255,255,255,0.06)',
              background: isActive ? `${tab.color}18` : 'rgba(255,255,255,0.04)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            className="active:scale-95 transition-transform"
          >
            <tab.Icon size={17} color={isActive ? tab.color : 'rgba(255,255,255,0.4)'} />
            <span style={{ fontSize: 10, fontWeight: 800, color: isActive ? '#fff' : 'rgba(255,255,255,0.45)', letterSpacing: '0.04em' }}>{tab.label}</span>
            {count > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: isActive ? tab.color : 'rgba(255,255,255,0.3)', background: isActive ? `${tab.color}22` : 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '1px 6px' }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Main Page ─── */
export default function Missions() {
  const { isLoading, user } = useAuth() as any;
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: adminData } = useQuery<{ isAdmin: boolean }>({ queryKey: ['/api/admin/check'], retry: false });
  const isAdmin = adminData?.isAdmin || false;
  const [activeCategory, setActiveCategory] = useState<CategoryTab>('channel');
  const [clickedTasks, setClickedTasks] = useState<Set<string>>(new Set());
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const [claimReadyTasks, setClaimReadyTasks] = useState<Set<string>>(new Set());
  const [countdownTasks, setCountdownTasks] = useState<Map<string, number>>(new Map());
  const [adLoadingPlatform, setAdLoadingPlatform] = useState<string | null>(null);
  const [platformCounts, setPlatformCounts] = useState({
    monetag: getPlatformCount('monetag'),
    gigapub: getPlatformCount('gigapub'),
    monetix: getPlatformCount('monetix'),
  });

  const { showMonetagAd, showGigaPubAd, showMonetixAd } = useAdFlow();

  const { data: appSettings } = useQuery<AppSettings>({ queryKey: ['/api/app-settings'], retry: false });
  const { data: tasksData, isLoading: tasksLoading } = useQuery<{ success: boolean; tasks: Task[] }>({
    queryKey: ["/api/advertiser-tasks"],
    retry: false,
    refetchOnMount: true,
    staleTime: 10000,
  });

  const monetagReward = appSettings?.monetagMissionReward ?? 50;
  const monetagLimit  = appSettings?.monetagMissionLimit  ?? 10;
  const gigaPubReward = appSettings?.gigaPubMissionReward ?? 50;
  const gigaPubLimit  = appSettings?.gigaPubMissionLimit  ?? 10;
  const monetixReward = appSettings?.monetixMissionReward ?? 1500;
  const monetixLimit  = appSettings?.monetixMissionLimit  ?? 25;
  const channelReward = appSettings?.channelTaskReward || 30;
  const botReward     = appSettings?.botTaskReward     || 20;
  const partnerReward = appSettings?.partnerTaskReward  || 5;

  const claimMissionAdMutation = useMutation({
    mutationFn: async (platform: string) => {
      const response = await fetch('/api/missions/ads/watch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
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
    onError: (error: Error) => showNotification(error.message, 'error'),
  });

  const handleWatchAd = useCallback(async (platform: 'monetag' | 'gigapub' | 'monetix') => {
    const limitMap = { monetag: monetagLimit, gigapub: gigaPubLimit, monetix: monetixLimit };
    const limit = limitMap[platform];
    if (getPlatformCount(platform) >= limit) { showNotification(`Daily limit reached (${limit}/day)`, 'info'); return; }
    if (adLoadingPlatform) return;
    setAdLoadingPlatform(platform);
    try {
      let result: { success: boolean; unavailable: boolean };
      if (platform === 'monetag') {
        const r = await showMonetagAd();
        result = { success: r.success, unavailable: r.unavailable };
      } else if (platform === 'gigapub') {
        result = await showGigaPubAd();
      } else {
        result = await showMonetixAd();
      }
      if (result.unavailable) { showNotification('No ad available right now, try again later', 'info'); return; }
      if (!result.success)    { showNotification('Please watch the full ad to earn', 'error'); return; }
      await claimMissionAdMutation.mutateAsync(platform);
    } catch (err: any) {
      showNotification(err?.message || 'Something went wrong', 'error');
    } finally {
      setAdLoadingPlatform(null);
    }
  }, [monetagLimit, gigaPubLimit, monetixLimit, adLoadingPlatform, showMonetagAd, showGigaPubAd, showMonetixAd, claimMissionAdMutation]);

  const clickTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      setLoadingTaskId(taskId);
      const response = await fetch(`/api/advertiser-tasks/${taskId}/click`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
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
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/advertiser-tasks'] });
    },
    onError: (error: Error) => { showNotification(error.message, "error"); setLoadingTaskId(null); },
  });

  const handleTaskGo = (task: Task) => {
    if (!task.link || claimReadyTasks.has(task.id) || clickedTasks.has(task.id)) return;
    let link = task.link.trim();
    if (!link.startsWith('http')) link = 'https://' + link;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      if (link.includes('t.me/') && tg.openTelegramLink) tg.openTelegramLink(link);
      else if (tg.openLink) tg.openLink(link);
      else window.open(link, '_blank');
    } else {
      window.open(link, '_blank');
    }
    setClickedTasks(prev => new Set(prev).add(task.id));
    setCountdownTasks(prev => new Map(prev).set(task.id, 3));
    const interval = setInterval(() => {
      setCountdownTasks(prev => {
        const m = new Map(prev);
        const c = m.get(task.id) || 0;
        if (c <= 1) { clearInterval(interval); m.delete(task.id); setClaimReadyTasks(p => new Set(p).add(task.id)); }
        else m.set(task.id, c - 1);
        return m;
      });
    }, 1000);
  };

  if (isLoading) {
    return (
      <Layout>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0, 150, 300].map(d => (
              <div key={d} style={{ width: 8, height: 8, borderRadius: '50%', background: BLUE, animation: 'bounce 1s infinite', animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  const allTasks    = (tasksData?.tasks || []).filter(t => !completedTaskIds.has(t.id));
  const channelTasks = allTasks.filter(t => t.taskType === 'channel');
  const botTasks    = allTasks.filter(t => t.taskType === 'bot');
  const partnerTasks = allTasks.filter(t => t.taskType === 'partner');

  const categoryCounts: Record<CategoryTab, number> = {
    channel: channelTasks.length,
    bot: botTasks.length,
    partner: partnerTasks.length,
  };

  const activeTasks =
    activeCategory === 'channel' ? channelTasks :
    activeCategory === 'bot'     ? botTasks     :
    partnerTasks;

  const getReward = (t: Task) =>
    t.taskType === 'partner' ? partnerReward : t.taskType === 'channel' ? channelReward : botReward;

  const emptyMessages: Record<CategoryTab, string> = {
    channel: 'No channel tasks available right now',
    bot: 'No bot or website tasks available right now',
    partner: 'No partner tasks available right now',
  };

  const adPlatforms = [
    { id: 'monetag' as const, name: 'Monetag',  reward: monetagReward, limit: monetagLimit,  count: platformCounts.monetag },
    { id: 'gigapub' as const, name: 'GiGaPub',  reward: gigaPubReward, limit: gigaPubLimit,  count: platformCounts.gigapub },
    { id: 'monetix' as const, name: 'Monetix',  reward: monetixReward, limit: monetixLimit,  count: platformCounts.monetix },
  ];

  const cardStyle = {
    background: CARD,
    borderRadius: 18,
    overflow: 'hidden' as const,
    marginBottom: 16,
  };

  return (
    <Layout>
      <main style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 100px' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: TEXT, margin: 0 }}>Mission</h1>
          <p style={{ fontSize: 13, color: TEXT_DIM, marginTop: 4 }}>Complete tasks and earn POW rewards</p>
        </div>

        {/* Banner — Create Task */}
        <div
          style={{ borderRadius: 18, overflow: 'hidden', position: 'relative', height: 90, marginBottom: 20, cursor: isAdmin ? 'pointer' : 'default' }}
          className="active:scale-[0.98] transition-transform"
          onClick={() => {
            if (isAdmin) {
              setLocation("/task/create");
            } else {
              showNotification("Coming Soon", "info");
            }
          }}
        >
          <img src="/spiderman-banner.jpg" alt="Create Task" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 35%' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.1) 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 18px' }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#fff', lineHeight: 1.2 }}>I want my task here</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
              {isAdmin ? 'create your own task' : '🔒 Coming Soon'}
            </span>
          </div>
          {!isAdmin && (
            <div style={{ position: 'absolute', top: 10, right: 12, background: 'rgba(255,200,0,0.18)', border: '1px solid rgba(255,200,0,0.45)', borderRadius: 8, padding: '3px 10px' }}>
              <span style={{ fontSize: 10, fontWeight: 900, color: '#ffd700', letterSpacing: '0.08em' }}>COMING SOON</span>
            </div>
          )}
        </div>

        {/* Earn with ADS */}
        <SectionLabel title="Earn with ADS" />
        <div style={cardStyle}>
          {adPlatforms.map((p, i) => (
            <AdRow
              key={p.id}
              platform={p.id}
              name={p.name}
              reward={p.reward}
              limit={p.limit}
              count={p.count}
              loading={adLoadingPlatform === p.id}
              disabled={!!adLoadingPlatform && adLoadingPlatform !== p.id}
              onWatch={() => handleWatchAd(p.id)}
              isLast={i === adPlatforms.length - 1}
            />
          ))}
        </div>

        {/* Promo Code */}
        <SectionLabel title="Promo Code" />
        <div style={cardStyle}>
          <div style={{ padding: '14px 16px' }}>
            <PromoCodeInput />
          </div>
        </div>

        {/* Tasks — Categorized */}
        <SectionLabel title="Tasks" />

        {/* Category Tabs */}
        <CategoryTabs
          active={activeCategory}
          onChange={setActiveCategory}
          counts={categoryCounts}
        />

        {/* Task List for Active Category */}
        <div style={cardStyle}>
          {tasksLoading ? (
            <>
              <LoadingRow />
              <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 16px' }} />
              <LoadingRow />
            </>
          ) : activeTasks.length === 0 ? (
            <EmptyRow label={emptyMessages[activeCategory]} />
          ) : (
            activeTasks.map((task, i) => (
              <TaskRow
                key={task.id}
                task={task}
                reward={getReward(task)}
                loading={loadingTaskId === task.id}
                clickedTasks={clickedTasks}
                claimReadyTasks={claimReadyTasks}
                countdownTasks={countdownTasks}
                onGo={handleTaskGo}
                onClaim={id => clickTaskMutation.mutate(id)}
                isLast={i === activeTasks.length - 1}
              />
            ))
          )}
        </div>

      </main>
    </Layout>
  );
}
