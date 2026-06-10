import { useState } from "react";
import { FaHandPointer } from "react-icons/fa";
import { MdCheckBox, MdCheckBoxOutlineBlank } from "react-icons/md";

interface AdFailurePopupProps {
  onClose: () => void;
}

export default function AdFailurePopup({ onClose }: AdFailurePopupProps) {
  const [checked, setChecked] = useState(false);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(10px)",
      }} />

      <div style={{
        position: "relative", width: "100%", maxWidth: 480,
        background: "linear-gradient(160deg, #0d0d10, #111118)",
        borderRadius: "24px 24px 0 0",
        padding: "28px 20px",
        paddingBottom: "max(28px, calc(env(safe-area-inset-bottom, 0px) + 24px))",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        {/* Drag handle */}
        <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", margin: "0 auto 20px" }} />

        {/* Title */}
        <h2 style={{ color: "#fff", fontSize: 18, fontWeight: 900, textAlign: "center", margin: "0 0 16px" }}>
          You need to interact with the ad.
        </h2>

        {/* Go button image */}
        <div style={{
          width: "100%",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 18,
          background: "#0d1117",
        }}>
          <img
            src="/go-btn.jpg"
            alt="Go button — tap this inside the ad"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>

        {/* Message rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <div style={{
            background: "rgba(239,68,68,0.06)",
            borderRadius: 12, padding: "12px 14px",
            display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <FaHandPointer size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5, lineHeight: 1.55 }}>
              <strong style={{ color: "#f87171" }}>Don't skip the ad</strong> — watch the full ad to earn your reward!
            </span>
          </div>

          <div style={{
            background: "rgba(59,130,246,0.06)",
            borderRadius: 12, padding: "12px 14px",
            display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <FaHandPointer size={14} color="#3b82f6" style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5, lineHeight: 1.55 }}>
              Watch the ad, then tap the advertiser button to confirm your interaction.{" "}
              <strong style={{ color: "#93c5fd" }}>TAP THE ADVERTISER BUTTON</strong> when it appears.
            </span>
          </div>
        </div>

        {/* Checkbox */}
        <div
          onClick={() => setChecked(p => !p)}
          style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            cursor: "pointer", marginBottom: 18,
            background: checked ? "rgba(37,99,235,0.08)" : "rgba(255,255,255,0.02)",
            borderRadius: 12, padding: "12px 13px",
            transition: "background 0.18s ease",
          }}
        >
          {checked
            ? <MdCheckBox size={22} color="#3b82f6" style={{ flexShrink: 0, marginTop: 1 }} />
            : <MdCheckBoxOutlineBlank size={22} color="rgba(255,255,255,0.25)" style={{ flexShrink: 0, marginTop: 1 }} />
          }
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.6, userSelect: "none" }}>
            I understand — I will tap the{" "}
            <strong style={{ color: "#93c5fd" }}>Blue button</strong> inside the ad and stay on the page for at least 3 seconds.
          </span>
        </div>

        {/* OK button */}
        <button
          onClick={onClose}
          disabled={!checked}
          style={{
            width: "100%", padding: "14px 0",
            background: checked ? "linear-gradient(135deg, #2563eb, #3b82f6)" : "rgba(255,255,255,0.05)",
            border: "none", borderRadius: 14,
            color: checked ? "#fff" : "rgba(255,255,255,0.2)",
            fontSize: 15, fontWeight: 800,
            cursor: checked ? "pointer" : "not-allowed",
            boxShadow: checked ? "0 4px 18px rgba(37,99,235,0.35)" : "none",
            letterSpacing: "0.02em",
            transition: "all 0.2s ease",
          }}
        >
          {checked ? "OK, I Understand" : "Tick the checkbox to continue"}
        </button>
      </div>
    </div>
  );
}
