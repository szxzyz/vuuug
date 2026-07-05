import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { showNotification } from "@/components/AppNotification";
import {
  Award, TrendingUp, Copy, Clock, BarChart2,
  CheckCircle2, XCircle, Loader2, Star, Send,
  Users, DollarSign, Calendar, Settings
} from "lucide-react";

// ── Design tokens (matches Missions/Home) ─────────────────────────────────────
const BLUE   = "#3b82f6";
const BLUE_D = "#2563eb";
const TEXT   = "#fff";
const TEXT_DIM  = "rgba(255,255,255,0.35)";
const TEXT_FAINT = "rgba(255,255,255,0.22)";
const CARD   = "rgba(255,255,255,0.07)";
const DIVIDER = "rgba(255,255,255,0.05)";
const ACCENT = "#3b82f6";

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
  }>;
  activePromos: any[];
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 10, marginTop: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.28)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {title}
      </span>
    </div>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px" }}>
      <span style={{ color: TEXT_DIM, fontSize: 13 }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ color: TEXT, fontSize: 14, fontWeight: 700 }}>{value}</span>
        {sub && <div style={{ color: TEXT_FAINT, fontSize: 11, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: DIVIDER, margin: "0 16px" }} />;
}

export default function Ambassador() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [channelLink, setChannelLink] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [customPromoName, setCustomPromoName] = useState("");
  const [showPromoRequest, setShowPromoRequest] = useState(false);

  const { data: statusData, isLoading: statusLoading } = useQuery<AmbassadorStatus>({
    queryKey: ["/api/ambassador/status"],
    retry: false,
  });

  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ["/api/ambassador/dashboard"],
    enabled: statusData?.isAmbassador === true,
    refetchInterval: 30000,
  });

  const applyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ambassador/apply", { channelLink, termsAccepted }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        showNotification("Application submitted! We'll review it shortly.", "success");
        queryClient.invalidateQueries({ queryKey: ["/api/ambassador/status"] });
      } else {
        showNotification(data.message || "Failed to submit application", "error");
      }
    },
    onError: () => showNotification("Failed to submit application", "error"),
  });

  const scheduleMutation = useMutation({
    mutationFn: (count: number) => apiRequest("POST", "/api/ambassador/schedule", { dailyPromoCount: count }).then(r => r.json()),
    onSuccess: () => {
      showNotification("Schedule updated!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
    },
  });

  const promoRequestMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ambassador/request-promo-name", { promoCodeName: customPromoName }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        showNotification("Request submitted for admin review!", "success");
        setShowPromoRequest(false);
        setCustomPromoName("");
        queryClient.invalidateQueries({ queryKey: ["/api/ambassador/dashboard"] });
      } else {
        showNotification(data.message || "Failed to submit request", "error");
      }
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => showNotification("Code copied!", "success")).catch(() => {});
  };

  if (statusLoading) {
    return (
      <Layout>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <Loader2 style={{ width: 22, height: 22, color: BLUE, animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Layout>
    );
  }

  // ── Ambassador Dashboard ───────────────────────────────────────────────────
  if (statusData?.isAmbassador && dashboard?.ambassador) {
    const amb = dashboard.ambassador;
    const stats = dashboard.stats;
    const currentSchedule = amb.dailyPromoCount || 1;

    return (
      <Layout>
        <div style={{ background: "#000", minHeight: "100vh", paddingBottom: 100, color: TEXT }}>
          <div style={{ maxWidth: 440, margin: "0 auto", padding: "16px 16px 0" }}>

            {/* Header */}
            <div style={{ marginBottom: 20 }}>
              <h1 className="text-2xl font-black text-white tracking-tight mb-2">
                Ambassador Dashboard
              </h1>
              <p className="text-[#888] text-sm leading-relaxed">
                Your promo code is{" "}
                <span className="text-white font-semibold">{amb.promoCodeName}</span>.{" "}
                Earn <span className="text-white font-semibold">$0.0001</span> for every successful claim.
              </p>
            </div>

            {/* Promo Code Banner */}
            <div style={{ background: `linear-gradient(135deg, ${BLUE}18, rgba(167,139,250,0.1))`, borderRadius: 18, padding: "18px 18px", marginBottom: 20 }}>
              <div style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                Your Promo Code
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: BLUE, fontFamily: "monospace", letterSpacing: "0.1em" }}>
                  {amb.promoCodeName}
                </span>
                <button
                  onClick={() => copyCode(amb.promoCodeName)}
                  style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.08)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Copy style={{ width: 15, height: 15, color: TEXT_DIM }} />
                </button>
              </div>
              {amb.customPromoRequestStatus === "pending" && (
                <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 8 }}>⏳ Custom name request pending review</div>
              )}
              {amb.lastPromoSentAt && (
                <div style={{ color: TEXT_FAINT, fontSize: 11, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock style={{ width: 11, height: 11 }} />
                  Last sent: {new Date(amb.lastPromoSentAt).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Stats */}
            <SectionLabel title="Stats" />
            <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
              <StatRow label="Today's Claims" value={String(stats.todayClaims)} />
              <Divider />
              <StatRow label="Today's Earnings" value={`$${parseFloat(stats.todayEarnings || "0").toFixed(4)}`} />
              <Divider />
              <StatRow label="This Week" value={String(stats.weekClaims)} sub="claims" />
              <Divider />
              <StatRow label="This Month" value={String(stats.monthClaims)} sub="claims" />
              <Divider />
              <StatRow label="Lifetime Claims" value={String(stats.lifetimeClaims)} />
              <Divider />
              <StatRow label="Total Earnings" value={`$${parseFloat(stats.totalEarnings || "0").toFixed(4)}`} />
            </div>

            {/* Daily Schedule */}
            <SectionLabel title="Daily Promo Schedule" />
            <div style={{ background: CARD, borderRadius: 16, padding: "16px 16px", marginBottom: 20 }}>
              <div style={{ color: TEXT_DIM, fontSize: 12, marginBottom: 12 }}>
                How many promo codes sent to you per day?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    onClick={() => scheduleMutation.mutate(n)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 10, border: "none",
                      background: currentSchedule === n ? `${BLUE}22` : "rgba(255,255,255,0.05)",
                      color: currentSchedule === n ? BLUE : TEXT_DIM,
                      fontSize: 13, fontWeight: 700, cursor: "pointer",
                      outline: currentSchedule === n ? `1.5px solid ${BLUE}55` : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {n}×/day
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Promo Name */}
            <SectionLabel title="Custom Promo Name" />
            <div style={{ background: CARD, borderRadius: 16, padding: "16px 16px", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showPromoRequest ? 12 : 0 }}>
                <span style={{ color: TEXT_DIM, fontSize: 13 }}>
                  {amb.customPromoRequestStatus === "pending" ? "Request pending review" : "Request a different promo code name"}
                </span>
                {amb.customPromoRequestStatus !== "pending" && (
                  <button
                    onClick={() => setShowPromoRequest(!showPromoRequest)}
                    style={{ color: BLUE, fontSize: 12, fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
                  >
                    {showPromoRequest ? "Cancel" : "Request"}
                  </button>
                )}
              </div>
              {showPromoRequest && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    value={customPromoName}
                    onChange={e => setCustomPromoName(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    placeholder="e.g. MYCHANNEL1"
                    maxLength={20}
                    style={{
                      width: "100%", background: "rgba(255,255,255,0.05)", border: "none",
                      borderRadius: 10, padding: "12px 14px", color: TEXT, fontSize: 14,
                      outline: "none", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ color: TEXT_FAINT, fontSize: 11 }}>3–20 letters/numbers only. Requires admin approval.</div>
                  <button
                    onClick={() => promoRequestMutation.mutate()}
                    disabled={customPromoName.length < 3 || promoRequestMutation.isPending}
                    style={{
                      padding: "12px", borderRadius: 12, border: "none",
                      background: customPromoName.length >= 3 ? `linear-gradient(135deg, ${BLUE_D}, ${BLUE})` : "rgba(255,255,255,0.06)",
                      color: customPromoName.length >= 3 ? "#fff" : TEXT_FAINT,
                      fontSize: 14, fontWeight: 700, cursor: customPromoName.length >= 3 ? "pointer" : "not-allowed",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}
                  >
                    {promoRequestMutation.isPending
                      ? <><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> Submitting...</>
                      : "Submit Request"}
                  </button>
                </div>
              )}
            </div>

            {/* Claim History */}
            <SectionLabel title="Claim History" />
            <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
              {dashboard.promoHistory.length === 0 ? (
                <div style={{ padding: "24px 16px", textAlign: "center", color: TEXT_FAINT, fontSize: 13 }}>
                  No claims yet. Share your code!
                </div>
              ) : (
                dashboard.promoHistory.map((entry, i) => (
                  <div key={entry.id}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px" }}>
                      <div>
                        <div style={{ color: BLUE, fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{entry.promoCode}</div>
                        <div style={{ color: TEXT_FAINT, fontSize: 11, marginTop: 2 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                      </div>
                      <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 700 }}>
                        +${parseFloat(entry.commissionUsd).toFixed(4)}
                      </span>
                    </div>
                    {i < dashboard.promoHistory.length - 1 && <Divider />}
                  </div>
                ))
              )}
            </div>

          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Layout>
    );
  }

  // ── Pending Application ────────────────────────────────────────────────────
  if (statusData?.application?.status === "pending") {
    return (
      <Layout>
        <div style={{ background: "#000", minHeight: "100vh", padding: "16px 16px 0", color: TEXT }}>
          <div style={{ maxWidth: 440, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <h1 className="text-2xl font-black text-white tracking-tight mb-2">
                Under Review
              </h1>
              <p className="text-[#888] text-sm leading-relaxed">
                Your Ambassador application is being reviewed.{" "}
                <span className="text-white font-semibold">We'll notify you via Telegram</span>{" "}
                once a decision is made.
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(251,191,36,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Clock style={{ width: 26, height: 26, color: "#fbbf24" }} />
              </div>
            </div>
            <div style={{ background: CARD, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px" }}>
                <span style={{ color: TEXT_DIM, fontSize: 13 }}>Channel</span>
                <span style={{ color: TEXT, fontSize: 13, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {statusData.application.channelLink}
                </span>
              </div>
              {statusData.application.channelTitle && (
                <>
                  <Divider />
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px" }}>
                    <span style={{ color: TEXT_DIM, fontSize: 13 }}>Title</span>
                    <span style={{ color: TEXT, fontSize: 13 }}>{statusData.application.channelTitle}</span>
                  </div>
                </>
              )}
              <Divider />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "13px 16px" }}>
                <span style={{ color: TEXT_DIM, fontSize: 13 }}>Status</span>
                <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(251,191,36,0.15)", color: "#fbbf24", borderRadius: 5, padding: "2px 7px" }}>PENDING</span>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Rejected Application ───────────────────────────────────────────────────
  if (statusData?.application?.status === "rejected") {
    return (
      <Layout>
        <div style={{ background: "#000", minHeight: "100vh", padding: "16px 16px 0", color: TEXT }}>
          <div style={{ maxWidth: 440, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <h1 className="text-2xl font-black text-white tracking-tight mb-2">
                Not Approved
              </h1>
              <p className="text-[#888] text-sm leading-relaxed">
                {statusData.application.rejectionReason
                  ? <><span className="text-white font-semibold">Reason:</span> {statusData.application.rejectionReason}. </>
                  : null}
                You may reapply with a different channel.
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <XCircle style={{ width: 26, height: 26, color: "#f87171" }} />
              </div>
            </div>

            <button
              onClick={() => queryClient.setQueryData(["/api/ambassador/status"], { ...statusData, application: null })}
              style={{
                width: "100%", padding: "14px", borderRadius: 14, border: "none",
                background: `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`,
                color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
                boxShadow: `0 4px 20px ${BLUE}40`,
              }}
            >
              Apply Again
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Application Form ───────────────────────────────────────────────────────
  return (
    <Layout>
      <div style={{ background: "#000", minHeight: "100vh", paddingBottom: 100, color: TEXT }}>
        <div style={{ maxWidth: 440, margin: "0 auto", padding: "16px 16px 0" }}>

          {/* Header — matches Affiliates page style */}
          <div className="mb-6">
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">
              Ambassador Program
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              Promote Paid Adz through your Telegram channel and earn{" "}
              <span className="text-white font-semibold">$0.0001</span>{" "}
              for every successful promo code claim.
            </p>
          </div>

          {/* How it works */}
          <SectionLabel title="How It Works" />
          <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
            {[
              "Submit your Telegram channel link",
              "Our team reviews your application",
              "Get approved & receive your unique promo code",
              "Bot sends promo codes to you daily",
              "Earn $0.0001 for every successful claim",
            ].map((text, i, arr) => (
              <div key={i}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: `${BLUE}22`, color: BLUE, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <span style={{ color: TEXT_DIM, fontSize: 13 }}>{text}</span>
                </div>
                {i < arr.length - 1 && <Divider />}
              </div>
            ))}
          </div>

          {/* Earnings Example */}
          <SectionLabel title="Earnings Example" />
          <div style={{ background: CARD, borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
            {[["100 claims", "$0.01"], ["1,000 claims", "$0.10"], ["10,000 claims", "$1.00"]].map(([claims, earn], i, arr) => (
              <div key={claims}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px" }}>
                  <span style={{ color: TEXT_DIM, fontSize: 13 }}>{claims}</span>
                  <span style={{ color: "#4ade80", fontSize: 14, fontWeight: 700 }}>{earn}</span>
                </div>
                {i < arr.length - 1 && <Divider />}
              </div>
            ))}
          </div>

          {/* Application Form */}
          <SectionLabel title="Application Form" />
          <div style={{ background: CARD, borderRadius: 16, padding: "16px 16px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ color: TEXT_FAINT, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                Telegram Channel Link
              </div>
              <input
                value={channelLink}
                onChange={e => setChannelLink(e.target.value)}
                placeholder="https://t.me/yourchannel or @yourchannel"
                style={{
                  width: "100%", background: "rgba(255,255,255,0.05)", border: "none",
                  borderRadius: 10, padding: "12px 14px", color: TEXT, fontSize: 14,
                  outline: "none", boxSizing: "border-box",
                }}
              />
              <div style={{ color: TEXT_FAINT, fontSize: 11, marginTop: 6 }}>Must be a public Telegram channel you own or manage.</div>
            </div>

            {/* T&C */}
            <div
              onClick={() => setTermsAccepted(!termsAccepted)}
              style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                background: termsAccepted ? BLUE : "rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
              }}>
                {termsAccepted && <CheckCircle2 style={{ width: 13, height: 13, color: "#fff" }} />}
              </div>
              <span style={{ color: TEXT_DIM, fontSize: 13, lineHeight: 1.5 }}>
                I accept the <span style={{ color: BLUE }}>Terms & Conditions</span> of the Paid Adz Ambassador Program.
              </span>
            </div>

            <button
              onClick={() => applyMutation.mutate()}
              disabled={!channelLink.trim() || !termsAccepted || applyMutation.isPending}
              style={{
                width: "100%", padding: "14px", borderRadius: 13, border: "none",
                background: channelLink.trim() && termsAccepted && !applyMutation.isPending
                  ? `linear-gradient(135deg, ${BLUE_D}, ${BLUE})`
                  : "rgba(255,255,255,0.06)",
                color: channelLink.trim() && termsAccepted ? "#fff" : TEXT_FAINT,
                fontSize: 15, fontWeight: 700,
                cursor: channelLink.trim() && termsAccepted && !applyMutation.isPending ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: channelLink.trim() && termsAccepted ? `0 4px 20px ${BLUE}40` : "none",
                transition: "all 0.2s",
              }}
            >
              {applyMutation.isPending
                ? <><Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> Submitting...</>
                : "Submit Application"}
            </button>
          </div>

        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Layout>
  );
}
