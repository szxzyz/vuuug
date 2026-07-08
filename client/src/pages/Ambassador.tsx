import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import {
  CheckCircle2, XCircle, Loader2,
  Scroll, AlertTriangle, Send, Info, UserCheck, ChevronDown, ChevronRight,
  Clock, Plus, Trash2,
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
  const [channelLink, setChannelLink] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [channelAdded, setChannelAdded] = useState(false);
  const [preVerifyResult, setPreVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [customPromoInput, setCustomPromoInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [scheduleSlots, setScheduleSlots] = useState<string[]>(["06:30", "18:30"]);

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

  // Sync schedule slots from server data once when ambassador data first loads
  const ambId = (amb as any)?.id as string | undefined;
  useEffect(() => {
    const raw = (amb as any)?.postingSchedule;
    if (!raw) return;
    try {
      const parsed: string[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setScheduleSlots(parsed);
      }
    } catch {}
    // Only run when the ambassador record changes (by id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambId]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const scheduleMutation = useMutation({
    mutationFn: (times: string[]) =>
      apiRequest("POST", "/api/ambassador/schedule", { postingTimes: times }).then((r: any) => r.json()),
    onSuccess: () => {
      showNotification("Schedule saved!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
    },
    onError: (e: any) => showNotification(e?.message || "Failed to save schedule", "error"),
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
      showNotification("Application submitted! We'll review it soon.", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
    },
    onError: (e: any) => showNotification(e?.message || "Failed to submit application", "error"),
  });

  const promoNameMutation = useMutation({
    mutationFn: (promoCodeName: string) =>
      apiRequest("POST", "/api/ambassador/request-promo-name", { promoCodeName }),
    onSuccess: () => {
      showNotification("Custom name request submitted for review!", "success");
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
          <DrawerTitle className="text-white font-bold text-lg">How It Works</DrawerTitle>
          <DrawerClose asChild>
            <button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">
              Close
            </button>
          </DrawerClose>
        </DrawerHeader>
        <div className="px-4 pb-6 overflow-y-auto space-y-1">
          {[
            { n: 1, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: "Apply with your channel", sub: "Submit your Telegram channel link for review" },
            { n: 2, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: "Add bot as admin", sub: "Grant @Paid_Adzbot posting permission in your channel" },
            { n: 3, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: "Auto-posting begins", sub: "2 promo posts per day, every 12 hours, with 2 unique codes each" },
            { n: 4, color: "#22c55e", bg: "rgba(34,197,94,0.15)", title: "Earn per claim", sub: "Get $0.0001 for every successful claim" },
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
              Under Review
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              Your application is being reviewed. We'll notify you via{" "}
              <span className="text-white font-semibold">Telegram</span> once a decision is made.
            </p>
          </div>

          <div className="rounded-2xl p-4" style={{ background: SECTION_BG }}>
            <div className="flex items-center justify-between py-2 border-b border-white/5">
              <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">Channel</p>
              <p className="text-white text-sm font-medium">{status.application.channelLink}</p>
            </div>
            {status.application.channelTitle && (
              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">Title</p>
                <p className="text-white text-sm font-medium">{status.application.channelTitle}</p>
              </div>
            )}
            {status.application.subscriberCount && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">Subscribers</p>
                <p className="text-white text-sm font-medium">{status.application.subscriberCount.toLocaleString()}</p>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-2xl p-4 flex items-center gap-3" style={{ background: "rgba(234,179,8,0.08)" }}>
            <Loader2 className="w-5 h-5 text-yellow-400 animate-spin flex-shrink-0" />
            <p className="text-yellow-400 text-sm font-medium">Review in progress — typically within 24 hours</p>
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
              Not Approved
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              {status.application.rejectionReason
                ? <><span className="text-white font-semibold">Reason: </span>{status.application.rejectionReason}</>
                : "Your application was not approved at this time. You may reapply."}
            </p>
          </div>

          <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(239,68,68,0.08)" }}>
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm font-medium">Application rejected</p>
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
            <span className="text-white font-semibold text-sm">Apply Again</span>
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
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">
              Ambassador Dashboard
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              Your code prefix is{" "}
              <span className="text-white font-semibold">{promoPrefix}</span>.
              Earn <span className="text-white font-semibold">$0.0001</span> for every claim.
            </p>
          </div>

          {/* Claim History button */}
          <div className="mb-4">
            <button
              onClick={() => setHistoryOpen(true)}
              className="w-full h-14 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-transform"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <Scroll className="w-5 h-5 text-white/70" />
              <span className="text-white font-bold tracking-widest text-sm">Claim History</span>
            </button>
          </div>

          {/* Statistics */}
          <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
            <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Statistics</p>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <p className="text-white text-sm font-semibold">Total Promo Earnings</p>
                <p className="text-[#888] text-xs mt-0.5">All-time commissions earned</p>
              </div>
              {dashLoading ? <StatSkeleton /> : (
                <span className="text-green-400 text-lg font-black">
                  ${totalEarnings > 0 ? totalEarnings.toFixed(4) : "0.0000"}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <p className="text-white text-sm font-semibold">Total Promo Claims</p>
                <p className="text-[#888] text-xs mt-0.5">All users who claimed your code</p>
              </div>
              {dashLoading ? <StatSkeleton /> : (
                <span className="text-white text-xl font-black">{stats?.lifetimeClaims ?? 0}</span>
              )}
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <p className="text-white text-sm font-semibold">Active Promo Codes</p>
                <p className="text-[#888] text-xs mt-0.5">Currently valid codes</p>
              </div>
              {dashLoading ? <StatSkeleton /> : (
                <span className="text-white text-xl font-black">{dashboard?.activePromos?.length ?? 0}</span>
              )}
            </div>

            <div className="flex items-center justify-between pt-3">
              <div>
                <p className="text-white text-sm font-semibold">Today's Claims</p>
                <p className="text-[#888] text-xs mt-0.5">Claims in the last 24 hours</p>
              </div>
              {dashLoading ? <StatSkeleton /> : (
                <span className="text-white text-xl font-black">{stats?.todayClaims ?? 0}</span>
              )}
            </div>
          </div>

          {/* Custom Promo Code */}
          <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
            <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Custom Promo Name</p>

            <div className="flex items-center justify-between py-2 border-b border-white/5 mb-3">
              <div>
                <p className="text-white text-sm font-semibold">Current Prefix</p>
                <p className="text-[#888] text-xs mt-0.5">Used as code prefix</p>
              </div>
              <span className="text-white font-black tracking-widest">{promoPrefix}</span>
            </div>

            {amb.customPromoRequest && (
              <div className="flex items-center justify-between py-2 border-b border-white/5 mb-3">
                <div>
                  <p className="text-white text-sm font-semibold">Requested Name</p>
                  <p className="text-[#888] text-xs mt-0.5">{amb.customPromoRequest}</p>
                </div>
                <Badge className={
                  amb.customPromoRequestStatus === "approved"
                    ? "bg-green-600/20 text-green-400 border-green-600/30"
                    : amb.customPromoRequestStatus === "rejected"
                    ? "bg-red-600/20 text-red-400 border-red-600/30"
                    : "bg-yellow-600/20 text-yellow-400 border-yellow-600/30"
                }>
                  {amb.customPromoRequestStatus === "approved" ? "Approved" :
                   amb.customPromoRequestStatus === "rejected" ? "Rejected" : "Pending"}
                </Badge>
              </div>
            )}

            {(!amb.customPromoRequest || amb.customPromoRequestStatus === "rejected") && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPromoInput}
                  onChange={(e) => setCustomPromoInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="E.g. MYCHAIN"
                  maxLength={20}
                  className="flex-1 h-11 rounded-xl px-3 text-white text-sm font-mono focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
                />
                <button
                  onClick={() => promoNameMutation.mutate(customPromoInput)}
                  disabled={customPromoInput.length < 3 || promoNameMutation.isPending}
                  className="h-11 px-4 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.12)" }}
                >
                  {promoNameMutation.isPending
                    ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                    : <span className="text-white font-semibold text-sm">Request</span>}
                </button>
              </div>
            )}
          </div>

          {/* Posting Schedule */}
          <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-[#4cd3ff]" />
              <p className="text-[#888] text-xs font-semibold uppercase tracking-wider">Posting Schedule (UTC)</p>
            </div>
            <p className="text-[#555] text-xs mb-4 leading-relaxed">
              Set the UTC times when promos are auto-posted to your channel every day.
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

            {scheduleSlots.length < 10 && (
              <button
                onClick={() => setScheduleSlots(prev => [...prev, "12:00"])}
                className="w-full h-10 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform mb-3"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)" }}
              >
                <Plus className="w-4 h-4 text-white/30" />
                <span className="text-white/30 text-xs">Add Time Slot</span>
              </button>
            )}

            <button
              onClick={() => scheduleMutation.mutate(scheduleSlots)}
              disabled={scheduleMutation.isPending || scheduleSlots.length === 0}
              className="w-full h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40"
              style={{ background: "rgba(76,211,255,0.12)", border: "1px solid rgba(76,211,255,0.22)" }}
            >
              {scheduleMutation.isPending
                ? <Loader2 className="w-4 h-4 text-[#4cd3ff] animate-spin" />
                : <>
                    <CheckCircle2 className="w-4 h-4 text-[#4cd3ff]" />
                    <span className="text-[#4cd3ff] font-semibold text-sm">Save Schedule</span>
                  </>}
            </button>
          </div>

        </main>

        {/* Claim History Drawer */}
        <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
          <DrawerContent className="border-none max-h-[85vh]" style={{ background: SECTION_BG }}>
            <DrawerHeader className="flex items-center justify-between pb-2">
              <DrawerTitle className="text-white font-bold text-lg">Claim History</DrawerTitle>
              <DrawerClose asChild>
                <button className="text-white/50 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-white/10 transition-colors">
                  Close
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
                  <p className="text-white/40 text-sm">No promo codes yet</p>
                  <p className="text-white/25 text-xs">Your codes will appear here once posted</p>
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
                            {/* Reward info row */}
                            <div className="py-2 border-b border-white/5 flex items-center justify-between">
                              <span className="text-[#888] text-[10px]">Reward per claim</span>
                              <span className="text-white text-[10px] font-semibold">
                                {parseInt(item.rewardAmount || "10000").toLocaleString()} POW
                              </span>
                            </div>
                            {item.claims.length === 0 ? (
                              <p className="text-white/25 text-xs py-3 text-center">No claims yet</p>
                            ) : (
                              <>
                                <div className="grid grid-cols-3 gap-1 pt-2 pb-1">
                                  <span className="text-[#555] text-[9px] font-semibold uppercase tracking-wider">User</span>
                                  <span className="text-[#555] text-[9px] font-semibold uppercase tracking-wider text-center">Date &amp; Time</span>
                                  <span className="text-[#555] text-[9px] font-semibold uppercase tracking-wider text-right">Reward</span>
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
            Ambassador Program
          </h1>
          <p className="text-[#888] text-sm leading-relaxed">
            Promote Paid Adz on your Telegram channel and earn{" "}
            <span className="text-white font-semibold">$0.0001</span>{" "}
            for every user who claims your promo code.
          </p>
        </div>

        {/* How It Works button */}
        <button
          onClick={() => setHowItWorksOpen(true)}
          className="w-full h-14 rounded-full flex items-center justify-center gap-3 active:scale-95 transition-transform mb-4"
          style={{ background: "rgba(255,255,255,0.12)" }}
        >
          <Info className="w-5 h-5 text-white/70" />
          <span className="text-white font-bold tracking-widest text-sm">How It Works</span>
        </button>

        {/* Apply Now */}
        <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Apply Now</p>

          {/* Channel link */}
          <div className="mb-4">
            <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Telegram Channel Link
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
            <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Channel Verification</p>

            {channelAdded ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 py-2 px-3 rounded-xl" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-green-400 text-sm font-semibold">Channel Verified</p>
                    <p className="text-[#888] text-xs mt-0.5">@Paid_Adzbot has Post Messages permission ✓</p>
                  </div>
                </div>
                <button
                  onClick={() => { setChannelAdded(false); setPreVerifyResult(null); }}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Use a different channel
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(234,179,8,0.08)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 text-sm font-semibold">Required: Add Bot as Admin</p>
                      <p className="text-[#888] text-xs mt-1 leading-relaxed">
                        In your Telegram channel settings, add{" "}
                        <span className="text-white font-semibold">@Paid_Adzbot</span> as administrator with{" "}
                        <span className="text-white font-semibold">Post Messages</span> permission enabled.
                        Then click Verify below.
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
                    {preVerifyMutation.isPending ? "Verifying…" : "Verify Channel"}
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
            {applyMutation.isPending ? "Submitting…" : "Submit Application"}
          </span>
        </button>

        {/* Requirements */}
        <div className="rounded-2xl p-4" style={{ background: SECTION_BG }}>
          <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-2">Requirements</p>
          <div className="space-y-1.5">
            {[
              "Active Telegram channel",
              "Add @Paid_Adzbot as admin",
              "Permission to post messages",
              "Genuine followers (no bots)",
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
