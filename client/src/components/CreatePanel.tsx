import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Loader2, AlertTriangle,
  CheckCircle2, ShieldCheck, ShieldOff,
} from "lucide-react";
import { showNotification } from "@/components/AppNotification";
import { useLocation } from "wouter";

// ─── Pricing packages ──────────────────────────────────────────
const PACKAGES = [
  { clicks: 100,   price: 0.1500, verified: 0.2000 },
  { clicks: 500,   price: 0.7500, verified: 1.0000 },
  { clicks: 1000,  price: 1.5000, verified: 2.0000 },
  { clicks: 2000,  price: 3.0000, verified: 4.0000 },
  { clicks: 5000,  price: 7.5000, verified: 10.0000 },
  { clicks: 10000, price: 15.0000, verified: 20.0000 },
];

type Flow        = "advertise" | "giveaway" | null;
type Category    = "channel" | "bot";
type VerifyType  = "verification" | "without";
interface Props { open: boolean; onClose: () => void; }

const BOT_NAME = "@Paid_Adzbot";

// ─── Tiny label — matches AdWatchingSection "AD LIMIT" / "REWARD" style ──────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)",
      textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8,
    }}>
      {children}
    </p>
  );
}

export default function CreatePanel({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // ── form state
  const [flow,        setFlow]        = useState<Flow>(null);
  const [category,    setCategory]    = useState<Category>("channel");
  const [verifyType,  setVerifyType]  = useState<VerifyType>("verification");
  const [taskName,    setTaskName]    = useState("");
  const [link,        setLink]        = useState("");
  const [botLink,     setBotLink]     = useState("");        // bot username (without @)
  const [botStartLink,setBotStartLink]= useState("");        // full start link for verified bot
  const [selectedPkg, setSelectedPkg] = useState<number | null>(null);

  // ── channel verify state
  const [chVerifying, setChVerifying] = useState(false);
  const [chVerified,  setChVerified]  = useState(false);
  const [chError,     setChError]     = useState("");

  const isVerification   = verifyType === "verification";
  const selectedPkgData  = PACKAGES.find(p => p.clicks === selectedPkg);
  const cost = selectedPkgData
    ? (isVerification ? selectedPkgData.verified : selectedPkgData.price).toFixed(4)
    : null;

  const reset = useCallback(() => {
    setFlow(null); setCategory("channel"); setVerifyType("verification");
    setTaskName(""); setLink(""); setBotLink(""); setBotStartLink("");
    setSelectedPkg(null); setChVerifying(false); setChVerified(false); setChError("");
  }, []);

  const handleClose = useCallback(() => { onClose(); setTimeout(reset, 350); }, [onClose, reset]);

  // reset verify state when link/category/verifyType changes
  const resetChannelVerify = () => { setChVerified(false); setChError(""); };

  const verifyChannel = async () => {
    const trimmed = link.trim();
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
      else setChError(data.message || "Verification failed. Make sure bot is admin.");
    } catch { setChError("Network error. Please try again."); }
    finally { setChVerifying(false); }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let finalLink = "";
      if (category === "channel") {
        finalLink = link.trim();
      } else {
        finalLink = isVerification
          ? botStartLink.trim()
          : `https://t.me/${botLink.replace(/^@/, "").trim()}`;
      }
      const res = await fetch("/api/advertiser-tasks/create", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: category,
          title: taskName.trim(),
          link: finalLink,
          totalClicksRequired: selectedPkg,
          verificationRequired: isVerification,
          channelVerified: category === "channel" ? chVerified : false,
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
    if (!taskName.trim() || !selectedPkg || createMutation.isPending) return false;
    if (category === "channel") {
      if (!link.trim() || !link.includes("t.me/")) return false;
      if (isVerification && !chVerified) return false;
    } else {
      if (isVerification && !botStartLink.trim()) return false;
      if (!isVerification && !botLink.trim()) return false;
    }
    return true;
  })();

  const pills = [
    { id: "advertise" as Flow, label: "Advertise",  emoji: "📢" },
    { id: "giveaway"  as Flow, label: "Giveaway",   emoji: "🎁" },
    { id: null        as Flow, label: "Ambassador", emoji: "🚀", navigate: "/ambassador" },
  ];

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[49]"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Pill stack */}
      <AnimatePresence>
        {open && (
          <div className="fixed z-[65]"
            style={{ bottom: "92px", right: "16px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
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
                  display: "inline-flex", alignItems: "center", gap: 10, height: 48,
                  width: "max-content", background: "rgba(255,255,255,0.12)",
                  backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
                  border: "none", borderRadius: 24, padding: "0 18px 0 14px",
                  cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                }}
              >
                <span style={{ fontSize: 18 }}>{emoji}</span>
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
              </motion.button>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Bottom sheet */}
      <AnimatePresence>
        {flow !== null && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[68]"
              style={{ background: "rgba(0,0,0,0.6)" }}
              onClick={handleClose}
            />

            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
              className="fixed bottom-0 left-0 right-0 z-[69]"
              style={{
                background: "#111",
                borderRadius: "20px 20px 0 0",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* ── Sticky header ── */}
              <div style={{ flexShrink: 0 }}>
                <div className="flex justify-center pt-3 pb-1">
                  <div style={{ width: 32, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)" }} />
                </div>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={handleClose}
                    style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: "rgba(255,255,255,0.08)", border: "none",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <ChevronLeft style={{ width: 16, height: 16, color: "rgba(255,255,255,0.5)" }} />
                  </button>
                  {flow === "advertise" ? (
                    <div>
                      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>Add Mission</h2>
                      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 1 }}>Promote your channel or bot</p>
                    </div>
                  ) : (
                    <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>
                      {flow === "giveaway" ? "Giveaway" : ""}
                    </h2>
                  )}
                </div>
                <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
              </div>

              {/* ── Scrollable body ── */}
              <div style={{
                flex: 1, overflowY: "auto", padding: "16px 16px",
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
              }}>

                {/* Giveaway placeholder */}
                {flow === "giveaway" && (
                  <div className="flex flex-col items-center justify-center gap-3 py-14">
                    <span style={{ fontSize: 40 }}>🎁</span>
                    <div className="text-center">
                      <p className="text-white font-bold text-lg">Coming Soon</p>
                      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginTop: 4 }}>
                        Giveaway campaigns are in development.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Advertise form ── */}
                {flow === "advertise" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* TASK NAME */}
                    <div>
                      <SectionLabel>Task Name</SectionLabel>
                      <input
                        type="text"
                        placeholder="e.g. Join PaidAdz Channel"
                        value={taskName}
                        onChange={e => setTaskName(e.target.value)}
                        style={inputStyle}
                      />
                    </div>

                    {/* CATEGORY */}
                    <div>
                      <SectionLabel>Category</SectionLabel>
                      <div style={toggleContainerStyle}>
                        {(["channel", "bot"] as Category[]).map(cat => (
                          <button
                            key={cat}
                            onClick={() => { setCategory(cat); resetChannelVerify(); setLink(""); setBotLink(""); setBotStartLink(""); }}
                            style={{
                              ...toggleBtnBase,
                              background: category === cat ? "rgba(255,255,255,0.12)" : "transparent",
                              color: category === cat ? "#fff" : "rgba(255,255,255,0.35)",
                              fontWeight: category === cat ? 600 : 400,
                            }}
                          >
                            {cat === "channel" ? "Channel / Group" : "Website / Bot"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* VERIFICATION TYPE */}
                    <div>
                      <SectionLabel>Type</SectionLabel>
                      <div style={toggleContainerStyle}>
                        {([
                          { id: "verification" as VerifyType, label: "With Verification", icon: <ShieldCheck style={{ width: 13, height: 13 }} /> },
                          { id: "without"      as VerifyType, label: "Without Verification", icon: <ShieldOff style={{ width: 13, height: 13 }} /> },
                        ]).map(({ id, label, icon }) => {
                          const sel = verifyType === id;
                          return (
                            <button
                              key={id}
                              onClick={() => { setVerifyType(id); resetChannelVerify(); }}
                              style={{
                                ...toggleBtnBase,
                                background: sel ? "rgba(255,255,255,0.12)" : "transparent",
                                color: sel ? "#fff" : "rgba(255,255,255,0.35)",
                                fontWeight: sel ? 600 : 400,
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                              }}
                            >
                              {icon}{label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Type description */}
                      <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginTop: 7, lineHeight: 1.55, paddingLeft: 2 }}>
                        {category === "channel"
                          ? isVerification
                            ? "Bot verifies membership — penalty applied if user leaves after joining."
                            : "User opens the channel link — reward granted instantly without join check."
                          : isVerification
                            ? "User starts bot via referral link — verified before reward is given."
                            : "User opens your bot — reward granted instantly."
                        }
                      </p>
                    </div>

                    {/* ── CHANNEL FIELDS ── */}
                    {category === "channel" && (
                      <div>
                        <SectionLabel>Channel Link</SectionLabel>

                        {/* Link input + Verify button row */}
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            placeholder="https://t.me/YourChannel"
                            value={link}
                            onChange={e => { setLink(e.target.value); resetChannelVerify(); }}
                            style={{ ...inputStyle, flex: 1, margin: 0 }}
                          />
                          {/* Show verify button only for with-verification */}
                          {isVerification && (
                            <button
                              onClick={verifyChannel}
                              disabled={chVerifying || !link.trim() || chVerified}
                              style={{
                                flexShrink: 0, height: 44, padding: "0 14px",
                                borderRadius: 12, border: "none", cursor: chVerified || chVerifying ? "default" : "pointer",
                                background: chVerified
                                  ? "rgba(34,197,94,0.15)"
                                  : "rgba(59,130,246,0.15)",
                                color: chVerified ? "#4ade80" : "#60a5fa",
                                fontSize: 12, fontWeight: 700,
                                display: "flex", alignItems: "center", gap: 5,
                                opacity: (!link.trim() && !chVerified) ? 0.5 : 1,
                                whiteSpace: "nowrap",
                                transition: "background 0.15s",
                              }}
                            >
                              {chVerifying
                                ? <><Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> Checking</>
                                : chVerified
                                  ? <><CheckCircle2 style={{ width: 12, height: 12 }} /> Verified</>
                                  : "Verify Bot"}
                            </button>
                          )}
                        </div>

                        {/* Admin warning / status */}
                        <AnimatePresence>
                          {isVerification && !chVerified && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}
                              style={{ overflow: "hidden" }}
                            >
                              <div style={{
                                marginTop: 8, background: "rgba(234,179,8,0.07)",
                                border: "1px solid rgba(234,179,8,0.2)",
                                borderRadius: 10, padding: "9px 11px",
                                display: "flex", gap: 8, alignItems: "flex-start",
                              }}>
                                <AlertTriangle style={{ width: 13, height: 13, color: "#eab308", flexShrink: 0, marginTop: 1 }} />
                                <p style={{ color: "rgba(253,230,138,0.8)", fontSize: 11.5, lineHeight: 1.55 }}>
                                  Add <strong style={{ color: "#fbbf24" }}>{BOT_NAME}</strong> as Admin in your channel, then tap <strong>Verify Bot</strong>.
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Verify error */}
                        {chError && (
                          <p style={{ color: "#f87171", fontSize: 12, marginTop: 6 }}>{chError}</p>
                        )}

                        {/* Without verification hint */}
                        {!isVerification && (
                          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginTop: 6 }}>
                            Example: https://t.me/YourChannel
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── BOT FIELDS ── */}
                    {category === "bot" && (
                      <div>
                        <SectionLabel>
                          {isVerification ? "Bot Referral Start Link" : "Bot Username"}
                        </SectionLabel>
                        {isVerification ? (
                          <>
                            <input
                              type="text"
                              placeholder="https://t.me/YourBot?start=YOUR_CODE"
                              value={botStartLink}
                              onChange={e => setBotStartLink(e.target.value)}
                              style={inputStyle}
                            />
                            <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginTop: 6, lineHeight: 1.55 }}>
                              Provide the full referral start link so users join through your code.
                            </p>
                          </>
                        ) : (
                          <div style={{ position: "relative" }}>
                            <span style={{
                              position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                              color: "rgba(255,255,255,0.3)", fontSize: 14, pointerEvents: "none",
                            }}>@</span>
                            <input
                              type="text"
                              placeholder="yourbotname"
                              value={botLink}
                              onChange={e => setBotLink(e.target.value)}
                              style={{ ...inputStyle, paddingLeft: 28 }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* TASK NAME (campaign label) — shown after link fields */}
                    <div>
                      <SectionLabel>Campaign Label</SectionLabel>
                      <input
                        type="text"
                        placeholder={
                          category === "channel"
                            ? "e.g. Join PaidAdz News Channel"
                            : "e.g. Start My Earning Bot"
                        }
                        value={taskName}
                        onChange={e => setTaskName(e.target.value)}
                        style={inputStyle}
                      />
                    </div>

                    {/* COMPLETIONS GRID */}
                    <div>
                      <SectionLabel>Number of Completions</SectionLabel>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        {PACKAGES.map(pkg => {
                          const sel   = selectedPkg === pkg.clicks;
                          const price = isVerification ? pkg.verified : pkg.price;
                          return (
                            <motion.button
                              key={pkg.clicks}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setSelectedPkg(pkg.clicks)}
                              style={{
                                padding: "10px 6px", borderRadius: 10, border: "none",
                                background: sel ? "rgba(59,130,246,0.15)" : "#1a1a1a",
                                outline: sel ? "1.5px solid rgba(59,130,246,0.5)" : "1.5px solid transparent",
                                cursor: "pointer", textAlign: "center",
                                transition: "background 0.15s, outline 0.15s",
                              }}
                            >
                              <div style={{ color: sel ? "#60a5fa" : "#fff", fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                                {pkg.clicks >= 1000 ? `${pkg.clicks / 1000}K` : pkg.clicks}
                              </div>
                              <div style={{ color: sel ? "rgba(147,197,253,0.75)" : "rgba(255,255,255,0.3)", fontSize: 10, marginTop: 3, fontWeight: 500 }}>
                                {price.toFixed(4)} TON
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    {/* PAY BUTTON */}
                    <div style={{ marginTop: 4 }}>
                      <motion.button
                        whileTap={canSubmit ? { scale: 0.97 } : {}}
                        onClick={() => createMutation.mutate()}
                        disabled={!canSubmit}
                        style={{
                          width: "100%", padding: "13px 16px", borderRadius: 12, border: "none",
                          background: canSubmit ? "#3b82f6" : "rgba(255,255,255,0.07)",
                          color: canSubmit ? "#fff" : "rgba(255,255,255,0.25)",
                          fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
                          cursor: canSubmit ? "pointer" : "not-allowed",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                          transition: "background 0.15s",
                        }}
                      >
                        {createMutation.isPending
                          ? <><Loader2 style={{ width: 15, height: 15, animation: "spin 1s linear infinite" }} /> Creating…</>
                          : <>▽ Pay {cost ? `${cost} TON` : "—"}</>
                        }
                      </motion.button>
                      <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, textAlign: "center", marginTop: 8 }}>
                        Automated verification via Blockchain.
                      </p>
                    </div>

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

// ─── Shared style objects ──────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  borderRadius: 12, padding: "12px 14px",
  color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
};

const toggleContainerStyle: React.CSSProperties = {
  display: "flex", background: "#1a1a1a", borderRadius: 12, padding: 3, gap: 3,
};

const toggleBtnBase: React.CSSProperties = {
  flex: 1, padding: "9px 6px", borderRadius: 10, border: "none",
  fontSize: 12.5, cursor: "pointer", transition: "background 0.15s, color 0.15s",
};
