import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FaStar, FaCrown, FaMedal, FaSync, FaUser } from "react-icons/fa";
import { Button } from "@/components/ui/button";

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
}

const PRIZE_PCTS: Record<number, number> = { 1: 40, 2: 25, 3: 15, 4: 8, 5: 5, 6: 3, 7: 1, 8: 1, 9: 1, 10: 1 };
function getPrize(rank: number, pool: number): string {
  const pct = PRIZE_PCTS[rank];
  if (!pct || pool <= 0) return '$0';
  const amt = (pool * pct) / 100;
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
          <img
            src={profileImageUrl}
            alt={name || 'User'}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
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
          border: '2px solid #000',
          boxShadow: `0 2px 6px ${m.shadow}`,
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
  const m = MEDAL[index];
  const initials = (entry.firstName || entry.username || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      background: '#2C2C2E',
      border: `1.5px solid ${index < 3 ? MEDAL[index].bg : 'rgba(255,255,255,0.08)'}`,
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {entry.profileImageUrl ? (
        <img
          src={entry.profileImageUrl}
          alt={entry.firstName || entry.username || 'User'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span style={{ fontSize: 14, fontWeight: 800, color: 'rgba(255,255,255,0.6)' }}>{initials}</span>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth() as any;

  const { data, isLoading, refetch } = useQuery<LeaderboardData>({
    queryKey: ['/api/leaderboard/weekly'],
    refetchInterval: 60000,
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

  const lb = data?.leaderboard || [];
  const userRank = data?.userRank || null;
  const userStars = data?.userStars || 0;
  const userStarBalance = data?.userStarBalance || 0;

  const p1 = lb[0], p2 = lb[1], p3 = lb[2];

  return (
    <div style={{ background: '#0A0A0A', minHeight: '100vh', paddingBottom: 160, overflowX: 'hidden' }}>

      {/* ── Countdown Timer Strip ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 16px 8px', gap: 6,
        position: 'sticky', top: 0, background: 'rgba(10,10,10,0.96)',
        backdropFilter: 'blur(12px)', zIndex: 20,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <FaStar style={{ color: '#FFD700', fontSize: 11 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>Ends in</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#FFD700' }}>{d}d {h}h {m}m {s}s</span>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0,150,300].map(d => (
              <div key={d} style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFD700', animation: `pulse 1s ${d}ms infinite` }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && lb.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <FaStar style={{ color: 'rgba(255,215,0,0.18)', fontSize: 60, marginBottom: 16 }} />
          <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.45)', margin: '0 0 8px' }}>No participants yet</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', margin: '0 0 20px' }}>Watch ads to earn Stars and claim the top spot!</p>
          <button onClick={() => navigate('/watch')} style={{ background: '#FFD700', border: 'none', borderRadius: 12, padding: '11px 30px', fontSize: 14, fontWeight: 800, color: '#000', cursor: 'pointer' }}>
            Earn Stars Now
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════
          PODIUM
      ══════════════════════════════════════ */}
      {!isLoading && lb.length > 0 && (
        <div style={{ padding: '20px 16px 0' }}>

          {/* Avatars row: 2nd | 1st | 3rd */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 0, marginBottom: 0 }}>

            {/* ── 2nd Place ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 0 }}>
              {p2 ? (
                <>
                  <Avatar size={58} rank={2} profileImageUrl={p2.profileImageUrl} name={p2.firstName || p2.username || 'Player 2'} />
                  <p style={{ margin: '7px 0 2px', fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' }}>
                    {shortName(p2, 'Player 2')}
                  </p>
                  <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 900, color: '#4ADE80' }}>{getPrize(2, prizePool)}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                    <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{(p2.weeklyStars ?? 0).toLocaleString()} stars</span>
                  </div>
                </>
              ) : <div style={{ height: 120 }} />}
            </div>

            {/* ── 1st Place ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 0 }}>
              {p1 ? (
                <>
                  <Avatar size={74} rank={1} profileImageUrl={p1.profileImageUrl} name={p1.firstName || p1.username || 'Player 1'} />
                  <p style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 800, color: '#fff', textAlign: 'center' }}>
                    {shortName(p1, 'Player 1')}
                  </p>
                  <p style={{ margin: '0 0 2px', fontSize: 19, fontWeight: 900, color: '#4ADE80' }}>{getPrize(1, prizePool)}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                    <FaStar style={{ color: '#FFD700', fontSize: 11 }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{(p1.weeklyStars ?? 0).toLocaleString()} stars</span>
                  </div>
                </>
              ) : <div style={{ height: 140 }} />}
            </div>

            {/* ── 3rd Place ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 0 }}>
              {p3 ? (
                <>
                  <Avatar size={52} rank={3} profileImageUrl={p3.profileImageUrl} name={p3.firstName || p3.username || 'Player 3'} />
                  <p style={{ margin: '7px 0 2px', fontSize: 11, fontWeight: 700, color: '#fff', textAlign: 'center' }}>
                    {shortName(p3, 'Player 3')}
                  </p>
                  <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 900, color: '#4ADE80' }}>{getPrize(3, prizePool)}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 8 }}>
                    <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{(p3.weeklyStars ?? 0).toLocaleString()} stars</span>
                  </div>
                </>
              ) : <div style={{ height: 110 }} />}
            </div>
          </div>

          {/* ── Podium Platforms ── */}
          <div style={{ display: 'flex', alignItems: 'flex-end', height: 110, gap: 2 }}>
            <div style={{
              flex: 1, height: 86,
              background: 'linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%)',
              borderRadius: '10px 10px 0 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.07)',
            }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: 'rgba(255,255,255,0.12)', userSelect: 'none' }}>2</span>
            </div>
            <div style={{
              flex: 1, height: 110,
              background: 'linear-gradient(180deg, #333 0%, #1e1e1e 100%)',
              borderRadius: '10px 10px 0 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.1)',
            }}>
              <span style={{ fontSize: 42, fontWeight: 900, color: 'rgba(255,255,255,0.15)', userSelect: 'none' }}>1</span>
            </div>
            <div style={{
              flex: 1, height: 68,
              background: 'linear-gradient(180deg, #252525 0%, #161616 100%)',
              borderRadius: '10px 10px 0 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontSize: 32, fontWeight: 900, color: 'rgba(255,255,255,0.1)', userSelect: 'none' }}>3</span>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          RANKED LIST
      ══════════════════════════════════════ */}
      {!isLoading && lb.length > 0 && (
        <div style={{ background: '#141414', borderRadius: '20px 20px 0 0', marginTop: 0, padding: '20px 16px 16px' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>
              TOP {lb.length} PLAYERS
            </p>
            <button
              onClick={() => refetch()}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
            >
              <FaSync style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }} />
            </button>
          </div>

          {lb.map((entry, i) => {
            const isMe = entry.userId === user?.id;
            const rankMedal = MEDAL[i];
            return (
              <div key={entry.userId} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px',
                background: isMe ? 'rgba(255,215,0,0.06)' : i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'transparent',
                borderRadius: 12,
                marginBottom: 4,
                border: isMe ? '1px solid rgba(255,215,0,0.2)' : '1px solid transparent',
              }}>
                {i < 3 ? (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: rankMedal.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: `0 2px 8px ${rankMedal.shadow}`,
                  }}>
                    {i === 0
                      ? <FaCrown style={{ fontSize: 12, color: '#000' }} />
                      : <FaMedal style={{ fontSize: 12, color: '#000' }} />}
                  </div>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.3)', width: 28, textAlign: 'center', flexShrink: 0 }}>
                    {i < 49 ? `#${i + 1}` : '50+'}
                  </span>
                )}

                <SmallAvatar entry={entry} index={i} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: isMe ? '#FFD700' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.firstName || entry.username || `Player ${i + 1}`}
                    {isMe && <span style={{ fontSize: 9, background: 'rgba(255,215,0,0.15)', color: '#FFD700', borderRadius: 4, padding: '1px 5px', marginLeft: 5, fontWeight: 700 }}>YOU</span>}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                    <FaStar style={{ color: '#FFD700', fontSize: 9 }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{(entry.weeklyStars ?? 0).toLocaleString()} stars</span>
                  </div>
                </div>

                <span style={{ fontSize: 15, fontWeight: 800, color: '#4ADE80', flexShrink: 0 }}>
                  {getPrize(i + 1, prizePool)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sticky Bottom Bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(20,20,20,0.97)', backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '12px 16px 16px', zIndex: 30,
      }}>
        {userRank ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ background: '#2C2C2E', borderRadius: 10, padding: '7px 13px', textAlign: 'center', flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>RANK</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#FFD700', lineHeight: 1.1 }}>#{userRank.rank}</p>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff' }}>Your Position</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <FaStar style={{ color: '#FFD700', fontSize: 10 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,215,0,0.8)', fontWeight: 600 }}>{userStars.toLocaleString()} stars this week</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff' }}>Not on leaderboard yet</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <FaStar style={{ color: 'rgba(255,215,0,0.5)', fontSize: 10 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Watch ads to earn Stars</span>
              </div>
            </div>
          </div>
        )}

        {/* Back button — styled like settings popup */}
        <Button
          onClick={() => navigate('/')}
          className="w-full h-12 font-bold rounded-xl"
          style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff' }}
        >
          Back
        </Button>
      </div>

      <style>{`@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:.6}}`}</style>
    </div>
  );
}
