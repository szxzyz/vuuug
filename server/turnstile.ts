import type { Request, Response, NextFunction } from "express";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFIED_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

// Routes that bypass the Turnstile session gate entirely
const TURNSTILE_EXEMPT_PATHS = new Set([
  "/api/turnstile/verify",
  "/api/turnstile/status",
  "/api/telegram/webhook",
  "/api/telegram/webhook/status",
  "/api/test-direct",
  "/api/emergency-fix-referrals",
]);

// ── Types ────────────────────────────────────────────────────────────────────

type TurnstileVerification = {
  success: boolean;
  action?: string;
  errorCodes?: string[];
};

declare module "express-session" {
  interface SessionData {
    /** Unix timestamp (ms) when the user last completed Turnstile verification */
    turnstileVerifiedAt?: number;
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

function getTurnstileSecret(): string {
  return (
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ||
    process.env.TURNSTILE_SECRET_KEY ||
    ""
  ).trim();
}

function getClientIP(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return (typeof fwd === "string" ? fwd : fwd[0]).split(",")[0].trim();
  return req.ip || "unknown";
}

function extractToken(req: Request): string {
  const headerToken = req.headers["x-turnstile-token"];
  if (typeof headerToken === "string") return headerToken.trim();
  const body = (req as any).body;
  const bodyToken = body?.token ?? body?.turnstileToken;
  return typeof bodyToken === "string" ? bodyToken.trim() : "";
}

async function verifyTokenWithCloudflare(
  token: string,
  remoteip?: string,
): Promise<TurnstileVerification> {
  const secret = getTurnstileSecret();
  if (!secret || !token) return { success: false, errorCodes: ["missing-input"] };

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteip && remoteip !== "unknown") params.set("remoteip", remoteip);

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`Turnstile HTTP error: ${response.status}`);
      return { success: false, errorCodes: [`http-${response.status}`] };
    }

    const result = (await response.json()) as {
      success?: boolean;
      action?: string;
      "error-codes"?: string[];
    };
    return {
      success: result.success === true,
      action: result.action,
      errorCodes: result["error-codes"],
    };
  } catch (error: any) {
    if (error?.name === "TimeoutError" || error?.code === "ABORT_ERR") {
      console.error("Turnstile verification timed out");
      return { success: false, errorCodes: ["timeout"] };
    }
    console.error("Turnstile verification error:", error);
    return { success: false, errorCodes: ["verification-request-failed"] };
  }
}

// ── Session gate (full-page verification) ────────────────────────────────────

/**
 * Returns true when the current session has a valid (≤ 24 h) Turnstile stamp,
 * or when Turnstile is not configured (so the gate is a no-op).
 */
export function isTurnstileSessionValid(req: Request): boolean {
  if (!getTurnstileSecret()) return true; // not configured — pass through
  const verifiedAt = (req as any).session?.turnstileVerifiedAt as
    | number
    | undefined;
  if (!verifiedAt) return false;
  return Date.now() - verifiedAt < VERIFIED_SESSION_TTL;
}

/**
 * Express middleware — block all `/api/` requests when the session hasn't
 * completed Turnstile verification, except for the small set of exempt paths.
 * Safe to add whether or not the keys are configured.
 */
export function requireTurnstileSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // No-op when Turnstile is not configured
  if (!getTurnstileSecret()) return next();

  // Always allow exempt paths (verify/status endpoints + webhooks)
  if (TURNSTILE_EXEMPT_PATHS.has(req.path)) return next();

  // Only guard API routes — static assets / SPA HTML pass through
  if (!req.path.startsWith("/api/")) return next();

  if (isTurnstileSessionValid(req)) return next();

  res.status(403).json({
    message:
      "Human verification required. Please complete the security check.",
    errorType: "turnstile_required",
    requiresVerification: true,
  });
}

// ── API route handlers ───────────────────────────────────────────────────────

/**
 * POST /api/turnstile/verify
 * Body: { token: string }
 *
 * Verifies the Turnstile token with Cloudflare, then stamps the session so
 * subsequent requests pass the `requireTurnstileSession` middleware for 24 h.
 */
export async function handleTurnstileVerify(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = getTurnstileSecret();

  // Keys not configured → silently pass so the app still works while keys are
  // being set up.
  if (!secret) {
    (req as any).session.turnstileVerifiedAt = Date.now();
    res.json({ success: true, message: "Verification skipped (not configured)" });
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(400).json({ success: false, message: "No verification token provided." });
    return;
  }

  const clientIP = getClientIP(req);

  try {
    const result = await verifyTokenWithCloudflare(token, clientIP);

    if (result.success) {
      (req as any).session.turnstileVerifiedAt = Date.now();
      // Persist session explicitly to avoid race conditions on fast clients
      await new Promise<void>((resolve, reject) =>
        (req as any).session.save((err: any) => (err ? reject(err) : resolve())),
      );
      console.log(`✅ Turnstile session verified: IP=${clientIP}`);
      res.json({ success: true });
      return;
    }

    const errorCodes = result.errorCodes ?? [];
    const isServiceError = errorCodes.some((c) =>
      [
        "internal-error",
        "timeout",
        "timeout-or-duplicate",
        "verification-request-failed",
      ].includes(c),
    );

    console.warn(
      `🚫 Turnstile failed: IP=${clientIP} errors=${errorCodes.join(",")}`,
    );
    res.status(isServiceError ? 503 : 403).json({
      success: false,
      message: isServiceError
        ? "Cloudflare verification service is temporarily unavailable. Please retry."
        : "Verification failed. Please try again.",
      errorCodes,
      retryable: isServiceError,
    });
  } catch (err) {
    console.error("Turnstile verify handler error:", err);
    res.status(503).json({
      success: false,
      message: "Verification service temporarily unavailable. Please retry.",
      retryable: true,
    });
  }
}

/**
 * GET /api/turnstile/status
 *
 * Returns whether the current session has a valid Turnstile stamp.
 * Used by the frontend gate on mount to decide whether to show the widget.
 */
export function handleTurnstileStatus(req: Request, res: Response): void {
  const secret = getTurnstileSecret();

  if (!secret) {
    // Not configured — tell the frontend it's always verified
    res.json({ verified: true, configured: false });
    return;
  }

  const verifiedAt = (req as any).session?.turnstileVerifiedAt as
    | number
    | undefined;
  const now = Date.now();

  if (verifiedAt && now - verifiedAt < VERIFIED_SESSION_TTL) {
    res.json({
      verified: true,
      configured: true,
      expiresAt: verifiedAt + VERIFIED_SESSION_TTL,
    });
  } else {
    res.json({ verified: false, configured: true });
  }
}

// ── Legacy per-action helper (kept for backward compat with existing routes) ─

/**
 * Require a valid Turnstile token for a specific action.
 * Returns a `{ status, body }` error object to send, or `null` to proceed.
 */
export async function requireTurnstile(
  req: Request,
  action: string,
): Promise<{ status: number; body: Record<string, string> } | null> {
  if (!getTurnstileSecret()) return null; // not configured — skip

  const token = extractToken(req);
  if (!token) {
    console.warn(
      `⚠️ Turnstile: no token for action=${action} ip=${req.ip} — VITE_TURNSTILE_SITE_KEY may not be set`,
    );
    return null;
  }

  const result = await verifyTokenWithCloudflare(token, req.ip);
  if (result.success && (!result.action || result.action === action)) return null;

  console.warn(
    `🚫 Turnstile rejected: action=${action} ip=${req.ip} errors=${(result.errorCodes ?? []).join(",")}`,
  );
  return {
    status: 403,
    body: {
      message: "Security verification failed. Please try again.",
      errorType: "turnstile_failed",
    },
  };
}
