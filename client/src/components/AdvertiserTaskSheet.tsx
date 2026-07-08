import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Megaphone, ExternalLink, ClipboardPaste, Link2,
  CheckCircle2, Loader2, AlertCircle, X, ShieldCheck, Zap,
} from "lucide-react";

const BLUE_ACCENT = "#4cd3ff";

function TaskAvatar({ task, isBot }: { task: Task; isBot: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const src = `/api/advertiser-tasks/avatar?link=${encodeURIComponent(task.link)}`;

  // Reset load state whenever the underlying task/link changes — otherwise a
  // failed load for one task permanently hides the image for every task after it.
  useEffect(() => {
    setImgOk(true);
    setLoaded(false);
  }, [task.link]);

  return (
    <div style={{
      width: 56, height: 56, borderRadius: 16, margin: "0 auto 12px",
      overflow: "hidden",
      background: isBot ? "rgba(99,102,241,0.12)" : "rgba(34,197,94,0.10)",
      border: isBot ? "1px solid rgba(99,102,241,0.22)" : "1px solid rgba(34,197,94,0.18)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {imgOk && (
        <img
          key={src}
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setImgOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: loaded ? "block" : "none" }}
        />
      )}
      {(!imgOk || !loaded) && (
        isBot
          ? <Bot style={{ width: "24px", height: "24px", color: "#818cf8" }} />
          : <Megaphone style={{ width: "24px", height: "24px", color: "#4ade80" }} />
      )}
    </div>
  );
}

interface Task {
  id: string;
  taskType: string;
  title: string;
  link: string;
  verificationRequired?: boolean;
  channelVerified?: boolean;
}

interface AdvertiserTaskSheetProps {
  task: Task | null;
  open: boolean;
  reward: number;
  onClose: () => void;
  onClaim: (taskId: string) => void;
  claiming?: boolean;
}

const BG       = "rgba(13,13,16,0.99)";
const CARD_BG  = "rgba(255,255,255,0.055)";
const CARD_BDR = "rgba(255,255,255,0.08)";
const TEXT     = "#ffffff";
const TEXT_DIM = "rgba(255,255,255,0.45)";
const TEXT_FAINT = "rgba(255,255,255,0.25)";
const BLUE     = "#3b82f6";

function openLink(link: string) {
  let url = link.trim();
  if (!url.startsWith("http")) url = "https://" + url;
  const tg = (window as any).Telegram?.WebApp;
  if (tg) {
    if (url.includes("t.me/") && tg.openTelegramLink) tg.openTelegramLink(url);
    else if (tg.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  } else {
    window.open(url, "_blank");
  }
}

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-[6px]" style={{ marginBottom: "4px" }}>
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            width: i === current ? "20px" : "6px",
            background: i === current ? BLUE : "rgba(255,255,255,0.2)",
          }}
          transition={{ duration: 0.22 }}
          style={{ height: "6px", borderRadius: "3px" }}
        />
      ))}
    </div>
  );
}

function StepRow({
  Icon, title, body, accent = "rgba(255,255,255,0.7)",
}: {
  num: number; Icon: React.ElementType; title: string; body: string; accent?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div style={{
        width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
        background: "rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: "18px", height: "18px", color: accent }} />
      </div>
      <div style={{ paddingTop: "4px", flex: 1 }}>
        <p style={{ color: TEXT, fontWeight: 600, fontSize: "14.5px" }}>{title}</p>
        <p style={{ color: TEXT_DIM, fontSize: "12.5px", marginTop: "4px", lineHeight: 1.55 }}>{body}</p>
      </div>
    </div>
  );
}

function ChannelPenaltyWarning() {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: "14px",
      background: "rgba(251,191,36,0.06)",
      display: "flex", alignItems: "flex-start", gap: "10px",
    }}>
      <span style={{ fontSize: "15px", flexShrink: 0, lineHeight: 1.4 }}>⚠️</span>
      <p style={{ color: "rgba(251,191,36,0.8)", fontSize: "12.5px", lineHeight: 1.55, margin: 0 }}>
        <strong>Important:</strong> Leaving this channel within 7 days will result in a{" "}
        <strong>50,000 POW penalty</strong> deducted automatically.
      </p>
    </div>
  );
}

function ActionBtn({
  onClick, disabled, color, children,
}: {
  onClick?: () => void; disabled?: boolean; color: string; children: React.ReactNode;
}) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    // primary CTA — matches the Withdraw page's action button
    indigo: { bg: BLUE_ACCENT, border: "transparent", text: "#000" },
    green:  { bg: BLUE_ACCENT, border: "transparent", text: "#000" },
    blue:   { bg: BLUE_ACCENT, border: "transparent", text: "#000" },
    ghost:  { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.09)", text: TEXT_DIM },
  };
  const c = colors[color] ?? colors.blue;
  return (
    <motion.button
      whileTap={!disabled ? { scale: 0.97 } : {}}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", padding: "15px", borderRadius: "16px",
        fontWeight: 700, fontSize: "15px",
        background: disabled ? "rgba(255,255,255,0.04)" : c.bg,
        border: `1px solid ${disabled ? "rgba(255,255,255,0.08)" : c.border}`,
        color: disabled ? TEXT_FAINT : c.text,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
      }}
    >
      {children}
    </motion.button>
  );
}

export default function AdvertiserTaskSheet({
  task, open, reward, onClose, onClaim, claiming = false,
}: AdvertiserTaskSheetProps) {
  const [botStep, setBotStep]           = useState(0);
  const [referralPasted, setReferralPasted] = useState("");
  const [opened, setOpened]             = useState(false);
  const [canClaim, setCanClaim]         = useState(false);
  const [verifying, setVerifying]       = useState(false);
  const [verifyError, setVerifyError]   = useState("");

  const reset = () => {
    setBotStep(0); setReferralPasted(""); setOpened(false);
    setCanClaim(false); setVerifying(false); setVerifyError("");
  };

  const handleClose = () => { onClose(); setTimeout(reset, 380); };

  if (!task) return null;

  const isBot     = task.taskType === "bot";
  const isChannel = task.taskType === "channel";
  const withVerif = task.verificationRequired === true;

  const handleOpen = () => {
    openLink(task.link);
    setOpened(true);
    if (!withVerif) setCanClaim(true);
  };

  const handleVerifyReferral = async () => {
    if (!referralPasted.trim()) return;
    setVerifying(true);
    setVerifyError("");
    await new Promise(r => setTimeout(r, 1000));
    if (referralPasted.includes("t.me") || referralPasted.startsWith("https://")) {
      setVerifying(false);
      setCanClaim(true);
    } else {
      setVerifying(false);
      setVerifyError("Invalid referral link. Please paste the correct link from the bot.");
    }
  };

  const handleCheckMembership = async () => {
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await fetch("/api/tasks/verify-channel-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ channelUsername: task.link }),
      });
      const data = await res.json();
      if (data.success || data.verified) {
        setVerifying(false);
        onClaim(task.id);
        handleClose();
      } else {
        setVerifyError(data.message || "You haven't joined the channel yet.");
        setVerifying(false);
      }
    } catch {
      setVerifyError("Network error. Please try again.");
      setVerifying(false);
    }
  };

  // ── BOT with VERIFICATION (3-step) ──
  const BotVerifiedFlow = () => (
    <div className="flex flex-col gap-5">
      <StepDots total={3} current={botStep} />

      <div className="text-center">
        <p style={{ color: TEXT_FAINT, fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Step {botStep + 1} of 3
        </p>
      </div>

      <AnimatePresence mode="wait">
        {botStep === 0 && (
          <motion.div key="step0"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="flex flex-col gap-4"
          >
            <StepRow
              num={1} Icon={Bot} accent="#818cf8"
              title="Open Bot & Start It"
              body="Open the bot via the referral link and press Start to activate it."
            />
            <ActionBtn color="indigo" onClick={() => { handleOpen(); setBotStep(1); }}>
              <ExternalLink style={{ width: "17px", height: "17px" }} /> Open Bot
            </ActionBtn>
          </motion.div>
        )}

        {botStep === 1 && (
          <motion.div key="step1"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="flex flex-col gap-4"
          >
            <StepRow
              num={2} Icon={Link2} accent="#4ade80"
              title="Copy Your Referral Link"
              body="Inside the bot, go to Invite Friends → Copy your unique referral link."
            />
            <ActionBtn color="green" onClick={() => setBotStep(2)}>
              I've Copied the Link →
            </ActionBtn>
          </motion.div>
        )}

        {botStep === 2 && (
          <motion.div key="step2"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="flex flex-col gap-4"
          >
            <StepRow
              num={3} Icon={ClipboardPaste} accent="#fbbf24"
              title="Paste Your Referral Link"
              body="Paste the referral link you copied from the bot."
            />
            <input
              type="text"
              placeholder="Paste your referral link here"
              value={referralPasted}
              onChange={e => { setReferralPasted(e.target.value); setVerifyError(""); }}
              style={{
                width: "100%", background: "rgba(255,255,255,0.05)",
                border: `1px solid ${CARD_BDR}`, borderRadius: "14px",
                padding: "14px 16px", color: TEXT, fontSize: "14px", outline: "none",
              }}
            />
            {verifyError && (
              <div className="flex items-center gap-2">
                <AlertCircle style={{ width: "13px", height: "13px", color: "#f87171", flexShrink: 0 }} />
                <p style={{ color: "#f87171", fontSize: "12px" }}>{verifyError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                style={{
                  flex: 1, padding: "14px", borderRadius: "14px",
                  background: "rgba(255,255,255,0.05)",
                  color: TEXT_DIM, fontSize: "14px", fontWeight: 600, cursor: "pointer",
                }}
              >
                Skip
              </button>
              {!canClaim ? (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleVerifyReferral}
                  disabled={!referralPasted.trim() || verifying}
                  style={{
                    flex: 2, padding: "14px", borderRadius: "14px",
                    background: referralPasted.trim() ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${referralPasted.trim() ? "rgba(59,130,246,0.3)" : CARD_BDR}`,
                    color: referralPasted.trim() ? "#93c5fd" : TEXT_FAINT,
                    fontSize: "14px", fontWeight: 700,
                    cursor: referralPasted.trim() && !verifying ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
                  }}
                >
                  {verifying
                    ? <><Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite" }} /> Verifying...</>
                    : "Verify & Claim"}
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { onClaim(task.id); handleClose(); }}
                  disabled={claiming}
                  style={{
                    flex: 2, padding: "14px", borderRadius: "14px",
                    background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.28)",
                    color: "#4ade80", fontSize: "14px", fontWeight: 700,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
                  }}
                >
                  {claiming
                    ? <Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite" }} />
                    : <><CheckCircle2 style={{ width: "16px", height: "16px" }} /> Claim +{reward.toLocaleString()} POW</>}
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // ── CHANNEL with VERIFICATION ──
  const ChannelVerifiedFlow = () => (
    <div className="flex flex-col gap-5">
      <ChannelPenaltyWarning />
      <StepRow
        num={1} Icon={Megaphone} accent="#4ade80"
        title="Join the Channel"
        body="Open the channel and join. Then tap 'Verify Membership' — the bot checks automatically."
      />
      {!opened ? (
        <ActionBtn color="green" onClick={handleOpen}>
          <ExternalLink style={{ width: "17px", height: "17px" }} /> Open Channel
        </ActionBtn>
      ) : (
        <div className="flex flex-col gap-3">
          {verifyError && (
            <div className="flex items-center gap-2">
              <AlertCircle style={{ width: "13px", height: "13px", color: "#f87171", flexShrink: 0 }} />
              <p style={{ color: "#f87171", fontSize: "12px" }}>{verifyError}</p>
            </div>
          )}
          <ActionBtn color="blue" onClick={handleCheckMembership} disabled={verifying}>
            {verifying
              ? <><Loader2 style={{ width: "17px", height: "17px", animation: "spin 1s linear infinite" }} /> Checking...</>
              : <><ShieldCheck style={{ width: "17px", height: "17px" }} /> Verify Membership</>}
          </ActionBtn>
        </div>
      )}
    </div>
  );

  const flowLabel = isBot
    ? (withVerif ? "Bot · Verified" : "Bot · Instant")
    : (withVerif ? "Channel · Verified" : "Channel · Instant");

  const flowIcon = withVerif
    ? <ShieldCheck style={{ width: "12px", height: "12px", color: "#60a5fa" }} />
    : <Zap style={{ width: "12px", height: "12px", color: "#facc15" }} />;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[72]"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)" }}
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            className="fixed bottom-0 left-0 right-0 z-[73]"
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
              {/* Handle + close */}
              <div className="flex items-center justify-between px-5 pt-4 pb-0">
                <div style={{ width: "32px" }} />
                <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.12)" }} />
                <button onClick={handleClose} style={{
                  width: "32px", height: "32px", borderRadius: "50%",
                  background: "rgba(255,255,255,0.07)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}>
                  <X style={{ width: "15px", height: "15px", color: TEXT_DIM }} />
                </button>
              </div>

              {/* Task info */}
              <div className="text-center px-6 pt-4 pb-4">
                <TaskAvatar task={task} isBot={isBot} />

                <h2 style={{ color: TEXT, fontSize: "19px", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.2 }}>
                  {task.title}
                </h2>
                <p style={{ color: TEXT_DIM, fontSize: "13px", marginTop: "5px" }}>
                  {isBot ? "is looking for new users" : "is looking for subscribers"}
                </p>

                {/* Badges */}
                <div className="flex items-center justify-center gap-2 mt-3">
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 20,
                    background: "rgba(255,255,255,0.05)",
                  }}>
                    {flowIcon}
                    <span style={{ color: TEXT_FAINT, fontSize: "11.5px", fontWeight: 600 }}>{flowLabel}</span>
                  </div>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 20,
                    background: "rgba(59,130,246,0.08)",
                  }}>
                    <span style={{ color: "#93c5fd", fontSize: "11.5px", fontWeight: 700 }}>
                      +{reward.toLocaleString()} POW
                    </span>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 20px" }} />
            </div>

            {/* ── Scrollable content ── */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 20px",
              paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 80px)",
            }}>
              {isBot     && withVerif  && <BotVerifiedFlow />}
              {isBot     && !withVerif && (
                <div className="flex flex-col gap-5">
                  <StepRow num={1} Icon={Bot} accent="#818cf8"
                    title="Open the Bot"
                    body="Press Start inside the bot — your reward is granted instantly." />
                  {!opened ? (
                    <ActionBtn color="indigo" onClick={handleOpen}>
                      <ExternalLink style={{ width: "17px", height: "17px" }} /> Open Bot
                    </ActionBtn>
                  ) : canClaim ? (
                    <ActionBtn color="green" onClick={() => { onClaim(task.id); handleClose(); }} disabled={claiming}>
                      {claiming
                        ? <Loader2 style={{ width: "17px", height: "17px", animation: "spin 1s linear infinite" }} />
                        : <><CheckCircle2 style={{ width: "17px", height: "17px" }} /> Claim +{reward.toLocaleString()} POW</>}
                    </ActionBtn>
                  ) : null}
                </div>
              )}
              {isChannel && withVerif  && <ChannelVerifiedFlow />}
              {isChannel && !withVerif && (
                <div className="flex flex-col gap-5">
                  <StepRow num={1} Icon={Megaphone} accent="#4ade80"
                    title="Open the Channel"
                    body="Join the channel — your reward is granted instantly." />
                  {!opened ? (
                    <ActionBtn color="green" onClick={handleOpen}>
                      <ExternalLink style={{ width: "17px", height: "17px" }} /> Open Channel
                    </ActionBtn>
                  ) : canClaim ? (
                    <ActionBtn color="green" onClick={() => { onClaim(task.id); handleClose(); }} disabled={claiming}>
                      {claiming
                        ? <Loader2 style={{ width: "17px", height: "17px", animation: "spin 1s linear infinite" }} />
                        : <><CheckCircle2 style={{ width: "17px", height: "17px" }} /> Claim +{reward.toLocaleString()} POW</>}
                    </ActionBtn>
                  ) : null}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
