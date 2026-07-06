import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import {
  CheckCircle2, XCircle, Loader2,
  Scroll, Shield, AlertTriangle, Send, Info, UserCheck,
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
  activePromos: any[];
}

export default function Ambassador() {
  const queryClient = useQueryClient();
  const [channelLink, setChannelLink] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [channelAdded, setChannelAdded] = useState(false);
  const [customPromoInput, setCustomPromoInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<AmbassadorStatus>({
    queryKey: ["/api/ambassador/status"],
    retry: false,
  });

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["/api/ambassador/dashboard"],
    retry: false,
    enabled: status?.isAmbassador === true,
  });

  const amb = dashboard?.ambassador ?? status?.ambassador;
  const stats = dashboard?.stats;

  // ── Mutations ────────────────────────────────────────────────────────────────

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

  const verifyChannelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ambassador/verify-channel", {}),
    onSuccess: (data: any) => {
      if (data.verified) {
        showNotification(data.message || "Channel verified!", "success");
      } else {
        showNotification(data.message || "Verification failed", "error");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
    },
    onError: (e: any) => showNotification(e?.message || "Verification failed", "error"),
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
            { n: 3, color: "#3b82f6", bg: "rgba(59,130,246,0.15)", title: "Auto-posting begins", sub: "Unique promo codes posted to your channel every 4 hours" },
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
    const isVerified = amb.channelVerified;

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

          {/* Channel Verification */}
          <div className="rounded-2xl p-4 mb-3" style={{ background: SECTION_BG }}>
            <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Channel Setup</p>

            {isVerified ? (
              <div className="flex items-center gap-3 py-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(34,197,94,0.15)" }}>
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">Channel Verified</p>
                  <p className="text-[#888] text-xs mt-0.5">Auto-posting is enabled to your channel</p>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(234,179,8,0.08)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 text-sm font-semibold">Bot Admin Required</p>
                      <p className="text-[#888] text-xs mt-1 leading-relaxed">
                        Add <span className="text-white font-semibold">@Paid_Adzbot</span> as an administrator in your channel with permission to <span className="text-white font-semibold">Post Messages</span>.
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => verifyChannelMutation.mutate()}
                  disabled={verifyChannelMutation.isPending}
                  className="w-full h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
                  style={{ background: "rgba(59,130,246,0.18)", border: "1px solid rgba(59,130,246,0.3)" }}
                >
                  {verifyChannelMutation.isPending
                    ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                    : <Shield className="w-4 h-4 text-blue-400" />}
                  <span className="text-blue-400 font-semibold text-sm">Verify Bot Permission</span>
                </button>
                {verifyChannelMutation.data && !(verifyChannelMutation.data as any).verified && (
                  <p className="text-red-400 text-xs mt-2 text-center">
                    {(verifyChannelMutation.data as any).message}
                  </p>
                )}
              </>
            )}
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

        </main>

        {/* Claim History Drawer */}
        <Drawer open={historyOpen} onOpenChange={setHistoryOpen}>
          <DrawerContent className="border-none max-h-[80vh]" style={{ background: SECTION_BG }}>
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
                  <div className="text-white/40 text-sm">Loading…</div>
                </div>
              ) : (dashboard?.promoHistory?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Scroll className="w-10 h-10 text-white/20" />
                  <p className="text-white/40 text-sm">No claims yet</p>
                  <p className="text-white/25 text-xs">Start posting to get your first claim</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 pb-2 border-b border-white/10 mb-2">
                    <span className="text-[#888] text-xs font-semibold uppercase tracking-wider">Code</span>
                    <span className="text-[#888] text-xs font-semibold uppercase tracking-wider text-center">User</span>
                    <span className="text-[#888] text-xs font-semibold uppercase tracking-wider text-right">Earned</span>
                  </div>

                  <div className="space-y-1">
                    {dashboard?.promoHistory?.map((item) => (
                      <div key={item.id} className="grid grid-cols-3 gap-2 items-center py-2.5 border-b border-white/5">
                        <div className="min-w-0">
                          <p className="text-white text-xs font-mono font-bold truncate">{item.promoCode}</p>
                          <p className="text-[#666] text-[10px] mt-0.5">
                            {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <div className="flex justify-center">
                          <p className="text-[#888] text-xs truncate">
                            {item.claimUserUsername ? `@${item.claimUserUsername}` : "User"}
                          </p>
                        </div>
                        <div className="flex justify-end">
                          <span className="text-green-400 text-xs font-bold">
                            +${parseFloat(item.commissionUsd).toFixed(4)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <p className="text-[#666] text-xs mt-4 text-center">
                    {dashboard?.promoHistory?.length} claim{(dashboard?.promoHistory?.length ?? 0) !== 1 ? "s" : ""}
                  </p>
                </>
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
              onChange={(e) => setChannelLink(e.target.value)}
              placeholder="t.me/yourchannel or @yourchannel"
              className="w-full h-11 rounded-xl px-3 text-white text-sm focus:outline-none"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>

          {/* Channel Setup step */}
          <div className="border-t border-white/5 pt-4 mb-4">
            <p className="text-[#888] text-xs font-semibold uppercase tracking-wider mb-3">Channel Setup</p>

            {channelAdded ? (
              <div className="flex items-center gap-3 py-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(34,197,94,0.15)" }}>
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">Bot Added</p>
                  <p className="text-[#888] text-xs mt-0.5">@Paid_Adzbot is set as admin in your channel</p>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(234,179,8,0.08)" }}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 text-sm font-semibold">Required Step</p>
                      <p className="text-[#888] text-xs mt-1 leading-relaxed">
                        Add <span className="text-white font-semibold">@Paid_Adzbot</span> as an administrator in your channel with permission to <span className="text-white font-semibold">Post Messages</span>, then confirm below.
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setChannelAdded(true)}
                  className="w-full h-11 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: "rgba(59,130,246,0.18)", border: "1px solid rgba(59,130,246,0.3)" }}
                >
                  <UserCheck className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-400 font-semibold text-sm">I've Added the Bot as Admin</span>
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
