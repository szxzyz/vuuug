import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { useLanguage } from "@/hooks/useLanguage";
import {
  CheckCircle2, XCircle, Loader2,
  AlertTriangle, Send, Info, UserCheck, ChevronDown, ChevronRight,
  Clock, Plus, Trash2, Zap, Timer, Copy, FileText, Tag,
  Calendar, TrendingUp, Hash, Settings2,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";

// ── Design tokens aligned with app theme ──────────────────────────────────────
const CARD_BG      = "#1C1C1E";
const CARD_BORDER  = "#2C2C2E";
const INNER_BG     = "#2A2A2A";
const INNER_BORDER = "#333333";
const PRIMARY      = "#007BFF";
const PRIMARY_DIM  = "rgba(0,123,255,0.15)";
const PRIMARY_RING = "rgba(0,123,255,0.35)";
const TEXT_MUTED   = "#888888";
const TEXT_DIM     = "#555555";

function StatSkeleton() {
  return (
    <div style={{
      height: 22, width: 52, background: "rgba(255,255,255,0.08)",
      borderRadius: 6, display: "inline-block", animation: "pulse 1.5s ease-in-out infinite",
    }} />
  );
}

interface AmbassadorStatus {
  isAmbassador: boolean;
  ambassador: any | null;
  application: any | null;
}

interface ClaimRecord {
  id: string;
  username: string | null;
  firstName: string | null;
  claimedAt: string;
  rewardGranted: string;
}

interface PromoCodeHistoryRecord {
  promoCode: string;
  totalClaims: number;
  totalEarnings: string;
  createdAt: string;
  expiresAt: string | null;
  rewardAmount: string;
  usageLimit: number | null;
  usageCount: number;
  remainingClaims: number | null;
  totalRewardsDistributed: string;
  status: "active" | "expired";
  claims: ClaimRecord[];
}

interface DashboardData {
  ambassador: any;
  stats: {
    todayClaims: number;
    weekClaims: number;
    monthClaims: number;
    lifetimeClaims: number;
    todayEarnings: string;
    weekEarnings: string;
    monthEarnings: string;
    totalEarnings: string;
  };
  promoHistory: Array<{
    id: string;
    promoCode: string;
    commissionUsd: string;
    createdAt: string;
    claimUserUsername?: string;
  }>;
  promoCodeHistory: PromoCodeHistoryRecord[];
  activePromos: any[];
}

function buildPostPreview(codes: string[], rewardAmount: string): string {
  const reward = parseInt(rewardAmount || "10000").toLocaleString("en-US");
  return [
    "💸 Paid Adz Promo Code is LIVE!",
    "",
    "👤 Earn real crypto rewards — join free!",
    "",
    `🎁 Reward: ${reward} POW`,
    "",
    ...codes.map((c) => `🎟 Code: ${c}`),
    "",
    "🚀 Claim your free POW now!",
  ].join("\n");
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Card({ children, className = "", style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl p-4 ${className}`}
      style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, ...style }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-[#007BFF]">{icon}</span>}
      <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">{children}</p>
    </div>
  );
}

function PrimaryButton({
  onClick, disabled, loading, children, className = "",
}: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full h-12 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 font-semibold text-sm text-white ${className}`}
      style={{ background: disabled && !loading ? "#333" : PRIMARY }}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
}

function GhostButton({
  onClick, disabled, children, className = "",
}: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full h-12 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 font-semibold text-sm text-white/70 ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}` }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Ambassador() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<"posts" | "codes">("posts");
  const [channelLink, setChannelLink] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [channelAdded, setChannelAdded] = useState(false);
  const [preVerifyResult, setPreVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [customPromoInput, setCustomPromoInput] = useState("");
  const [scheduleSlots, setScheduleSlots] = useState<string[]>(["06:30", "18:30"]);
  const [postingMode, setPostingMode] = useState<"automatic" | "manual">("automatic");
  const [requireChannelJoin, setRequireChannelJoin] = useState(false);
  const [postNowCountdown, setPostNowCountdown] = useState<number | null>(null);
  const [nextAutoTimer, setNextAutoTimer] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<AmbassadorStatus>({
    queryKey: ["/api/ambassador/status"],
    retry: false,
    refetchInterval: 30_000,
  });

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["/api/ambassador/dashboard"],
    retry: false,
    enabled: status?.isAmbassador === true,
    refetchInterval: 30_000,
  });

  const amb = dashboard?.ambassador ?? status?.ambassador;
  const stats = dashboard?.stats;
  const ambId = (amb as any)?.id as string | undefined;

  useEffect(() => {
    if (!amb) return;
    const raw = (amb as any)?.postingSchedule;
    if (raw) {
      try {
        const parsed: string[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setScheduleSlots(parsed);
      } catch {}
    }
    const mode = (amb as any)?.postingMode;
    if (mode === "automatic" || mode === "manual") setPostingMode(mode);
    const rcj = (amb as any)?.requireChannelJoin;
    if (typeof rcj === "boolean") setRequireChannelJoin(rcj);

    const lastAt = (amb as any)?.manualPostLastAt;
    if (lastAt && mode === "manual") {
      const ms = Date.now() - new Date(lastAt).getTime();
      const remaining = 24 * 60 * 60 * 1000 - ms;
      setPostNowCountdown(remaining > 0 ? remaining : null);
    }
    const nextAt = (amb as any)?.nextPromoAt;
    if (nextAt && (mode === "automatic" || !mode)) {
      const remaining = new Date(nextAt).getTime() - Date.now();
      setNextAutoTimer(remaining > 0 ? remaining : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambId]);

  useEffect(() => {
    if (postNowCountdown === null) return;
    const tick = setInterval(() => {
      setPostNowCountdown(prev => {
        if (prev === null || prev <= 1000) { clearInterval(tick); return null; }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [postNowCountdown]);

  useEffect(() => {
    if (nextAutoTimer === null) return;
    const tick = setInterval(() => {
      setNextAutoTimer(prev => {
        if (prev === null || prev <= 1000) { clearInterval(tick); return null; }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [nextAutoTimer]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const scheduleMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/ambassador/schedule", { postingTimes: scheduleSlots, postingMode, requireChannelJoin }).then((r: any) => r.json()),
    onSuccess: () => {
      showNotification(t("schedule_saved"), "success");
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
    },
    onError: (e: any) => showNotification(e?.message || "Failed to save settings", "error"),
  });

  const postNowMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/ambassador/post-now").then(async (r: any) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || "Failed to post");
        return data;
      }),
    onSuccess: () => {
      showNotification("✅ Promo posted to your channel!", "success");
      setPostNowCountdown(24 * 60 * 60 * 1000);
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
    },
    onError: (e: any) => showNotification(e?.message || "Failed to post promo", "error"),
  });

  const preVerifyMutation = useMutation({
    mutationFn: (link: string) =>
      apiRequest("POST", "/api/ambassador/pre-verify-channel", { channelLink: link }).then((r: any) => r.json()),
    onSuccess: (data: any) => {
      setPreVerifyResult({ ok: data.success, text: data.message || (data.success ? "Channel verified!" : "Verification failed.") });
      if (data.success) setChannelAdded(true);
    },
    onError: () => setPreVerifyResult({ ok: false, text: "Network error. Please try again." }),
  });

  const applyMutation = useMutation({
    mutationFn: (data: { channelLink: string; termsAccepted: boolean }) =>
      apiRequest("POST", "/api/ambassador/apply", data),
    onSuccess: () => {
      showNotification(t("application_submitted_msg"), "success");
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
    },
    onError: (e: any) => showNotification(e?.message || "Failed to submit application", "error"),
  });

  const promoNameMutation = useMutation({
    mutationFn: (promoCodeName: string) =>
      apiRequest("POST", "/api/ambassador/request-promo-name", { promoCodeName }),
    onSuccess: () => {
      showNotification(t("custom_name_submitted_msg"), "success");
      setCustomPromoInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
    },
    onError: (e: any) => showNotification(e?.message || "Failed to submit request", "error"),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function copyText(text: string, label = "Copied!") {
    navigator.clipboard.writeText(text).then(() => showNotification(label, "success")).catch(() => {});
  }

  function fmtCountdown(ms: number) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // ── How It Works Drawer ────────────────────────────────────────────────────
  const HowItWorksDrawer = (
    <Drawer open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
      <DrawerContent className="border-none max-h-[80vh]" style={{ background: CARD_BG }}>
        <DrawerHeader className="flex items-center justify-between pb-2">
          <DrawerTitle className="text-white font-bold text-lg">{t("how_it_works_title")}</DrawerTitle>
          <DrawerClose asChild>
            <button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">
              {t("close_label")}
            </button>
          </DrawerClose>
        </DrawerHeader>
        <div className="px-4 pb-6 overflow-y-auto space-y-1">
          {[
            { n: 1, title: t("hiw_step1_title"), sub: t("hiw_step1_sub") },
            { n: 2, title: t("hiw_step2_title"), sub: t("hiw_step2_sub") },
            { n: 3, title: t("hiw_step3_title"), sub: t("hiw_step3_sub") },
            { n: 4, title: t("hiw_step4_title"), sub: t("hiw_step4_sub") },
          ].map(({ n, title, sub }) => (
            <div key={n} className="flex items-start gap-3 py-3 border-b border-white/5 last:border-none">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-black"
                style={{ background: PRIMARY_DIM, color: PRIMARY }}
              >{n}</div>
              <div>
                <p className="text-white text-sm font-semibold">{title}</p>
                <p className="text-[#888] text-xs mt-0.5">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (statusLoading) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 bg-black">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
          </div>
        </main>
      </Layout>
    );
  }

  // ── Pending ────────────────────────────────────────────────────────────────
  if (status?.application?.status === "pending" && !status?.isAmbassador) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">{t("under_review_title")}</h1>
            <p className="text-[#888] text-sm leading-relaxed">{t("under_review_desc")}</p>
          </div>
          <Card>
            <div className="flex items-center justify-between py-2 border-b border-white/5">
              <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">{t("channel_label")}</p>
              <p className="text-white text-sm font-medium">{status.application.channelLink}</p>
            </div>
            {status.application.channelTitle && (
              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">{t("title_label")}</p>
                <p className="text-white text-sm font-medium">{status.application.channelTitle}</p>
              </div>
            )}
            {status.application.subscriberCount && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">{t("subscribers_label")}</p>
                <p className="text-white text-sm font-medium">{status.application.subscriberCount.toLocaleString()}</p>
              </div>
            )}
          </Card>
          <div className="mt-3 rounded-2xl p-4 flex items-center gap-3" style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}>
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin flex-shrink-0" />
            <p className="text-yellow-400 text-sm font-medium">{t("review_in_progress")}</p>
          </div>
        </main>
      </Layout>
    );
  }

  // ── Rejected ───────────────────────────────────────────────────────────────
  if (status?.application?.status === "rejected" && !status?.isAmbassador) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">{t("not_approved_title")}</h1>
            <p className="text-[#888] text-sm leading-relaxed">
              {status.application.rejectionReason
                ? <><span className="text-white font-semibold">{t("reason_label")}: </span>{status.application.rejectionReason}</>
                : t("application_not_approved_text")}
            </p>
          </div>
          <div className="rounded-2xl p-4 mb-4 flex items-center gap-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm font-medium">{t("application_rejected")}</p>
          </div>
          <GhostButton onClick={() => {
            setChannelLink(""); setTermsAccepted(false); setChannelAdded(false);
            queryClient.setQueryData(["/api/ambassador/status"], (old: any) => ({ ...old, application: null }));
          }}>
            {t("apply_again")}
          </GhostButton>
        </main>
      </Layout>
    );
  }

  // ── Ambassador Dashboard ───────────────────────────────────────────────────
  if (status?.isAmbassador && amb) {
    const promoPrefix = (amb.promoPrefix || amb.promoCodeName || "").toUpperCase();
    const totalEarnings = parseFloat(stats?.totalEarnings || "0");
    const activeCodes = (dashboard?.promoCodeHistory ?? []).filter(p => p.status === "active");
    const latestCode = activeCodes[0]?.promoCode ?? "";
    const latestReward = activeCodes[0]?.rewardAmount ?? "10000";
    const postPreviewText = buildPostPreview(
      activeCodes.slice(0, 2).map(p => p.promoCode),
      latestReward,
    );

    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">

          {/* Header */}
          <div className="mb-5">
            <h1 className="text-2xl font-black text-white tracking-tight mb-1">{t("ambassador_dashboard")}</h1>
            <p className="text-[#888] text-xs">
              Prefix:{" "}
              <span className="text-white font-bold font-mono">{promoPrefix}</span>
            </p>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {[
              { label: "Total Earned", value: `$${totalEarnings > 0 ? totalEarnings.toFixed(2) : "0.00"}`, color: "#22c55e" },
              { label: "All Claims",   value: String(stats?.lifetimeClaims ?? 0),                           color: "#fff" },
              { label: "Active Codes", value: String(activeCodes.length),                                    color: PRIMARY },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-xl p-3 flex flex-col items-center gap-1"
                style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}
              >
                {dashLoading ? <StatSkeleton /> : (
                  <span className="text-base font-black" style={{ color }}>{value}</span>
                )}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: TEXT_MUTED }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex rounded-2xl overflow-hidden mb-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
            {(["posts", "codes"] as const).map((tab) => {
              const labels = { posts: "Ambassador Posts", codes: "Promo Codes" };
              const icons  = { posts: <FileText className="w-3.5 h-3.5" />, codes: <Tag className="w-3.5 h-3.5" /> };
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 h-11 flex items-center justify-center gap-1.5 text-xs font-semibold transition-all"
                  style={{
                    background: active ? PRIMARY_DIM : "transparent",
                    color: active ? PRIMARY : TEXT_DIM,
                    borderBottom: active ? `2px solid ${PRIMARY}` : "2px solid transparent",
                  }}
                >
                  {icons[tab]}
                  {labels[tab]}
                </button>
              );
            })}
          </div>

          {/* ── TAB 1: Ambassador Posts ─────────────────────────────────── */}
          {activeTab === "posts" && (
            <div className="space-y-3">

              {/* Generated Promo Code */}
              <Card>
                <SectionLabel icon={<Hash className="w-4 h-4" />}>Generated Promo Code</SectionLabel>
                {dashLoading ? (
                  <div className="h-12 rounded-xl animate-pulse" style={{ background: INNER_BG }} />
                ) : latestCode ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="flex-1 h-12 rounded-xl flex items-center px-4"
                      style={{ background: PRIMARY_DIM, border: `1px solid ${PRIMARY_RING}` }}
                    >
                      <span className="font-mono font-black text-base tracking-widest" style={{ color: PRIMARY }}>{latestCode}</span>
                    </div>
                    <button
                      onClick={() => copyText(latestCode, "Code copied!")}
                      className="w-12 h-12 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
                      style={{ background: PRIMARY, color: "#fff" }}
                      title="Copy code"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: TEXT_DIM }}>No active code yet — post your first promo to generate one.</p>
                )}
              </Card>

              {/* Post Preview */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel icon={<FileText className="w-4 h-4" />}>Post Preview</SectionLabel>
                  {postPreviewText && (
                    <button
                      onClick={() => copyText(postPreviewText, "Post copied!")}
                      className="flex items-center gap-1.5 h-7 px-3 rounded-lg active:scale-95 transition-transform text-white font-semibold text-[11px]"
                      style={{ background: PRIMARY }}
                    >
                      <Copy className="w-3 h-3" />
                      Copy Post
                    </button>
                  )}
                </div>
                {dashLoading ? (
                  <div className="space-y-2">
                    {[80, 100, 60, 90, 70].map((w, i) => (
                      <div key={i} className="h-3 rounded animate-pulse" style={{ width: `${w}%`, background: INNER_BG }} />
                    ))}
                  </div>
                ) : activeCodes.length > 0 ? (
                  <div
                    className="rounded-xl p-3 font-mono text-xs leading-relaxed whitespace-pre-line"
                    style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}`, color: "#ccc" }}
                  >
                    {postPreviewText}
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: TEXT_DIM }}>Post your first promo to see a preview here.</p>
                )}
              </Card>

              {/* Next Auto Post Timer */}
              <Card>
                <SectionLabel icon={<Clock className="w-4 h-4" />}>Next Auto Post</SectionLabel>

                {postingMode === "automatic" ? (
                  nextAutoTimer !== null ? (
                    <div
                      className="h-12 rounded-xl flex items-center justify-center gap-2"
                      style={{ background: PRIMARY_DIM, border: `1px solid ${PRIMARY_RING}` }}
                    >
                      <Timer className="w-4 h-4" style={{ color: PRIMARY }} />
                      <span className="font-mono font-bold text-base tabular-nums" style={{ color: PRIMARY }}>
                        {fmtCountdown(nextAutoTimer)}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="h-12 rounded-xl flex items-center justify-center gap-2"
                      style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
                    >
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-green-400 text-sm font-semibold">Ready to post on schedule</span>
                    </div>
                  )
                ) : (
                  postNowCountdown !== null ? (
                    <div
                      className="h-12 rounded-xl flex items-center justify-center gap-2"
                      style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}` }}
                    >
                      <Timer className="w-4 h-4" style={{ color: TEXT_MUTED }} />
                      <span className="text-sm font-semibold tabular-nums" style={{ color: TEXT_MUTED }}>
                        {t("next_post_in")} {fmtCountdown(postNowCountdown)}
                      </span>
                    </div>
                  ) : (
                    <PrimaryButton onClick={() => postNowMutation.mutate()} loading={postNowMutation.isPending}>
                      <Zap className="w-4 h-4" />
                      {t("post_now")}
                    </PrimaryButton>
                  )
                )}

                {postingMode === "automatic" && scheduleSlots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {scheduleSlots.map((slot, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: PRIMARY_DIM, color: PRIMARY }}
                      >
                        {slot}
                      </span>
                    ))}
                    <span className="text-[10px] self-center" style={{ color: TEXT_DIM }}>UTC</span>
                  </div>
                )}
              </Card>

              {/* Posting History */}
              <Card>
                <SectionLabel icon={<TrendingUp className="w-4 h-4" />}>Posting History</SectionLabel>

                {dashLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
                  </div>
                ) : (dashboard?.promoCodeHistory?.length ?? 0) === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <TrendingUp className="w-8 h-8 text-white/10" />
                    <p className="text-sm" style={{ color: TEXT_DIM }}>{t("no_promo_codes_yet")}</p>
                    <p className="text-xs" style={{ color: TEXT_DIM }}>{t("codes_appear_once_posted")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dashboard!.promoCodeHistory.map((item) => {
                      const isExpanded = expandedCode === item.promoCode;
                      return (
                        <div
                          key={item.promoCode}
                          className="rounded-xl overflow-hidden"
                          style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}` }}
                        >
                          <button
                            className="w-full flex items-center justify-between px-3 py-2.5 transition-colors"
                            style={{ background: "transparent" }}
                            onClick={() => setExpandedCode(isExpanded ? null : item.promoCode)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TEXT_DIM }} />
                                : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TEXT_DIM }} />}
                              <div className="min-w-0 text-left">
                                <p className="text-white text-xs font-mono font-bold">{item.promoCode}</p>
                                <p className="text-[10px] mt-0.5" style={{ color: TEXT_DIM }}>
                                  {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-white text-[11px] font-semibold">{item.totalClaims} claim{item.totalClaims !== 1 ? "s" : ""}</p>
                                <p className="text-green-400 text-[10px] font-bold">+${item.totalEarnings}</p>
                              </div>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                item.status === "active"
                                  ? "bg-green-500/15 text-green-400"
                                  : "bg-white/10 text-white/35"
                              }`}>{item.status}</span>
                            </div>
                          </button>

                          {isExpanded && (
                            <div style={{ borderTop: `1px solid ${INNER_BORDER}` }} className="px-3 pb-2">
                              <div className="py-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]" style={{ borderBottom: `1px solid ${INNER_BORDER}` }}>
                                {[
                                  [t("reward_per_claim"), `${parseInt(item.rewardAmount || "0").toLocaleString()} POW`],
                                  ["Max Claims", item.usageLimit !== null ? item.usageLimit?.toLocaleString() : "∞"],
                                  ["Claims Used", (item.usageCount ?? 0).toLocaleString()],
                                  ["Remaining", item.remainingClaims !== null ? item.remainingClaims?.toLocaleString() : "∞"],
                                ].map(([label, val], i) => (
                                  <div key={i} className="flex items-center justify-between">
                                    <span style={{ color: TEXT_MUTED }}>{label}</span>
                                    <span className="text-white font-semibold">{val}</span>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between col-span-2">
                                  <span style={{ color: TEXT_MUTED }}>Total Distributed</span>
                                  <span className="text-purple-400 font-semibold">{Math.round(parseFloat(item.totalRewardsDistributed || "0")).toLocaleString()} POW</span>
                                </div>
                              </div>

                              {item.claims.length === 0 ? (
                                <p className="text-xs py-3 text-center" style={{ color: TEXT_DIM }}>{t("no_claims_yet")}</p>
                              ) : (
                                <>
                                  <div className="grid grid-cols-3 gap-1 pt-2 pb-1">
                                    {[t("table_user"), t("table_date_time"), t("table_reward")].map((h, i) => (
                                      <span key={i} className={`text-[9px] font-semibold uppercase tracking-wider ${i === 1 ? "text-center" : i === 2 ? "text-right" : ""}`} style={{ color: TEXT_DIM }}>{h}</span>
                                    ))}
                                  </div>
                                  {item.claims.map((claim) => (
                                    <div key={claim.id} className="grid grid-cols-3 gap-1 items-center py-1.5" style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                                      <p className="text-[10px] truncate" style={{ color: "#aaa" }}>
                                        {claim.username ? `@${claim.username}` : claim.firstName || "User"}
                                      </p>
                                      <p className="text-[10px] text-center" style={{ color: TEXT_DIM }}>
                                        {new Date(claim.claimedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                                        {new Date(claim.claimedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                      </p>
                                      <p className="text-green-400 text-[10px] font-bold text-right">
                                        {parseInt(claim.rewardGranted || "10000").toLocaleString()} POW
                                      </p>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Settings (collapsible) */}
              <div className="rounded-2xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3.5"
                  onClick={() => setSettingsOpen(prev => !prev)}
                >
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4" style={{ color: TEXT_MUTED }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>Posting Settings</span>
                  </div>
                  {settingsOpen
                    ? <ChevronDown className="w-4 h-4" style={{ color: TEXT_DIM }} />
                    : <ChevronRight className="w-4 h-4" style={{ color: TEXT_DIM }} />}
                </button>

                {settingsOpen && (
                  <div className="px-4 pb-4" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                    {/* Mode toggle */}
                    <div className="flex rounded-xl overflow-hidden my-3" style={{ border: `1px solid ${INNER_BORDER}` }}>
                      {(["automatic", "manual"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setPostingMode(m)}
                          className="flex-1 h-10 flex items-center justify-center gap-1.5 text-xs font-semibold transition-all"
                          style={{
                            background: postingMode === m ? PRIMARY_DIM : "transparent",
                            color: postingMode === m ? PRIMARY : TEXT_DIM,
                          }}
                        >
                          {m === "automatic" ? <Clock className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                      ))}
                    </div>

                    {postingMode === "automatic" && (
                      <>
                        <p className="text-xs mb-3 leading-relaxed" style={{ color: TEXT_DIM }}>{t("posting_schedule_desc")}</p>
                        <div className="space-y-2 mb-2">
                          {scheduleSlots.map((time, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="time"
                                value={time}
                                onChange={(e) =>
                                  setScheduleSlots(prev => prev.map((v, i) => i === idx ? e.target.value : v))
                                }
                                className="flex-1 h-10 rounded-xl px-3 text-white text-sm focus:outline-none"
                                style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}` }}
                              />
                              <button
                                onClick={() => setScheduleSlots(prev => prev.filter((_, i) => i !== idx))}
                                className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
                                style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.2)" }}
                              >
                                <Trash2 className="w-4 h-4 text-red-400" />
                              </button>
                            </div>
                          ))}
                        </div>
                        {scheduleSlots.length < 3 && (
                          <button
                            onClick={() => setScheduleSlots(prev => [...prev, "12:00"])}
                            className="w-full h-9 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform mb-3"
                            style={{ background: INNER_BG, border: `1px dashed ${INNER_BORDER}` }}
                          >
                            <Plus className="w-3.5 h-3.5" style={{ color: TEXT_DIM }} />
                            <span className="text-xs" style={{ color: TEXT_DIM }}>{t("add_time_slot")}</span>
                          </button>
                        )}
                      </>
                    )}

                    {/* Require channel join toggle */}
                    <div className="flex items-center justify-between py-3 mb-3" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                      <div>
                        <p className="text-white text-sm font-semibold">{t("require_channel_join")}</p>
                        <p className="text-xs mt-0.5" style={{ color: TEXT_DIM }}>{t("require_channel_join_desc")}</p>
                      </div>
                      <button
                        onClick={() => setRequireChannelJoin(prev => !prev)}
                        className="relative w-12 h-6 rounded-full transition-all flex-shrink-0"
                        style={{
                          background: requireChannelJoin ? PRIMARY : INNER_BG,
                          border: `1.5px solid ${requireChannelJoin ? PRIMARY : INNER_BORDER}`,
                        }}
                      >
                        <span
                          className="absolute top-0.5 w-4 h-4 rounded-full transition-all bg-white"
                          style={{ left: requireChannelJoin ? "calc(100% - 18px)" : "2px" }}
                        />
                      </button>
                    </div>

                    {/* Custom promo name */}
                    <div className="pb-3 mb-3" style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT_MUTED }}>{t("custom_promo_name")}</p>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs" style={{ color: TEXT_DIM }}>{t("current_prefix_label")}</p>
                        <span className="text-white font-bold font-mono text-xs">{promoPrefix}</span>
                      </div>
                      {amb.customPromoRequest && (
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs" style={{ color: TEXT_DIM }}>
                            {t("requested_name_label")}:{" "}
                            <span className="text-white/70">{amb.customPromoRequest}</span>
                          </p>
                          <Badge className={
                            amb.customPromoRequestStatus === "approved"
                              ? "bg-green-600/20 text-green-400 border-green-600/30 text-[10px]"
                              : amb.customPromoRequestStatus === "rejected"
                              ? "bg-red-600/20 text-red-400 border-red-600/30 text-[10px]"
                              : "bg-yellow-600/20 text-yellow-400 border-yellow-600/30 text-[10px]"
                          }>
                            {amb.customPromoRequestStatus === "approved" ? t("status_approved") :
                             amb.customPromoRequestStatus === "rejected" ? t("status_rejected") : t("status_pending")}
                          </Badge>
                        </div>
                      )}
                      {(!amb.customPromoRequest || amb.customPromoRequestStatus === "rejected") && (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customPromoInput}
                            onChange={(e) => setCustomPromoInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                            placeholder={t("placeholder_eg_mychain")}
                            maxLength={20}
                            className="flex-1 h-10 rounded-xl px-3 text-white text-sm font-mono focus:outline-none"
                            style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}` }}
                          />
                          <button
                            onClick={() => promoNameMutation.mutate(customPromoInput)}
                            disabled={customPromoInput.length < 3 || promoNameMutation.isPending}
                            className="h-10 px-4 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40 text-white font-semibold text-xs"
                            style={{ background: PRIMARY }}
                          >
                            {promoNameMutation.isPending
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : t("request_label")}
                          </button>
                        </div>
                      )}
                    </div>

                    <PrimaryButton onClick={() => scheduleMutation.mutate()} loading={scheduleMutation.isPending} disabled={postingMode === "automatic" && scheduleSlots.length === 0}>
                      <CheckCircle2 className="w-4 h-4" />
                      {t("save_schedule_btn")}
                    </PrimaryButton>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 2: Promo Codes ──────────────────────────────────────── */}
          {activeTab === "codes" && (
            <div className="space-y-3">
              {dashLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
                </div>
              ) : (dashboard?.promoCodeHistory?.length ?? 0) === 0 ? (
                <Card className="flex flex-col items-center gap-2 py-8">
                  <Tag className="w-10 h-10 text-white/10" />
                  <p className="text-white/30 text-sm font-semibold">No promo codes yet</p>
                  <p className="text-white/20 text-xs text-center">Your codes will appear here once the bot posts your first promo.</p>
                </Card>
              ) : (
                dashboard!.promoCodeHistory.map((pc) => {
                  const reward  = parseInt(pc.rewardAmount || "0").toLocaleString();
                  const isActive = pc.status === "active";
                  return (
                    <div
                      key={pc.promoCode}
                      className="rounded-2xl p-4"
                      style={{
                        background: CARD_BG,
                        border: `1px solid ${CARD_BORDER}`,
                        borderLeft: `3px solid ${isActive ? "#22c55e" : INNER_BORDER}`,
                      }}
                    >
                      {/* Code + status row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-white font-black text-sm">{pc.promoCode}</span>
                          <button
                            onClick={() => copyText(pc.promoCode, "Code copied!")}
                            className="w-6 h-6 rounded-md flex items-center justify-center active:scale-90 transition-transform"
                            style={{ background: INNER_BG }}
                            title="Copy"
                          >
                            <Copy className="w-3 h-3" style={{ color: TEXT_MUTED }} />
                          </button>
                        </div>
                        <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                          isActive ? "bg-green-500/15 text-green-400" : "bg-white/8 text-white/35"
                        }`}>
                          {isActive ? "Active" : "Expired"}
                        </span>
                      </div>

                      {/* Data rows */}
                      <div className="space-y-0">
                        {[
                          { label: "Reward",         value: `${reward} POW` },
                          { label: "Maximum Claims", value: pc.usageLimit !== null ? pc.usageLimit.toLocaleString() : "Unlimited" },
                          { label: "Claims Used",    value: (pc.usageCount ?? 0).toLocaleString() },
                          {
                            label: "Remaining",
                            value: pc.remainingClaims !== null ? pc.remainingClaims.toLocaleString() : "Unlimited",
                            valueColor: pc.remainingClaims === 0 ? "#f87171" : undefined,
                          },
                          {
                            label: "Created",
                            value: new Date(pc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                            icon: <Calendar className="w-3 h-3" style={{ color: TEXT_DIM }} />,
                          },
                        ].map(({ label, value, valueColor, icon }, i, arr) => (
                          <div
                            key={label}
                            className="flex items-center justify-between py-2"
                            style={{ borderBottom: i < arr.length - 1 ? `1px solid ${CARD_BORDER}` : "none" }}
                          >
                            <div className="flex items-center gap-1.5">
                              {icon}
                              <span className="text-xs" style={{ color: TEXT_DIM }}>{label}</span>
                            </div>
                            <span className="text-xs font-semibold" style={{ color: valueColor ?? "#fff" }}>
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

        </main>
      </Layout>
    );
  }

  // ── Application Form ───────────────────────────────────────────────────────
  const canSubmit = channelLink.trim().length > 0 && channelAdded && termsAccepted;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">

        <div className="mb-6">
          <h1 className="text-2xl font-black text-white tracking-tight mb-2">{t("ambassador_program_title")}</h1>
          <p className="text-sm leading-relaxed" style={{ color: TEXT_MUTED }}>{t("ambassador_program_desc")}</p>
        </div>

        {/* How It Works */}
        <GhostButton onClick={() => setHowItWorksOpen(true)} className="mb-4">
          <Info className="w-5 h-5" />
          {t("how_it_works_title")}
        </GhostButton>

        {/* Apply form */}
        <Card className="mb-3">
          <SectionLabel>{t("apply_now_label")}</SectionLabel>

          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: TEXT_MUTED }}>
              {t("telegram_channel_link")}
            </label>
            <input
              type="text"
              value={channelLink}
              onChange={(e) => {
                setChannelLink(e.target.value);
                if (channelAdded || preVerifyResult) { setChannelAdded(false); setPreVerifyResult(null); }
              }}
              placeholder="t.me/yourchannel or @yourchannel"
              className="w-full h-11 rounded-xl px-3 text-white text-sm focus:outline-none"
              style={{ background: INNER_BG, border: `1px solid ${INNER_BORDER}` }}
            />
          </div>

          <div className="pt-4 mb-4" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>{t("channel_verification_label")}</p>

            {channelAdded ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 py-2 px-3 rounded-xl" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-green-400 text-sm font-semibold">{t("channel_verified_label")}</p>
                    <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>{t("bot_has_permission")}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setChannelAdded(false); setPreVerifyResult(null); }}
                  className="text-xs transition-colors"
                  style={{ color: TEXT_DIM }}
                >
                  {t("use_different_channel")}
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 text-sm font-semibold">{t("required_add_bot_admin")}</p>
                      <p className="text-xs mt-1 leading-relaxed" style={{ color: TEXT_MUTED }}>
                        {t("bot_admin_instructions_pre")}{" "}
                        <span className="text-white font-semibold">@Paid_Adzbot</span>{" "}
                        {t("bot_admin_instructions_mid")}{" "}
                        <span className="text-white font-semibold">{t("post_messages_permission_label")}</span>{" "}
                        {t("bot_admin_instructions_post")}
                      </p>
                    </div>
                  </div>
                </div>

                {preVerifyResult && !preVerifyResult.ok && (
                  <div className="rounded-xl p-3 mb-3 flex items-start gap-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-xs leading-relaxed">{preVerifyResult.text}</p>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (!channelLink.trim()) { setPreVerifyResult({ ok: false, text: "Enter your channel link above first." }); return; }
                    setPreVerifyResult(null);
                    preVerifyMutation.mutate(channelLink.trim());
                  }}
                  disabled={preVerifyMutation.isPending}
                  className="w-full h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50 text-white font-semibold text-sm"
                  style={{ background: PRIMARY }}
                >
                  {preVerifyMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <UserCheck className="w-4 h-4" />}
                  {preVerifyMutation.isPending ? t("verifying_ellipsis") : t("verify_channel_btn")}
                </button>
              </>
            )}
          </div>

          {/* Terms */}
          <label className="flex items-start gap-3 cursor-pointer">
            <div
              onClick={() => setTermsAccepted(!termsAccepted)}
              className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 cursor-pointer transition-all"
              style={{
                background: termsAccepted ? PRIMARY : INNER_BG,
                border: termsAccepted ? "none" : `1px solid ${INNER_BORDER}`,
              }}
            >
              {termsAccepted && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: TEXT_MUTED }}>
              I agree to post only legitimate promotional content and to maintain bot admin permissions for auto-posting to work.
            </span>
          </label>
        </Card>

        {/* Submit */}
        <button
          onClick={() => applyMutation.mutate({ channelLink, termsAccepted })}
          disabled={!canSubmit || applyMutation.isPending}
          className="w-full h-14 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 mb-4 text-white font-bold tracking-widest text-sm"
          style={{ background: canSubmit ? PRIMARY : INNER_BG }}
        >
          {applyMutation.isPending
            ? <Loader2 className="w-5 h-5 animate-spin" />
            : <Send className="w-5 h-5" />}
          {applyMutation.isPending ? t("submitting_ellipsis") : t("submit_application_btn")}
        </button>

        {/* Requirements */}
        <Card>
          <SectionLabel>{t("requirements_label")}</SectionLabel>
          <div className="space-y-1.5">
            {[t("req_active_channel"), t("req_add_bot_admin"), t("req_post_messages"), t("req_genuine_followers")].map((req, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIMARY }} />
                <span className="text-xs" style={{ color: TEXT_MUTED }}>{req}</span>
              </div>
            ))}
          </div>
        </Card>

      </main>

      {HowItWorksDrawer}
    </Layout>
  );
}
