import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Megaphone, ExternalLink, ClipboardPaste, Link2,
  CheckCircle2, Loader2, AlertCircle, X, ShieldCheck, Zap,
} from "lucide-react";

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

const SHEET_BG   = "rgba(13,13,15,0.99)";
const CARD_BG    = "rgba(255,255,255,0.055)";
const CARD_BDR   = "rgba(255,255,255,0.08)";
const TEXT       = "#ffffff";
const TEXT_DIM   = "rgba(255,255,255,0.45)";
const TEXT_FAINT = "rgba(255,255,255,0.25)";

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
            background: i === current ? "#fff" : "rgba(255,255,255,0.2)",
          }}
          transition={{ duration: 0.22 }}
          style={{ height: "6px", borderRadius: "3px" }}
        />
      ))}
    </div>
  );
}

function StepRow({
  num, Icon, title, body, accent = "rgba(255,255,255,0.7)",
}: {
  num: number; Icon: React.ElementType; title: string; body: string; accent?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div style={{
        width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
        background: "rgba(255,255,255,0.07)", border: `1px solid ${CARD_BDR}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: "17px", height: "17px", color: accent }} />
      </div>
      <div style={{ paddingTop: "2px", flex: 1 }}>
        <p style={{ color: TEXT, fontWeight: 600, fontSize: "14px" }}>{title}</p>
        <p style={{ color: TEXT_DIM, fontSize: "12.5px", marginTop: "3px", lineHeight: 1.5 }}>{body}</p>
      </div>
    </div>
  );
}

// 7-day penalty warning banner — shown for all verified channel tasks
function ChannelPenaltyWarning() {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: "12px",
      background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.22)",
      display: "flex", alignItems: "flex-start", gap: "8px",
    }}>
      <span style={{ fontSize: "14px", flexShrink: 0, lineHeight: 1.4 }}>⚠️</span>
      <p style={{ color: "rgba(251,191,36,0.85)", fontSize: "12px", lineHeight: 1.55, margin: 0 }}>
        <strong>Warning:</strong> If you leave this channel within 7 days, a{" "}
        <strong>50,000 POW penalty</strong> will automatically be deducted from your account.
      </p>
    </div>
  );
}

export default function AdvertiserTaskSheet({
  task, open, reward, onClose, onClaim, claiming = false,
}: AdvertiserTaskSheetProps) {
  const [botStep, setBotStep]      = useState(0);
  const [referralPasted, setReferralPasted] = useState("");
  const [opened, setOpened]        = useState(false);
  const [canClaim, setCanClaim]    = useState(false);
  const [verifying, setVerifying]  = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const reset = () => {
    setBotStep(0); setReferralPasted(""); setOpened(false);
    setCanClaim(false); setVerifying(false); setVerifyError("");
  };

  const handleClose = () => { onClose(); setTimeout(reset, 380); };

  if (!task) return null;

  const isBot     = task.taskType === "bot";
  const isChannel = task.taskType === "channel";
  const withVerif = task.verificationRequired === true;

  // Open the task link — for without-verification: instant claim
  const handleOpen = () => {
    openLink(task.link);
    setOpened(true);
    if (!withVerif) {
      setCanClaim(true); // No verification: grant claim immediately, no countdown
    }
  };

  // Bot with verification: validate pasted referral link
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

  // Channel with verification: check membership via API and auto-claim if verified
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
        // Membership confirmed — auto-complete the task immediately
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

      <div className="text-center" style={{ marginBottom: "4px" }}>
        <p style={{ color: TEXT_FAINT, fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Step {botStep + 1} of 3
        </p>
      </div>

      <AnimatePresence mode="wait">
        {botStep === 0 && (
          <motion.div key="step0"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="flex flex-col gap-5"
          >
            <StepRow
              num={1} Icon={Bot} accent="#818cf8"
              title="Open Bot & Start It"
              body="Open the bot via the referral link and press Start to activate it."
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => { handleOpen(); setBotStep(1); }}
              style={{
                padding: "15px", borderRadius: "16px", fontWeight: 700, fontSize: "15px",
                background: "rgba(99,102,241,0.18)", border: "1px solid rgba(99,102,241,0.3)",
                color: "#a5b4fc", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              }}
            >
              <ExternalLink style={{ width: "17px", height: "17px" }} /> Open Bot
            </motion.button>
          </motion.div>
        )}

        {botStep === 1 && (
          <motion.div key="step1"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="flex flex-col gap-5"
          >
            <StepRow
              num={2} Icon={Link2} accent="#4ade80"
              title="Copy Your Referral Link"
              body="Inside the bot, go to Invite Friends → Copy your unique referral link."
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setBotStep(2)}
              style={{
                padding: "15px", borderRadius: "16px", fontWeight: 700, fontSize: "15px",
                background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.25)",
                color: "#4ade80", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              }}
            >
              I've Copied the Link →
            </motion.button>
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
              body="Come back here and paste the referral link you copied from the bot."
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
                  background: "rgba(255,255,255,0.05)", border: `1px solid ${CARD_BDR}`,
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
                    background: referralPasted.trim() ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${referralPasted.trim() ? "rgba(255,255,255,0.15)" : CARD_BDR}`,
                    color: referralPasted.trim() ? TEXT : TEXT_FAINT,
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
                    background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.3)",
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

  // ── BOT / CHANNEL without verification — instant claim ──
  const SimpleFlow = () => (
    <div className="flex flex-col gap-5">
      <div style={{
        padding: "16px", borderRadius: "16px",
        background: CARD_BG, border: `1px solid ${CARD_BDR}`,
      }}>
        <div className="flex items-center gap-3">
          <div style={{
            width: "42px", height: "42px", borderRadius: "12px", flexShrink: 0,
            background: isBot ? "rgba(99,102,241,0.12)" : "rgba(34,197,94,0.1)",
            border: isBot ? "1px solid rgba(99,102,241,0.25)" : "1px solid rgba(34,197,94,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isBot
              ? <Bot style={{ width: "20px", height: "20px", color: "#818cf8" }} />
              : <Megaphone style={{ width: "20px", height: "20px", color: "#4ade80" }} />}
          </div>
          <div>
            <p style={{ color: TEXT, fontWeight: 600, fontSize: "14px" }}>
              {isBot ? "Open and start the bot" : "Open and join the channel"}
            </p>
            <p style={{ color: TEXT_DIM, fontSize: "12px", marginTop: "2px" }}>
              {isBot ? "Press Start — reward is granted instantly" : "Join the channel — reward is granted instantly"}
            </p>
          </div>
        </div>
      </div>

      {!opened ? (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleOpen}
          style={{
            padding: "15px", borderRadius: "16px", fontWeight: 700, fontSize: "15px",
            background: isBot ? "rgba(99,102,241,0.18)" : "rgba(34,197,94,0.14)",
            border: isBot ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(34,197,94,0.25)",
            color: isBot ? "#a5b4fc" : "#4ade80",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          }}
        >
          <ExternalLink style={{ width: "17px", height: "17px" }} />
          {isBot ? "Open Bot" : "Open Channel"}
        </motion.button>
      ) : canClaim ? (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { onClaim(task.id); handleClose(); }}
          disabled={claiming}
          style={{
            padding: "15px", borderRadius: "16px", fontWeight: 700, fontSize: "15px",
            background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.3)",
            color: "#4ade80", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          }}
        >
          {claiming
            ? <Loader2 style={{ width: "17px", height: "17px", animation: "spin 1s linear infinite" }} />
            : <><CheckCircle2 style={{ width: "17px", height: "17px" }} /> Claim +{reward.toLocaleString()} POW</>}
        </motion.button>
      ) : null}
    </div>
  );

  // ── CHANNEL with VERIFICATION — join + auto-verify ──
  const ChannelVerifiedFlow = () => (
    <div className="flex flex-col gap-5">
      {/* 7-day penalty warning */}
      <ChannelPenaltyWarning />

      <StepRow
        num={1} Icon={Megaphone} accent="#4ade80"
        title="Join the Channel"
        body="Open and join this channel. Tap 'Verify Membership' — the bot checks automatically."
      />

      {!opened ? (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleOpen}
          style={{
            padding: "15px", borderRadius: "16px", fontWeight: 700, fontSize: "15px",
            background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.25)",
            color: "#4ade80", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          }}
        >
          <ExternalLink style={{ width: "17px", height: "17px" }} /> Open Channel
        </motion.button>
      ) : (
        <div className="flex flex-col gap-3">
          {verifyError && (
            <div className="flex items-center gap-2">
              <AlertCircle style={{ width: "13px", height: "13px", color: "#f87171", flexShrink: 0 }} />
              <p style={{ color: "#f87171", fontSize: "12px" }}>{verifyError}</p>
            </div>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleCheckMembership}
            disabled={verifying}
            style={{
              padding: "15px", borderRadius: "16px", fontWeight: 700, fontSize: "15px",
              background: "rgba(59,130,246,0.14)", border: "1px solid rgba(59,130,246,0.25)",
              color: "#93c5fd", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}
          >
            {verifying
              ? <><Loader2 style={{ width: "17px", height: "17px", animation: "spin 1s linear infinite" }} /> Checking...</>
              : <><ShieldCheck style={{ width: "17px", height: "17px" }} /> Verify Membership</>}
          </motion.button>
        </div>
      )}
    </div>
  );

  const flowLabel = isBot
    ? (withVerif ? "Bot · Verification" : "Bot · No Verification")
    : (withVerif ? "Channel · Verification" : "Channel · No Verification");

  const flowIcon = withVerif
    ? <ShieldCheck style={{ width: "13px", height: "13px", color: "#60a5fa" }} />
    : <Zap        style={{ width: "13px", height: "13px", color: "#facc15" }} />;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[72]"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
            onClick={handleClose}
          />

          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            className="fixed bottom-0 left-0 right-0 z-[73]"
            style={{
              background: SHEET_BG,
              backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "28px 28px 0 0",
              paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 112px)",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle + close */}
            <div className="flex items-center justify-between px-5 pt-4 pb-0">
              <div style={{ width: "32px" }} />
              <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.13)" }} />
              <button onClick={handleClose} style={{
                width: "32px", height: "32px", borderRadius: "50%",
                background: "rgba(255,255,255,0.07)", border: `1px solid ${CARD_BDR}`,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}>
                <X style={{ width: "15px", height: "15px", color: TEXT_DIM }} />
              </button>
            </div>

            {/* Title */}
            <div className="text-center px-6 pt-4 pb-2">
              <h2 style={{ color: TEXT, fontSize: "20px", fontWeight: 800, letterSpacing: "-0.02em" }}>
                {task.title}
              </h2>
              <p style={{ color: TEXT_DIM, fontSize: "13px", marginTop: "4px" }}>
                is looking for {isBot ? "referrals" : "subscribers"}
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                {flowIcon}
                <span style={{ color: TEXT_FAINT, fontSize: "11.5px", fontWeight: 600 }}>{flowLabel}</span>
              </div>
            </div>

            <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "12px 20px 16px" }} />

            <div className="px-5">
              {isBot && withVerif  && <BotVerifiedFlow />}
              {isBot && !withVerif && <SimpleFlow />}
              {isChannel && withVerif  && <ChannelVerifiedFlow />}
              {isChannel && !withVerif && <SimpleFlow />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
