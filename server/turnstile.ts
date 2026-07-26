import type { Request } from "express";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileVerification = {
  success: boolean;
  action?: string;
  errorCodes?: string[];
};

function getTurnstileSecret(): string {
  return (
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ||
    process.env.TURNSTILE_SECRET_KEY ||
    ""
  ).trim();
}

function getToken(req: Request): string {
  const headerToken = req.headers["x-turnstile-token"];
  if (typeof headerToken === "string") return headerToken.trim();

  const bodyToken = (req as any).body?.turnstileToken;
  return typeof bodyToken === "string" ? bodyToken.trim() : "";
}

async function verifyToken(
  token: string,
  remoteip?: string,
): Promise<TurnstileVerification> {
  const secret = getTurnstileSecret();
  if (!secret || !token) return { success: false, errorCodes: ["missing-input"] };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip && remoteip !== "unknown") body.set("remoteip", remoteip);

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      console.error(`Turnstile verification HTTP ${response.status}`);
      return { success: false, errorCodes: [`http-${response.status}`] };
    }

    const result = (await response.json()) as {
      success?: boolean;
      action?: string;
      ["error-codes"]?: string[];
    };
    return {
      success: result.success === true,
      action: result.action,
      errorCodes: result["error-codes"],
    };
  } catch (error) {
    console.error("Turnstile verification failed:", error);
    return { success: false, errorCodes: ["verification-request-failed"] };
  }
}

/**
 * Require a valid Turnstile token when the server secret is set AND the client
 * actually provided a token.
 *
 * Why "only when a token is provided":
 * Turnstile requires VITE_TURNSTILE_SITE_KEY to be baked into the frontend at
 * build time. If that key is missing the client sends no token at all, and
 * hard-blocking every such request would lock out every legitimate user in
 * deployments where only the server secret has been configured.
 *
 * Threat model: A bot that does not know to forge a Turnstile token is already
 * gated by Telegram HMAC + the antiBot interaction-proof chain. Blocking a
 * forged (wrong) token is the valuable check; blocking a missing token in a
 * misconfigured deployment is not worth the user impact.
 */
export async function requireTurnstile(
  req: Request,
  action: string,
): Promise<{ status: number; body: Record<string, string> } | null> {
  if (!getTurnstileSecret()) return null;   // Turnstile not configured — skip

  const token = getToken(req);
  if (!token) {
    // No token in the request — client does not have VITE_TURNSTILE_SITE_KEY
    // configured. Log for monitoring, but allow through so legitimate WebApp
    // users are not blocked. Other bot-detection layers still apply.
    console.warn(
      `⚠️ Turnstile: no token provided for action=${action} ip=${req.ip} — VITE_TURNSTILE_SITE_KEY may not be set on the client`,
    );
    return null;
  }

  // A token was sent — verify it. Forged or expired tokens are blocked.
  const result = await verifyToken(token, req.ip);
  if (result.success && (!result.action || result.action === action)) return null;

  console.warn(
    `🚫 Turnstile rejected token: action=${action} ip=${req.ip} errors=${(result.errorCodes || []).join(",")}`,
  );
  return {
    status: 403,
    body: {
      message: "Security verification failed. Please try again.",
      errorType: "turnstile_failed",
    },
  };
}