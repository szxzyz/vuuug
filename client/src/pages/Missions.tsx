import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showNotification } from "@/components/AppNotification";
import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import PromoCodeInput from "@/components/PromoCodeInput";
import { useLanguage } from "@/hooks/useLanguage";
import AdvertiserTaskSheet from "@/components/AdvertiserTaskSheet";

declare global {
  interface Window {
    Adsgram?: {
      init: (params: { blockId: string; debug?: boolean }) => { show: () => Promise<void>; destroy: () => void };
    };
    show_11123429?: (type?: string) => Promise<void>;
    showGiga?: () => Promise<void>;
  }
}

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
  verificationRequired?: boolean;
  channelVerified?: boolean;
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
  shareReferralReward?: number;
  checkAnnouncementReward?: number;
  adsgramCheckinReward?: number;
  firstActiveReferralReward?: number;
  channelUrl?: string;
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

function SectionLabel({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>{title}</span>
    </div>
  );
}

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

function LoadingRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px' }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.06)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 12, width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: 6, marginBottom: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: 10, width: '40%', background: 'rgba(255,255,255,0.04)', borderRadius: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

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

function AdRow({ platform, name, reward, limit, count, loading, disabled, onWatch, isLast, doneLabel, watchLabel, loadingLabel, perDayLabel }: {
  platform: string; name: string; reward: number; limit: number; count: number;
  loading: boolean; disabled: boolean; onWatch: () => void; isLast: boolean;
  doneLabel: string; watchLabel: string; loadingLabel: string; perDayLabel: string;
}) {
  const done = count >= limit;
  const busy = loading;
  const btnLabel = busy ? loadingLabel : done ? doneLabel : watchLabel;

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
            {done ? `${limit}/${limit} — ${perDayLabel}` : `${count}/${limit} ${perDayLabel}`}
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

/* ── Unified action button style ── */
const BTN_BASE: React.CSSProperties = {
  flexShrink: 0,
  width: 72,
  height: 36,
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  letterSpacing: '0.02em',
  transition: 'opacity 0.15s',
};

/* ── Daily Mission Card — compact single-row like AdRow ── */
function DailyMissionCard({
  icon, title, reward, done, busy, btnLabel, btnColor,
  countdown, claimReady, onAction, onClaim, isOneTime,
}: {
  icon: React.ReactNode; title: string; reward: number;
  done: boolean; busy: boolean; btnLabel: string; btnColor: string;
  countdown?: number; claimReady?: boolean;
  onAction: () => void; onClaim: () => void;
  isLast: boolean; isOneTime?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px' }}>
      {/* Icon box */}
      <div style={{ flexShrink: 0, width: 42, height: 42, borderRadius: 11, background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {icon}
      </div>

      {/* Title + reward */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: TEXT, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          {isOneTime && (
            <span style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, color: 'rgba(255,255,255,0.35)', fontSize: 8, fontWeight: 700, padding: '1px 4px', flexShrink: 0 }}>1×</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
          <span style={{ color: BLUE, fontSize: 12, fontWeight: 800 }}>+{reward.toLocaleString()}</span>
          <span style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 600 }}>POW</span>
        </div>
      </div>

      {/* Action button */}
      {done ? (
        <div style={{ flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      ) : countdown !== undefined ? (
        <div style={{ ...BTN_BASE, background: 'rgba(255,255,255,0.06)', color: TEXT_DIM, cursor: 'default', flexShrink: 0 }}>
          {countdown}s
        </div>
      ) : claimReady ? (
        <button onClick={onClaim} disabled={busy} style={{ ...BTN_BASE, flexShrink: 0, background: busy ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#16a34a,#22c55e)', color: busy ? TEXT_DIM : '#fff', boxShadow: busy ? 'none' : '0 2px 10px rgba(34,197,94,0.3)', cursor: busy ? 'not-allowed' : 'pointer' }} className="active:scale-95 transition-transform">
          {busy ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> : 'Claim'}
        </button>
      ) : (
        <button onClick={onAction} disabled={busy} style={{ ...BTN_BASE, flexShrink: 0, background: busy ? 'rgba(255,255,255,0.06)' : btnColor, color: busy ? TEXT_DIM : '#fff', boxShadow: busy ? 'none' : '0 2px 10px rgba(0,0,0,0.25)', cursor: busy ? 'not-allowed' : 'pointer' }} className={busy ? '' : 'active:scale-95 transition-transform'}>
          {busy ? <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> : btnLabel}
        </button>
      )}
    </div>
  );
}

/* ── Task type image icon ── */
function TaskTypeIcon({ taskType }: { taskType: string }) {
  const src = taskType === 'channel' || taskType === 'partner'
    ? '/icon-channel.png'
    : '/icon-game.png';
  return (
    <div style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={src} alt={taskType} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  );
}

/* ── Feed TaskRow – compact single-row layout ── */
function TaskRow({ task, reward, loading, clickedTasks, claimReadyTasks, countdownTasks, onGo, onClaim }: {
  task: Task; reward: number; loading: boolean;
  clickedTasks: Set<string>; claimReadyTasks: Set<string>; countdownTasks: Map<string, number>;
  onGo: (task: Task) => void; onClaim: (taskId: string) => void; isLast: boolean;
}) {
  const isClaimReady = claimReadyTasks.has(task.id);
  const isClicked = clickedTasks.has(task.id);
  const countdown = countdownTasks.get(task.id);

  const accent = task.taskType === 'channel' ? '#3b82f6'
    : task.taskType === 'partner' ? '#ec4899'
    : '#8b5cf6';

  const typeLabel = task.taskType === 'channel' ? 'Channel'
    : task.taskType === 'partner' ? 'Partner'
    : 'Bot / Game';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px' }}>
      {/* Icon box */}
      <div style={{ flexShrink: 0, width: 42, height: 42, borderRadius: 11, background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <TaskTypeIcon taskType={task.taskType} />
      </div>

      {/* Title + reward */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: TEXT, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block' }}>{task.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <span style={{ color: accent, fontSize: 12, fontWeight: 800 }}>+{reward.toLocaleString()}</span>
          <span style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 600 }}>POW</span>
          <span style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 500, opacity: 0.6 }}>· {typeLabel}</span>
        </div>
        {task.taskType === 'channel' && task.verificationRequired && (
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10 }}>⚠️</span>
            <span style={{ color: 'rgba(251,191,36,0.72)', fontSize: 10, fontWeight: 600 }}>7-day penalty applies</span>
          </div>
        )}
      </div>

      {/* Button */}
      {!isClicked ? (
        <button onClick={() => onGo(task)} style={{ ...BTN_BASE, flexShrink: 0, background: `linear-gradient(135deg,${BLUE_D},${BLUE})`, color: '#fff', boxShadow: '0 2px 10px rgba(37,99,235,0.35)' }} className="active:scale-95 transition-transform">
          Go
        </button>
      ) : countdown !== undefined ? (
        <div style={{ ...BTN_BASE, flexShrink: 0, background: 'rgba(255,255,255,0.06)', color: TEXT_DIM, cursor: 'default' }}>
          {countdown}s
        </div>
      ) : isClaimReady ? (
        <button onClick={e => { e.stopPropagation(); onClaim(task.id); }} disabled={loading} style={{ ...BTN_BASE, flexShrink: 0, background: loading ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#16a34a,#22c55e)', color: loading ? TEXT_DIM : '#fff', boxShadow: loading ? 'none' : '0 2px 12px rgba(34,197,94,0.35)', cursor: loading ? 'not-allowed' : 'pointer' }} className="active:scale-95 transition-transform">
          {loading ? '…' : 'Claim'}
        </button>
      ) : (
        <div style={{ flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      )}
    </div>
  );
}

type MainTab = 'all' | 'daily' | 'partner';

function MainTabs({ active, onChange, allLabel, dailyLabel, partnerLabel }: {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  allLabel: string;
  dailyLabel: string;
  partnerLabel: string;
}) {
  const tabs: { id: MainTab; label: string }[] = [
    { id: 'all',     label: allLabel },
    { id: 'daily',   label: dailyLabel },
    { id: 'partner', label: partnerLabel },
  ];
  return (
    <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 4, marginBottom: 16, gap: 2 }}>
      {tabs.map(tab => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 11, border: 'none', background: isActive ? '#fff' : 'transparent', cursor: 'pointer', transition: 'all 0.18s', fontSize: 13, fontWeight: 700, color: isActive ? '#000' : 'rgba(255,255,255,0.5)', letterSpacing: '0.01em' }}
            className="active:scale-95"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Missions() {
  const { isLoading, user } = useAuth() as any;
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const { data: adminData } = useQuery<{ isAdmin: boolean }>({ queryKey: ['/api/admin/check'], retry: false });
  const isAdmin = adminData?.isAdmin || false;
  const [activeTab, setActiveTab] = useState<MainTab>('all');

  /* Silently check for channel-leave penalties on mount */
  useEffect(() => {
    fetch('/api/tasks/check-channel-penalties', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {}); // Non-blocking, ignore errors
  }, []);

  /* Feed task state */
  const [clickedTasks, setClickedTasks] = useState<Set<string>>(new Set());
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());
  const [claimReadyTasks, setClaimReadyTasks] = useState<Set<string>>(new Set());
  const [countdownTasks, setCountdownTasks] = useState<Map<string, number>>(new Map());
  const [activeTaskSheet, setActiveTaskSheet] = useState<Task | null>(null);

  /* Ad platform state */
  const [adLoadingPlatform, setAdLoadingPlatform] = useState<string | null>(null);
  const [platformCounts, setPlatformCounts] = useState({
    monetag: getPlatformCount('monetag'),
    gigapub: getPlatformCount('gigapub'),
    monetix: getPlatformCount('monetix'),
  });

  /* Daily mission state */
  const [claimingMission, setClaimingMission] = useState<string | null>(null);

  /* Per-mission: countdown + claimReady */
  const [missionCountdown, setMissionCountdown] = useState<Record<string, number>>({});
  const [missionClaimReady, setMissionClaimReady] = useState<Record<string, boolean>>({});
  const missionTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  /* Queries */
  const { data: appSettings } = useQuery<AppSettings>({ queryKey: ['/api/app-settings'], retry: false });
  const { data: missionsStatus, refetch: refetchMissions } = useQuery<any>({ queryKey: ['/api/missions/status'], retry: false, staleTime: 30000 });
  const { data: tasksData, isLoading: tasksLoading } = useQuery<{ success: boolean; tasks: Task[] }>({ queryKey: ["/api/advertiser-tasks"], retry: false, refetchOnMount: true, staleTime: 10000 });
  const { data: botInfo } = useQuery<{ username: string }>({ queryKey: ['/api/bot-info'], retry: false, staleTime: 300000 });

  /* Derived values */
  const monetagReward = appSettings?.monetagMissionReward ?? 50;
  const monetagLimit  = appSettings?.monetagMissionLimit  ?? 10;
  const gigaPubReward = appSettings?.gigaPubMissionReward ?? 50;
  const gigaPubLimit  = appSettings?.gigaPubMissionLimit  ?? 10;
  const channelReward = appSettings?.channelTaskReward || 30;
  const botReward     = appSettings?.botTaskReward     || 20;
  const partnerReward = appSettings?.partnerTaskReward  || 5;

  const botUsername = botInfo?.username || (import.meta as any).env?.VITE_BOT_USERNAME || 'Paid_Adzbot';
  const referralLink = (user as any)?.referralCode
    ? `https://t.me/${botUsername}?start=${(user as any).referralCode}`
    : '';
  const channelUrl = appSettings?.channelUrl || 'https://t.me/PaidAdzNews';

  /* ── helpers ── */

  const startMissionCountdown = (key: string, cb: () => void, seconds = 3) => {
    setMissionCountdown(prev => ({ ...prev, [key]: seconds }));
    if (missionTimers.current[key]) clearInterval(missionTimers.current[key]);
    missionTimers.current[key] = setInterval(() => {
      setMissionCountdown(prev => {
        const c = (prev[key] || 0) - 1;
        if (c <= 0) {
          clearInterval(missionTimers.current[key]);
          delete missionTimers.current[key];
          setMissionCountdown(p => { const n = { ...p }; delete n[key]; return n; });
          setMissionClaimReady(p => ({ ...p, [key]: true }));
          cb();
          return prev;
        }
        return { ...prev, [key]: c };
      });
    }, 1000);
  };

  const claimMission = async (endpoint: string, missionKey: string) => {
    if (claimingMission) return;
    setClaimingMission(missionKey);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        showNotification(`+${data.reward} POW ${t('claimed')}!`, 'success');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        refetchMissions();
        setMissionClaimReady(p => { const n = { ...p }; delete n[missionKey]; return n; });
      } else {
        showNotification(data.error || t('failed'), 'error');
      }
    } catch (e: any) {
      showNotification(e.message || t('something_went_wrong'), 'error');
    } finally {
      setClaimingMission(null);
    }
  };

  /* AdsGram helper */
  const showAdsgramAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise(resolve => {
      if (!window.Adsgram) { resolve({ success: false, unavailable: true }); return; }
      try {
        window.Adsgram.init({ blockId: 'int-35652' })
          .show()
          .then(() => resolve({ success: true, unavailable: false }))
          .catch(() => resolve({ success: false, unavailable: false }));
      } catch {
        resolve({ success: false, unavailable: true });
      }
    });

  /* ── Mission handlers ── */

  const handleJustCheckIn = async (done: boolean) => {
    if (done || claimingMission === 'adsgram_checkin') return;
    if (missionClaimReady['adsgram_checkin']) {
      await claimMission('/api/missions/adsgram-checkin/claim', 'adsgram_checkin');
      return;
    }
    setClaimingMission('adsgram_checkin_loading');
    try {
      const result = await showAdsgramAd();
      if (result.unavailable) { showNotification(t('no_ad_available') || 'No ad available right now', 'info'); return; }
      if (!result.success) { showNotification(t('watch_full_ad') || 'Please watch the full ad', 'error'); return; }
      setMissionClaimReady(p => ({ ...p, adsgram_checkin: true }));
      await claimMission('/api/missions/adsgram-checkin/claim', 'adsgram_checkin');
    } finally {
      setClaimingMission(null);
    }
  };

  const handleCheckForUpdates = (done: boolean) => {
    if (done || claimingMission === 'check_announcement') return;
    if (missionClaimReady['check_announcement']) {
      claimMission('/api/missions/check-announcement/claim', 'check_announcement');
      return;
    }
    if (missionCountdown['check_announcement'] !== undefined) return;
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openTelegramLink) tg.openTelegramLink(channelUrl);
    else if (tg?.openLink) tg.openLink(channelUrl);
    else window.open(channelUrl, '_blank');
    startMissionCountdown('check_announcement', () => {});
  };

  const handleShareWithFriends = (done: boolean) => {
    if (done || claimingMission === 'share_referral') return;
    if (missionClaimReady['share_referral']) {
      claimMission('/api/missions/share-referral/claim', 'share_referral');
      return;
    }
    if (missionCountdown['share_referral'] !== undefined) return;
    if (!referralLink) { showNotification('Referral link not available', 'error'); return; }
    const tg = (window as any).Telegram?.WebApp;
    const shareText = `Join Paid Adz and earn rewards! 💰\n${referralLink}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Paid Adz and earn rewards! 💰')}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
    else if (tg?.openLink) tg.openLink(shareUrl);
    else if (navigator.share) navigator.share({ title: 'Paid Adz', text: shareText, url: referralLink }).catch(() => {});
    else window.open(shareUrl, '_blank');
    startMissionCountdown('share_referral', () => {});
  };

  const handleInviteFriend = async (done: boolean) => {
    if (done || claimingMission === 'first_active_referral') return;
    if (missionClaimReady['first_active_referral']) {
      claimMission('/api/missions/first-active-referral/claim', 'first_active_referral');
      return;
    }
    setClaimingMission('first_active_referral_checking');
    try {
      const res = await fetch('/api/missions/referral-status', { credentials: 'include' });
      const data = await res.json();
      if (data.hasActiveReferral) {
        setMissionClaimReady(p => ({ ...p, first_active_referral: true }));
        await claimMission('/api/missions/first-active-referral/claim', 'first_active_referral');
      } else {
        showNotification('No active referral found yet. Invite a friend to join first!', 'info');
      }
    } catch {
      showNotification('Could not check referral status. Try again.', 'error');
    } finally {
      setClaimingMission(null);
    }
  };

  /* Ad flow handlers */
  const showMonetagAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise(resolve => {
      // SDK exposes window.show_11123429 via data-sdk attribute in index.html
      if (typeof window.show_11123429 !== 'function') {
        resolve({ success: false, unavailable: true }); return;
      }
      window.show_11123429()
        .then(() => resolve({ success: true, unavailable: false }))
        .catch((err: any) => {
          const msg = String(err?.message || err || '').toLowerCase();
          const noFill = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable') || msg.includes('empty');
          resolve({ success: false, unavailable: noFill });
        });
    });

  const showGigaPubAd = (): Promise<{ success: boolean; unavailable: boolean }> =>
    new Promise(resolve => {
      // SDK exposes window.showGiga via gigapub script in index.html
      if (typeof window.showGiga !== 'function') {
        resolve({ success: false, unavailable: true }); return;
      }
      window.showGiga()
        .then(() => resolve({ success: true, unavailable: false }))
        .catch((err: any) => {
          const msg = String(err?.message || err?.error || err || '').toLowerCase();
          const noFill = msg.includes('no ad') || msg.includes('no fill') || msg.includes('unavailable') || msg.includes('empty');
          resolve({ success: false, unavailable: noFill });
        });
    });

  const claimMissionAdMutation = useMutation({
    mutationFn: async (platform: string) => {
      const response = await fetch('/api/missions/ads/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ platform }) });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || t('failed'));
      return data;
    },
    onSuccess: (data, platform) => {
      incPlatformCount(platform);
      setPlatformCounts(prev => ({ ...prev, [platform]: getPlatformCount(platform) }));
      showNotification(`+${data.reward} POW ${t('claimed')}!`, 'success');
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (error: Error) => showNotification(error.message, 'error'),
  });

  const handleWatchAd = useCallback(async (platform: 'monetag' | 'gigapub') => {
    const limitMap = { monetag: monetagLimit, gigapub: gigaPubLimit };
    const limit = limitMap[platform];
    if (getPlatformCount(platform) >= limit) { showNotification(`Daily limit (${limit}/day)`, 'info'); return; }
    if (adLoadingPlatform) return;
    setAdLoadingPlatform(platform);
    try {
      let result: { success: boolean; unavailable: boolean };
      if (platform === 'monetag') result = await showMonetagAd();
      else result = await showGigaPubAd();
      if (result.unavailable) { showNotification(t('no_ad_available'), 'info'); return; }
      if (!result.success)    { showNotification(t('watch_full_ad'), 'error'); return; }
      await claimMissionAdMutation.mutateAsync(platform);
    } catch (err: any) {
      showNotification(err?.message || t('something_went_wrong'), 'error');
    } finally {
      setAdLoadingPlatform(null);
    }
  }, [monetagLimit, gigaPubLimit, adLoadingPlatform, claimMissionAdMutation, t]);

  /* Feed task handlers */
  const clickTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      setLoadingTaskId(taskId);
      const response = await fetch(`/api/advertiser-tasks/${taskId}/click`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      const data = await response.json();
      if (!data.success) throw new Error(data.message);
      return data;
    },
    onSuccess: (data, taskId) => {
      showNotification(`+${parseInt(data.reward).toLocaleString()} POW ${t('claimed')}!`, "success");
      setCompletedTaskIds(prev => new Set(prev).add(taskId));
      setClickedTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
      setClaimReadyTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
      setLoadingTaskId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/advertiser-tasks'] });
    },
    onError: (error: Error) => { showNotification(error.message, "error"); setLoadingTaskId(null); },
  });

  const openTaskLink = (task: Task) => {
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

  const handleTaskGo = (task: Task) => {
    if (!task.link || claimReadyTasks.has(task.id) || clickedTasks.has(task.id)) return;
    // Verified bot/channel tasks → open interactive sheet
    if ((task.taskType === 'bot' || task.taskType === 'channel') && task.verificationRequired) {
      setActiveTaskSheet(task);
      return;
    }
    // All other tasks (including non-verified bot/channel) → direct open + countdown
    openTaskLink(task);
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

  const allTasks     = (tasksData?.tasks || []).filter(t => !completedTaskIds.has(t.id));
  const partnerTasks = allTasks.filter(t => t.taskType === 'partner');

  const getReward = (task: Task) =>
    task.taskType === 'partner' ? partnerReward : task.taskType === 'channel' ? channelReward : botReward;

  const adPlatforms = [
    { id: 'monetag' as const, name: 'Monetag', reward: monetagReward, limit: monetagLimit, count: platformCounts.monetag },
    { id: 'gigapub' as const, name: 'GiGaPub', reward: gigaPubReward, limit: gigaPubLimit, count: platformCounts.gigapub },
  ];

  const cardStyle = { background: CARD, borderRadius: 18, overflow: 'hidden' as const, marginBottom: 8 };

  /* Mission data */
  const shareReferralM       = missionsStatus?.shareReferral;
  const checkAnnouncementM   = missionsStatus?.checkAnnouncement;
  const adsgramCheckinM      = missionsStatus?.adsgramCheckin;
  const firstActiveReferralM = missionsStatus?.firstActiveReferral;

  const dailyMissions = [
    {
      key: 'adsgram_checkin',
      title: 'Just check in',
      description: 'Check in and get a reward',
      reward: adsgramCheckinM?.reward || appSettings?.adsgramCheckinReward || 1000,
      done: !!adsgramCheckinM?.claimed,
      btnLabel: 'Claim',
      btnColor: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
      icon: <img src="/icon-checkin.png" alt="check in" style={{ width: 42, height: 42, objectFit: 'contain', transform: 'scale(1.5)', transformOrigin: 'center' }} />,
      onAction: () => handleJustCheckIn(!!adsgramCheckinM?.claimed),
      onClaim: () => claimMission('/api/missions/adsgram-checkin/claim', 'adsgram_checkin'),
      busy: claimingMission === 'adsgram_checkin' || claimingMission === 'adsgram_checkin_loading',
    },
    {
      key: 'check_announcement',
      title: 'Check for updates',
      description: 'Find out the latest updates',
      reward: checkAnnouncementM?.reward || appSettings?.checkAnnouncementReward || 1000,
      done: !!checkAnnouncementM?.claimed,
      btnLabel: 'Go',
      btnColor: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
      icon: (
        <div style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="/icon-telegram.png" alt="updates" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ),
      onAction: () => handleCheckForUpdates(!!checkAnnouncementM?.claimed),
      onClaim: () => claimMission('/api/missions/check-announcement/claim', 'check_announcement'),
      busy: claimingMission === 'check_announcement',
    },
    {
      key: 'share_referral',
      title: 'Share with friends',
      description: 'Invite your friends and earn USD together',
      reward: shareReferralM?.reward || appSettings?.shareReferralReward || 1000,
      done: !!shareReferralM?.claimed,
      btnLabel: 'Share',
      btnColor: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
      icon: (
        <div style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="/icon-share.png" alt="share" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ),
      onAction: () => handleShareWithFriends(!!shareReferralM?.claimed),
      onClaim: () => claimMission('/api/missions/share-referral/claim', 'share_referral'),
      busy: claimingMission === 'share_referral',
    },
    {
      key: 'first_active_referral',
      title: 'Invite 1 friend',
      description: 'Invite and receive 20% of your friends earnings',
      reward: firstActiveReferralM?.reward || appSettings?.firstActiveReferralReward || 2500,
      done: !!firstActiveReferralM?.claimed,
      btnLabel: 'Check',
      btnColor: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
      isOneTime: true,
      icon: (
        <div style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="/icon-invite.png" alt="invite" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ),
      onAction: () => handleInviteFriend(!!firstActiveReferralM?.claimed),
      onClaim: () => claimMission('/api/missions/first-active-referral/claim', 'first_active_referral'),
      busy: claimingMission === 'first_active_referral',
    },
  ];

  return (
    <Layout>
      <main style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 20px' }}>

        {/* Promo Code */}
        <SectionLabel title={t('promo_code_label')} />
        <div style={cardStyle}>
          <div style={{ padding: '14px 16px' }}>
            <PromoCodeInput />
          </div>
        </div>

        {/* Tabs */}
        <MainTabs active={activeTab} onChange={setActiveTab} allLabel={t('all_tab')} dailyLabel={t('daily_tab')} partnerLabel={t('partner_tab')} />

        {/* ── ALL TAB ── */}
        {activeTab === 'all' && (
          <>
            <SectionLabel title={t('earn_with_ads')} />
            <div style={cardStyle}>
              {adPlatforms.map((p, i) => (
                <AdRow
                  key={p.id} platform={p.id} name={p.name} reward={p.reward} limit={p.limit} count={p.count}
                  loading={adLoadingPlatform === p.id} disabled={!!adLoadingPlatform && adLoadingPlatform !== p.id}
                  onWatch={() => handleWatchAd(p.id)} isLast={i === adPlatforms.length - 1}
                  doneLabel={t('done_label')} watchLabel={t('watch_label')} loadingLabel={t('loading_ellipsis')} perDayLabel={t('per_day')}
                />
              ))}
            </div>

            <SectionLabel title="Daily Tasks" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
              {dailyMissions.map(m => (
                <div key={m.key} style={cardStyle}>
                  <DailyMissionCard
                    icon={m.icon}
                    title={m.title}
                    reward={m.reward}
                    done={m.done}
                    busy={m.busy}
                    btnLabel={m.btnLabel}
                    btnColor={m.btnColor}
                    countdown={missionCountdown[m.key]}
                    claimReady={missionClaimReady[m.key]}
                    onAction={m.onAction}
                    onClaim={m.onClaim}
                    isLast={true}
                    isOneTime={(m as any).isOneTime}
                  />
                </div>
              ))}
            </div>

            <SectionLabel title={t('all_tasks_label')} />
            {tasksLoading ? (
              <div style={cardStyle}><LoadingRow /></div>
            ) : allTasks.length === 0 ? (
              <div style={cardStyle}><EmptyRow label={t('no_tasks_available')} /></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allTasks.map(task => (
                  <div key={task.id} style={cardStyle}>
                    <TaskRow
                      task={task} reward={getReward(task)} loading={loadingTaskId === task.id}
                      clickedTasks={clickedTasks} claimReadyTasks={claimReadyTasks} countdownTasks={countdownTasks}
                      onGo={handleTaskGo} onClaim={id => clickTaskMutation.mutate(id)} isLast={true}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── DAILY TAB ── */}
        {activeTab === 'daily' && (
          <>
            <SectionLabel title={t('earn_with_ads')} />
            <div style={cardStyle}>
              {adPlatforms.map((p, i) => (
                <AdRow
                  key={p.id} platform={p.id} name={p.name} reward={p.reward} limit={p.limit} count={p.count}
                  loading={adLoadingPlatform === p.id} disabled={!!adLoadingPlatform && adLoadingPlatform !== p.id}
                  onWatch={() => handleWatchAd(p.id)} isLast={i === adPlatforms.length - 1}
                  doneLabel={t('done_label')} watchLabel={t('watch_label')} loadingLabel={t('loading_ellipsis')} perDayLabel={t('per_day')}
                />
              ))}
            </div>

            <SectionLabel title="Daily Tasks" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dailyMissions.map(m => (
                <div key={m.key} style={cardStyle}>
                  <DailyMissionCard
                    icon={m.icon}
                    title={m.title}
                    reward={m.reward}
                    done={m.done}
                    busy={m.busy}
                    btnLabel={m.btnLabel}
                    btnColor={m.btnColor}
                    countdown={missionCountdown[m.key]}
                    claimReady={missionClaimReady[m.key]}
                    onAction={m.onAction}
                    onClaim={m.onClaim}
                    isLast={true}
                    isOneTime={(m as any).isOneTime}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── PARTNER TAB ── */}
        {activeTab === 'partner' && (
          <>
            <SectionLabel title={t('partner_tab')} />
            {tasksLoading ? (
              <div style={cardStyle}><LoadingRow /></div>
            ) : partnerTasks.length === 0 ? (
              <div style={cardStyle}><EmptyRow label={t('no_tasks_available')} /></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {partnerTasks.map(task => (
                  <div key={task.id} style={cardStyle}>
                    <TaskRow
                      task={task} reward={getReward(task)} loading={loadingTaskId === task.id}
                      clickedTasks={clickedTasks} claimReadyTasks={claimReadyTasks} countdownTasks={countdownTasks}
                      onGo={handleTaskGo} onClaim={id => clickTaskMutation.mutate(id)} isLast={true}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes bounce { 0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)} }
          @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.5} }
        `}</style>
      </main>

      {/* ── Advertiser task completion sheet (bot / channel) ── */}
      <AdvertiserTaskSheet
        task={activeTaskSheet}
        open={activeTaskSheet !== null}
        reward={activeTaskSheet ? getReward(activeTaskSheet) : 0}
        onClose={() => setActiveTaskSheet(null)}
        claiming={loadingTaskId === activeTaskSheet?.id}
        onClaim={id => {
          setActiveTaskSheet(null);
          clickTaskMutation.mutate(id);
        }}
      />
    </Layout>
  );
}
