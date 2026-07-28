/**
 * TurnstileGate — minimal popup that blocks the app until Cloudflare
 * Turnstile verification is complete.
 *
 * Flow:
 *  1. Mount → GET /api/turnstile/status
 *     → verified / not configured : render children immediately (no popup)
 *     → unverified                : show modal with Turnstile widget
 *  2. Widget success → POST token to /api/turnstile/verify
 *     → success  : dismiss popup, render children
 *     → failure  : error message + retry button inside popup
 *  3. If Cloudflare is unreachable (503 / network): friendly message + retry
 *  4. Session stamp lasts 24 h; after expiry the status check triggers the
 *     popup again automatically.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";

// ── Turnstile loader ─────────────────────────────────────────────────────────

const CF_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";

// Separate local type so we don't conflict with the invisible-mode declaration
// in lib/turnstile.ts — we access the API via (window as any).turnstile.
type CfTurnstile = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme: "dark" | "light" | "auto";
      size?: "normal" | "compact" | "flexible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": (code?: string) => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    onTurnstileLoad?: () => void;
  }
}

const cf = (): CfTurnstile | undefined => (window as any).turnstile;

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (cf()) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src^="https://challenges.cloudflare.com/turnstile"]`) && cf()) {
      return resolve();
    }
    window.onTurnstileLoad = () => resolve();
    const s = document.createElement("script");
    s.src = CF_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onerror = () => { scriptPromise = null; reject(new Error("script load failed")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

// ── Types ────────────────────────────────────────────────────────────────────

type State =
  | "checking"    // GET /api/turnstile/status in flight
  | "widget"      // showing the widget
  | "submitting"  // POST /api/turnstile/verify in flight
  | "success"     // brief success flash
  | "error"       // verification rejected
  | "unavailable" // Cloudflare / network down
  | "done";       // popup dismissed — children visible

// ── Component ────────────────────────────────────────────────────────────────

export default function TurnstileGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [msg, setMsg] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const alive = useRef(true);
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";

  // ── cleanup ────────────────────────────────────────────────────────────────
  const dropWidget = useCallback(() => {
    const api = cf();
    if (widgetId.current !== null && api) {
      try { api.remove(widgetId.current); } catch { /* ignore */ }
      widgetId.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; dropWidget(); };
  }, [dropWidget]);

  // ── step 1 — check session ─────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    setState("checking");
    try {
      const r = await fetch("/api/turnstile/status", { credentials: "include", cache: "no-store" });
      const d = await r.json() as { verified: boolean; configured: boolean };
      if (!alive.current) return;
      setState(d.verified || !d.configured ? "done" : "widget");
    } catch {
      if (alive.current) setState("widget");
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // ── step 2 — render widget ─────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "widget") return;
    if (!siteKey) { setState("done"); return; }

    let cancelled = false;
    (async () => {
      try {
        await loadScript();
        if (cancelled || !alive.current) return;
        const el = containerRef.current;
        if (!el) return;
        dropWidget();
        const api = cf()!;
        const id = api.render(el, {
          sitekey: siteKey,
          theme: "dark",
          size: "normal",
          callback: (token) => { if (alive.current) submit(token); },
          "expired-callback": () => {
            const a = cf();
            if (widgetId.current !== null && a) {
              try { a.reset(widgetId.current); } catch { /* ignore */ }
            }
          },
          "error-callback": (code) => {
            if (!alive.current) return;
            const net = !code || code.startsWith("110") || code === "crashed";
            setMsg(net
              ? "Cloudflare could not load. Check your connection and retry."
              : "Widget error. Please retry.");
            setState(net ? "unavailable" : "error");
          },
        });
        widgetId.current = id;
      } catch {
        if (!alive.current) return;
        setMsg("Failed to load verification widget. Please retry.");
        setState("unavailable");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, siteKey]);

  // ── step 3 — verify token ──────────────────────────────────────────────────
  async function submit(token: string) {
    setState("submitting");
    try {
      const r = await fetch("/api/turnstile/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json() as { success: boolean; message?: string; retryable?: boolean };
      if (!alive.current) return;
      if (d.success) {
        setState("success");
        setTimeout(() => { if (alive.current) setState("done"); }, 700);
      } else if (r.status === 503 || d.retryable) {
        setMsg(d.message ?? "Verification service unavailable. Please retry.");
        setState("unavailable");
      } else {
        setMsg(d.message ?? "Verification failed. Please try again.");
        setState("error");
      }
    } catch {
      if (alive.current) {
        setMsg("Network error. Please check your connection and retry.");
        setState("unavailable");
      }
    }
  }

  function retry() { dropWidget(); setMsg(""); setState("widget"); }

  // ── render — children ──────────────────────────────────────────────────────
  if (state === "done") return <>{children}</>;

  // ── render — popup ─────────────────────────────────────────────────────────
  // Children are NOT rendered at all until state === "done". This ensures no
  // App effects (auth, membership checks, etc.) fire against protected API
  // routes before the Turnstile session is stamped.
  const isLoading = state === "checking" || state === "submitting";
  const isErr = state === "error" || state === "unavailable";

  return (
    <>
      {/* backdrop */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }} />

      {/* popup card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Security verification"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{
          width: "100%",
          maxWidth: 360,
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "28px 24px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
          fontFamily: "'Inter','DM Sans',system-ui,sans-serif",
        }}>

          {/* icon */}
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: isErr
              ? "rgba(255,160,0,0.1)"
              : state === "success"
                ? "rgba(0,200,100,0.1)"
                : "rgba(0,123,255,0.1)",
            border: `1.5px solid ${isErr ? "rgba(255,160,0,0.3)" : state === "success" ? "rgba(0,200,100,0.35)" : "rgba(0,123,255,0.25)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isLoading
              ? <Loader2 size={22} style={{ color: "#007BFF", animation: "spin 1s linear infinite" }} />
              : isErr
                ? <AlertTriangle size={22} style={{ color: "#ffa000" }} />
                : <ShieldCheck size={22} style={{ color: state === "success" ? "#00c864" : "#007BFF" }} />
            }
          </div>

          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          {/* text */}
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.2px" }}>
              {state === "checking" && "Checking…"}
              {state === "widget" && "Verify you are human"}
              {state === "submitting" && "Verifying…"}
              {state === "success" && "Verified!"}
              {state === "error" && "Verification failed"}
              {state === "unavailable" && "Service unavailable"}
            </p>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              {state === "checking" && "Checking your session"}
              {state === "widget" && "Complete the challenge below to continue"}
              {state === "submitting" && "Confirming with Cloudflare…"}
              {state === "success" && "Opening the app…"}
              {isErr && (msg || "Please try again.")}
            </p>
          </div>

          {/* widget container */}
          {state === "widget" && (
            <div ref={containerRef} style={{ lineHeight: 0 }} />
          )}

          {/* retry */}
          {isErr && (
            <button onClick={retry} style={{
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
              <RefreshCw size={14} /> Try again
            </button>
          )}

          {/* badge */}
          {(state === "widget" || isErr) && (
            <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 11, margin: 0 }}>
              Protected by Cloudflare Turnstile
            </p>
          )}
        </div>
      </div>
    </>
  );
}
