/**
 * Security Middleware — CashWatch
 *
 * Centralised middleware for:
 *  - requireVerifiedSession   — Turnstile session gate for balance-affecting endpoints
 *  - requireStrictAuth        — Belt-and-suspenders auth check after authenticateTelegram
 *  - securityLog              — Structured security event logging
 *  - Enhanced per-user/per-IP rate limiting with cooldowns
 */

import type { RequestHandler } from "express";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIP(req: any): string {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return (typeof fwd === "string" ? fwd : fwd[0]).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function fingerprintHash(req: any): string {
  const fp = req.headers["x-device-fingerprint"] || "";
  const ua = req.headers["user-agent"] || "";
  // Short hash for logging — NOT cryptographically secure, just identification
  let h = 0;
  const str = `${fp}:${ua}`;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Structured security logger ────────────────────────────────────────────────

export interface SecurityEvent {
  event:
    | "auth_success"
    | "auth_failure"
    | "turnstile_pass"
    | "turnstile_fail"
    | "turnstile_missing"
    | "rate_limited"
    | "cooldown_blocked"
    | "session_expired"
    | "unverified_session"
    | "access_denied"
    | "fingerprint_mismatch"
    | "ip_mismatch"
    | "suspicious_timing"
    | "automation_detected";
  endpoint: string;
  userId?: string;
  ip: string;
  fingerprintHash: string;
  reason?: string;
  ts: string;
}

export function securityLog(event: SecurityEvent): void {
  const prefix = event.event.startsWith("auth_failure") ||
    event.event === "turnstile_fail" ||
    event.event === "rate_limited" ||
    event.event === "access_denied" ||
    event.event === "automation_detected"
    ? "🚫 [SECURITY]"
    : "🔒 [SECURITY]";
  console.log(
    `${prefix} ${event.event} endpoint=${event.endpoint}` +
      ` userId=${event.userId ?? "anon"}` +
      ` ip=${event.ip}` +
      ` fp=${event.fingerprintHash}` +
      (event.reason ? ` reason="${event.reason}"` : "") +
      ` ts=${event.ts}`,
  );
}

// ── Turnstile session TTL — no longer used (Turnstile disabled app-wide) ──────


/**
 * requireVerifiedSession
 *
 * Cloudflare Turnstile has been disabled app-wide — this is now a no-op
 * pass-through. It previously 403'd any request whose session lacked a live
 * Turnstile stamp, which was blocking withdrawals/wallet mutations whenever
 * the challenge failed (common in Telegram's in-app browser) and driving the
 * retry loops that tripped the rate limiter.
 */
export const requireVerifiedSession: RequestHandler = (_req: any, _res, next) => {
  next();
};

/**
 * requireStrictAuth
 *
 * Belt-and-suspenders check placed AFTER authenticateTelegram to ensure
 * req.user is actually populated.  authenticateTelegram should handle this,
 * but belt-and-suspenders prevents accidents if middleware order changes.
 */
export const requireStrictAuth: RequestHandler = (req: any, res, next) => {
  const userId = req.user?.user?.id ?? req.session?.user?.user?.id;
  if (!userId) {
    securityLog({
      event: "access_denied",
      endpoint: `${req.method} ${req.path}`,
      ip: getClientIP(req),
      fingerprintHash: fingerprintHash(req),
      reason: "No authenticated user after auth middleware",
      ts: new Date().toISOString(),
    });
    return res.status(403).json({
      success: false,
      message: "Authentication required.",
      errorType: "auth_required",
    });
  }
  next();
};

// ── Enhanced in-memory rate limiter ──────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
  cooldownUntil?: number;
  strikes: number; // repeated violations → longer cooldowns
}

const buckets = new Map<string, RateBucket>();

// Prune stale buckets every 10 minutes
setInterval(
  () => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [key, b] of buckets) {
      if (b.windowStart < cutoff && (!b.cooldownUntil || b.cooldownUntil < Date.now())) {
        buckets.delete(key);
      }
    }
  },
  10 * 60 * 1000,
);

export interface RateLimitOptions {
  /** Requests allowed per window. Default 60. */
  limit?: number;
  /** Window length in ms. Default 60 000. */
  windowMs?: number;
  /** First cooldown in ms after limit is breached. Default 30 000. */
  cooldownMs?: number;
  /** Multiplier applied for each repeated strike. Default 2. */
  cooldownMultiplier?: number;
  /** Max cooldown in ms. Default 10 min. */
  maxCooldownMs?: number;
}

/**
 * rateLimit — factory that returns an Express RequestHandler.
 *
 * Keys the bucket on userId (preferred) then IP, so authenticated users and
 * anonymous bots are bucketed separately.
 *
 * Returns 429 during cooldown, logs a security event on first block.
 */
export function rateLimit(opts: RateLimitOptions = {}): RequestHandler {
  const {
    limit = 60,
    windowMs = 60_000,
    cooldownMs = 30_000,
    cooldownMultiplier = 2,
    maxCooldownMs = 10 * 60_000,
  } = opts;

  return (req: any, res, next) => {
    const userId = req.user?.user?.id ?? req.session?.user?.user?.id;
    const ip = getClientIP(req);
    const key = userId ? `user:${userId}` : `ip:${ip}`;
    const now = Date.now();
    const endpoint = `${req.method} ${req.path}`;
    const fp = fingerprintHash(req);
    const ts = new Date().toISOString();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, windowStart: now, strikes: 0 };
      buckets.set(key, bucket);
    }

    // Active cooldown?
    if (bucket.cooldownUntil && bucket.cooldownUntil > now) {
      const secsLeft = Math.ceil((bucket.cooldownUntil - now) / 1000);
      securityLog({
        event: "cooldown_blocked",
        endpoint,
        userId,
        ip,
        fingerprintHash: fp,
        reason: `Cooldown active, ${secsLeft}s remaining`,
        ts,
      });
      res.setHeader("Retry-After", String(secsLeft));
      return res.status(429).json({
        success: false,
        message: `Too many requests. Please wait ${secsLeft} seconds.`,
        retryAfter: secsLeft,
        errorType: "cooldown",
      });
    }

    // Reset window?
    if (now - bucket.windowStart > windowMs) {
      bucket.count = 0;
      bucket.windowStart = now;
    }

    bucket.count++;

    if (bucket.count > limit) {
      bucket.strikes++;
      const rawCooldown = cooldownMs * Math.pow(cooldownMultiplier, bucket.strikes - 1);
      const actualCooldown = Math.min(rawCooldown, maxCooldownMs);
      bucket.cooldownUntil = now + actualCooldown;

      securityLog({
        event: "rate_limited",
        endpoint,
        userId,
        ip,
        fingerprintHash: fp,
        reason: `${bucket.count}/${limit} req in window, strike ${bucket.strikes}, cooldown ${Math.round(actualCooldown / 1000)}s`,
        ts,
      });

      const secsLeft = Math.ceil(actualCooldown / 1000);
      res.setHeader("Retry-After", String(secsLeft));
      return res.status(429).json({
        success: false,
        message: `Too many requests. Please wait ${secsLeft} seconds.`,
        retryAfter: secsLeft,
        errorType: "rate_limited",
      });
    }

    next();
  };
}

// Pre-built limiters for common endpoints
export const authRateLimit = rateLimit({ limit: 10, windowMs: 60_000, cooldownMs: 60_000 });
export const adWatchRateLimit = rateLimit({ limit: 15, windowMs: 60_000, cooldownMs: 120_000 });
// Was limit:5/60s with a 300s base cooldown (doubling per strike, so a second
// strike within the window produced the 600s lockout users were hitting).
// Withdrawals are already capped by the daily-limit + pending-withdrawal
// checks in the route itself, so this only needs to stop rapid-fire spam,
// not double as the primary defense — loosened to avoid false-positive
// lockouts from normal double-taps/retries.
export const withdrawRateLimit = rateLimit({ limit: 5, windowMs: 60_000, cooldownMs: 30_000, maxCooldownMs: 120_000 });
export const walletMutationRateLimit = rateLimit({ limit: 10, windowMs: 60_000, cooldownMs: 60_000 });
export const taskRateLimit = rateLimit({ limit: 20, windowMs: 60_000, cooldownMs: 30_000 });
