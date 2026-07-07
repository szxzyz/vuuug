import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Radio, ChevronLeft, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";

// ─── Pricing packages ──────────────────────────────────────────
const PACKAGES = [
  { clicks: 100,   plain: 0.1500, verified: 0.2000 },
  { clicks: 500,   plain: 0.7500, verified: 1.0000 },
  { clicks: 1000,  plain: 1.5000, verified: 2.0000 },
  { clicks: 2000,  plain: 3.0000, verified: 4.0000 },
  { clicks: 5000,  plain: 7.5000, verified: 10.0000 },
  { clicks: 10000, plain: 15.0000, verified: 20.0000 },
];

type Flow = "advertise" | "giveaway" | null;
type AdvertiseTarget = "bot" | "channel" | null;
interface Props { open: boolean; onClose: () => void; }

// ─── Design tokens ─────────────────────────────────────────────
const BG     = "rgba(13,13,16,0.98)";
const CARD   = "rgba(255,255,255,0.055)";
const BDR    = "rgba(255,255,255,0.09)";
const T      = "#fff";
const TDIM   = "rgba(255,255,255,0.42)";
const TFAINT = "rgba(255,255,255,0.22)";
const BLUE   = "#3b82f6";

const Label = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: BLUE, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", marginBottom: 10 }}>{children}</p>
);

const Field = ({
  placeholder, value, onChange, prefix,
}: {
  placeholder: string; value: string; onChange: (v: string) => void; prefix?: string;
}) => (
  <div style={{ position: "relative" }}>
    {prefix && (
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
        color: TDIM, fontSize: 15, pointerEvents: "none", userSelect: "none" }}>{prefix}</span>
    )}
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: "100%", background: "rgba(255,255,255,0.05)",
        border: `1px solid ${BDR}`, borderRadius: 14,
        padding: prefix ? "13px 14px 13px 30px" : "13px 14px",
        color: T, fontSize: 15, outline: "none",
      }}
    />
  </div>
);

function RadioCard({ selected, onClick, title, sub }: {
  selected: boolean; onClick: () => void; title: string; sub: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        background: selected ? "rgba(59,130,246,0.06)" : CARD,
        border: `1.5px solid ${selected ? "rgba(59,130,246,0.45)" : BDR}`,
        borderRadius: 14, padding: "14px", width: "100%", textAlign: "left",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ flex: 1 }}>
        <p style={{ color: T, fontWeight: 600, fontSize: 14.5 }}>{title}</p>
        <p style={{ color: TDIM, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{sub}</p>
      </div>
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

export default function CreatePanel({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [flow,           setFlow]           = useState<Flow>(null);
  const [advertiseTarget, setAdvertiseTarget] = useState<AdvertiseTarget>(null);
  const [verifyType,     setVerifyType]     = useState<"verification" | "without">("without");
  const [campaignName,   setCampaignName]   = useState("");
  const [botLink,        setBotLink]        = useState("");
  const [botStartLink,   setBotStartLink]   = useState("");
  const [channelLink,    setChannelLink]    = useState("");
  const [selectedPkg,    setSelectedPkg]    = useState<number | null>(null);

  const [chVerifying, setChVerifying] = useState(false);
  const [chVerified,  setChVerified]  = useState(false);
  const [chError,     setChError]     = useState("");

  const taskFlow = advertiseTarget; // "bot" | "channel" | null
  const isVerification  = verifyType === "verification";
  const selectedPkgData = PACKAGES.find(p => p.clicks === selectedPkg);
  const cost = selectedPkgData
    ? (isVerification ? selectedPkgData.verified : selectedPkgData.plain).toFixed(4)
    : null;

  const reset = useCallback(() => {
    setFlow(null);
    setAdvertiseTarget(null);
    setVerifyType("without"); setCampaignName(""); setBotLink(""); setBotStartLink("");
    setChannelLink(""); setSelectedPkg(null);
    setChVerifying(false); setChVerified(false); setChError("");
  }, []);

  const handleClose = useCallback(() => { onClose(); setTimeout(reset, 350); }, [onClose, reset]);

  const handleBack = () => {
    if (advertiseTarget !== null) {
      setAdvertiseTarget(null);
      setVerifyType("without"); setCampaignName(""); setBotLink(""); setBotStartLink("");
      setChannelLink(""); setSelectedPkg(null);
      setChVerifying(false); setChVerified(false); setChError("");
    } else {
      handleClose();
    }
  };

  const verifyChannel = async () => {
    const trimmed = channelLink.trim();
    if (!trimmed) return;
    setChVerifying(true); setChError(""); setChVerified(false);
    try {
      const res = await fetch("/api/advertiser-tasks/verify-channel", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelLink: trimmed }),
      });
      const data = await res.json();
      if (data.success) setChVerified(true);
      else setChError(data.message || "Verification failed.");
    } catch { setChError("Network error."); }
    finally { setChVerifying(false); }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const link = taskFlow === "bot"
        ? isVerification
          ? botStartLink.trim()
          : `https://t.me/${botLink.replace(/^@/, "").trim()}`
        : channelLink.trim();
      const res = await fetch("/api/advertiser-tasks/create", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: taskFlow, title: campaignName.trim(), link,
          totalClicksRequired: selectedPkg,
          verificationRequired: isVerification,
          channelVerified: taskFlow === "channel" ? chVerified : false,
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
    if (!campaignName.trim() || !selectedPkg) return false;
    if (taskFlow === "bot") {
      if (isVerification && !botStartLink.trim()) return false;
      if (!isVerification && !botLink.trim()) return false;
    }
    if (taskFlow === "channel") {
      if (!channelLink.trim() || !channelLink.includes("t.me/")) return false;
      if (isVerification && !chVerified) return false;
    }
    return true;
  })();

  const pills = [
    { id: "advertise" as Flow,  label: "Advertise",  emoji: "📢" },
    { id: "giveaway"  as Flow,  label: "Giveaway",   emoji: "🎁" },
    { id: null        as Flow,  label: "Ambassador", emoji: "🚀", navigate: "/ambassador" },
  ];

  // ── Header title
  const sheetTitle = (() => {
    if (flow === "giveaway") return "Giveaway";
    if (flow === "advertise") {
      if (!advertiseTarget) return "Advertise";
      return advertiseTarget === "bot" ? "Promote Bot" : "Promote Channel";
    }
    return "";
  })();

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[49]"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Pill stack */}
      <AnimatePresence>
        {open && (
          <div
            className="fixed z-[65]"
            style={{ bottom: "92px", right: "16px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}
          >
            {pills.map(({ id, label, emoji, navigate: navTo }, i) => (
              <motion.button
                key={label}
                initial={{ opacity: 0, x: 12, scale: 0.92 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.92 }}
                transition={{ delay: i * 0.025, type: "spring", stiffness: 480, damping: 32 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (navTo) { onClose(); navigate(navTo); }
                  else setFlow(id);
                }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  height: 56, width: "max-content",
                  background: "rgba(28,28,30,0.92)",
                  backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
                  border: "none", borderRadius: 28, padding: "0 20px 0 16px",
                  cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                }}
              >
                <span style={{ fontSize: 20 }}>{emoji}</span>
                <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
              </motion.button>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Bottom sheet */}
      <AnimatePresence>
        {flow !== null && (
          <>
            {/* Sheet backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[68]"
              style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
              onClick={handleClose}
            />

            {/* Sheet */}
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              className="fixed bottom-0 left-0 right-0 z-[69]"
              style={{
                background: BG,
                backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
                borderRadius: "24px 24px 0 0",
                maxHeight: "88vh",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* ── Sticky header ── */}
              <div style={{ flexShrink: 0 }}>
                {/* Handle */}
                <div className="flex justify-center pt-3">
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)" }} />
                </div>

                {/* Title row */}
                <div className="flex items-center gap-3 px-5 pt-4 pb-3">
                  <button
                    onClick={handleBack}
                    style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: "rgba(255,255,255,0.07)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <ChevronLeft style={{ width: 17, height: 17, color: TDIM }} />
                  </button>
                  <h2 style={{ color: T, fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
                    {sheetTitle}
                  </h2>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 20px" }} />
              </div>

              {/* ── Scrollable content ── */}
              <div style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 20px",
                paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 100px)",
              }}>

                {/* Giveaway */}
                {flow === "giveaway" && (
                  <div className="flex flex-col items-center justify-center gap-4 py-12">
                    <span style={{ fontSize: 44 }}>🎁</span>
                    <div className="text-center">
                      <p style={{ color: T, fontWeight: 700, fontSize: 19 }}>Coming Soon</p>
                      <p style={{ color: TDIM, fontSize: 13.5, marginTop: 6 }}>Giveaway campaigns are in development.</p>
                    </div>
                  </div>
                )}

                {/* Advertise — target selector */}
                {flow === "advertise" && !advertiseTarget && (
                  <div className="flex flex-col gap-3">
                    <p style={{ color: TDIM, fontSize: 13, marginBottom: 4 }}>
                      What would you like to promote?
                    </p>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setAdvertiseTarget("bot")}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        background: CARD, border: `1.5px solid ${BDR}`,
                        borderRadius: 16, padding: "16px 18px", width: "100%", textAlign: "left",
                      }}
                    >
                      <div style={{
                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                        background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Cpu style={{ width: 22, height: 22, color: "#818cf8" }} />
                      </div>
                      <div>
                        <p style={{ color: T, fontWeight: 700, fontSize: 15 }}>Bot</p>
                        <p style={{ color: TDIM, fontSize: 12.5, marginTop: 3 }}>Drive users to your Telegram bot</p>
                      </div>
                    </motion.button>

                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setAdvertiseTarget("channel")}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        background: CARD, border: `1.5px solid ${BDR}`,
                        borderRadius: 16, padding: "16px 18px", width: "100%", textAlign: "left",
                      }}
                    >
                      <div style={{
                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                        background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Radio style={{ width: 22, height: 22, color: "#4ade80" }} />
                      </div>
                      <div>
                        <p style={{ color: T, fontWeight: 700, fontSize: 15 }}>Channel</p>
                        <p style={{ color: TDIM, fontSize: 12.5, marginTop: 3 }}>Grow your Telegram channel subscribers</p>
                      </div>
                    </motion.button>
                  </div>
                )}

                {/* Advertise — form (bot or channel selected) */}
                {flow === "advertise" && (advertiseTarget === "bot" || advertiseTarget === "channel") && (
                  <div className="flex flex-col gap-5">

                    {/* TYPE */}
                    <div>
                      <Label>Type</Label>
                      <div className="flex flex-col gap-2">
                        <RadioCard
                          selected={verifyType === "verification"}
                          onClick={() => { setVerifyType("verification"); setChVerified(false); setChError(""); }}
                          title="With Verification"
                          sub={advertiseTarget === "bot"
                            ? "Users start your bot via the referral link — verified before reward"
                            : "Users must join the channel — bot verifies membership automatically"}
                        />
                        <RadioCard
                          selected={verifyType === "without"}
                          onClick={() => setVerifyType("without")}
                          title="Without Verification"
                          sub={advertiseTarget === "bot"
                            ? "Users open your bot — reward is granted instantly"
                            : "Users open the channel — reward is granted instantly"}
                        />
                      </div>
                    </div>

                    {/* CHANNEL LINK */}
                    {advertiseTarget === "channel" && (
                      <div>
                        <Label>Your Channel</Label>
                        <div className="flex gap-2">
                          <div style={{ flex: 1 }}>
                            <Field
                              placeholder="https://t.me/YourChannel"
                              value={channelLink}
                              onChange={v => { setChannelLink(v); setChVerified(false); setChError(""); }}
                            />
                          </div>
                          {isVerification && (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={verifyChannel}
                              disabled={chVerifying || !channelLink.trim() || chVerified}
                              style={{
                                padding: "0 15px", borderRadius: 14, flexShrink: 0,
                                background: chVerified ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
                                border: chVerified ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(59,130,246,0.3)",
                                color: chVerified ? "#4ade80" : "#93c5fd",
                                fontSize: 13, fontWeight: 600,
                                cursor: chVerifying || chVerified ? "default" : "pointer",
                                display: "flex", alignItems: "center", gap: 6, minWidth: 78, justifyContent: "center",
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

                        {isVerification && !chVerified && channelLink.trim() && (
                          <p style={{ color: "rgba(147,197,253,0.75)", fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>
                            Add <strong>@Paid_Adzbot</strong> as admin to your channel, then tap Verify.
                          </p>
                        )}
                        {!isVerification && (
                          <p style={{ color: TDIM, fontSize: 12, marginTop: 6 }}>
                            Example: https://t.me/YourChannel
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

                    {/* BOT LINK */}
                    {advertiseTarget === "bot" && (
                      <div>
                        <Label>{isVerification ? "Bot Referral Start Link" : "Your Bot"}</Label>
                        {isVerification ? (
                          <>
                            <Field
                              placeholder="https://t.me/YourBot?start=YOUR_CODE"
                              value={botStartLink}
                              onChange={setBotStartLink}
                            />
                            <p style={{ color: TDIM, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                              Provide the full start link with your referral code so users join through your link.
                            </p>
                          </>
                        ) : (
                          <Field
                            placeholder="bot username"
                            prefix="@"
                            value={botLink}
                            onChange={setBotLink}
                          />
                        )}
                      </div>
                    )}

                    {/* CAMPAIGN NAME */}
                    <div>
                      <Label>Campaign Details</Label>
                      <Field
                        placeholder={advertiseTarget === "bot" ? "e.g. Join My Earning Bot" : "e.g. Join Paid Adz News"}
                        value={campaignName}
                        onChange={setCampaignName}
                      />
                    </div>

                    {/* PACKAGE PICKER */}
                    <div>
                      <Label>Completions &amp; Price</Label>
                      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                        {PACKAGES.map(pkg => {
                          const price = isVerification ? pkg.verified : pkg.plain;
                          const sel = selectedPkg === pkg.clicks;
                          return (
                            <button
                              key={pkg.clicks}
                              onClick={() => setSelectedPkg(pkg.clicks)}
                              style={{
                                padding: "10px 14px", borderRadius: 12, flexShrink: 0,
                                background: sel ? "rgba(59,130,246,0.12)" : CARD,
                                border: `1.5px solid ${sel ? "rgba(59,130,246,0.45)" : BDR}`,
                                cursor: "pointer", minWidth: 82, textAlign: "center",
                                transition: "border-color 0.15s, background 0.15s",
                              }}
                            >
                              <div style={{ color: T, fontWeight: 700, fontSize: 14 }}>
                                {pkg.clicks >= 1000 ? `${pkg.clicks / 1000}K` : pkg.clicks}
                              </div>
                              <div style={{ color: sel ? "#93c5fd" : TDIM, fontSize: 11, marginTop: 3 }}>
                                {price.toFixed(4)} TON
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* COST */}
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

                    {/* SUBMIT */}
                    <motion.button
                      whileTap={canSubmit && !createMutation.isPending ? { scale: 0.97 } : {}}
                      onClick={() => createMutation.mutate()}
                      disabled={!canSubmit || createMutation.isPending}
                      style={{
                        width: "100%", padding: "15px", borderRadius: 15,
                        background: canSubmit && !createMutation.isPending ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${canSubmit && !createMutation.isPending ? "rgba(59,130,246,0.4)" : BDR}`,
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
