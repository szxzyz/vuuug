/**
 * Server-side checks for direct API automation.
 *
 * These checks are intentionally conservative: they block unmistakable
 * automation and require the interaction proof emitted by the real WebApp
 * shell, but they do not treat a normal Telegram platform (Android, iOS,
 * Desktop, or Web) as suspicious by itself.
 */

import type { Request } from "express";

const MAX_PROOF_AGE_MS = 30_000;
const MAX_HEARTBEAT_AGE_MS = 20_000;
const MAX_CLOCK_SKEW_MS = 5_000;

export type AntiBotResult =
  | { allowed: true }
  | { allowed: false; reason: string; signal: string };

function headerValue(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return typeof value === "string" ? value : "";
}

function hasObviousAutomationSignature(req: Request): { signal: string; reason: string } | null {
  const userAgent = headerValue(req, "user-agent").toLowerCase();
  const requestedWith = headerValue(req, "x-requested-with").toLowerCase();

  // The uploaded script uses this exact Android package-style value while
  // making requests with Python requests. It is not sent by our WebApp.
  if (requestedWith === "ellipi.messenges") {
    return {
      signal: "known_script_x_requested_with",
      reason: "Automated client signature detected",
    };
  }

  const automationTerms = [
    "python-requests",
    "python/",
    "httpx",
    "aiohttp",
    "curl/",
    "wget/",
    "libwww-perl",
    "scrapy",
    "selenium",
    "webdriver",
    "headlesschrome",
    "phantomjs",
    "puppeteer",
    "playwright",
  ];
  const matchedTerm = automationTerms.find((term) => userAgent.includes(term));
  if (matchedTerm) {
    return {
      signal: `automation_user_agent:${matchedTerm}`,
      reason: "Automated client signature detected",
    };
  }

  return null;
}

/**
 * Validate the short-lived proof attached by client/src/main.tsx.
 *
 * This is not treated as a cryptographic identity proof. It is a server-side
 * freshness and protocol check that stops the imported script as-is and makes
 * replaying old request bodies ineffective.
 */
export function validateInteractionProof(req: Request): AntiBotResult {
  const obviousAutomation = hasObviousAutomationSignature(req);
  if (obviousAutomation) {
    return { allowed: false, ...obviousAutomation };
  }

  const rawProof = headerValue(req, "x-interaction-proof");
  if (!rawProof) {
    return {
      allowed: false,
      signal: "missing_interaction_proof",
      reason: "Browser interaction proof is required",
    };
  }

  let proof: {
    entropy?: unknown;
    timestamp?: unknown;
    heartbeat?: unknown;
    visible?: unknown;
  };
  try {
    proof = JSON.parse(rawProof);
  } catch {
    return {
      allowed: false,
      signal: "invalid_interaction_proof",
      reason: "Invalid browser interaction proof",
    };
  }

  const now = Date.now();
  const timestamp = typeof proof.timestamp === "number" ? proof.timestamp : NaN;
  const heartbeat = typeof proof.heartbeat === "number" ? proof.heartbeat : NaN;

  if (
    !Number.isFinite(timestamp) ||
    timestamp > now + MAX_CLOCK_SKEW_MS ||
    now - timestamp > MAX_PROOF_AGE_MS
  ) {
    return {
      allowed: false,
      signal: "stale_interaction_proof",
      reason: "Browser interaction proof expired",
    };
  }

  if (
    proof.visible !== true ||
    !Number.isFinite(heartbeat) ||
    heartbeat > now + MAX_CLOCK_SKEW_MS ||
    now - heartbeat > MAX_HEARTBEAT_AGE_MS
  ) {
    return {
      allowed: false,
      signal: "invalid_visibility_heartbeat",
      reason: "Active browser visibility could not be confirmed",
    };
  }

  return { allowed: true };
}

export function rejectAutomatedRequest(
  req: Request,
  logContext: string,
): { status: number; body: Record<string, string> } | null {
  const result = validateInteractionProof(req);
  if (result.allowed) return null;

  console.warn(
    `🚫 Bot request blocked (${logContext}): signal=${result.signal} ip=${req.ip}`,
  );
  return {
    status: 403,
    body: {
      message: "Automated clients are not eligible to use this app.",
      errorType: "bot_detected",
      signal: result.signal,
    },
  };
}