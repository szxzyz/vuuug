import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Loader2, AlertTriangle,
  CheckCircle2, ShieldCheck, ShieldOff,
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";

// ─── Pricing ───────────────────────────────────────────────────
const PACKAGES = [
  { clicks: 100,   price: 0.1500, verified: 0.2000 },
  { clicks: 500,   price: 0.7500, verified: 1.0000 },
  { clicks: 1000,  price: 1.5000, verified: 2.0000 },
  { clicks: 2000,  price: 3.0000, verified: 4.0000 },
  { clicks: 5000,  price: 7.5000, verified: 10.000 },
  { clicks: 10000, price: 15.000, verified: 20.000 },
];

type Flow       = "advertise" | "giveaway" | null;
type Category   = "channel" | "bot";
type VerifyType = "verification" | "without";
interface Props { open: boolean; onClose: () => void; }

const BOT_NAME = "@Paid_Adzbot";

// spring preset — very fast, no bounce
const SPRING = { type: "spring" as const, stiffness: 500, damping: 42, mass: 0.9 };

export default function CreatePanel({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // ── state
  const [flow,         setFlow]         = useState<Flow>(null);
  const [category,     setCategory]     = useState<Category>("channel");
  const [verifyType,   setVerifyType]   = useState<VerifyType>("verification");
  const [taskName,     setTaskName]     = useState("");
  const [channelLink,  setChannelLink]  = useState("");
  const [botUser,      setBotUser]      = useState("");
  const [botStart,     setBotStart]     = useState("");
  const [selectedPkg,  setSelectedPkg]  = useState<number | null>(null);
  const [chState,      setChState]      = useState<"idle" | "checking" | "ok" | "err">("idle");
  const [chError,      setChError]      = useState("");

  const isVerif     = verifyType === "verification";
  const pkgData     = PACKAGES.find(p => p.clicks === selectedPkg);
  const cost        = pkgData ? (isVerif ? pkgData.verified : pkgData.price).toFixed(4) : null;
  const chVerified  = chState === "ok";

  const reset = useCallback(() => {
    setFlow(null); setCategory("channel"); setVerifyType("verification");
    setTaskName(""); setChannelLink(""); setBotUser(""); setBotStart("");
    setSelectedPkg(null); setChState("idle"); setChError("");
  }, []);

  const handleClose = useCallback(() => {
    onClose(); setTimeout(reset, 400);
  }, [onClose, reset]);

  const resetCh = () => { setChState("idle"); setChError(""); };

  const verifyChannel = async () => {
    const url = channelLink.trim();
    if (!url) return;
    setChState("checking"); setChError("");
    try {
      const res  = await fetch("/api/advertiser-tasks/verify-channel", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelLink: url }),
      });
      const data = await res.json();
      if (data.success) setChState("ok");
      else { setChState("err"); setChError(data.message || "Bot is not admin on this channel."); }
    } catch { setChState("err"); setChError("Network error. Try again."); }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const link = category === "channel"
        ? channelLink.trim()
        : isVerif
          ? botStart.trim()
          : `https://t.me/${botUser.replace(/^@/, "").trim()}`;
      const res = await fetch("/api/advertiser-tasks/create", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: category, title: taskName.trim(), link,
          totalClicksRequired: selectedPkg,
          verificationRequired: isVerif,
          channelVerified: category === "channel" ? chVerified : false,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      showNotification("Mission created!", "success");
      queryClient.invalidateQueries({ queryKey: ["/api/advertiser-tasks"] });
      handleClose();
    },
    onError: (e: Error) => showNotification(e.message, "error"),
  });

  const canSubmit = (() => {
    if (!taskName.trim() || !selectedPkg || createMutation.isPending) return false;
    if (category === "channel") {
      if (!channelLink.trim() || !channelLink.includes("t.me/")) return false;
      if (isVerif && !chVerified) return false;
    } else {
      if (isVerif && !botStart.trim()) return false;
      if (!isVerif && !botUser.trim()) return false;
    }
    return true;
  })();

  const pills = [
    { id: "advertise" as Flow, label: "Advertise",  emoji: "📢" },
    { id: "giveaway"  as Flow, label: "Giveaway",   emoji: "🎁" },
    { id: null        as Flow, label: "Ambassador", emoji: "🚀", nav: "/ambassador" },
  ];

  return (
    <>
      {/* ── dim backdrop for pill menu ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[49]"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* ── pill stack ── */}
      <AnimatePresence>
        {open && flow === null && (
          <div className="fixed z-[65]"
            style={{ bottom: 92, right: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {pills.map(({ id, label, emoji, nav }, i) => (
              <motion.button key={label}
                initial={{ opacity: 0, x: 14, scale: 0.88 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.9 }}
                transition={{ delay: i * 0.03, ...SPRING }}
                whileTap={{ scale: 0.88 }}
                onClick={() => { if (nav) { onClose(); navigate(nav); } else setFlow(id); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 10, height: 48,
                  background: "rgba(255,255,255,0.12)", backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)", border: "none",
                  borderRadius: 24, padding: "0 18px 0 14px", cursor: "pointer",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
                }}
              >
                <span style={{ fontSize: 18 }}>{emoji}</span>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
              </motion.button>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* ── full-screen page sheet ── */}
      <AnimatePresence>
        {flow !== null && (
          <>
            {/* sheet dim */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[68]"
              style={{ background: "rgba(0,0,0,0.65)" }}
              onClick={handleClose}
            />

            {/* page */}
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={SPRING}
              className="fixed inset-x-0 bottom-0 z-[69]"
              style={{
                /* full viewport height → true page feel */
                height: "100dvh",
                background: "#000",
                borderRadius: "22px 22px 0 0",
                display: "flex",
                flexDirection: "column",
                /* GPU layer — eliminates jank */
                willChange: "transform",
                contain: "layout style",
              }}
              onClick={e => e.stopPropagation()}
            >

              {/* ════ HEADER ════ */}
              <div style={{
                flexShrink: 0,
                background: "#000",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                paddingTop: "env(safe-area-inset-top, 12px)",
              }}>
                {/* drag handle */}
                <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 6 }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)" }} />
                </div>

                {/* title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 14px" }}>
                  <button onClick={handleClose} style={backBtnStyle}>
                    <ChevronLeft style={{ width: 18, height: 18, color: "rgba(255,255,255,0.55)" }} />
                  </button>
                  {flow === "advertise" ? (
                    <div>
                      <p style={{ color: "#fff", fontSize: 17, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
                        Add Mission
                      </p>
                      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 2 }}>
                        Promote your channel or bot
                      </p>
                    </div>
                  ) : (
                    <p style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>Giveaway</p>
                  )}
                </div>
              </div>

              {/* ════ SCROLLABLE BODY ════ */}
              <div style={{
                flex: 1, overflowY: "auto", overflowX: "hidden",
                WebkitOverflowScrolling: "touch",
                padding: "20px 16px 8px",
              }}>

                {/* ── Giveaway coming soon ── */}
                {flow === "giveaway" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 }}>
                    <span style={{ fontSize: 48 }}>🎁</span>
                    <p style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>Coming Soon</p>
                    <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 14, textAlign: "center" }}>
                      Giveaway campaigns are in development.
                    </p>
                  </div>
                )}

                {/* ── Advertise form ── */}
                {flow === "advertise" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

                    {/* TASK NAME */}
                    <Field label="Task Name">
                      <input
                        type="text"
                        placeholder={category === "channel" ? "e.g. Join PaidAdz Channel" : "e.g. Start My Earning Bot"}
                        value={taskName}
                        onChange={e => setTaskName(e.target.value)}
                        style={INPUT}
                      />
                    </Field>

                    {/* CATEGORY */}
                    <Field label="Category">
                      <PillToggle
                        options={[
                          { id: "channel", label: "Channel / Group" },
                          { id: "bot",     label: "Website / Bot"   },
                        ]}
                        value={category}
                        onChange={v => {
                          setCategory(v as Category);
                          setChannelLink(""); setBotUser(""); setBotStart(""); resetCh();
                        }}
                      />
                    </Field>

                    {/* TYPE */}
                    <Field label="Verification Type">
                      <PillToggle
                        options={[
                          { id: "verification", label: "With Verification",    icon: <ShieldCheck size={12} /> },
                          { id: "without",      label: "Without Verification", icon: <ShieldOff   size={12} /> },
                        ]}
                        value={verifyType}
                        onChange={v => { setVerifyType(v as VerifyType); resetCh(); }}
                      />
                      <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11.5, marginTop: 8, lineHeight: 1.6, paddingLeft: 2 }}>
                        {typeHint(category, isVerif)}
                      </p>
                    </Field>

                    {/* ── CHANNEL fields ── */}
                    {category === "channel" && (
                      <Field label="Channel Link">
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            type="text"
                            placeholder="https://t.me/YourChannel"
                            value={channelLink}
                            onChange={e => { setChannelLink(e.target.value); resetCh(); }}
                            style={{ ...INPUT, flex: 1 }}
                          />
                          {isVerif && (
                            <button
                              onClick={verifyChannel}
                              disabled={chState === "checking" || chVerified || !channelLink.trim()}
                              style={verifyBtnStyle(chState)}
                            >
                              {chState === "checking"
                                ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} />
                                : chState === "ok"
                                  ? <><CheckCircle2 size={13} /> Done</>
                                  : "Verify"}
                            </button>
                          )}
                        </div>

                        {/* warning / success / error */}
                        <AnimatePresence>
                          {isVerif && chState !== "ok" && (
                            <motion.div
                              key="warn"
                              initial={{ opacity: 0, y: -4, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: "auto" }}
                              exit={{ opacity: 0, y: -4, height: 0 }}
                              transition={{ duration: 0.15 }}
                              style={{ overflow: "hidden" }}
                            >
                              <div style={warningBox}>
                                <AlertTriangle size={13} style={{ color: "#eab308", flexShrink: 0, marginTop: 1 }} />
                                <p style={{ color: "rgba(253,230,138,0.8)", fontSize: 12, lineHeight: 1.6 }}>
                                  {chState === "err" && chError
                                    ? chError
                                    : <>Add <strong style={{ color: "#fbbf24" }}>{BOT_NAME}</strong> as <strong>Admin</strong> in your channel, then tap <strong>Verify</strong>.</>
                                  }
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {!isVerif && (
                          <p style={{ color: "rgba(255,255,255,0.22)", fontSize: 11.5, marginTop: 6 }}>
                            Example: https://t.me/YourChannel
                          </p>
                        )}
                      </Field>
                    )}

                    {/* ── BOT fields ── */}
                    {category === "bot" && (
                      <Field label={isVerif ? "Referral Start Link" : "Bot Username"}>
                        {isVerif ? (
                          <>
                            <input
                              type="text"
                              placeholder="https://t.me/YourBot?start=REF_CODE"
                              value={botStart}
                              onChange={e => setBotStart(e.target.value)}
                              style={INPUT}
                            />
                            <p style={{ color: "rgba(255,255,255,0.22)", fontSize: 11.5, marginTop: 6, lineHeight: 1.6 }}>
                              Users must start via your referral link — verified before reward is granted.
                            </p>
                          </>
                        ) : (
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", fontSize: 15, pointerEvents: "none" }}>@</span>
                            <input
                              type="text"
                              placeholder="yourbotname"
                              value={botUser}
                              onChange={e => setBotUser(e.target.value)}
                              style={{ ...INPUT, paddingLeft: 28 }}
                            />
                          </div>
                        )}
                      </Field>
                    )}

                    {/* COMPLETIONS */}
                    <Field label="Number of Completions">
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {PACKAGES.map(pkg => {
                          const sel   = selectedPkg === pkg.clicks;
                          const price = isVerif ? pkg.verified : pkg.price;
                          return (
                            <button
                              key={pkg.clicks}
                              onClick={() => setSelectedPkg(pkg.clicks)}
                              style={{
                                padding: "12px 4px", borderRadius: 12, border: "none",
                                background: sel ? "rgba(59,130,246,0.13)" : "#1a1a1a",
                                outline: `1.5px solid ${sel ? "rgba(59,130,246,0.55)" : "transparent"}`,
                                cursor: "pointer", textAlign: "center",
                                transition: "background 120ms, outline-color 120ms",
                              }}
                            >
                              <p style={{ color: sel ? "#60a5fa" : "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1 }}>
                                {pkg.clicks >= 1000 ? `${pkg.clicks / 1000}K` : pkg.clicks}
                              </p>
                              <p style={{ color: sel ? "rgba(147,197,253,0.7)" : "rgba(255,255,255,0.28)", fontSize: 10.5, marginTop: 4, fontWeight: 500 }}>
                                {price.toFixed(4)} TON
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </Field>

                    {/* bottom spacing so sticky footer doesn't overlap last field */}
                    <div style={{ height: 20 }} />
                  </div>
                )}
              </div>

              {/* ════ STICKY FOOTER ════ */}
              {flow === "advertise" && (
                <div style={{
                  flexShrink: 0, padding: "12px 16px",
                  paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
                  background: "#000",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <button
                    onClick={() => createMutation.mutate()}
                    disabled={!canSubmit}
                    style={{
                      width: "100%", height: 50, borderRadius: 14, border: "none",
                      background: canSubmit ? "#3b82f6" : "#1a1a1a",
                      color: canSubmit ? "#fff" : "rgba(255,255,255,0.2)",
                      fontSize: 15, fontWeight: 700, letterSpacing: "0.01em",
                      cursor: canSubmit ? "pointer" : "not-allowed",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      transition: "background 150ms",
                    }}
                  >
                    {createMutation.isPending
                      ? <><Loader2 size={16} style={{ animation: "spin 0.8s linear infinite" }} /> Creating…</>
                      : <>▽ Pay {cost ? `${cost} TON` : "—"}</>
                    }
                  </button>
                  <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 11, textAlign: "center", marginTop: 8 }}>
                    Automated verification via Blockchain.
                  </p>
                </div>
              )}

            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 9 }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function PillToggle({ options, value, onChange }: {
  options: { id: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", background: "#1a1a1a", borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map(opt => {
        const sel = value === opt.id;
        return (
          <button key={opt.id} onClick={() => onChange(opt.id)}
            style={{
              flex: 1, padding: "9px 6px", borderRadius: 10, border: "none",
              background: sel ? "rgba(255,255,255,0.11)" : "transparent",
              color: sel ? "#fff" : "rgba(255,255,255,0.32)",
              fontSize: 12.5, fontWeight: sel ? 600 : 400,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "background 100ms, color 100ms",
            }}>
            {opt.icon}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Styles / helpers ──────────────────────────────────────────

const INPUT: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  borderRadius: 12, padding: "13px 14px",
  color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
};

const backBtnStyle: React.CSSProperties = {
  width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
  background: "rgba(255,255,255,0.08)", border: "none",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

const warningBox: React.CSSProperties = {
  marginTop: 8, background: "rgba(234,179,8,0.07)",
  border: "1px solid rgba(234,179,8,0.22)", borderRadius: 10,
  padding: "9px 11px", display: "flex", gap: 8, alignItems: "flex-start",
};

function verifyBtnStyle(state: "idle" | "checking" | "ok" | "err"): React.CSSProperties {
  const ok = state === "ok";
  return {
    flexShrink: 0, height: 46, padding: "0 14px", borderRadius: 12, border: "none",
    background: ok ? "rgba(34,197,94,0.14)" : "rgba(59,130,246,0.14)",
    color: ok ? "#4ade80" : "#60a5fa",
    fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
    display: "flex", alignItems: "center", gap: 5,
    cursor: state === "checking" || ok ? "default" : "pointer",
    opacity: state === "idle" ? 1 : 1,
    transition: "background 150ms",
  };
}

function typeHint(cat: Category, verif: boolean): string {
  if (cat === "channel") {
    return verif
      ? "Bot verifies join status. If a user leaves after claiming, a penalty is applied automatically."
      : "User opens the channel link — reward is granted instantly without a join check.";
  }
  return verif
    ? "User must start your bot via the referral link — verified before reward is given."
    : "User opens your bot link — reward is granted instantly.";
}

