import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FaStar, FaSync, FaUsers } from "react-icons/fa";
import Layout from "@/components/Layout";

interface MonthlyEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  weeklyStars: number | null;
  rank: number;
}

interface ReferralEntry {
  userId: string;
  username: string | null;
  firstName: string | null;
  referralCount: number;
  rank: number;
}

const PRIZE_PCTS: [number, number][] = [
  [1, 25], [2, 18], [3, 14], [4, 11], [5, 7],
  [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
];

function getPrize(rank: number, pool: number): string {
  const entry = PRIZE_PCTS.find(([r]) => r === rank);
  if (!entry || pool <= 0) return "";
  const amt = (pool * entry[1]) / 100;
  return `$${amt % 1 === 0 ? amt.toFixed(0) : amt.toFixed(2)}`;
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

function getInitials(entry: { firstName?: string | null; username?: string | null }) {
  const name = entry.firstName || entry.username || "?";
  return name.slice(0, 1).toUpperCase();
}

const RANK_COLORS = ["#3b82f6", "#60a5fa", "#93c5fd"];

function InitialsBadge({ entry, rank, size = 36 }: { entry: { firstName?: string | null; username?: string | null }; rank: number; size?: number }) {
  const color = rank <= 3 ? RANK_COLORS[rank - 1] : "#374151";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: color + "22",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ fontSize: size * 0.4, fontWeight: 800, color: color }}>{getInitials(entry)}</span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span style={{ fontSize: 16 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: 16 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: 16 }}>🥉</span>;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.35)", width: 22, textAlign: "center", display: "block" }}>
      #{rank}
    </span>
  );
}

function EntryRow({
  rank, entry, isMe, rightContent,
}: {
  rank: number;
  entry: { firstName?: string | null; username?: string | null; userId: string };
  isMe: boolean;
  rightContent: React.ReactNode;
}) {
  const name = entry.firstName || entry.username || `User ${rank}`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px",
      background: isMe ? "rgba(59,130,246,0.08)" : "transparent",
      borderRadius: 12,
      borderLeft: isMe ? "2px solid #3b82f6" : "2px solid transparent",
    }}>
      <div style={{ width: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <RankBadge rank={rank} />
      </div>
      <InitialsBadge entry={entry} rank={rank} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          color: isMe ? "#3b82f6" : "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name.length > 16 ? name.slice(0, 15) + "…" : name}
          {isMe && (
            <span style={{
              fontSize: 9, background: "rgba(59,130,246,0.15)", color: "#3b82f6",
              borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 700,
            }}>You</span>
          )}
        </p>
      </div>
      {rightContent}
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<"monthly" | "referral">("monthly");

  const { data: appSettings } = useQuery<any>({
    queryKey: ["/api/app-settings"],
    refetchInterval: 60000,
  });

  const { data: monthlyData, isLoading: loadingMonthly, refetch: refetchMonthly } = useQuery<{
    leaderboard: MonthlyEntry[];
    userRank: { rank: number; weeklyStars: number } | null;
    userStars: number;
  }>({
    queryKey: ["/api/leaderboard/weekly", "current"],
    queryFn: () => fetch("/api/leaderboard/weekly?week=current", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: referralData, isLoading: loadingReferral, refetch: refetchReferral } = useQuery<{
    leaderboard: ReferralEntry[];
    userRank: { rank: number; referralCount: number } | null;
    topN: number;
    startDate: string;
    endDate: string;
  }>({
    queryKey: ["/api/leaderboard/referral"],
    queryFn: () => fetch("/api/leaderboard/referral", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60000,
  });

  const prizePool: number = appSettings?.weeklyGiveawayAmount ?? 10;
  const monthlyTopN: number = appSettings?.monthlyContestTopUsers ?? 20;
  const weeklyReferralTopN: number = appSettings?.weeklyReferralTopUsers ?? 10;

  const monthlyEndDate = useMemo(() => {
    const d = appSettings?.monthlyContestEndDate;
    if (d) { const dd = new Date(d); if (!isNaN(dd.getTime())) return dd; }
    return null;
  }, [appSettings?.monthlyContestEndDate]);

  const referralEndDate = useMemo(() => {
    const d = appSettings?.weeklyReferralEndDate || referralData?.endDate;
    if (d) { const dd = new Date(d); if (!isNaN(dd.getTime())) return dd; }
    return null;
  }, [appSettings?.weeklyReferralEndDate, referralData?.endDate]);

  const { d: md, h: mh, m: mm, s: ms } = useCountdown(monthlyEndDate);
  const { d: rd, h: rh, m: rm, s: rs } = useCountdown(referralEndDate);

  const monthlyEntries = (monthlyData?.leaderboard || []).slice(0, monthlyTopN);
  const referralEntries = referralData?.leaderboard || [];

  const isLoading = activeTab === "monthly" ? loadingMonthly : loadingReferral;
  const entries = activeTab === "monthly" ? monthlyEntries : referralEntries;
  const isEmpty = !isLoading && entries.length === 0;
  const refetch = activeTab === "monthly" ? refetchMonthly : refetchReferral;

  const myMonthlyRank = monthlyData?.userRank;
  const myReferralRank = referralData?.userRank;

  return (
    <Layout>
      <div style={{ background: "#0a0a0a", minHeight: "100%" }}>

        {/* Tabs */}
        <div style={{
          display: "flex", padding: "10px 16px 0",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          {([
            { id: "monthly", label: "Monthly Contest" },
            { id: "referral", label: "Weekly Referral" },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 700,
                background: "transparent", border: "none", cursor: "pointer",
                color: activeTab === tab.id ? "#3b82f6" : "rgba(255,255,255,0.35)",
                borderBottom: activeTab === tab.id ? "2px solid #3b82f6" : "2px solid transparent",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Monthly Contest */}
        {activeTab === "monthly" && (
          <>
            {/* Info Banner */}
            <div style={{ margin: "12px 16px 0", background: "#111827", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(59,130,246,0.7)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Monthly Prize Pool
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 26, fontWeight: 900, color: "#3b82f6", lineHeight: 1 }}>${prizePool}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>Top {monthlyTopN} winners</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(59,130,246,0.5)", fontWeight: 700 }}>Earn stars by watching ads</p>
                </div>
              </div>
              {monthlyEndDate && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Ends in:</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#3b82f6" }}>{md}d {mh}h {mm}m {ms}s</span>
                </div>
              )}
            </div>

            {/* My rank card */}
            {myMonthlyRank && (
              <div style={{ margin: "8px 16px 0", background: "rgba(59,130,246,0.06)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Your rank</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#3b82f6" }}>#{myMonthlyRank.rank}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <FaStar style={{ color: "#3b82f6", fontSize: 11 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{(myMonthlyRank.weeklyStars || 0).toLocaleString()} stars</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Weekly Referral Contest */}
        {activeTab === "referral" && (
          <>
            <div style={{ margin: "12px 16px 0", background: "#111827", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(59,130,246,0.7)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Weekly Referral Contest
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <FaUsers style={{ color: "#3b82f6", fontSize: 14 }} />
                    <span style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>Invite &amp; Earn</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>Top {weeklyReferralTopN} inviters</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(59,130,246,0.5)", fontWeight: 700 }}>Verified invites only</p>
                </div>
              </div>
              {referralEndDate && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Ends in:</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#3b82f6" }}>{rd}d {rh}h {rm}m {rs}s</span>
                </div>
              )}
            </div>

            {/* My rank card */}
            {myReferralRank && (
              <div style={{ margin: "8px 16px 0", background: "rgba(59,130,246,0.06)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Your rank</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#3b82f6" }}>#{myReferralRank.rank}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <FaUsers style={{ color: "#3b82f6", fontSize: 11 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{myReferralRank.referralCount} verified</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 150, 300].map(delay => (
                <div key={delay} style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: `pulse 1s ${delay}ms infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {isEmpty && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            {activeTab === "referral"
              ? <FaUsers style={{ color: "rgba(59,130,246,0.18)", fontSize: 60, marginBottom: 16 }} />
              : <FaStar style={{ color: "rgba(59,130,246,0.18)", fontSize: 60, marginBottom: 16 }} />
            }
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>No participants yet</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>
              {activeTab === "referral" ? "Invite friends to climb the leaderboard!" : "Watch ads to earn stars and climb the leaderboard!"}
            </p>
          </div>
        )}

        {/* List */}
        {!isLoading && entries.length > 0 && (
          <div style={{ margin: "12px 16px 0 16px", background: "#111", borderRadius: 16, overflow: "hidden", paddingBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 14px 8px" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#fff" }}>
                {activeTab === "monthly" ? `Top ${monthlyTopN} Players` : `Top ${weeklyReferralTopN} Inviters`}
              </p>
              <button onClick={() => refetch()} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
                <FaSync style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }} />
              </button>
            </div>

            {activeTab === "monthly" && (entries as MonthlyEntry[]).map((entry, i) => {
              const isMe = entry.userId === user?.id;
              const prize = getPrize(i + 1, prizePool);
              return (
                <EntryRow
                  key={entry.userId}
                  rank={i + 1}
                  entry={entry}
                  isMe={isMe}
                  rightContent={
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {prize && <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#3b82f6" }}>{prize}</p>}
                      <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end", marginTop: prize ? 1 : 0 }}>
                        <FaStar style={{ color: "#3b82f6", fontSize: 9 }} />
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                          {(entry.weeklyStars ?? 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  }
                />
              );
            })}

            {activeTab === "referral" && (entries as ReferralEntry[]).map((entry, i) => {
              const isMe = entry.userId === user?.id;
              return (
                <EntryRow
                  key={entry.userId}
                  rank={i + 1}
                  entry={entry}
                  isMe={isMe}
                  rightContent={
                    <div style={{ textAlign: "right", flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                      <FaUsers style={{ color: "#3b82f6", fontSize: 10, opacity: 0.7 }} />
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{entry.referralCount}</span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>verified</span>
                    </div>
                  }
                />
              );
            })}
          </div>
        )}

        <div style={{ height: 20 }} />
      </div>
    </Layout>
  );
}
