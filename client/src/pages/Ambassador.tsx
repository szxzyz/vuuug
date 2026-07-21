import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import { useLanguage } from "@/hooks/useLanguage";
import {
  CheckCircle2, XCircle, Loader2,
  Scroll, AlertTriangle, Send, Info, UserCheck, ChevronDown, ChevronRight,
  Clock, Plus, Trash2, Zap, Timer,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";

const SECTION_BG = "#1C1C1E";

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

export default function Ambassador() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [channelLink, setChannelLink] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [channelAdded, setChannelAdded] = useState(false);
  const [preVerifyResult, setPreVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [customPromoInput, setCustomPromoInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [scheduleSlots, setScheduleSlots] = useState<string[]>(["06:30", "18:30"]);
  const [postingMode, setPostingMode] = useState<"automatic" | "manual">("automatic");
  const [requireChannelJoin, setRequireChannelJoin] = useState(false);
  const [postNowCountdown, setPostNowCountdown] = useState<number | null>(null); // ms remaining
  const [ambActiveTab, setAmbActiveTab] = useState<'management' | 'promos'>('management');

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

  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const amb = dashboard?.ambassador ?? status?.ambassador;
  const stats = dashboard?.stats;

  // Sync schedule slots and settings from server data once when ambassador data first loads
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
    if (mode === 'automatic' || mode === 'manual') setPostingMode(mode);
    const rcj = (amb as any)?.requireChannelJoin;
    if (typeof rcj === 'boolean') setRequireChannelJoin(rcj);

    // Compute initial post-now countdown if in manual mode
    const lastAt = (amb as any)?.manualPostLastAt;
    if (lastAt && mode === 'manual') {
      const ms = Date.now() - new Date(lastAt).getTime();
      const remaining = 24 * 60 * 60 * 1000 - ms;
      setPostNowCountdown(remaining > 0 ? remaining : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambId]);

  // Countdown tick for manual post rate limit
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

  // ── Mutations ────────────────────────────────────────────────────────────────

  const scheduleMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/ambassador/schedule", {
        postingTimes: scheduleSlots,
        postingMode,
        requireChannelJoin,
      }).then((r: any) => r.json()),
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
      setPostNowCountdown(24 * 60 * 60 * 1000); // reset 24h countdown
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

  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const verifyChannelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ambassador/verify-channel").then(r => r.json()),
    onSuccess: (data: any) => {
      setVerifyMsg({ ok: data.success, text: data.message || (data.success ? "Channel verified!" : "Verification failed.") });
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
      }
    },
    onError: () => setVerifyMsg({ ok: false, text: "Network error. Please try again." }),
  });

  // ── How It Works Drawer ───────────────────────────────────────────────────
  const HowItWorksDrawer = (
    <Drawer open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
      <DrawerContent className="border-none max-h-[80vh]" style={{ background: SECTION_BG }}>
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
            { n: 1, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: t("hiw_step1_title"), sub: t("hiw_step1_sub") },
            { n: 2, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: t("hiw_step2_title"), sub: t("hiw_step2_sub") },
            { n: 3, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: t("hiw_step3_title"), sub: t("hiw_step3_sub") },
            { n: 4, color: "#22c55e", bg: "rgba(34,197,94,0.15)", title: t("hiw_step4_title"), sub: t("hiw_step4_sub") },
          ].map(({ n, color, bg, title, sub }) => (
            <div key={n} className="flex items-start gap-3 py-3 border-b border-white/5 last:border-none">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-black"
                style={{ background: bg, color }}>{n}</div>
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

  // ── Loading state ─────────────────────────────────────────────────────────
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

  // ── Pending state ─────────────────────────────────────────────────────────
  if (status?.application?.status === "pending" && !status?.isAmbassador) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">
              {t("under_review_title")}
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              {t("under_review_desc")}
            </p>
          </div>

          <div className="rounded-2xl p-4" style={{ background: SECTION_BG }}>
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
          </div>

          <div className="mt-4 rounded-2xl p-4 flex items-center gap-3" style={{ background: "rgba(234,179,8,0.08)" }}>
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin flex-shrink-0" />
            <p className="text-yellow-400 text-sm font-medium">{t("review_in_progress")}</p>
          </div>
        </main>
      </Layout>
    );
  }

  // ── Rejected state ─────────────────────────────────────────────────────────
  if (status?.application?.status === "rejected" && !status?.isAmbassador) {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">
              {t("not_approved_title")}
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              {status.application.rejectionReason
                ? <><span className="text-white font-semibold">{t("reason_label")}: </span>{status.application.rejectionReason}</>
                : t("application_not_approved_text")}
            </p>
          </div>

          <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(239,68,68,0.08)" }}>
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm font-medium">{t("application_rejected")}</p>
            </div>
          </div>

          <button
            onClick={() => {
              setChannelLink("");
              setTermsAccepted(false);
              setChannelAdded(false);
              queryClient.setQueryData(["/api/ambassador/status"], (old: any) => ({
                ...old,
                application: null,
              }));
            }}
            className="w-full h-12 rounded-2xl flex items-center justify-center active:scale-95 transition-transform"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <span className="text-white font-semibold text-sm">{t("apply_again")}</span>
          </button>
        </main>
      </Layout>
    );
  }

  // ── Ambassador Dashboard ───────────────────────────────────────────────────
  if (status?.isAmbassador && amb) {
    const promoPrefix = (amb.promoPrefix || amb.promoCodeName || "").toUpperCase();
    const totalEarnings = parseFloat(stats?.totalEarnings || "0");

    return (
      <Layout>
        <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">

          {/* Header */}
          <div className="mb-4">
            <h1 className="text-2xl font-black text-white tracking-tight mb-1">
              {t("ambassador_dashboard")}
            </h1>
            <p className="text-[#888] text-xs leading-relaxed">
              Code prefix: <span className="text-white font-bold tracking-widest">{promoPrefix}</span>
            </p>
          </div>

          {/* Two-Tab Navigation */}
          <div className="flex rounded-2xl overflow-hidden mb-4" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}>
            {([
              { key: 'management' as const, label: 'Ambassador Management' },
              { key: 'promos' as const, label: 'Promo Codes' },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setAmbActiveTab(tab.key)}
                className="flex-1 py-3 text-xs font-semibold transition-all"
                style={{
                  background: ambActiveTab === tab.key ? "#3b82f6" : "transparent",
                  color: ambActiveTab === tab.key ? "#fff" : "rgba(255,255,255,0.4)",
                  borderRadius: ambActiveTab === tab.key ? 14 : 0,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab 1: Ambassador Management ── */}
          {ambActiveTab === 'management' && (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { label: t("todays_claims"), value: stats?.todayClaims ?? 0, color: "#3b82f6" },
                  { label: t("total_promo_claims"), value: stats?.lifetimeClaims ?? 0, color: "#fff" },
                  { label: "Active Codes", value: dashboard?.activePromos?.length ?? 0, color: "#fff" },
                  { label: t("total_promo_earnings"), value: `${totalEarnings > 0 ? totalEarnings.toFixed(4) : "0.0000"}`, color: "#22c55e" },
                ].map((stat, i) => (
                  <div key={i} className="rounded-xl p-3" style={{ background: SECTION_BG }}>
                    <p className="text-[#666] text-[10px] font-semibold uppercase tracking-wider mb-1">{stat.label}</p>
                    {dashLoading ? <StatSkeleton /> : (
                      <p className="font-black text-lg" style={{ color: stat.color }}>{stat.value}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Channel Info */}
              {(amb as any).channelId && (
                <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
                  <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Channel</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-semibold">{(amb as any).channelTitle || (amb as any).channelId}</p>
                      {(amb as any).channelUsername && <p className="text-[#888] text-xs mt-0.5">@{(amb as any).channelUsername}</p>}
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                      (amb as any).channelVerified ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"
                    }`}>
                      {(amb as any).channelVerified ? "Verified" : "Unverified"}
                    </span>
                  </div>
                  {!(amb as any).channelVerified && (
                    <button
                      onClick={() => verifyChannelMutation.mutate()}
                      disabled={verifyChannelMutation.isPending}
                      className="w-full h-10 mt-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40"
                      style={{ background: "#3b82f6" }}
                    >
                      {verifyChannelMutation.isPending
                        ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                        : <span className="text-white font-semibold text-sm">Verify Channel</span>}
                    </button>
                  )}
                  {verifyMsg && (
                    <p className={`text-xs mt-2 font-medium ${verifyMsg.ok ? "text-green-400" : "text-red-400"}`}>{verifyMsg.text}</p>
                  )}
                </div>
              )}

              {/* Custom Promo Code Name */}
              <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
                <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">{t("custom_promo_name")}</p>

                <div className="flex items-center justify-between py-2 border-b border-white/5 mb-3">
                  <div>
                    <p className="text-white text-sm font-semibold">{t("current_prefix_label")}</p>
                    <p className="text-[#888] text-xs mt-0.5">{t("used_as_code_prefix")}</p>
                  </div>
                  <span className="text-white font-black tracking-widest">{promoPrefix}</span>
                </div>

                {amb.customPromoRequest && (
                  <div className="flex items-center justify-between py-2 border-b border-white/5 mb-3">
                    <div>
                      <p className="text-white text-sm font-semibold">{t("requested_name_label")}</p>
                      <p className="text-[#888] text-xs mt-0.5">{amb.customPromoRequest}</p>
                    </div>
                    <Badge className={
                      amb.customPromoRequestStatus === "approved"
                        ? "bg-green-600/20 text-green-400 border-green-600/30"
                        : amb.customPromoRequestStatus === "rejected"
                        ? "bg-red-600/20 text-red-400 border-red-600/30"
                        : "bg-yellow-600/20 text-yellow-400 border-yellow-600/30"
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
                      className="flex-1 h-11 rounded-xl px-3 text-white text-sm font-mono focus:outline-none"
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    <button
                      onClick={() => promoNameMutation.mutate(customPromoInput)}
                      disabled={customPromoInput.length < 3 || promoNameMutation.isPending}
                      className="h-11 px-4 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
                      style={{ background: "#3b82f6" }}
                    >
                      {promoNameMutation.isPending
                        ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                        : <span className="text-white font-semibold text-sm">{t("request_label")}</span>}
                    </button>
                  </div>
                )}
              </div>

              {/* Posting Mode + Schedule */}
              <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-[#3b82f6]" />
                  <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">{t("posting_schedule_label")}</p>
                </div>

                {/* Mode toggle */}
                <div className="flex rounded-xl overflow-hidden mb-4" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                  {(["automatic", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPostingMode(m)}
                      className="flex-1 h-10 flex items-center justify-center gap-1.5 text-xs font-semibold transition-all"
                      style={{
                        background: postingMode === m ? "rgba(59,130,246,0.2)" : "transparent",
                        color: postingMode === m ? "#3b82f6" : "#555",
                      }}
                    >
                      {m === "automatic" ? <Clock className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>

                {postingMode === "automatic" ? (
                  <>
                    <p className="text-[#555] text-xs mb-4 leading-relaxed">
                      {t("posting_schedule_desc")}
                    </p>
                    <div className="space-y-2 mb-3">
                      {scheduleSlots.map((time, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={time}
                            onChange={(e) =>
                              setScheduleSlots(prev => prev.map((v, i) => i === idx ? e.target.value : v))
                            }
                            className="flex-1 h-10 rounded-xl px-3 text-white text-sm focus:outline-none"
                            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
                          />
                          <button
                            onClick={() => setScheduleSlots(prev => prev.filter((_, i) => i !== idx))}
                            className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
                            style={{ background: "rgba(239,68,68,0.10)" }}
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {scheduleSlots.length < 3 && (
                      <button
                        onClick={() => setScheduleSlots(prev => [...prev, "12:00"])}
                        className="w-full h-10 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform mb-3"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)" }}
                      >
                        <Plus className="w-4 h-4 text-white/30" />
                        <span className="text-white/30 text-xs">{t("add_time_slot")}</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="mb-4">
                    <p className="text-[#555] text-xs mb-4 leading-relaxed">{t("post_promo_desc")}</p>
                    {postNowCountdown !== null ? (
                      <div
                        className="w-full h-12 rounded-xl flex items-center justify-center gap-2"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <Timer className="w-4 h-4 text-[#888]" />
                        <span className="text-[#888] text-sm font-semibold">
                          {t("next_post_in")}{" "}
                          {String(Math.floor(postNowCountdown / 3600000)).padStart(2, "0")}:
                          {String(Math.floor((postNowCountdown % 3600000) / 60000)).padStart(2, "0")}:
                          {String(Math.floor((postNowCountdown % 60000) / 1000)).padStart(2, "0")}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => postNowMutation.mutate()}
                        disabled={postNowMutation.isPending}
                        className="w-full h-12 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40"
                        style={{ background: "#3b82f6" }}
                      >
                        {postNowMutation.isPending
                          ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                          : <>
                              <Zap className="w-4 h-4 text-white" />
                              <span className="text-white font-semibold text-sm">{t("post_now")}</span>
                            </>}
                      </button>
                    )}
                  </div>
                )}

                {/* Require channel join toggle */}
                <div
                  className="flex items-center justify-between py-3 mb-4"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div>
                    <p className="text-white text-sm font-semibold">{t("require_channel_join")}</p>
                    <p className="text-[#555] text-xs mt-0.5">{t("require_channel_join_desc")}</p>
                  </div>
                  <button
                    onClick={() => setRequireChannelJoin(prev => !prev)}
                    className="relative w-12 h-6 rounded-full transition-all flex-shrink-0"
                    style={{
                      background: requireChannelJoin ? "#3b82f6" : "rgba(255,255,255,0.1)",
                      border: requireChannelJoin ? "1.5px solid rgba(59,130,246,0.5)" : "1.5px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                      style={{
                        background: "#fff",
                        left: requireChannelJoin ? "calc(100% - 18px)" : "2px",
                      }}
                    />
                  </button>
                </div>

                <button
                  onClick={() => scheduleMutation.mutate()}
                  disabled={scheduleMutation.isPending || (postingMode === "automatic" && scheduleSlots.length === 0)}
                  className="w-full h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40"
                  style={{ background: "#3b82f6" }}
                >
                  {scheduleMutation.isPending
                    ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                    : <>
                        <CheckCircle2 className="w-4 h-4 text-white" />
                        <span className="text-white font-semibold text-sm">{t("save_schedule_btn")}</span>
                      </>}
                </button>
              </div>
            </>
          )}

          {/* ── Tab 2: Promo Codes ── */}
          {ambActiveTab === 'promos' && (
            <>
              {/* Claim History */}
              <div className="mb-3">
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="w-full h-12 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-transform"
                  style={{ background: "#3b82f6" }}
                >
                  <Scroll className="w-4 h-4 text-white" />
                  <span className="text-white font-bold text-sm">{t("claim_history_label")}</span>
                </button>
              </div>

              {/* Promo Codes List */}
              {dashLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
                </div>
              ) : (dashboard?.promoCodeHistory?.length ?? 0) === 0 ? (
                <div className="rounded-2xl p-6 text-center" style={{ background: SECTION_BG }}>
                  <Scroll className="w-10 h-10 text-white/20 mx-auto mb-2" />
                  <p className="text-white/40 text-sm">{t("no_promo_codes_yet")}</p>
                  <p className="text-white/25 text-xs mt-1">{t("codes_appear_once_posted")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {dashboard!.promoCodeHistory.map((pc) => {
                    const rewardPow = parseInt(pc.rewardAmount || "0");
                    const maxClaims = pc.usageLimit;
                    const claimsUsed = pc.usageCount ?? 0;
                    const remaining = pc.remainingClaims;
                    const totalRewarded = Math.round(parseFloat(pc.totalRewardsDistributed || "0"));
                    return (
                      <div key={pc.promoCode} className="rounded-2xl overflow-hidden" style={{ background: SECTION_BG }}>
                        {/* Code header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                          <span className="font-mono text-white text-sm font-bold">{pc.promoCode}</span>
                          <span className={`text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                            pc.status === "active"
                              ? "bg-green-500/15 text-green-400"
                              : "bg-white/10 text-white/40"
                          }`}>{pc.status}</span>
                        </div>

                        {/* Stats */}
                        <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                          <div>
                            <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Reward / Claim</p>
                            <p className="text-white text-sm font-bold mt-0.5">{rewardPow.toLocaleString()} POW</p>
                          </div>
                          <div>
                            <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Claim Limit</p>
                            <p className="text-white text-sm font-bold mt-0.5">{maxClaims !== null ? maxClaims.toLocaleString() : "∞"}</p>
                          </div>
                          <div>
                            <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Total Claims</p>
                            <p className="text-white text-sm font-bold mt-0.5">{claimsUsed.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Remaining</p>
                            <p className={`text-sm font-bold mt-0.5 ${remaining !== null && remaining === 0 ? "text-red-400" : "text-white"}`}>
                              {remaining !== null ? remaining.toLocaleString() : "∞"}
                            </p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Total Distributed</p>
                            <p className="text-[#3b82f6] text-sm font-bold mt-0.5">{totalRewarded.toLocaleString()} POW</p>
                          </div>
                          {pc.expiresAt && (
                            <div className="col-span-2">
                              <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Expires</p>
                              <p className="text-white/60 text-sm font-semibold mt-0.5">
                                {new Date(pc.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </p>
                            </div>
                          )}
                          <div className="col-span-2">
                            <p className="text-[#555] text-[10px] font-semibold uppercase tracking-wider">Created</p>
                            <p className="text-white/60 text-sm font-semibold mt-0.5">
                              {new Date(pc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

        </main>

        {/* Claim History Drawer */}
        <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
          <DrawerContent className="border-none max-h-[85vh]" style={{ background: SECTION_BG }}>
            <DrawerHeader className="flex items-center justify-between pb-2">
              <DrawerTitle className="text-white font-bold text-lg">{t("claim_history_label")}</DrawerTitle>
              <DrawerClose asChild>
                <button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">
                  {t("close_label")}
                </button>
              </DrawerClose>
            </DrawerHeader>

            <div className="px-4 pb-6 overflow-y-auto">
              {dashLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
                </div>
              ) : (dashboard?.promoCodeHistory?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Scroll className="w-10 h-10 text-white/20" />
                  <p className="text-white/40 text-sm">{t("no_promo_codes_yet")}</p>
                  <p className="text-white/25 text-xs">{t("codes_appear_once_posted")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {dashboard?.promoCodeHistory?.map((item) => {
                    const isExpanded = expandedCode === item.promoCode;
                    return (
                      <div key={item.promoCode} className="rounded-xl overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        {/* Promo code header row — tap to expand */}
                        <button
                          className="w-full flex items-center justify-between px-3 py-3 active:bg-white/5 transition-colors"
                          onClick={() => setExpandedCode(isExpanded ? null : item.promoCode)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-white/40 flex-shrink-0" />}
                            <div className="min-w-0 text-left">
                              <p className="text-white text-xs font-mono font-bold">{item.promoCode}</p>
                              <p className="text-[#666] text-[10px] mt-0.5">
                                Created {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                            <div className="text-right">
                              <p className="text-white text-xs font-semibold">{item.totalClaims} user{item.totalClaims !== 1 ? "s" : ""}</p>
                              <p className="text-green-400 text-[10px] font-bold">+${item.totalEarnings}</p>
                            </div>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              item.status === "active"
                                ? "bg-green-500/15 text-green-400"
                                : "bg-white/10 text-white/40"
                            }`}>
                              {item.status}
                            </span>
                          </div>
                        </button>

                        {/* Expanded: per-user claims */}
                        {isExpanded && (
                          <div className="border-t border-white/5 px-3 pb-2">
                            {/* Stats rows */}
                            <div className="py-2 border-b border-white/5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">{t("reward_per_claim")}</span>
                                <span className="text-white font-semibold">{parseInt(item.rewardAmount || "0").toLocaleString()} POW</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Max Claims</span>
                                <span className="text-white font-semibold">{item.usageLimit !== null ? item.usageLimit?.toLocaleString() : "∞"}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Claims Used</span>
                                <span className="text-white font-semibold">{(item.usageCount ?? 0).toLocaleString()}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[#888]">Remaining</span>
                                <span className={`font-semibold ${item.remainingClaims === 0 ? "text-red-400" : "text-white"}`}>
                                  {item.remainingClaims !== null ? item.remainingClaims?.toLocaleString() : "∞"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between col-span-2">
                                <span className="text-[#888]">Total Distributed</span>
                                <span className="text-purple-400 font-semibold">{Math.round(parseFloat(item.totalRewardsDistributed || "0")).toLocaleString()} POW</span>
                              </div>
                            </div>
                            {item.claims.length === 0 ? (
                              <p className="text-white/25 text-xs py-3 text-center">{t("no_claims_yet")}</p>
                            ) : (
                              <>
                                <div className="grid grid-cols-3 gap-1 pt-2 pb-1">
                                  <span className="text-[#555] text-[9px] font-semibold uppercase tracking-wider">{t("table_user")}</span>
                                  <span className="text-[#555] text-[9px] font-semibold uppercase tracking-wider text-center">{t("table_date_time")}</span>
                                  <span className="text-[#555] text-[9px] font-semibold uppercase tracking-wider text-right">{t("table_reward")}</span>
                                </div>
                                <div className="space-y-0">
                                  {item.claims.map((claim) => (
                                    <div key={claim.id} className="grid grid-cols-3 gap-1 items-center py-1.5 border-b border-white/5 last:border-none">
                                      <p className="text-[#aaa] text-[10px] truncate">
                                        {claim.username ? `@${claim.username}` : claim.firstName || "User"}
                                      </p>
                                      <p className="text-[#666] text-[10px] text-center">
                                        {new Date(claim.claimedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                                        {new Date(claim.claimedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                      </p>
                                      <p className="text-green-400 text-[10px] font-bold text-right">
                                        {parseInt(claim.rewardGranted || "10000").toLocaleString()} POW
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DrawerContent>
        </Drawer>
      </Layout>
    );
  }

  // ── Application Form ───────────────────────────────────────────────────────
  const canSubmit = channelLink.trim().length > 0 && channelAdded && termsAccepted;

  return (
    <Layout>
      <main className="max-w-md mx-auto px-4 pt-4 pb-8 bg-black">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white tracking-tight mb-2">
            {t("ambassador_program_title")}
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            {t("ambassador_program_desc")}
          </p>
        </div>

        {/* How It Works button */}
        <button
          onClick={() => setHowItWorksOpen(true)}
          className="w-full h-14 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-transform mb-4"
          style={{ background: "rgba(255,255,255,0.12)" }}
        >
          <Info className="w-5 h-5 text-white/70" />
          <span className="text-white font-bold tracking-widest text-sm">{t("how_it_works_title")}</span>
        </button>

        {/* Apply Now */}
        <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">{t("apply_now_label")}</p>

          {/* Channel link */}
          <div className="mb-4">
            <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              {t("telegram_channel_link")}
            </label>
            <input
              type="text"
              value={channelLink}
              onChange={(e) => {
                setChannelLink(e.target.value);
                // Reset verification state when the channel link changes
                if (channelAdded || preVerifyResult) {
                  setChannelAdded(false);
                  setPreVerifyResult(null);
                }
              }}
              placeholder="t.me/yourchannel or @yourchannel"
              className="w-full h-11 rounded-xl px-3 text-white text-sm focus:outline-none"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>

          {/* Channel Setup step */}
          <div className="border-t border-white/5 pt-4 mb-4">
            <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">{t("channel_verification_label")}</p>

            {channelAdded ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 py-2 px-3 rounded-xl" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-green-400 text-sm font-semibold">{t("channel_verified_label")}</p>
                    <p className="text-[#888] text-xs mt-0.5">{t("bot_has_permission")}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setChannelAdded(false); setPreVerifyResult(null); }}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {t("use_different_channel")}
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(234,179,8,0.08)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 text-sm font-semibold">{t("required_add_bot_admin")}</p>
                      <p className="text-[#888] text-xs mt-1 leading-relaxed">
                        {t("bot_admin_instructions_pre")}{" "}
                        <span className="text-white font-semibold">@Paid_Adzbot</span> {t("bot_admin_instructions_mid")}{" "}
                        <span className="text-white font-semibold">{t("post_messages_permission_label")}</span> {t("bot_admin_instructions_post")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Pre-verify result message */}
                {preVerifyResult && !preVerifyResult.ok && (
                  <div className="rounded-xl p-3 mb-3 flex items-start gap-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-400 text-xs leading-relaxed">{preVerifyResult.text}</p>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (!channelLink.trim()) {
                      setPreVerifyResult({ ok: false, text: "Enter your channel link above first." });
                      return;
                    }
                    setPreVerifyResult(null);
                    preVerifyMutation.mutate(channelLink.trim());
                  }}
                  disabled={preVerifyMutation.isPending}
                  className="w-full h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
                  style={{ background: "rgba(59,130,246,0.18)", border: "1px solid rgba(59,130,246,0.3)" }}
                >
                  {preVerifyMutation.isPending ? (
                    <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  ) : (
                    <UserCheck className="w-4 h-4 text-blue-400" />
                  )}
                  <span className="text-blue-400 font-semibold text-sm">
                    {preVerifyMutation.isPending ? t("verifying_ellipsis") : t("verify_channel_btn")}
                  </span>
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
                background: termsAccepted ? "#3b82f6" : "rgba(255,255,255,0.08)",
                border: termsAccepted ? "none" : "1px solid rgba(255,255,255,0.2)",
              }}
            >
              {termsAccepted && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
            </div>
            <span className="text-[#888] text-xs leading-relaxed">
              I agree to post only legitimate promotional content and to maintain bot admin permissions for auto-posting to work.
            </span>
          </label>
        </div>

        {/* Submit */}
        <button
          onClick={() => applyMutation.mutate({ channelLink, termsAccepted })}
          disabled={!canSubmit || applyMutation.isPending}
          className="w-full h-14 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 mb-4"
          style={{ background: "rgba(255,255,255,0.12)" }}
        >
          {applyMutation.isPending
            ? <Loader2 className="w-5 h-5 text-white animate-spin" />
            : <Send className="w-5 h-5 text-white/70" />}
          <span className="text-white font-bold tracking-widest text-sm">
            {applyMutation.isPending ? t("submitting_ellipsis") : t("submit_application_btn")}
          </span>
        </button>

        {/* Requirements */}
        <div className="rounded-2xl p-4" style={{ background: SECTION_BG }}>
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-2">{t("requirements_label")}</p>
          <div className="space-y-1.5">
            {[
              t("req_active_channel"),
              t("req_add_bot_admin"),
              t("req_post_messages"),
              t("req_genuine_followers"),
            ].map((req, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400/50 flex-shrink-0" />
                <span className="text-[#888] text-xs">{req}</span>
              </div>
            ))}
          </div>
        </div>

      </main>

      {HowItWorksDrawer}
    </Layout>
  );
}
