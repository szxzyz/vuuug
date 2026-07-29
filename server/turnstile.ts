/**
 * Invisible Turnstile helper for background API protection.
 *
 * Renders an invisible Cloudflare Turnstile widget to obtain a one-time
 * token that is attached to specific API requests via `x-turnstile-token`.
 *
 * If VITE_TURNSTILE_SITE_KEY is not configured, or if Cloudflare is
 * unreachable, returns null — non-blocking so callers are never stalled.
 * The server decides whether the token is required for each endpoint.
 */

const SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";

const CF_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";

// Single shared promise so the <script> tag is only injected once.
let _scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if ((window as any).turnstile) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;

  _scriptPromise = new Promise<void>((resolve, reject) => {
    // Script tag already in DOM — hook the pending onload callback.
    if (
      document.querySelector(
        `script[src^="https://challenges.cloudflare.com/turnstile"]`,
      )
    ) {
      const prev = window.onTurnstileLoad;
      window.onTurnstileLoad = () => {
        prev?.();
        resolve();
      };
      return;
    }

    window.onTurnstileLoad = () => resolve();

    const s = document.createElement("script");
    s.src = CF_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      _scriptPromise = null; // allow retry on next call
      reject(new Error("Turnstile script load failed"));
    };
    document.head.appendChild(s);
  });

  return _scriptPromise;
}

/**
 * Obtain a Turnstile invisible-challenge token for `action`.
 * Returns the token string on success, or `null` if:
 *   - VITE_TURNSTILE_SITE_KEY is not set
 *   - Cloudflare script fails to load
 *   - The invisible challenge errors or times out (15 s)
 *
 * Never throws.
 */
export async function getTurnstileToken(action: string): Promise<string | null> {
  if (!SITE_KEY) return null;

  try {
    await loadTurnstileScript();
  } catch (err) {
    console.warn(
      `[turnstile] Script load failed for action="${action}" — skipping invisible challenge:`,
      err,
    );
    return null;
  }

  const api = (window as any).turnstile as
    | {
        render: (el: HTMLElement, opts: Record<string, unknown>) => string;
        remove: (id: string) => void;
      }
    | undefined;

  if (!api?.render) {
    console.warn("[turnstile] API not available after script load");
    return null;
  }

  return new Promise<string | null>((resolve) => {
    // Off-screen throw-away container — invisible to the user.
    const container = document.createElement("div");
    container.style.cssText =
      "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(container);

    let widgetId: string | null = null;
    let settled = false;

    const cleanup = () => {
      if (widgetId !== null) {
        try {
          api.remove(widgetId);
        } catch {
          /* ignore */
        }
        widgetId = null;
      }
      if (container.parentNode) container.parentNode.removeChild(container);
    };

    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(token);
    };

    // 15-second guard — Cloudflare auto-solve completes well under this.
    const timer = setTimeout(() => {
      console.warn(
        `[turnstile] Invisible challenge timed out for action="${action}"`,
      );
      settle(null);
    }, 15_000);

    try {
      widgetId = api.render(container, {
        sitekey: SITE_KEY,
        action,
        size: "invisible",
        theme: "dark",
        callback: (token: string) => settle(token),
        "expired-callback": () => {
          console.warn(
            `[turnstile] Invisible token expired for action="${action}"`,
          );
          settle(null);
        },
        "error-callback": (code?: string) => {
          console.warn(
            `[turnstile] Invisible challenge error code=${code ?? "unknown"} action="${action}"`,
          );
          settle(null);
        },
      });
    } catch (err) {
      console.warn(`[turnstile] render() threw for action="${action}":`, err);
      settle(null);
    }
  });
}

// Make TypeScript happy with the global callback name used by the CF script.
declare global {
  interface Window {
    onTurnstileLoad?: () => void;
  }
}
