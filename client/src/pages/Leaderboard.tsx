import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FaStar, FaCrown, FaMedal, FaSync } from "react-icons/fa";
import Layout from "@/components/Layout";
import { useLanguage } from "@/hooks/useLanguage";

interface LeaderboardEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  weeklyStars: number | null;
  rank: number;
  profileImageUrl?: string | null;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  userRank: { rank: number; weeklyStars: number } | null;
  userStars: number;
  userStarBalance: number;
  currentWeek: string;
  lastWeek: string;
  isLastWeek: boolean;
}

const PRIZE_PCTS: [number, number][] = [
  [1, 25], [2, 18], [3, 14], [4, 11], [5, 7],
  [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
];

function getPrize(rank: number, pool: number): string {
  const entry = PRIZE_PCTS.find(([r]) => r === rank);
  if (!entry || pool <= 0) return '';
  const amt = (pool * entry[1]) / 100;
  return `$${amt % 1 === 0 ? amt.toFixed(0) : amt.toFixed(2)}`;
}

function getWeekEnd(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + (day === 0 ? 0 : 7 - day));
  end.setUTCHours(23, 59, 59, 0);
  return end;
}

function useCountdown(target: Date) {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const calc = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) return setT({ d: 0, h: 0, m: 0, s: 0 });
      setT({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [target]);
  return t;
}

function shortName(e: LeaderboardEntry, fb: string) {
  const n = e.firstName || e.username || fb;
  return n.length > 10 ? n.slice(0, 9) + '…' : n;
}

const MEDAL = [
  { bg: '#FFD700', shadow: '#b8960088' },
  { bg: '#C0C0C0', shadow: '#99999988' },
  { bg: '#CD7F32', shadow: '#9a5e2688' },
];

function Avatar({ size = 64, rank, profileImageUrl, name }: { size?: number; rank: number; profileImageUrl?: string | null; name?: string }) {
  const m = MEDAL[rank - 1];
  const initials = name ? name.slice(0, 1).toUpperCase() : '?';
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'linear-gradient(145deg, #2C2C2E, #1C1C1E)',
        border: `2.5px solid ${m?.bg || '#555'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 12px ${m?.shadow || '#00000044'}`,
        overflow: 'hidden',
      }}>
        {profileImageUrl ? (
          <img src={profileImageUrl} alt={name || 'User'} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <span style={{ fontSize: size * 0.38, fontWeight: 800, color: 'rgba(255,255,255,0.6)' }}>{initials}</span>
        )}
      </div>
      {rank <= 3 && (
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: size * 0.35, height: size * 0.35,
          borderRadius: '50%', background: m.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid #000', boxShadow: `0 2px 6px ${m.shadow}`,
        }}>
          {rank === 1
            ? <FaCrown style={{ fontSize: size * 0.17, color: '#000' }} />
            : <FaMedal style={{ fontSize: size * 0.17, color: '#000' }} />}
        </div>
      )}
    </div>
  );
}

function SmallAvatar({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  const initials = (entry.firstName || entry.username || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      background: '#2C2C2E',
      border: `1.5px solid ${index < 3 ? MEDAL[index].bg : 'rgba(255,255,255,0.08)'}`,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {entry.profileImageUrl ? (
        <img src={entry.profileImageUrl} alt={entry.firstName || entry.username || 'User'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        <span style={{ fontSize: 14, fontWeight: 800, color: 'rgba(255,255,255,0.6)' }}>{initials}</span>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<'current' | 'last'>('current');
  const { t } = useLanguage();

  const { data: currentData, isLoading: loadingCurrent, refetch: refetchCurrent } = useQuery<LeaderboardData>({
    queryKey: ['/api/leaderboard/weekly', 'current'],
    queryFn: () => fetch('/api/leaderboard/weekly?week=current', { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: lastData, isLoading: loadingLast, refetch: refetchLast } = useQuery<LeaderboardData>({
    queryKey: ['/api/leaderboard/weekly', 'last'],
    queryFn: () => fetch('/api/leaderboard/weekly?week=last', { credentials: 'include' }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const { data: appSettings } = useQuery<any>({
    queryKey: ['/api/app-settings'],
  });
  const prizePool: number = appSettings?.weeklyGiveawayAmount ?? 10;

  const weekEnd = useMemo(() => {
    if (appSettings?.weeklyContestEndDate) {
      const d = new Date(appSettings.weeklyContestEndDate);
      if (!isNaN(d.getTime())) return d;
    }
    return getWeekEnd();
  }, [appSettings?.weeklyContestEndDate]);

  const { d, h, m, s } = useCountdown(weekEnd);

  const data = activeTab === 'current' ? currentData : lastData;
  const isLoading = activeTab === 'current' ? loadingCurrent : loadingLast;
  const refetch = activeTab === 'current' ? refetchCurrent : refetchLast;

  const allEntries = data?.leaderboard || [];
  const top10 = allEntries.slice(0, 10);
  const userRank = data?.userRank || null;
  const userStars = data?.userStars || 0;

  const p1 = top10[0], p2 = top10[1], p3 = top10[2];

  return (
    <Layout>
      <div style={{ background: '#0A0A0A', minHeight: '100%' }}>

        {/* ── Week Tabs ── */}
        <div style={{ display: 'flex', gap: 0, padding: '10px 16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {(['current', 'last'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 700,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: activeTab === tab ? '#FFD700' : 'rgba(255,255,255,0.35)',
                borderBottom: activeTab === tab ? '2px solid #FFD700' : '2px solid transparent',
                transition: 'all 0.2s',
              }}
            >
              {tab === 'current' ? t('this_week') : t('last_week')}
            </button>
          ))}
        </div>

        {/* ── Countdown Timer (current week only) ── */}
        {activeTab === 'current' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '8px 16px 6px', gap: 6,
          }}>
            <FaStar style={{ color: '#FFD700', fontSize: 11 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>{t('contest_ends_in')}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#FFD700' }}>{d}d {h}h {m}m {s}s</span>
          </div>
        )}

        {/* ── Last week ended badge ── */}
        {activeTab === 'last' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '8px 16px 6px', gap: 6,
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>
              {t('last_week_final')} — {lastData?.lastWeek || ''}
            </span>
          </div>
        )}

        {/* ── Prize Pool Banner ── */}
        <div style={{
          margin: '10px 16px 0',
          background: 'linear-gradient(135deg, #1a1200 0%, #2a1f00 50%, #1a1200 100%)',
          border: '1px solid rgba(255,215,0,0.25)',
          borderRadius: 16, padding: '12px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,215,0,0.6)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {activeTab === 'current' ? t('weekly_prize_pool') : t('last_week_prize')}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 26, fontWeight: 900, color: '#FFD700', lineHeight: 1 }}>${prizePool}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>{t('top_10_winners')}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(255,215,0,0.5)', fontWeight: 700 }}>{t('earn_stars_by')}</p>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[0, 150, 300].map(delay => (
                <div key={delay} style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFD700', animation: `pulse 1s ${delay}ms infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* ── Empty ── */}
        {!isLoading && top10.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <FaStar style={{ color: 'rgba(255,215,0,0.18)', fontSize: 60, marginBottom: 16 }} />
            <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.45)', margin: '0 0 8px' }}>
              {activeTab === 'last' ? t('no_data_last_week') : t('no_participants_yet')}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: '0 0 20px' }}>
              {activeTab === 'last' ? t('last_week_no_data') : t('watch_to_top_spot')}
            </p>
          </div>
        )}

        {/* PODIUM */}
        {!isLoading && top10.length > 0 && (
          <div style={{ padding: '16px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 0, marginBottom: 0 }}>
              {/* 2nd Place */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {p2 ? (
                  <>
                    <Avatar size={58} rank={2} profileImageUrl={p2.profileImageUrl} name={p2.firstName || p2.username || 'Player 2'} />
                    <p style={{ margin: '7px 0 2px', fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' }}>{shortName(p2, 'Player 2')}</p>
                    <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 900, color: activeTab === 'last' ? 'rgba(74,222,128,0.5)' : '#4ADE80' }}>
                      {activeTab === 'current' ? getPrize(2, prizePool) : '🏅'}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                      <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{(p2.weeklyStars ?? 0).toLocaleString()} ⭐</span>
                    </div>
                  </>
                ) : <div style={{ height: 120 }} />}
              </div>

              {/* 1st Place */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {p1 ? (
                  <>
                    <Avatar size={74} rank={1} profileImageUrl={p1.profileImageUrl} name={p1.firstName || p1.username || 'Player 1'} />
                    <p style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 800, color: '#fff', textAlign: 'center' }}>{shortName(p1, 'Player 1')}</p>
                    <p style={{ margin: '0 0 2px', fontSize: 19, fontWeight: 900, color: activeTab === 'last' ? 'rgba(74,222,128,0.6)' : '#4ADE80' }}>
                      {activeTab === 'current' ? getPrize(1, prizePool) : '🏆'}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                      <FaStar style={{ color: '#FFD700', fontSize: 11 }} />
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{(p1.weeklyStars ?? 0).toLocaleString()} ⭐</span>
                    </div>
                  </>
                ) : <div style={{ height: 140 }} />}
              </div>

              {/* 3rd Place */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {p3 ? (
                  <>
                    <Avatar size={52} rank={3} profileImageUrl={p3.profileImageUrl} name={p3.firstName || p3.username || 'Player 3'} />
                    <p style={{ margin: '7px 0 2px', fontSize: 11, fontWeight: 700, color: '#fff', textAlign: 'center' }}>{shortName(p3, 'Player 3')}</p>
                    <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 900, color: activeTab === 'last' ? 'rgba(74,222,128,0.5)' : '#4ADE80' }}>
                      {activeTab === 'current' ? getPrize(3, prizePool) : '🥉'}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                      <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{(p3.weeklyStars ?? 0).toLocaleString()} ⭐</span>
                    </div>
                  </>
                ) : <div style={{ height: 110 }} />}
              </div>
            </div>

            {/* Podium Platforms */}
            <div style={{ display: 'flex', alignItems: 'flex-end', height: 110, gap: 2 }}>
              <div style={{ flex: 1, height: 86, background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.07)' }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: 'rgba(255,255,255,0.12)', userSelect: 'none' }}>2</span>
              </div>
              <div style={{ flex: 1, height: 110, background: 'linear-gradient(180deg, #333 0%, #1e1e1e 100%)', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.1)' }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: 'rgba(255,255,255,0.15)', userSelect: 'none' }}>1</span>
              </div>
              <div style={{ flex: 1, height: 68, background: 'linear-gradient(180deg, #252525 0%, #161616 100%)', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 32, fontWeight: 900, color: 'rgba(255,255,255,0.1)', userSelect: 'none' }}>3</span>
              </div>
            </div>
          </div>
        )}

        {/* TOP 10 RANKED LIST */}
        {!isLoading && top10.length > 0 && (
          <div style={{ background: '#141414', borderRadius: '20px 20px 0 0', marginTop: 0, padding: '20px 16px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>
                {t('top_10_players')}
              </p>
              <button onClick={() => refetch()} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                <FaSync style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }} />
              </button>
            </div>

            {top10.slice(3).map((entry, sliceIdx) => {
              const i = sliceIdx + 3;
              const isMe = entry.userId === user?.id;
              const prize = activeTab === 'current' ? getPrize(i + 1, prizePool) : '';
              return (
                <div key={entry.userId} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px',
                  background: isMe ? 'rgba(255,215,0,0.06)' : sliceIdx % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'transparent',
                  borderRadius: 12, marginBottom: 4,
                  border: isMe ? '1px solid rgba(255,215,0,0.2)' : '1px solid transparent',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.3)', width: 28, textAlign: 'center', flexShrink: 0 }}>
                    #{i + 1}
                  </span>
                  <SmallAvatar entry={entry} index={i} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: isMe ? '#FFD700' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.firstName || entry.username || `Player ${i + 1}`}
                      {isMe && <span style={{ fontSize: 9, background: 'rgba(255,215,0,0.15)', color: '#FFD700', borderRadius: 4, padding: '1px 5px', marginLeft: 5, fontWeight: 700 }}>{t('you_label')}</span>}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                      <FaStar style={{ color: '#FFD700', fontSize: 9 }} />
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{(entry.weeklyStars ?? 0).toLocaleString()} ⭐</span>
                    </div>
                  </div>
                  {prize && (
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#4ADE80', flexShrink: 0 }}>
                      {prize}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* User's own rank (outside top 10) */}
        {!isLoading && activeTab === 'current' && userRank && userRank.rank > 10 && (
          <div style={{ margin: '8px 16px 0', background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: '#2C2C2E', borderRadius: 8, padding: '6px 10px', textAlign: 'center', flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase' }}>{t('your_rank')}</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#FFD700', lineHeight: 1.1 }}>#{userRank.rank}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff' }}>{t('keep_watching_climb')}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,215,0,0.8)', fontWeight: 600 }}>{userStars.toLocaleString()} ⭐ {t('this_week_label')}</span>
              </div>
            </div>
          </div>
        )}

        {/* User in top 3 */}
        {!isLoading && activeTab === 'current' && userRank && userRank.rank <= 3 && (
          <div style={{ margin: '8px 16px 0', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: '#2C2C2E', borderRadius: 8, padding: '6px 10px', textAlign: 'center', flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase' }}>{t('your_rank')}</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#4ADE80', lineHeight: 1.1 }}>#{userRank.rank}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#4ADE80' }}>{t('you_are_winning')} {getPrize(userRank.rank, prizePool)}! 🎉</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,215,0,0.8)', fontWeight: 600 }}>{userStars.toLocaleString()} ⭐ {t('this_week_label')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Not ranked this week */}
        {!isLoading && activeTab === 'current' && !userRank && (
          <div style={{ margin: '8px 16px 0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 14px' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff' }}>{t('not_ranked_yet')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
              <FaStar style={{ color: 'rgba(255,215,0,0.5)', fontSize: 10 }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{t('watch_to_enter')}</span>
            </div>
          </div>
        )}

        <style>{`@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:.6}}`}</style>
      </div>
    </Layout>
  );
}
