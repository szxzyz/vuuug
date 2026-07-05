import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FaStar, FaSync, FaUsers } from "react-icons/fa";
import Layout from "@/components/Layout";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  weeklyStars: number;
  rank: number;
}

interface ReferralEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  referralCount: number;
  rank: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉"];

function posLabel(rank: number) {
  return rank <= 3 ? MEDALS[rank - 1] : `#${rank}`;
}

function displayName(
  entry: { firstName?: string | null; username?: string | null } | null,
  rank: number
): string {
  if (!entry) return "—";
  return entry.firstName || entry.username || `User ${rank}`;
}


function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dd = new Date(d);
  if (isNaN(dd.getTime())) return null;
  return dd.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function useCountdown(target: Date | null) {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    if (!target) return;
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

// ─── Top-3 gradient card ──────────────────────────────────────────────────────

const TOP3_GRADIENTS: Record<number, string> = {
  1: "linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)",
  2: "linear-gradient(135deg, #0e7490 0%, #0c6080 100%)",
  3: "linear-gradient(135deg, #1e3a4a 0%, #162d3a 100%)",
};

function TopCard({
  rank,
  entry,
  score,
  scoreIcon,
  prize,
  isMe,
}: {
  rank: number;
  entry: { firstName?: string | null; username?: string | null; userId?: string } | null;
  score: number;
  scoreIcon: React.ReactNode;
  prize: string | null;
  isMe: boolean;
}) {
  const name = displayName(entry, rank);
  const isEmpty = !entry;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 16,
        background: TOP3_GRADIENTS[rank],
        marginBottom: 8,
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        border: isMe ? "1.5px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.06)",
        opacity: isEmpty ? 0.55 : 1,
      }}
    >
      {/* Medal */}
      <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{MEDALS[rank - 1]}</span>

      {/* Name + prize */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 800,
            color: isEmpty ? "rgba(255,255,255,0.45)" : "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name.length > 16 ? name.slice(0, 15) + "…" : name}
          {isMe && (
            <span
              style={{
                fontSize: 9,
                background: "rgba(255,255,255,0.25)",
                color: "#fff",
                borderRadius: 4,
                padding: "1px 5px",
                marginLeft: 6,
                fontWeight: 700,
              }}
            >
              You
            </span>
          )}
        </p>
        {prize && (
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            🎁 {prize}
          </p>
        )}
      </div>

      {/* Score */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {isEmpty ? (
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>—</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
            {scoreIcon}
            <span style={{ fontSize: 15, fontWeight: 900, color: "#fff" }}>
              {score.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Regular ranked row (4th place onwards) ───────────────────────────────────

function RankRow({
  rank,
  entry,
  score,
  scoreIcon,
  prize,
  isMe,
}: {
  rank: number;
  entry: { firstName?: string | null; username?: string | null; userId?: string } | null;
  score: number;
  scoreIcon: React.ReactNode;
  prize: string | null;
  isMe: boolean;
}) {
  const name = displayName(entry, rank);
  const isEmpty = !entry;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        background: isMe ? "rgba(34,211,238,0.07)" : "transparent",
        borderRadius: 10,
        borderLeft: isMe ? "2px solid #22d3ee" : "2px solid transparent",
        opacity: isEmpty ? 0.45 : 1,
      }}
    >
      {/* Position */}
      <span
        style={{
          width: 28,
          fontSize: 12,
          fontWeight: 700,
          color: isEmpty ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)",
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        #{rank}
      </span>

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            color: isMe ? "#22d3ee" : isEmpty ? "rgba(255,255,255,0.2)" : "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name.length > 18 ? name.slice(0, 17) + "…" : name}
          {isMe && (
            <span
              style={{
                fontSize: 9,
                background: "rgba(34,211,238,0.15)",
                color: "#22d3ee",
                borderRadius: 4,
                padding: "1px 5px",
                marginLeft: 6,
                fontWeight: 700,
              }}
            >
              You
            </span>
          )}
        </p>
        {prize && !isEmpty && (
          <p style={{ margin: "1px 0 0", fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>
            🎁 {prize}
          </p>
        )}
      </div>

      {/* Score */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {isEmpty ? (
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", fontWeight: 600 }}>—</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {scoreIcon}
            <span style={{ fontSize: 13, fontWeight: 800, color: isMe ? "#22d3ee" : "rgba(255,255,255,0.85)" }}>
              {score.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Leaderboard() {
  const { user } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<"monthly" | "referral">("monthly");

  const { data: appSettings } = useQuery<any>({
    queryKey: ["/api/app-settings"],
    staleTime: 0,
    refetchInterval: 15000,
  });

  const {
    data: monthlyData,
    isLoading: loadingMonthly,
    refetch: refetchMonthly,
  } = useQuery<{
    leaderboard: MonthlyEntry[];
    userRank: { rank: number; weeklyStars: number } | null;
    userStars: number;
    contestActive: boolean;
    topN: number;
    prizes: string[];
    startDate: string | null;
    endDate: string | null;
  }>({
    queryKey: ["/api/leaderboard/weekly", "current"],
    queryFn: () => fetch("/api/leaderboard/weekly", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    refetchInterval: 30000,
    enabled: activeTab === "monthly",
  });

  const {
    data: referralData,
    isLoading: loadingReferral,
    refetch: refetchReferral,
  } = useQuery<{
    leaderboard: ReferralEntry[];
    userRank: { rank: number; referralCount: number } | null;
    contestActive: boolean;
    topN: number;
    prizes: string[];
    startDate: string | null;
    endDate: string | null;
  }>({
    queryKey: ["/api/leaderboard/referral"],
    queryFn: () => fetch("/api/leaderboard/referral", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    refetchInterval: 30000,
    enabled: activeTab === "referral",
  });

  const isMonthly = activeTab === "monthly";

  // Derive values from whichever tab is active
  const monthlyContestActive = monthlyData?.contestActive !== false;
  const referralContestActive = referralData?.contestActive !== false;
  const contestActive = isMonthly ? monthlyContestActive : referralContestActive;

  const monthlyTopN: number = monthlyData?.topN ?? appSettings?.monthlyContestTopUsers ?? 10;
  const referralTopN: number = referralData?.topN ?? appSettings?.weeklyReferralTopUsers ?? 10;
  const topN = isMonthly ? monthlyTopN : referralTopN;

  const monthlyPrizes: string[] = monthlyData?.prizes ?? [];
  const referralPrizes: string[] = referralData?.prizes ?? [];
  const prizes = isMonthly ? monthlyPrizes : referralPrizes;

  // Build a rank→entry map for O(1) lookup
  const monthlyMap = useMemo(() => {
    const m = new Map<number, MonthlyEntry>();
    (monthlyData?.leaderboard ?? []).forEach(e => m.set(e.rank, e));
    return m;
  }, [monthlyData?.leaderboard]);

  const referralMap = useMemo(() => {
    const m = new Map<number, ReferralEntry>();
    (referralData?.leaderboard ?? []).forEach(e => m.set(e.rank, e));
    return m;
  }, [referralData?.leaderboard]);

  // Dates
  const monthlyStartDate = monthlyData?.startDate || appSettings?.monthlyContestStartDate || null;
  const monthlyEndDateStr = monthlyData?.endDate || appSettings?.monthlyContestEndDate || null;
  const referralStartDate = referralData?.startDate || appSettings?.weeklyReferralStartDate || null;
  const referralEndDateStr = referralData?.endDate || appSettings?.weeklyReferralEndDate || null;

  const startDateLabel = formatDate(isMonthly ? monthlyStartDate : referralStartDate);
  const endDateLabel = formatDate(isMonthly ? monthlyEndDateStr : referralEndDateStr);

  const monthlyEndDate = useMemo(() => {
    if (!monthlyEndDateStr) return null;
    const d = new Date(monthlyEndDateStr);
    return isNaN(d.getTime()) ? null : d;
  }, [monthlyEndDateStr]);

  const referralEndDate = useMemo(() => {
    if (!referralEndDateStr) return null;
    const d = new Date(referralEndDateStr);
    return isNaN(d.getTime()) ? null : d;
  }, [referralEndDateStr]);

  const { d: md, h: mh, m: mm, s: ms } = useCountdown(monthlyEndDate);
  const { d: rd, h: rh, m: rm, s: rs } = useCountdown(referralEndDate);
  const { d, h, m, s } = isMonthly
    ? { d: md, h: mh, m: mm, s: ms }
    : { d: rd, h: rh, m: rm, s: rs };

  const myMonthlyRank = monthlyContestActive ? monthlyData?.userRank : null;
  const myReferralRank = referralContestActive ? referralData?.userRank : null;

  const isLoading = isMonthly ? loadingMonthly : loadingReferral;
  const refetch = isMonthly ? refetchMonthly : refetchReferral;

  const starIcon = <FaStar style={{ color: "#fbbf24", fontSize: 11 }} />;
  const usersIcon = <FaUsers style={{ color: "#34d399", fontSize: 11 }} />;
  const scoreIcon = isMonthly ? starIcon : usersIcon;

  // Slots: always render all topN positions
  const slots = Array.from({ length: topN }, (_, i) => i + 1);
  const top3 = slots.filter(r => r <= 3);
  const rest = slots.filter(r => r > 3);

  // Has any real data
  const hasData = isMonthly
    ? (monthlyData?.leaderboard ?? []).length > 0
    : (referralData?.leaderboard ?? []).length > 0;

  return (
    <Layout>
      <div style={{ background: "#0a0a0a", minHeight: "100%" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px 4px" }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#fff" }}>
            {isMonthly ? "Monthly Contest" : "Referral Contest"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
            Updates every 30 seconds
          </p>
        </div>

        {/* ── Your Rank ── */}
        {isMonthly && myMonthlyRank && (
          <div style={{ margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Your Rank</p>
              <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>
                {posLabel(myMonthlyRank.rank)}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FaStar style={{ color: "#fbbf24", fontSize: 11 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                {(myMonthlyRank.weeklyStars || 0).toLocaleString()} stars
              </span>
            </div>
          </div>
        )}
        {!isMonthly && myReferralRank && (
          <div style={{ margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Your Rank</p>
              <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>
                {posLabel(myReferralRank.rank)}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FaUsers style={{ color: "#34d399", fontSize: 11 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                {myReferralRank.referralCount} verified
              </span>
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ padding: "14px 16px 0" }}>
          <div
            className="flex items-center"
            style={{ background: "#1a1a1a", borderRadius: 14, padding: "4px", gap: 2 }}
          >
            {(["monthly", "referral"] as const).map(tab => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 11,
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                    background: isActive ? "#2e2e2e" : "transparent",
                    border: "none", cursor: "pointer",
                    boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}
                >
                  {tab === "monthly" ? "Monthly" : "Referral"}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Date / countdown banner ── */}
        {(startDateLabel || endDateLabel) && (
          <div style={{ margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Started</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>{startDateLabel || "—"}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Ends</p>
                <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>{endDateLabel || "—"}</p>
              </div>
            </div>
            {(monthlyEndDate || referralEndDate) && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Time left:</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>
                  {d}d {h}h {m}m {s}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 150, 300].map(delay => (
                <div
                  key={delay}
                  style={{ width: 8, height: 8, borderRadius: "50%", background: "#22d3ee", animation: `pulse 1s ${delay}ms infinite` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Contest not active ── */}
        {!isLoading && isMonthly && !monthlyContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Admin will start the next Monthly Contest soon.</p>
          </div>
        )}
        {!isLoading && !isMonthly && !referralContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Admin will start the next Referral Contest soon.</p>
          </div>
        )}

        {/* ── Leaderboard ── */}
        {!isLoading && contestActive && (
          <>
            {/* Top 3 gradient cards */}
            {top3.length > 0 && (
              <div style={{ padding: "16px 16px 0" }}>
                {top3.map(rank => {
                  const entry = isMonthly ? (monthlyMap.get(rank) ?? null) : (referralMap.get(rank) ?? null);
                  const score = isMonthly
                    ? ((entry as MonthlyEntry | null)?.weeklyStars ?? 0)
                    : ((entry as ReferralEntry | null)?.referralCount ?? 0);
                  const prize = prizes[rank - 1] ?? null;
                  const isMe = !!(entry && (entry as any).userId === user?.id);
                  return (
                    <TopCard
                      key={rank}
                      rank={rank}
                      entry={entry}
                      score={score}
                      scoreIcon={scoreIcon}
                      prize={prize}
                      isMe={isMe}
                    />
                  );
                })}
              </div>
            )}

            {/* Ranks 4+ */}
            {rest.length > 0 && (
              <div style={{ margin: "8px 16px 0", background: "#111", borderRadius: 16, overflow: "hidden", paddingBottom: 8 }}>
                {/* Section header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 6px" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#fff" }}>Rankings</p>
                  <button
                    onClick={() => refetch()}
                    style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}
                  >
                    <FaSync style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }} />
                  </button>
                </div>

                {/* Divider header row: Position / Name / Score */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 14px 6px",
                    gap: 10,
                  }}
                >
                  <span style={{ width: 28, fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 700, textAlign: "center", flexShrink: 0 }}>POS</span>
                  <span style={{ width: 32, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 700 }}>NAME</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 700, flexShrink: 0 }}>
                    {isMonthly ? "STARS" : "REFS"}
                  </span>
                </div>

                {/* Rows */}
                {rest.map(rank => {
                  const entry = isMonthly ? (monthlyMap.get(rank) ?? null) : (referralMap.get(rank) ?? null);
                  const score = isMonthly
                    ? ((entry as MonthlyEntry | null)?.weeklyStars ?? 0)
                    : ((entry as ReferralEntry | null)?.referralCount ?? 0);
                  const prize = prizes[rank - 1] ?? null;
                  const isMe = !!(entry && (entry as any).userId === user?.id);
                  return (
                    <RankRow
                      key={rank}
                      rank={rank}
                      entry={entry}
                      score={score}
                      scoreIcon={scoreIcon}
                      prize={prize}
                      isMe={isMe}
                    />
                  );
                })}
              </div>
            )}

            {/* No participants yet — but still show the grid */}
            {!hasData && (
              <div style={{ textAlign: "center", padding: "12px 24px 0" }}>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>
                  {isMonthly ? "Watch ads to earn stars and climb!" : "Invite friends who watch 1+ ad to rank up!"}
                </p>
              </div>
            )}
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </Layout>
  );
}
