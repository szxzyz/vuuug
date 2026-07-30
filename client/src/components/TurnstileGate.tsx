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
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";

  // Always start in "checking" — never skip the gate regardless of site-key presence.
  // A missing site key means misconfiguration and must block access, not grant it.
  const [state, setState] = useState<State>("checking");
  const [msg, setMsg] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const alive = useRef(true);

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

  // ── step 1 — check session ────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    // Missing site key means misconfiguration — block, never grant access.
    if (!siteKey) {
      console.error('[Turnstile] ❌ VITE_TURNSTILE_SITE_KEY is not set — access blocked');
      setMsg("Security verification is not properly configured. Contact support.");
      setState("unavailable");
      return;
    }
    setState("checking");
    console.log('[Turnstile] 🔄 Checking session status...');
    try {
      const r = await fetch("/api/turnstile/status", { credentials: "include", cache: "no-store" });
      const d = await r.json() as { verified: boolean; configured: boolean };
      if (!alive.current) return;
      if (d.verified) {
        console.log('[Turnstile] ✅ Session already verified — skipping challenge');
        setState("done");
      } else if (!d.configured) {
        // Server keys missing — this is a misconfiguration, not a pass-through.
        console.error('[Turnstile] ❌ Server reports Turnstile not configured — access blocked');
        setMsg("Security verification is not configured on the server. Contact support.");
        setState("unavailable");
      } else {
        console.log('[Turnstile] ℹ️ Not yet verified — showing challenge widget');
        setState("widget");
      }
    } catch {
      if (alive.current) {
        console.warn('[Turnstile] ⚠️ Status check failed — showing widget as fallback');
        setState("widget");
      }
    }
  }, [siteKey]);

  // ── preload — start fetching the CF script immediately on mount ───────────
  // This runs in parallel with checkStatus so the script is ready (or nearly
  // ready) by the time state transitions to "widget", preventing a visible
  // flash of the loading spinner between the status check and widget render.
  useEffect(() => {
    if (!siteKey) return;
    loadScript().catch(() => {
      // Ignore errors here — the "widget" effect handles them with retry logic.
    });
  }, [siteKey]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // ── step 2 — render widget ─────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "widget") return;
    // Missing site key means misconfiguration — block, never grant access.
    if (!siteKey) {
      console.error('[Turnstile] ❌ Site key missing — cannot render widget, blocking access');
      setMsg("Security verification is not properly configured. Contact support.");
      setState("unavailable");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        console.log('[Turnstile] 🔄 Loading Cloudflare Turnstile script...');
        await loadScript();
        if (cancelled || !alive.current) return;
        console.log('[Turnstile] ✅ Cloudflare script loaded successfully');
        const el = containerRef.current;
        if (!el) return;
        dropWidget();
        const api = cf()!;
        const id = api.render(el, {
          sitekey: siteKey,
          theme: "dark",
          size: "normal",
          callback: (token) => {
            if (alive.current) {
              console.log('[Turnstile] ✅ Token received from widget — starting backend verification');
              submit(token);
            }
          },
          "expired-callback": () => {
            const a = cf();
            if (widgetId.current !== null && a) {
              console.log('[Turnstile] ℹ️ Token expired — resetting widget');
              try { a.reset(widgetId.current); } catch { /* ignore */ }
            }
          },
          "error-callback": (code) => {
            if (!alive.current) return;
            console.error('[Turnstile] ❌ Widget error, code:', code);
            const net = !code || code.startsWith("110") || code === "crashed";
            setMsg(net
              ? "Cloudflare could not load. Check your connection and retry."
              : "Widget error. Please retry.");
            setState(net ? "unavailable" : "error");
          },
        });
        widgetId.current = id;
        console.log('[Turnstile] ✅ Widget rendered successfully, id:', id);
      } catch (err) {
        if (!alive.current) return;
        console.error('[Turnstile] ❌ Failed to load Cloudflare script:', err);
        setMsg("Failed to load verification widget. Please retry.");
        setState("unavailable");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, siteKey]);

  // ── step 3 — verify token ──────────────────────────────────────────────────
  // Retries the POST with the same token on transient network / 503 errors
  // (exponential back-off: 1 s → 2 s → 4 s) before surfacing the "unavailable"
  // state.  The token is only refreshed (widget re-render) after all fetch
  // retries fail — this keeps the user on "Verifying…" instead of flashing
  // an error before they even saw the challenge widget.
  const MAX_FETCH_RETRIES = 3;

  async function submit(token: string, attempt = 0): Promise<void> {
    setState("submitting");
    console.log(`[Turnstile] 🔄 Backend verification started (attempt ${attempt + 1})`);
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
        console.log('[Turnstile] ✅ Backend verification success — access granted');
        setState("success");
        setTimeout(() => { if (alive.current) setState("done"); }, 700);
        return;
      }

      console.warn(`[Turnstile] ❌ Backend verification failed: ${d.message ?? 'unknown'} retryable=${d.retryable}`);
      const isTransient = r.status === 503 || d.retryable === true;
      if (isTransient && attempt < MAX_FETCH_RETRIES) {
        // Back-off and retry the same token — the server is warming up
        await new Promise(res => setTimeout(res, Math.min(1000 * 2 ** attempt, 8000)));
        if (!alive.current) return;
        return submit(token, attempt + 1);
      }

      if (isTransient) {
        // All retries exhausted — surface a clear error so the user can act.
        // Do NOT silently reset to "widget"; that creates an invisible loop.
        setMsg(d.message ?? "Verification service unavailable. Please retry.");
        setState("unavailable");
      } else {
        setMsg(d.message ?? "Verification failed. Please try again.");
        setState("error");
      }
    } catch (err) {
      if (!alive.current) return;
      console.error(`[Turnstile] ❌ Network error during verification (attempt ${attempt + 1}):`, err);
      // Network error — retry silently before surfacing anything.
      // Root-cause scenario: server is still starting when Cloudflare
      // auto-solves the challenge, so the POST fires before the API is ready.
      if (attempt < MAX_FETCH_RETRIES) {
        await new Promise(res => setTimeout(res, Math.min(1000 * 2 ** attempt, 8000)));
        if (!alive.current) return;
        return submit(token, attempt + 1);
      }
      // All retries exhausted — show error with a manual retry button
      setMsg("Verification service temporarily unavailable. Please retry.");
      setState("unavailable");
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
