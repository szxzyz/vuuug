const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      size: "invisible";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  remove?: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="${TURNSTILE_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Get a short-lived, one-time token for a protected action.
 * No site key means Turnstile is not configured yet; the server then keeps
 * using the existing anti-bot checks until the keys are supplied.
 */
export async function getTurnstileToken(action: string): Promise<string | null> {
  const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  if (!siteKey || typeof window === "undefined") return null;

  try {
    await loadTurnstile();
    if (!window.turnstile) return null;

    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.cssText =
      "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;";
    document.body.appendChild(container);

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      let widgetId = "";
      const finish = (token: string | null) => {
        if (settled) return;
        settled = true;
        if (widgetId && window.turnstile?.remove) window.turnstile.remove(widgetId);
        container.remove();
        resolve(token);
      };

      const timeout = window.setTimeout(() => finish(null), 15_000);
      const finishWithTimeout = (token: string | null) => {
        window.clearTimeout(timeout);
        finish(token);
      };

      try {
        widgetId = window.turnstile!.render(container, {
          sitekey: siteKey,
          action,
          size: "invisible",
          callback: (token) => finishWithTimeout(token),
          "expired-callback": () => finishWithTimeout(null),
          "error-callback": () => finishWithTimeout(null),
        });
        window.turnstile!.execute(widgetId);
      } catch {
        finishWithTimeout(null);
      }
    });
  } catch {
    return null;
  }
}