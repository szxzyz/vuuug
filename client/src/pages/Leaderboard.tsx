import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FaStar, FaSync, FaUsers, FaCrown } from "react-icons/fa";
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
  if (rank === 1) return "#d97706";
  if (rank === 2) return "#6b7280";
  if (rank === 3) return "#92400e";
  return "#1d4ed8";
}

/* ─── Podium for top 3 ───────────────────────────────────────────────── */
interface PodiumEntry {
  userId: string;
  firstName?: string | null;
  username?: string | null;
  value: number;
}

function PodiumSlot({
  entry, rank, height, medalColor, ringColor, showCrown, valueIcon, isMonthly,
}: {
  entry?: PodiumEntry;
  rank: number;
  height: number;
  medalColor: string;
  ringColor: string;
  showCrown?: boolean;
  valueIcon: React.ReactNode;
  isMonthly: boolean;
}) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
  const name = entry ? (entry.firstName || entry.username || `#${rank}`) : "—";
  const initials = entry ? getInitials(entry) : "?";
  const bg = entry ? avatarBg(rank) : "#111";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
      {showCrown && (
        <FaCrown style={{ color: "#fbbf24", fontSize: 14, marginBottom: 3 }} />
      )}
      {/* Avatar */}
      <div style={{
        width: rank === 1 ? 58 : 48,
        height: rank === 1 ? 58 : 48,
        borderRadius: "50%",
        background: bg,
        border: `2px solid ${ringColor}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, color: "#fff",
        fontSize: rank === 1 ? 18 : 14,
        marginBottom: 4, flexShrink: 0,
      }}>
        {entry ? initials : "?"}
      </div>
      {/* Platform */}
      <div style={{
        width: "100%", height, borderRadius: "12px 12px 0 0",
        background: "#111827",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-end",
        paddingBottom: 10, gap: 2,
      }}>
        <span style={{ fontSize: rank === 1 ? 22 : 18 }}>{medal}</span>
        <p style={{
          margin: 0, fontSize: 11, fontWeight: 700,
          color: medalColor, maxWidth: 68,
          textAlign: "center", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{name}</p>
        {entry && (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {valueIcon}
            <span style={{ fontSize: 11, fontWeight: 800, color: "#fbbf24" }}>
              {entry.value.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Podium({
  entries, valueIcon, isMonthly,
}: {
  entries: PodiumEntry[];
  valueIcon: React.ReactNode;
  isMonthly: boolean;
}) {
  const first = entries[0];
  const second = entries[1];
  const third = entries[2];

  return (
    <div style={{ display: "flex", alignItems: "flex-end", padding: "16px 12px 0", gap: 3 }}>
      <PodiumSlot entry={second} rank={2} height={76} medalColor="#d1d5db" ringColor="#9ca3af" valueIcon={valueIcon} isMonthly={isMonthly} />
      <PodiumSlot entry={first}  rank={1} height={100} medalColor="#fbbf24" ringColor="#f59e0b" showCrown valueIcon={valueIcon} isMonthly={isMonthly} />
      <PodiumSlot entry={third}  rank={3} height={58}  medalColor="#d97706" ringColor="#92400e" valueIcon={valueIcon} isMonthly={isMonthly} />
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

  const monthlyEndDate = useMemo(() => {
    const d = (monthlyData as any)?.endDate || appSettings?.monthlyContestEndDate;
    if (d) { const dd = new Date(d); if (!isNaN(dd.getTime())) return dd; }
    return null;
  }, [(monthlyData as any)?.endDate, appSettings?.monthlyContestEndDate]);

  const referralEndDate = useMemo(() => {
    const d = referralData?.endDate || appSettings?.weeklyReferralEndDate;
    if (d) { const dd = new Date(d); if (!isNaN(dd.getTime())) return dd; }
    return null;
  }, [referralData?.endDate, appSettings?.weeklyReferralEndDate]);

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

  const starIcon = <FaStar style={{ color: "#fbbf24", fontSize: 9 }} />;
  const usersIcon = <FaUsers style={{ color: "#34d399", fontSize: 9 }} />;

  const isMonthly = activeTab === "monthly";
  const entries = isMonthly ? monthlyEntries : referralEntries;
  const topEntries: PodiumEntry[] = entries.slice(0, 3).map((e: any) => ({
    userId: e.userId,
    firstName: e.firstName,
    username: e.username,
    value: isMonthly ? (e.weeklyStars ?? 0) : (e.referralCount ?? 0),
  }));
  const restEntries = entries.slice(3);

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

        {/* ── Monthly Contest ────────────────────────────────── */}
        {activeTab === "monthly" && (
          <>
            {/* Info Banner */}
            <div style={{ margin: "12px 16px 0", background: "#111827", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(59,130,246,0.7)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Monthly Contest
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 900, color: "#fff", lineHeight: 1 }}>
                    ⭐ Stars Race
                  </p>
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
          </>
        )}

        {/* ── Weekly Referral ────────────────────────────────── */}
        {activeTab === "referral" && (
          <>
            <div style={{ margin: "12px 16px 0", background: "#111827", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(52,211,153,0.8)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Weekly Referral Contest
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 900, color: "#fff", lineHeight: 1 }}>
                    👥 Invite &amp; Win
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>Top {weeklyReferralTopN} inviters</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(52,211,153,0.5)", fontWeight: 700 }}>Verified invites only</p>
                </div>
              </div>
              {referralEndDate && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Ends in:</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#34d399" }}>{rd}d {rh}h {rm}m {rs}s</span>
                </div>
              )}
            </div>
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

        {/* Contest Not Active */}
        {!isLoading && activeTab === "monthly" && !monthlyContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>
              Admin will start the next Monthly Contest soon. Stay tuned!
            </p>
          </div>
        )}
        {!isLoading && activeTab === "referral" && !referralContestActive && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>Contest Not Active</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>
              Admin will start the next Referral Contest soon. Invite friends to be ready!
            </p>
          </div>
        )}

        {/* Empty (contest active but no participants yet) */}
        {!isLoading && activeTab === "monthly" && monthlyContestActive && entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <FaStar style={{ color: "rgba(59,130,246,0.18)", fontSize: 60, marginBottom: 16 }} />
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>No participants yet</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Watch ads to earn stars and climb!</p>
          </div>
        )}
        {!isLoading && activeTab === "referral" && referralContestActive && entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <FaUsers style={{ color: "rgba(52,211,153,0.18)", fontSize: 60, marginBottom: 16 }} />
            <p style={{ fontSize: 17, fontWeight: 700, color: "rgba(255,255,255,0.45)", margin: "0 0 8px" }}>No participants yet</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", margin: 0 }}>Invite friends who watch 1+ ad to rank up!</p>
          </div>
        )}

        {/* Podium + List */}
        {!isLoading && entries.length > 0 && (
          <>
            {/* Podium for top 3 */}
            <Podium
              entries={topEntries}
              valueIcon={isMonthly ? starIcon : usersIcon}
              isMonthly={isMonthly}
            />

            {/* List from 4th onwards */}
            {restEntries.length > 0 && (
              <div style={{ margin: "12px 16px 0", background: "#111", borderRadius: 16, overflow: "hidden", paddingBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 6px" }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#fff" }}>
                    {isMonthly ? `Rankings` : `Rankings`}
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

        {/* My rank card — Monthly */}
        {activeTab === "monthly" && myMonthlyRank && (
          <div style={{ margin: "10px 16px 0", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: "#fff" }}>
                Me
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Your Rank</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#3b82f6" }}>#{myMonthlyRank.rank}</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FaStar style={{ color: "#fbbf24", fontSize: 11 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{(myMonthlyRank.weeklyStars || 0).toLocaleString()} stars</span>
            </div>
          </div>
        )}

        {/* My rank card — Referral */}
        {activeTab === "referral" && myReferralRank && (
          <div style={{ margin: "10px 16px 0", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#065f46", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: "#fff" }}>
                Me
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Your Rank</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#34d399" }}>#{myReferralRank.rank}</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FaUsers style={{ color: "#34d399", fontSize: 11 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{myReferralRank.referralCount} verified</span>
            </div>
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </Layout>
  );
}
