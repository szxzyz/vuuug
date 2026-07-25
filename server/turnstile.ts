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
 * Require a valid, one-time Turnstile token when the server secret is set.
 * Keeping enforcement conditional allows local development to work before the
 * Cloudflare keys are configured, while production becomes fail-closed once
 * the secret exists.
 */
export async function requireTurnstile(
  req: Request,
  action: string,
): Promise<{ status: number; body: Record<string, string> } | null> {
  if (!getTurnstileSecret()) return null;

  const result = await verifyToken(getToken(req), req.ip);
  if (result.success && (!result.action || result.action === action)) return null;

  console.warn(
    `🚫 Turnstile rejected request: action=${action} ip=${req.ip} errors=${(result.errorCodes || []).join(",")}`,
  );
  return {
    status: 403,
    body: {
      message: "Security verification failed. Please try again.",
      errorType: "turnstile_failed",
    },
  };
}