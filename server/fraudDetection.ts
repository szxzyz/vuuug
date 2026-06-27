/**
 * Paid Adz — Fraud Detection Engine
 *
 * Scoring-based anti-bot system. Does NOT ban users automatically.
 * Returns a numeric risk score + signals so callers can decide the action.
 *
 * Score thresholds:
 *   0–30  → LOW     (allow normally)
 *   31–55 → MEDIUM  (flag for review, allow)
 *   56–75 → HIGH    (flag + slow rewards)
 *   76+   → CRITICAL(flag + queue for manual review)
 *
 * Key principle: A single missing signal (null app_version, IP device ID,
 * Telegram Desktop) is NOT enough to flag a user. Only combinations matter.
 */

import { db, pool } from "./db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export type TelegramPlatform =
  | "android"   // Telegram Android
  | "ios"       // Telegram iOS
  | "tdesktop"  // Telegram Desktop (Windows / Mac / Linux) — fully legitimate
  | "web"       // Telegram Web (web.telegram.org)
  | "webz"      // Telegram WebZ
  | "macos"     // Telegram macOS native
  | "unknown"   // Could not determine (treat as legitimate by default)
  | "script";   // Confirmed automated/headless

export interface PlatformInfo {
  platform: TelegramPlatform;
  isRealTelegramClient: boolean;
  isMobile: boolean;
  isDesktop: boolean;
  isWebBrowser: boolean;
  isAutomated: boolean;
  rawPlatform?: string;
}

/**
 * Detect platform from Telegram initData + User-Agent.
 * Telegram Desktop (tdesktop) is fully legitimate — never penalise it.
 */
export function detectPlatform(
  initDataRaw: string | undefined,
  userAgent: string | undefined,
): PlatformInfo {
  let rawPlatform: string | undefined;

  // Extract top-level `platform` field from Telegram initData
  if (initDataRaw) {
    try {
      const params = new URLSearchParams(initDataRaw);
      rawPlatform = params.get("platform") || undefined;
    } catch {
      // ignore parse errors
    }
  }

  const ua = (userAgent || "").toLowerCase();

  // UA-level Telegram client signals
  const isTelegramAndroid = ua.includes("telegram-android") || ua.includes("tgandroid");
  const isTelegramIOS = ua.includes("telegram-ios") || ua.includes("tgios");
  const isTelegramDesktop = ua.includes("tdesktop") || rawPlatform === "tdesktop";
  const isTelegramMacOS = rawPlatform === "macos";
  const isTelegramWeb = rawPlatform === "web" || rawPlatform === "webz";

  // Headless / automation signals in UA
  const isHeadless =
    ua.includes("headlesschrome") ||
    ua.includes("phantomjs") ||
    ua.includes("selenium") ||
    ua.includes("webdriver") ||
    ua.includes("puppeteer") ||
    ua.includes("playwright");

  // Determine final platform
  let platform: TelegramPlatform;
  if (rawPlatform) {
    const p = rawPlatform.toLowerCase();
    const MAP: Record<string, TelegramPlatform> = {
      android: "android",
      ios: "ios",
      tdesktop: "tdesktop",
      web: "web",
      webz: "webz",
      macos: "macos",
    };
    platform = MAP[p] || "unknown";
  } else if (isTelegramAndroid) {
    platform = "android";
  } else if (isTelegramIOS) {
    platform = "ios";
  } else if (isTelegramDesktop) {
    platform = "tdesktop";
  } else if (isTelegramMacOS) {
    platform = "macos";
  } else if (isHeadless) {
    platform = "script";
  } else {
    platform = "unknown";
  }

  const isRealTelegramClient = ["android", "ios", "tdesktop", "web", "webz", "macos"].includes(platform);
  const isMobile = platform === "android" || platform === "ios";
  const isDesktop = platform === "tdesktop" || platform === "macos";
  const isWebBrowser = platform === "web" || platform === "webz";
  const isAutomated = platform === "script" || isHeadless;

  return { platform, isRealTelegramClient, isMobile, isDesktop, isWebBrowser, isAutomated, rawPlatform };
}

// ─────────────────────────────────────────────────────────────────────────────
// IP / NETWORK ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

// CIDR ranges for known datacenters, VPS providers, VPNs
// Extended from actual abuse cases observed in this app
const DATACENTER_RANGES: Array<{ cidr: string; label: string }> = [
  // Scaleway (confirmed abuse: @bek4711 on 57.129.x.x)
  { cidr: "57.128.0.0/15", label: "Scaleway" },
  { cidr: "163.172.0.0/16", label: "Scaleway" },
  // OVH
  { cidr: "51.68.0.0/16", label: "OVH" },
  { cidr: "51.75.0.0/16", label: "OVH" },
  { cidr: "51.89.0.0/16", label: "OVH" },
  { cidr: "54.36.0.0/14", label: "OVH" },
  { cidr: "91.134.0.0/16", label: "OVH" },
  // DigitalOcean
  { cidr: "104.131.0.0/16", label: "DigitalOcean" },
  { cidr: "104.236.0.0/16", label: "DigitalOcean" },
  { cidr: "138.197.0.0/16", label: "DigitalOcean" },
  { cidr: "159.65.0.0/16", label: "DigitalOcean" },
  { cidr: "159.203.0.0/16", label: "DigitalOcean" },
  { cidr: "167.99.0.0/16", label: "DigitalOcean" },
  { cidr: "174.138.0.0/16", label: "DigitalOcean" },
  { cidr: "178.62.0.0/16", label: "DigitalOcean" },
  { cidr: "188.166.0.0/16", label: "DigitalOcean" },
  // Hetzner
  { cidr: "5.9.0.0/16", label: "Hetzner" },
  { cidr: "46.4.0.0/16", label: "Hetzner" },
  { cidr: "78.46.0.0/16", label: "Hetzner" },
  { cidr: "78.47.0.0/16", label: "Hetzner" },
  { cidr: "88.198.0.0/16", label: "Hetzner" },
  { cidr: "148.251.0.0/16", label: "Hetzner" },
  { cidr: "168.119.0.0/16", label: "Hetzner" },
  { cidr: "195.201.0.0/16", label: "Hetzner" },
  // Vultr (confirmed abuse: @Marcydude on 38.3.126.x)
  { cidr: "38.0.0.0/12", label: "Vultr/US-Datacenter" },
  { cidr: "45.32.0.0/16", label: "Vultr" },
  { cidr: "45.63.0.0/16", label: "Vultr" },
  { cidr: "66.42.0.0/16", label: "Vultr" },
  { cidr: "108.61.0.0/16", label: "Vultr" },
  { cidr: "149.28.0.0/16", label: "Vultr" },
  // Linode / Akamai
  { cidr: "45.33.0.0/16", label: "Linode" },
  { cidr: "45.56.0.0/16", label: "Linode" },
  { cidr: "66.175.208.0/20", label: "Linode" },
  { cidr: "139.162.0.0/16", label: "Linode" },
  // AWS
  { cidr: "52.0.0.0/11", label: "AWS" },
  { cidr: "54.64.0.0/11", label: "AWS" },
  { cidr: "18.144.0.0/14", label: "AWS" },
  // Contabo
  { cidr: "213.136.64.0/18", label: "Contabo" },
  { cidr: "194.165.16.0/22", label: "Contabo" },
  // Frantech / BuyVM
  { cidr: "107.189.0.0/16", label: "Frantech" },
  // M247 (common VPN host)
  { cidr: "37.120.192.0/18", label: "M247" },
  // Google Cloud
  { cidr: "34.64.0.0/10", label: "Google Cloud" },
  { cidr: "35.184.0.0/13", label: "Google Cloud" },
  // Cloudflare
  { cidr: "172.64.0.0/13", label: "Cloudflare" },
];

function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return -1;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function cidrContains(cidr: string, ip: string): boolean {
  try {
    const [network, bits] = cidr.split("/");
    const prefixLen = parseInt(bits, 10);
    const mask = prefixLen === 0 ? 0 : (~((1 << (32 - prefixLen)) - 1)) >>> 0;
    const networkLong = ipToLong(network);
    const ipLong = ipToLong(ip);
    if (networkLong < 0 || ipLong < 0) return false;
    return (networkLong & mask) >>> 0 === (ipLong & mask) >>> 0;
  } catch {
    return false;
  }
}

export interface IPAnalysis {
  isDatacenter: boolean;
  provider?: string;
  riskContribution: number;
  note: string;
}

export function analyzeIP(ip: string | undefined | null): IPAnalysis {
  if (!ip || ip === "unknown") {
    return { isDatacenter: false, riskContribution: 0, note: "No IP available" };
  }
  // Private/local IPs are fine
  if (
    ip.startsWith("127.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  ) {
    return { isDatacenter: false, riskContribution: 0, note: "Private/local IP" };
  }

  for (const { cidr, label } of DATACENTER_RANGES) {
    if (cidrContains(cidr, ip)) {
      return {
        isDatacenter: true,
        provider: label,
        riskContribution: 30,
        note: `Datacenter IP (${label})`,
      };
    }
  }

  return { isDatacenter: false, riskContribution: 0, note: "Residential/unknown IP" };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE FINGERPRINT ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

export interface FingerprintAnalysis {
  isIPBasedDeviceId: boolean;
  isMinimalFingerprint: boolean;
  fieldCount: number;
  riskContribution: number;
  notes: string[];
}

export function analyzeFingerprint(
  deviceId: string | undefined | null,
  fingerprint: any,
): FingerprintAnalysis {
  const notes: string[] = [];
  let riskContribution = 0;

  const isIPBasedDeviceId = !!(deviceId && deviceId.startsWith("ip_"));
  const fieldCount = fingerprint ? Object.keys(fingerprint).length : 0;
  const isMinimalFingerprint = fieldCount <= 2;

  if (isIPBasedDeviceId) {
    // IP-based device alone = minor (15pts). Real browsers send a proper device ID.
    // But by itself, it is NOT enough to flag a user.
    riskContribution += 15;
    notes.push("No device fingerprint sent by client (IP fallback)");
  }

  if (isMinimalFingerprint && fieldCount > 0) {
    riskContribution += 8;
    notes.push(`Minimal fingerprint data (${fieldCount} fields)`);
  }

  if (fieldCount === 0 && isIPBasedDeviceId) {
    riskContribution += 5;
    notes.push("Empty fingerprint payload");
  }

  return { isIPBasedDeviceId, isMinimalFingerprint, fieldCount, riskContribution, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL ANALYSIS  (ad timing patterns)
// ─────────────────────────────────────────────────────────────────────────────

export interface BehaviorAnalysis {
  hasImpossibleTiming: boolean;
  hasUniformTiming: boolean;
  hasBurstPattern: boolean;
  impossibleGapCount: number;
  uniformityScore: number;   // 0 (random) → 1 (perfectly robotic)
  riskContribution: number;
  notes: string[];
}

/**
 * Analyse the last 50 ad earnings timestamps for automation patterns.
 * Uses the shared pg Pool directly to avoid introducing Drizzle complexity.
 */
export async function analyzeAdBehavior(userId: string): Promise<BehaviorAnalysis> {
  const notes: string[] = [];
  let riskContribution = 0;

  try {
    const result = await pool.query(
      `SELECT created_at FROM earnings
       WHERE user_id = $1 AND source IN ('ad_watch', 'mission_ad')
       ORDER BY created_at ASC
       LIMIT 50`,
      [userId],
    );

    const timestamps: number[] = result.rows
      .map((r: any) => new Date(r.created_at).getTime())
      .filter((t: number) => !isNaN(t));

    if (timestamps.length < 4) {
      return {
        hasImpossibleTiming: false,
        hasUniformTiming: false,
        hasBurstPattern: false,
        impossibleGapCount: 0,
        uniformityScore: 0,
        riskContribution: 0,
        notes: ["Insufficient ad history for behavioral analysis"],
      };
    }

    // Gap list (seconds)
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push((timestamps[i] - timestamps[i - 1]) / 1000);
    }

    // 1. Impossible gaps < 5 s
    const impossibleGaps = gaps.filter((g) => g < 5);
    const impossibleGapCount = impossibleGaps.length;
    const hasImpossibleTiming = impossibleGapCount >= 2;
    if (impossibleGapCount > 0) {
      const contrib = Math.min(60, impossibleGapCount * 12);
      riskContribution += contrib;
      notes.push(`${impossibleGapCount} impossible gaps (<5 s detected)`);
    }

    // 2. Robotic uniform timing — coefficient of variation
    let hasUniformTiming = false;
    let uniformityScore = 0;
    if (gaps.length >= 8) {
      const sample = gaps.slice(-8);
      const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
      if (mean > 0 && mean < 180) {
        const variance =
          sample.reduce((a, b) => a + (b - mean) ** 2, 0) / sample.length;
        const stdDev = Math.sqrt(variance);
        const cv = stdDev / mean;
        uniformityScore = Math.max(0, 1 - cv);
        if (cv < 0.07) {
          hasUniformTiming = true;
          riskContribution += 35;
          notes.push(`Robot-like interval uniformity: CV=${cv.toFixed(3)}, mean=${mean.toFixed(1)}s`);
        }
      }
    }

    // 3. Burst: >18 ads in any 10-minute window
    let hasBurstPattern = false;
    const TEN_MIN_MS = 10 * 60 * 1000;
    for (let i = 0; i < timestamps.length; i++) {
      const windowEnd = timestamps[i] + TEN_MIN_MS;
      let count = 0;
      for (let j = i; j < timestamps.length && timestamps[j] <= windowEnd; j++) count++;
      if (count >= 18) {
        hasBurstPattern = true;
        riskContribution += 20;
        notes.push(`Burst: ${count} ads in 10 min`);
        break;
      }
    }

    return {
      hasImpossibleTiming,
      hasUniformTiming,
      hasBurstPattern,
      impossibleGapCount,
      uniformityScore,
      riskContribution: Math.min(100, riskContribution),
      notes,
    };
  } catch (err) {
    console.error("Behavioral analysis error:", err);
    return {
      hasImpossibleTiming: false,
      hasUniformTiming: false,
      hasBurstPattern: false,
      impossibleGapCount: 0,
      uniformityScore: 0,
      riskContribution: 0,
      notes: ["Analysis failed (non-critical)"],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE RISK SCORING
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskScore {
  score: number;
  level: RiskLevel;
  signals: string[];
  platformInfo: PlatformInfo;
  ipAnalysis: IPAnalysis;
  fingerprintAnalysis: FingerprintAnalysis;
  behaviorAnalysis?: BehaviorAnalysis;
}

/**
 * Compute a composite risk score.
 *
 * Scoring summary:
 *  +50  — headless/automated browser
 *  +30  — datacenter IP (VPS/cloud/VPN)
 *  +20  — non-Telegram browser UA (direct API access)
 *  +15  — IP-based device ID (no real fingerprint)
 *  +10  — minimal fingerprint (<= 2 fields)
 *  +5   — empty fingerprint + IP device (cumulative)
 *  +5   — null app_version AND IP-based device (together only)
 *  behavioral (see analyzeAdBehavior above — max +100 but capped)
 */
export async function computeRiskScore(params: {
  telegramId: string;
  userId?: string;
  deviceId?: string;
  fingerprint?: any;
  ip?: string;
  userAgent?: string;
  initData?: string;
  appVersion?: string | null;
  includeBehavior?: boolean;
}): Promise<RiskScore> {
  const { deviceId, fingerprint, ip, userAgent, initData, appVersion, userId, includeBehavior = false } = params;

  const signals: string[] = [];
  let totalScore = 0;

  // ── 1. Platform ─────────────────────────────────────────────────────────
  const platformInfo = detectPlatform(initData, userAgent);

  if (platformInfo.isAutomated) {
    totalScore += 50;
    signals.push("Headless/automated client detected");
  }

  // Non-Telegram UA without any Telegram context = direct API call
  const ua = (userAgent || "").toLowerCase();
  const hasTelegramUA =
    ua.includes("telegram") ||
    ua.includes("tgandroid") ||
    ua.includes("tgios");
  if (!hasTelegramUA && ua.length > 10 && !platformInfo.isRealTelegramClient) {
    totalScore += 20;
    signals.push(`Non-Telegram browser UA: "${(userAgent || "").slice(0, 80)}"`);
  }

  // ── 2. IP analysis ──────────────────────────────────────────────────────
  const ipAnalysis = analyzeIP(ip);
  if (ipAnalysis.isDatacenter) {
    totalScore += ipAnalysis.riskContribution;
    signals.push(ipAnalysis.note);
  }

  // ── 3. Fingerprint / device ─────────────────────────────────────────────
  const fingerprintAnalysis = analyzeFingerprint(deviceId, fingerprint);
  totalScore += fingerprintAnalysis.riskContribution;
  signals.push(...fingerprintAnalysis.notes);

  // ── 4. App version — only a minor signal when combined ─────────────────
  // Telegram Desktop, some WebApp builds, and first-load flows have no app_version.
  // NEVER flag for null app_version alone.
  if (!appVersion && fingerprintAnalysis.isIPBasedDeviceId) {
    totalScore += 5;
    signals.push("No app version (combined with IP-only device)");
  }

  // ── 5. Behavioral analysis (async, for ad-reward endpoint) ────────────
  let behaviorAnalysis: BehaviorAnalysis | undefined;
  if (includeBehavior && userId) {
    behaviorAnalysis = await analyzeAdBehavior(userId);
    totalScore += behaviorAnalysis.riskContribution;
    signals.push(...behaviorAnalysis.notes);
  }

  // Clamp
  totalScore = Math.max(0, Math.min(100, totalScore));

  let level: RiskLevel;
  if (totalScore <= 30) level = "LOW";
  else if (totalScore <= 55) level = "MEDIUM";
  else if (totalScore <= 75) level = "HIGH";
  else level = "CRITICAL";

  return {
    score: totalScore,
    level,
    signals: signals.filter(Boolean),
    platformInfo,
    ipAnalysis,
    fingerprintAnalysis,
    behaviorAnalysis,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST RISK RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist the computed risk score to the user record.
 * Uses a blended average so a single high-risk login doesn't
 * permanently destroy a legitimate user's score.
 */
export async function persistRiskScore(
  userId: string,
  result: RiskScore,
): Promise<void> {
  try {
    const [existing] = await db
      .select({ suspicionScore: (users as any).suspicionScore })
      .from(users)
      .where(eq(users.id, userId));

    const currentScore: number = (existing as any)?.suspicionScore || 0;
    const blended = Math.round(result.score * 0.7 + currentScore * 0.3);
    const shouldFlag = blended >= 56;

    await db
      .update(users)
      .set({
        suspicionScore: blended,
        platform: result.platformInfo.platform,
        flagged: shouldFlag || undefined,
        flagReason: shouldFlag
          ? `Risk score ${blended}/100: ${result.signals.slice(0, 3).join("; ")}`
          : undefined,
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, userId));

    if (result.level !== "LOW") {
      console.log(
        `🔍 Risk assessment [${result.level}] score=${blended} user=${userId}: ${result.signals.slice(0, 2).join(", ")}`,
      );
    }
  } catch (err) {
    console.error("Failed to persist risk score:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING (in-memory, per-user + per-IP)
// ─────────────────────────────────────────────────────────────────────────────

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_PER_MIN = 120; // max API calls per user per minute

// Prune every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [key, entry] of rateLimitStore) {
    if (entry.windowStart < cutoff) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

export function checkRateLimit(key: string, limitPerMin = RATE_LIMIT_PER_MIN): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return false; // not limited
  }

  entry.count++;
  if (entry.count > limitPerMin) return true; // limited
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// REFERRAL ANTI-FRAUD
// ─────────────────────────────────────────────────────────────────────────────

export interface ReferralFraudCheck {
  isSuspicious: boolean;
  reason?: string;
  riskScore: number;
}

/**
 * Check whether a new referral looks fraudulent.
 * Does not ban — just returns a risk assessment.
 */
export async function checkReferralFraud(
  referrerId: string,
  refereeId: string,
  refereeDeviceId: string | undefined,
  refereeIP: string | undefined,
): Promise<ReferralFraudCheck> {
  try {
    const result = await pool.query(
      `SELECT device_id, last_login_ip FROM users WHERE id = $1 LIMIT 1`,
      [referrerId],
    );
    const referrer = result.rows[0];
    if (!referrer) return { isSuspicious: false, riskScore: 0 };

    // Self-referral: same device
    if (refereeDeviceId && referrer.device_id && refereeDeviceId === referrer.device_id) {
      return {
        isSuspicious: true,
        reason: "Self-referral: same device ID as referrer",
        riskScore: 80,
      };
    }

    // Self-referral: same IP (weaker — shared WiFi is possible)
    if (refereeIP && referrer.last_login_ip && refereeIP === referrer.last_login_ip) {
      return {
        isSuspicious: true,
        reason: "Referral from same IP address as referrer",
        riskScore: 35,
      };
    }

    // Count how many referrals the referrer already has with ip_ device IDs
    const botRefCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM referrals r
       JOIN users u ON u.id = r.referee_id
       WHERE r.referrer_id = $1 AND u.device_id LIKE 'ip_%'`,
      [referrerId],
    );
    const botCount = parseInt(botRefCount.rows[0]?.cnt || "0");
    if (botCount > 20) {
      return {
        isSuspicious: true,
        reason: `Referrer has ${botCount} IP-device referrals (bot farm pattern)`,
        riskScore: 60,
      };
    }

    return { isSuspicious: false, riskScore: 0 };
  } catch (err) {
    console.error("Referral fraud check error:", err);
    return { isSuspicious: false, riskScore: 0 };
  }
}
