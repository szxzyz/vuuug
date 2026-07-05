import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Radio, PartyPopper, ChevronLeft, Loader2, CheckCircle2, AlertCircle, Bot, Megaphone, Gift, Award } from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";

const VERIFIED_RATE = 0.0025;
const PLAIN_RATE    = 0.0020;
const MIN_CLICKS    = 100;

type Flow = "bot" | "channel" | "giveaway" | null;

interface Props { open: boolean; onClose: () => void; }

// ─── Design tokens ────────────────────────────────────────────
const BG      = "rgba(13,13,16,0.98)";
const CARD    = "rgba(255,255,255,0.055)";
const BDR     = "rgba(255,255,255,0.09)";
const T       = "#fff";
const TDIM    = "rgba(255,255,255,0.42)";
const TFAINT  = "rgba(255,255,255,0.22)";
const BLUE    = "#3b82f6";

// ─── Small helpers ────────────────────────────────────────────
const Label = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: BLUE, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", marginBottom: 10 }}>
    {children}
  </p>
);

const Field = ({
  placeholder, value, onChange, type = "text", prefix,
}: {
  placeholder: string; value: string; onChange: (v: string) => void;
  type?: string; prefix?: string;
}) => (
  <div style={{ position: "relative" }}>
    {prefix && (
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
        color: TDIM, fontSize: 15, pointerEvents: "none", userSelect: "none" }}>
        {prefix}
      </span>
    )}
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      min={type === "number" ? MIN_CLICKS : undefined}
      style={{
        width: "100%", background: "rgba(255,255,255,0.05)",
        border: `1px solid ${BDR}`, borderRadius: 14,
        padding: prefix ? "13px 14px 13px 30px" : "13px 14px",
        color: T, fontSize: 15, outline: "none",
      }}
    />
  </div>
);

// ─── Radio-style type card ────────────────────────────────────
function RadioCard({
  selected, onClick, title, sub, tag,
}: {
  selected: boolean; onClick: () => void;
  title: string; sub: string; tag?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        background: selected ? "rgba(59,130,246,0.06)" : CARD,
        border: `1.5px solid ${selected ? "rgba(59,130,246,0.45)" : BDR}`,
        borderRadius: 14, padding: "14px 14px", width: "100%", textAlign: "left",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ flex: 1 }}>
        <p style={{ color: T, fontWeight: 600, fontSize: 14.5 }}>{title}</p>
        <p style={{ color: TDIM, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{sub}</p>
        {tag && <p style={{ color: BLUE, fontSize: 11.5, marginTop: 6, fontWeight: 600 }}>{tag}</p>}
      </div>
      {/* Radio circle */}
      <div style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 2,
        border: `2px solid ${selected ? BLUE : "rgba(255,255,255,0.22)"}`,
        background: selected ? BLUE : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
      }}>
        {selected && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}
      </div>
    </motion.button>
  );
}

// ─── Main ─────────────────────────────────────────────────────
export default function CreatePanel({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // Pill menu
  const [flow, setFlow] = useState<Flow>(null);

  // Form state
  const [verifyType,       setVerifyType]       = useState<"verification" | "without">("without");
  const [campaignName,     setCampaignName]     = useState("");
  const [botLink,          setBotLink]          = useState("");
  const [channelUsername,  setChannelUsername]  = useState("");
  const [clicks,           setClicks]           = useState("");

  // Channel verify
  const [chVerifying,  setChVerifying]  = useState(false);
  const [chVerified,   setChVerified]   = useState(false);
  const [chError,      setChError]      = useState("");

  const parsedClicks    = parseInt(clicks) || 0;
  const isVerification  = verifyType === "verification";
  const cost            = parsedClicks >= MIN_CLICKS
    ? (parsedClicks * (isVerification ? VERIFIED_RATE : PLAIN_RATE)).toFixed(4)
    : null;

  const reset = useCallback(() => {
    setFlow(null);
    setVerifyType("without"); setCampaignName(""); setBotLink("");
    setChannelUsername(""); setClicks("");
    setChVerifying(false); setChVerified(false); setChError("");
  }, []);

  const handleClose = useCallback(() => {
    onClose(); setTimeout(reset, 350);
  }, [onClose, reset]);

  // Channel verify API call
  const verifyChannel = async () => {
    if (!channelUsername.trim()) return;
    setChVerifying(true); setChError(""); setChVerified(false);
    try {
      const username = channelUsername.replace(/^@/, "").trim();
      const res = await fetch("/api/advertiser-tasks/verify-channel", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelLink: `https://t.me/${username}` }),
      });
      const data = await res.json();
      if (data.success) setChVerified(true);
      else setChError(data.message || "Verification failed.");
    } catch { setChError("Network error."); }
    finally { setChVerifying(false); }
  };

  // Submit
  const createMutation = useMutation({
    mutationFn: async () => {
      const link = flow === "bot"
        ? `https://t.me/${botLink.replace(/^@/, "").trim()}`
        : `https://t.me/${channelUsername.replace(/^@/, "").trim()}`;
      const res = await fetch("/api/advertiser-tasks/create", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: flow, title: campaignName.trim(), link,
          totalClicksRequired: parsedClicks,
          verificationRequired: isVerification,
          channelVerified: flow === "channel" ? chVerified : false,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      showNotification("Task created!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
      handleClose();
    },
    onError: (err: Error) => showNotification(err.message, "error"),
  });

  const canSubmit = (() => {
    if (!campaignName.trim() || parsedClicks < MIN_CLICKS) return false;
    if (flow === "bot" && !botLink.trim()) return false;
    if (flow === "channel") {
      if (!channelUsername.trim()) return false;
      if (isVerification && !chVerified) return false;
    }
    return true;
  })();

  // ── FAB PILLS ──────────────────────────────────────────────
  const pills: { id: Flow; label: string; Icon: React.ElementType; navigate?: string }[] = [
    { id: "bot",      label: "Bot",        Icon: Cpu         },
    { id: "channel",  label: "Channel",    Icon: Radio       },
    { id: "giveaway", label: "Giveaway",   Icon: PartyPopper },
    { id: null,       label: "Ambassador", Icon: Award, navigate: "/ambassador" },
  ];

  return (
    <>
      {/* ── Full-screen blur backdrop ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[49]"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* ── Vertical pill stack above "+" button ── */}
      <AnimatePresence>
        {open && (
          <div
            className="fixed z-[65]"
            style={{ bottom: "92px", right: "16px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}
          >
            {pills.map(({ id, label, Icon, navigate: navTo }, i) => (
              <motion.button
                key={label}
                initial={{ opacity: 0, x: 20, scale: 0.88 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 16, scale: 0.88 }}
                transition={{ delay: i * 0.05, type: "spring", stiffness: 360, damping: 28 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (navTo) { onClose(); navigate(navTo); }
                  else setFlow(id);
                }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  height: 64,
                  width: "max-content",
                  background: "rgba(28,28,30,0.85)",
                  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                  border: "none",
                  borderRadius: 32,
                  padding: "0 22px 0 18px",
                  cursor: "pointer",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                }}
              >
                <Icon style={{ width: 24, height: 24, color: "rgba(255,255,255,0.88)", strokeWidth: 1.8, flexShrink: 0 }} />
                <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
              </motion.button>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* ── Bottom sheet (opens when a pill is chosen) ── */}
      <AnimatePresence>
        {flow !== null && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[68]"
              style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)" }}
              onClick={handleClose}
            />

            {/* Sheet */}
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 38 }}
              className="fixed bottom-0 left-0 right-0 z-[69]"
              style={{
                background: BG,
                backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
                borderRadius: "24px 24px 0 0",
                borderTop: "1px solid rgba(255,255,255,0.07)",
                maxHeight: "88vh", overflowY: "auto",
                paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 110px)",
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-0">
                <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)" }} />
              </div>

              {/* Header */}
              <div className="flex items-center gap-3 px-5 pt-4 pb-1">
                <button
                  onClick={handleClose}
                  style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: "rgba(255,255,255,0.07)", border: `1px solid ${BDR}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <ChevronLeft style={{ width: 17, height: 17, color: TDIM }} />
                </button>
                <h2 style={{ color: T, fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {flow === "bot" ? "Promote Bot"
                    : flow === "channel" ? "Promote Channel"
                    : "Giveaway"}
                </h2>
              </div>

              <div style={{ padding: "16px 20px 0" }}>
                {/* ── Giveaway coming soon ── */}
                {flow === "giveaway" && (
                  <div className="flex flex-col items-center justify-center gap-4 py-12">
                    <Gift style={{ width: 44, height: 44, color: "#fbbf24" }} />
                    <div className="text-center">
                      <p style={{ color: T, fontWeight: 700, fontSize: 19 }}>Coming Soon</p>
                      <p style={{ color: TDIM, fontSize: 13.5, marginTop: 6 }}>
                        Giveaway campaigns are in development.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Bot / Channel form (all-in-one) ── */}
                {(flow === "bot" || flow === "channel") && (
                  <div className="flex flex-col gap-5">

                    {/* ── PROMO TYPE ── */}
                    <div>
                      <Label>Promo Type</Label>
                      <div className="flex flex-col gap-2">
                        <RadioCard
                          selected={verifyType === "verification"}
                          onClick={() => { setVerifyType("verification"); setChVerified(false); setChError(""); }}
                          title="With Verification"
                          sub="Users must verify before claiming reward"
                          tag={`100 clicks = ${(100 * VERIFIED_RATE).toFixed(2)} TON`}
                        />
                        <RadioCard
                          selected={verifyType === "without"}
                          onClick={() => setVerifyType("without")}
                          title="Without Verification"
                          sub="Users complete task without verification"
                          tag={`100 clicks = ${(100 * PLAIN_RATE).toFixed(2)} TON`}
                        />
                      </div>
                    </div>

                    {/* ── CHANNEL INPUT (only for channel) ── */}
                    {flow === "channel" && (
                      <div>
                        <Label>Your Channel</Label>
                        <div className="flex gap-2">
                          <div style={{ flex: 1 }}>
                            <Field
                              placeholder="channel username"
                              prefix="@"
                              value={channelUsername}
                              onChange={v => { setChannelUsername(v); setChVerified(false); setChError(""); }}
                            />
                          </div>
                          {isVerification && (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={verifyChannel}
                              disabled={chVerifying || !channelUsername.trim() || chVerified}
                              style={{
                                padding: "0 15px", borderRadius: 14, flexShrink: 0,
                                background: chVerified
                                  ? "rgba(34,197,94,0.15)"
                                  : "rgba(59,130,246,0.15)",
                                border: chVerified
                                  ? "1px solid rgba(34,197,94,0.3)"
                                  : "1px solid rgba(59,130,246,0.3)",
                                color: chVerified ? "#4ade80" : "#93c5fd",
                                fontSize: 13, fontWeight: 600,
                                cursor: chVerifying || chVerified ? "default" : "pointer",
                                display: "flex", alignItems: "center", gap: 6, minWidth: 78,
                                justifyContent: "center",
                              }}
                            >
                              {chVerifying
                                ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                                : chVerified
                                  ? <><CheckCircle2 style={{ width: 14, height: 14 }} /> Done</>
                                  : "Verify"}
                            </motion.button>
                          )}
                        </div>

                        {/* Verify hint */}
                        {isVerification && !chVerified && channelUsername.trim() && (
                          <p style={{ color: "rgba(147,197,253,0.75)", fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>
                            Add <strong>@PaidAdzBot</strong> as admin to your channel, then tap Verify.
                          </p>
                        )}
                        {chError && (
                          <div className="flex items-center gap-2" style={{ marginTop: 7 }}>
                            <AlertCircle style={{ width: 13, height: 13, color: "#f87171", flexShrink: 0 }} />
                            <p style={{ color: "#f87171", fontSize: 12 }}>{chError}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── BOT LINK (only for bot) ── */}
                    {flow === "bot" && (
                      <div>
                        <Label>Your Bot</Label>
                        <Field placeholder="bot username" prefix="@" value={botLink} onChange={setBotLink} />
                      </div>
                    )}

                    {/* ── CAMPAIGN DETAILS ── */}
                    <div>
                      <Label>Campaign Details</Label>
                      <div className="flex flex-col gap-3">
                        <Field
                          placeholder="Campaign name"
                          value={campaignName}
                          onChange={setCampaignName}
                        />
                        <Field
                          type="number"
                          placeholder={`Required clicks (min ${MIN_CLICKS})`}
                          value={clicks}
                          onChange={setClicks}
                        />
                      </div>
                    </div>

                    {/* ── COST DISPLAY ── */}
                    {cost && (
                      <div style={{
                        padding: "12px 14px", borderRadius: 13,
                        background: "rgba(255,255,255,0.04)", border: `1px solid ${BDR}`,
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}>
                        <span style={{ color: TDIM, fontSize: 13 }}>Total Cost</span>
                        <span style={{ color: T, fontWeight: 700, fontSize: 16 }}>{cost} TON</span>
                      </div>
                    )}

                    {/* ── SUBMIT ── */}
                    <motion.button
                      whileTap={canSubmit && !createMutation.isPending ? { scale: 0.97 } : {}}
                      onClick={() => createMutation.mutate()}
                      disabled={!canSubmit || createMutation.isPending}
                      style={{
                        width: "100%", padding: "15px", borderRadius: 15,
                        background: canSubmit && !createMutation.isPending
                          ? "rgba(59,130,246,0.18)"
                          : "rgba(255,255,255,0.04)",
                        border: `1px solid ${canSubmit && !createMutation.isPending
                          ? "rgba(59,130,246,0.4)"
                          : BDR}`,
                        color: canSubmit && !createMutation.isPending ? "#93c5fd" : TFAINT,
                        fontSize: 15, fontWeight: 700,
                        cursor: canSubmit && !createMutation.isPending ? "pointer" : "not-allowed",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      {createMutation.isPending
                        ? <><Loader2 style={{ width: 17, height: 17, animation: "spin 1s linear infinite" }} /> Creating...</>
                        : "Create Task"}
                    </motion.button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
