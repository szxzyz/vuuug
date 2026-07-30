/**
 * TurnstileActionModal — visible per-action Turnstile challenge.
 *
 * Renders a full-screen backdrop + modal card with a fresh Cloudflare
 * Turnstile widget. Calls `onVerified(token)` when the user completes
 * the challenge, `onCancel()` if they dismiss it.
 *
 * Used for high-value actions: ad reward claim, withdrawal, promo redeem.
 * Tokens are one-time use — a new widget is rendered on every open.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, Loader2, X } from "lucide-react";

const CF_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";

// Shared script promise — only one <script> tag ever injected
let _scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if ((window as any).turnstile) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise<void>((resolve, reject) => {
    // Script already in DOM — hook onload
    if (document.querySelector(`script[src^="https://challenges.cloudflare.com/turnstile"]`)) {
      const prev = window.onTurnstileLoad;
      window.onTurnstileLoad = () => { prev?.(); resolve(); };
      return;
    }
    window.onTurnstileLoad = () => resolve();
    const s = document.createElement("script");
    s.src = CF_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onerror = () => { _scriptPromise = null; reject(new Error("Turnstile script load failed")); };
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

type ModalState = "loading" | "widget" | "error" | "unavailable";

export interface TurnstileActionModalProps {
  /** Cloudflare action name — used for logging on the CF dashboard */
  action: string;
  /** Heading shown inside the card */
  title: string;
  /** Optional sub-text */
  description?: string;
  /** Called with the raw CF token once the widget solves */
  onVerified: (token: string) => void;
  /** Called when the user taps the × button or the backdrop */
  onCancel: () => void;
}

export default function TurnstileActionModal({
  action,
  title,
  description,
  onVerified,
  onCancel,
}: TurnstileActionModalProps) {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";

  const [state, setState] = useState<ModalState>("loading");
  const [msg, setMsg] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const alive = useRef(true);

  // ── cleanup ────────────────────────────────────────────────────────────────
  const dropWidget = useCallback(() => {
    const api = (window as any).turnstile;
    if (widgetId.current !== null && api) {
      try { api.remove(widgetId.current); } catch { /* ignore */ }
      widgetId.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; dropWidget(); };
  }, [dropWidget]);

  // ── load script ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!siteKey) {
      setMsg("Security verification is not configured. Contact support.");
      setState("unavailable");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadScript();
        if (cancelled || !alive.current) return;
        setState("widget");
      } catch {
        if (!alive.current) return;
        setMsg("Failed to load verification widget. Check your connection and retry.");
        setState("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [siteKey]);

  // ── render widget ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "widget") return;
    const el = containerRef.current;
    if (!el) return;
    const api = (window as any).turnstile as any;
    if (!api?.render) return;
    dropWidget();
    try {
      const id = api.render(el, {
        sitekey: siteKey,
        action,
        theme: "dark",
        size: "normal",
        callback: (token: string) => {
          if (alive.current) onVerified(token);
        },
        "expired-callback": () => {
          // Token expired before parent used it — reset so user can retry
          if (widgetId.current !== null && (window as any).turnstile) {
            try { (window as any).turnstile.reset(widgetId.current); } catch { /* ignore */ }
          }
        },
        "error-callback": (code?: string) => {
          if (!alive.current) return;
          const isNet = !code || code.startsWith("110") || code === "crashed";
          setMsg(isNet
            ? "Cloudflare could not load. Check your connection and retry."
            : "Verification error. Please retry.");
          setState(isNet ? "unavailable" : "error");
        },
      });
      widgetId.current = id;
    } catch {
      setMsg("Failed to render verification widget. Please retry.");
      setState("unavailable");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, siteKey, action]);

  const retry = () => { dropWidget(); setMsg(""); setState("widget"); };
  const isErr = state === "error" || state === "unavailable";

  return (
    <>
      {/* Backdrop — click to cancel */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(0,0,0,0.78)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      />

      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Security verification"
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          width: "100%", maxWidth: 360,
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "28px 24px 24px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
          fontFamily: "'Inter','DM Sans',system-ui,sans-serif",
          position: "relative",
        }}>

          {/* Close button */}
          <button
            onClick={onCancel}
            aria-label="Cancel"
            style={{
              position: "absolute", top: 14, right: 14,
              background: "none", border: "none",
              color: "rgba(255,255,255,0.3)", cursor: "pointer",
              padding: 4, display: "flex", alignItems: "center",
              borderRadius: 6,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
          >
            <X size={16} />
          </button>

          {/* Status icon */}
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: isErr ? "rgba(255,160,0,0.1)" : "rgba(0,123,255,0.1)",
            border: `1.5px solid ${isErr ? "rgba(255,160,0,0.3)" : "rgba(0,123,255,0.25)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {state === "loading"
              ? <Loader2 size={22} style={{ color: "#007BFF", animation: "spin 1s linear infinite" }} />
              : isErr
                ? <AlertTriangle size={22} style={{ color: "#ffa000" }} />
                : <ShieldCheck size={22} style={{ color: "#007BFF" }} />
            }
          </div>

          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          {/* Title + description */}
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 5px", letterSpacing: "-0.2px" }}>
              {isErr ? "Verification error" : title}
            </p>
            {!isErr && description && (
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, margin: "0 0 4px", lineHeight: 1.5 }}>
                {description}
              </p>
            )}
            {state === "loading" && (
              <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 12, margin: 0 }}>
                Loading verification…
              </p>
            )}
            {state === "widget" && (
              <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, margin: 0 }}>
                Complete the challenge below to continue
              </p>
            )}
            {isErr && (
              <p style={{ color: "rgba(255,160,0,0.8)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                {msg}
              </p>
            )}
          </div>

          {/* Turnstile widget container */}
          {state === "widget" && (
            <div ref={containerRef} style={{ lineHeight: 0 }} />
          )}

          {/* Retry button (error / unavailable states) */}
          {isErr && (
            <button
              onClick={retry}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "#007BFF", color: "#fff",
                border: "none", borderRadius: 10,
                padding: "10px 22px", fontSize: 14, fontWeight: 600,
                cursor: "pointer", width: "100%", justifyContent: "center",
                transition: "opacity .15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = ".85")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <RefreshCw size={14} /> Retry
            </button>
          )}

          {/* CF badge */}
          <p style={{ color: "rgba(255,255,255,0.15)", fontSize: 11, margin: 0 }}>
            Protected by Cloudflare Turnstile
          </p>
        </div>
      </div>
    </>
  );
}
