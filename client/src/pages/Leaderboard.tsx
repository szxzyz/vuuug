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
  return name.slice(0, 2).toUpperCase();
}

function avatarBg(rank: number): string {
  if (rank === 1) return "#f59e0b";
  if (rank === 2) return "#9ca3af";
  if (rank === 3) return "#b45309";
  return "#1d4ed8";
}

function formatDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const dd = new Date(d);
  if (isNaN(dd.getTime())) return null;
  return dd.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/* ─── Top-3 gradient row (Telegram-style) ───────────────────────────── */
const RANK_GRADIENTS: Record<number, string> = {
  1: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  2: "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)",
  3: "linear-gradient(135deg, #c2855a 0%, #9a6040 100%)",
};

function TopRow({
  rank, entry, valueIcon, value, isMe,
}: {
  rank: number;
  entry: { firstName?: string | null; username?: string | null; userId: string };
  valueIcon: React.ReactNode;
  value: number;
  isMe: boolean;
}) {
  const name = entry.firstName || entry.username || `User ${rank}`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px",
      borderRadius: 16,
      background: RANK_GRADIENTS[rank] || RANK_GRADIENTS[3],
      marginBottom: 8,
      boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
      border: isMe ? "1.5px solid rgba(255,255,255,0.6)" : "none",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: "50%",
        background: "rgba(255,255,255,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, color: "#fff", fontSize: 14, flexShrink: 0,
        border: "1.5px solid rgba(255,255,255,0.35)",
      }}>
        {getInitials(entry)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 14, fontWeight: 800, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {rank}. {name.length > 16 ? name.slice(0, 15) + "…" : name}
          {isMe && (
            <span style={{
              fontSize: 9, background: "rgba(255,255,255,0.25)", color: "#fff",
              borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 700,
            }}>You</span>
          )}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>
          {rank === 1 ? "Top rank" : rank === 2 ? "2nd place" : "3rd place"}
        </p>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
          {valueIcon}
          <span style={{ fontSize: 15, fontWeight: 900, color: "#fff" }}>{value.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Ranked row (4th place onwards) ────────────────────────────────── */
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
      <span style={{ width: 26, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.35)", textAlign: "center", flexShrink: 0 }}>
        #{rank}
      </span>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: avatarBg(rank),
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 900, color: "#fff", flexShrink: 0,
      }}>
        {getInitials(entry)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          color: isMe ? "#3b82f6" : "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name.length > 18 ? name.slice(0, 17) + "…" : name}
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

/* ─── Main page ──────────────────────────────────────────────────────── */
export default function Leaderboard() {
  const { user } = useAuth() as any;
  const [activeTab, setActiveTab] = useState<"monthly" | "referral">("monthly");

  const { data: appSettings } = useQuery<any>({
    queryKey: ["/api/app-settings"],
    staleTime: 0,
    refetchInterval: 15000,
  });

  const { data: monthlyData, isLoading: loadingMonthly, refetch: refetchMonthly } = useQuery<{
    leaderboard: MonthlyEntry[];
    userRank: { rank: number; weeklyStars: number } | null;
    userStars: number;
  }>({
    queryKey: ["/api/leaderboard/weekly", "current"],
    queryFn: () => fetch("/api/leaderboard/weekly", { credentials: "include" }).then(r => r.json()),
    staleTime: 0,
    refetchInterval: 30000,
    enabled: activeTab === "monthly",
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
    staleTime: 0,
    refetchInterval: 30000,
    enabled: activeTab === "referral",
  });

  const monthlyTopN: number = (monthlyData as any)?.topN ?? appSettings?.monthlyContestTopUsers ?? 20;
  const weeklyReferralTopN: number = referralData?.topN ?? appSettings?.weeklyReferralTopUsers ?? 10;

  const monthlyStartDate = (monthlyData as any)?.startDate || appSettings?.monthlyContestStartDate || null;
  const monthlyEndDateStr = (monthlyData as any)?.endDate || appSettings?.monthlyContestEndDate || null;
  const referralStartDate = referralData?.startDate || appSettings?.weeklyReferralStartDate || null;
  const referralEndDateStr = referralData?.endDate || appSettings?.weeklyReferralEndDate || null;

  const monthlyEndDate = useMemo(() => {
    if (monthlyEndDateStr) { const dd = new Date(monthlyEndDateStr); if (!isNaN(dd.getTime())) return dd; }
    return null;
  }, [monthlyEndDateStr]);

  const referralEndDate = useMemo(() => {
    if (referralEndDateStr) { const dd = new Date(referralEndDateStr); if (!isNaN(dd.getTime())) return dd; }
    return null;
  }, [referralEndDateStr]);

  const { d: md, h: mh, m: mm, s: ms } = useCountdown(monthlyEndDate);
  const { d: rd, h: rh, m: rm, s: rs } = useCountdown(referralEndDate);

  const monthlyContestActive = (monthlyData as any)?.contestActive !== false;
  const referralContestActive = (referralData as any)?.contestActive !== false;

  const monthlyEntries = monthlyContestActive ? (monthlyData?.leaderboard || []).slice(0, monthlyTopN) : [];
  const referralEntries = referralContestActive ? (referralData?.leaderboard || []) : [];

  const myMonthlyRank = monthlyContestActive ? monthlyData?.userRank : null;
  const myReferralRank = referralContestActive ? referralData?.userRank : null;

  const isLoading = activeTab === "monthly" ? loadingMonthly : loadingReferral;
  const refetch = activeTab === "monthly" ? refetchMonthly : refetchReferral;

  const starIcon = <FaStar style={{ color: "#fde047", fontSize: 13 }} />;
  const usersIcon = <FaUsers style={{ color: "#fde047", fontSize: 13 }} />;

  const isMonthly = activeTab === "monthly";
  const entries = isMonthly ? monthlyEntries : referralEntries;
  const topEntries = entries.slice(0, 3);
  const restEntries = entries.slice(3);

  const startDateLabel = formatDate(isMonthly ? monthlyStartDate : referralStartDate);
  const endDateLabel = formatDate(isMonthly ? monthlyEndDateStr : referralEndDateStr);
  const { d, h, m, s } = isMonthly ? { d: md, h: mh, m: mm, s: ms } : { d: rd, h: rh, m: rm, s: rs };

  return (
    <Layout>
      <div style={{ background: "#0a0a0a", minHeight: "100%" }}>

        {/* Header */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "20px 16px 4px",
        }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#fff" }}>
            {isMonthly ? "Monthly Contest" : "Referral Contest"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
            List updates once a minute
          </p>
        </div>

        {/* My rank card — shown at top, before tabs */}
        {isMonthly && myMonthlyRank && (
          <div style={{ margin: "14px 16px 0", background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#0e7490", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: "#fff" }}>
                Me
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Your Rank</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#22d3ee" }}>#{myMonthlyRank.rank}</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FaStar style={{ color: "#fbbf24", fontSize: 11 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{(myMonthlyRank.weeklyStars || 0).toLocaleString()} stars</span>
            </div>
          </div>
        )}

        {!isMonthly && myReferralRank && (
          <div style={{ margin: "14px 16px 0", background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#0e7490", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: "#fff" }}>
                Me
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Your Rank</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#22d3ee" }}>#{myReferralRank.rank}</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FaUsers style={{ color: "#34d399", fontSize: 11 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{myReferralRank.referralCount} verified</span>
            </div>
          </div>
        )}

        {/* Tabs — matches Daily Adz / Premium Adz style */}
        <div style={{ padding: "14px 16px 0" }}>
          <div className="flex items-center"
            style={{ background: "#1a1a1a", borderRadius: 14, padding: "4px", gap: 2 }}>
            {([
              { id: "monthly", label: "Monthly" },
              { id: "referral", label: "Referral" },
            ] as const).map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    flex: 1, padding: "8px 10px", borderRadius: 11,
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    color: isActive ? "#fff" : "rgba(255,255,255,0.4)",
                    background: isActive ? "#2e2e2e" : "transparent",
                    border: "none", cursor: "pointer", whiteSpace: "nowrap",
                    boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Info banner: dates + countdown */}
        {(startDateLabel || endDateLabel) && (
          <div style={{
            margin: "14px 16px 0", background: "#1a1a1a", borderRadius: 18, padding: "12px 14px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Started
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>
                  {startDateLabel || "—"}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Ends
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 13, fontWeight: 800, color: "#fff" }}>
                  {endDateLabel || "—"}
                </p>
              </div>
            </div>
            {(monthlyEndDate || referralEndDate) && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)",
              }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Time left:</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: "#fff" }}>
                  {d}d {h}h {m}m {s}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 150, 300].map(delay => (
                <div key={delay} style={{ width: 8, height: 8, borderRadius: "50%", background: "#22d3ee", animation: `pulse 1s ${delay}ms infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* Contest Not Active */}
        {!isLoading && isMonthly && !monthlyContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>
              Admin will start the next Monthly Contest soon. Stay tuned!
            </p>
          </div>
        )}
        {!isLoading && !isMonthly && !referralContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>
              Admin will start the next Referral Contest soon. Invite friends to be ready!
            </p>
          </div>
        )}

        {/* Empty (contest active but no participants yet) */}
        {!isLoading && isMonthly && monthlyContestActive && entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <FaStar style={{ color: "rgba(34,211,238,0.18)", fontSize: 60, marginBottom: 16 }} />
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>No participants yet</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Watch ads to earn stars and climb!</p>
          </div>
        )}
        {!isLoading && !isMonthly && referralContestActive && entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <FaUsers style={{ color: "rgba(34,211,238,0.18)", fontSize: 60, marginBottom: 16 }} />
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>No participants yet</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Invite friends who watch 1+ ad to rank up!</p>
          </div>
        )}

        {/* Top 3 gradient rows + rest list */}
        {!isLoading && entries.length > 0 && (
          <>
            <div style={{ padding: "16px 16px 0" }}>
              {topEntries.map((e: any, i: number) => (
                <TopRow
                  key={e.userId}
                  rank={i + 1}
                  entry={e}
                  value={isMonthly ? (e.weeklyStars ?? 0) : (e.referralCount ?? 0)}
                  valueIcon={isMonthly ? starIcon : usersIcon}
                  isMe={e.userId === user?.id}
                />
              ))}
            </div>

            {restEntries.length > 0 && (
              <div style={{ margin: "8px 16px 0", background: "#111", borderRadius: 16, overflow: "hidden", paddingBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 6px" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#fff" }}>
                    Rankings
                  </p>
                  <button onClick={() => refetch()} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
                    <FaSync style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }} />
                  </button>
                </div>

                {isMonthly && (restEntries as MonthlyEntry[]).map((entry, i) => {
                  const rank = i + 4;
                  const isMe = entry.userId === user?.id;
                  return (
                    <EntryRow
                      key={entry.userId}
                      rank={rank}
                      entry={entry}
                      isMe={isMe}
                      rightContent={
                        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                          <FaStar style={{ color: "#fbbf24", fontSize: 9 }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
                            {(entry.weeklyStars ?? 0).toLocaleString()}
                          </span>
                        </div>
                      }
                    />
                  );
                })}

                {!isMonthly && (restEntries as ReferralEntry[]).map((entry, i) => {
                  const rank = i + 4;
                  const isMe = entry.userId === user?.id;
                  return (
                    <EntryRow
                      key={entry.userId}
                      rank={rank}
                      entry={entry}
                      isMe={isMe}
                      rightContent={
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <FaUsers style={{ color: "#34d399", fontSize: 10 }} />
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{entry.referralCount}</span>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </Layout>
  );
}
