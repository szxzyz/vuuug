import { useEffect, useState } from "react";

interface WatchInstructionPopupProps {
  onContinue: () => void;
}

export default function WatchInstructionPopup({ onContinue }: WatchInstructionPopupProps) {
  const [visible,  setVisible]  = useState(false);
  const [checked,  setChecked]  = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  const steps = [
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      ),
      title: "Tap Start Earning",
      desc: 'Press the "Start Earning" button — an AdsGram ad will open.',
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
      title: "Tap This Button Inside the Ad",
      desc: (
        <div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }}>
            You will see this blue button inside the ad —{" "}
            <strong style={{ color: "#93c5fd" }}>you must tap it</strong> to earn your reward.
          </div>
          {/* Cropped Play Now image */}
          <div style={{
            width: "100%",
            maxWidth: 230,
            height: 50,
            borderRadius: 10,
            overflow: "hidden",
            border: "1.5px solid rgba(59,130,246,0.4)",
            boxShadow: "0 0 14px rgba(59,130,246,0.2)",
          }}>
            <img
              src="/play-now-btn.jpg"
              alt="Play Now button"
              style={{
                width: "100%",
                height: "200%",
                objectFit: "cover",
                objectPosition: "center 60%",
                display: "block",
                marginTop: "-2px",
              }}
            />
          </div>
        </div>
      ),
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      title: "Stay for 3 Seconds",
      desc: "Wait at least 3 seconds on the external page, then return to the app.",
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>
        </svg>
      ),
      title: "Reward Credited",
      desc: "POW Tokens will be added to your wallet automatically.",
    },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9990,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      pointerEvents: visible ? "auto" : "none",
    }}>
      {/* Backdrop */}
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(10px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.35s ease",
      }}/>

      {/* Sheet */}
      <div style={{
        position: "relative",
        width: "100%", maxWidth: 480,
        background: "linear-gradient(170deg, #0e0e14, #111119)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "26px 26px 0 0",
        padding: "28px 20px",
        paddingBottom: "max(28px, calc(env(safe-area-inset-bottom, 0px) + 24px))",
        transform: visible ? "translateY(0)" : "translateY(110%)",
        transition: "transform 0.42s cubic-bezier(0.32, 0.94, 0.60, 1)",
        willChange: "transform",
        maxHeight: "90vh",
        overflowY: "auto",
      }}>
        {/* Drag handle */}
        <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", margin: "0 auto 22px" }}/>

        {/* Title */}
        <h2 style={{ color: "#fff", fontSize: 19, fontWeight: 900, textAlign: "center", letterSpacing: "0.02em", marginBottom: 4 }}>
          How to Earn
        </h2>
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, textAlign: "center", marginBottom: 22 }}>
          Follow these steps to receive your reward
        </p>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: "flex", gap: 14, alignItems: "flex-start",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 14, padding: "13px 14px",
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {step.icon}
              </div>
              <div>
                <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                  {step.title}
                </div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11.5, lineHeight: 1.55 }}>
                  {step.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Checkbox — T&C style */}
        <label style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          cursor: "pointer", marginBottom: 18,
          background: checked ? "rgba(37,99,235,0.08)" : "rgba(255,255,255,0.02)",
          border: `1px solid ${checked ? "rgba(59,130,246,0.35)" : "rgba(255,255,255,0.07)"}`,
          borderRadius: 12, padding: "12px 14px",
          transition: "all 0.2s ease",
        }}>
          {/* Custom checkbox */}
          <div
            onClick={() => setChecked(p => !p)}
            style={{
              width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
              border: `2px solid ${checked ? "#3b82f6" : "rgba(255,255,255,0.2)"}`,
              background: checked ? "#2563eb" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.18s ease",
            }}
          >
            {checked && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 6 5 9 10 3"/>
              </svg>
            )}
          </div>
          <span
            onClick={() => setChecked(p => !p)}
            style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 1.6, userSelect: "none" }}
          >
            I understand — I will tap the{" "}
            <strong style={{ color: "#93c5fd" }}>Play Now</strong> button inside the ad and stay on the page for at least 3 seconds.
          </span>
        </label>

        {/* Continue button */}
        <button
          onClick={onContinue}
          disabled={!checked}
          style={{
            width: "100%", padding: "14px 0",
            background: checked
              ? "linear-gradient(135deg, #2563eb, #3b82f6)"
              : "rgba(255,255,255,0.06)",
            border: "none", borderRadius: 16,
            color: checked ? "#fff" : "rgba(255,255,255,0.25)",
            fontSize: 15, fontWeight: 800, cursor: checked ? "pointer" : "not-allowed",
            boxShadow: checked ? "0 4px 20px rgba(37,99,235,0.4)" : "none",
            letterSpacing: "0.02em",
            transition: "all 0.2s ease",
          }}
        >
          {checked ? "I Understand, Continue →" : "Tick the checkbox to continue"}
        </button>
      </div>
    </div>
  );
}
