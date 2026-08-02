// Modern Telegram WebApp Authentication System
// Replaces legacy Replit OAuth with clean Telegram-only auth

import express, { type RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import crypto from "crypto";
import { storage } from "./storage";
import { pool } from "./db";
import { 
  validateDeviceAndDetectDuplicate, 
  banUserForMultipleAccounts,
  sendWarningToMainAccount,
  createBanLog,
  type DeviceInfo 
} from "./deviceTracking";
import { computeRiskScore, persistRiskScore, checkRateLimit, checkKnownBotSignature } from "./fraudDetection";
import { users } from "../shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

// Helper to extract client IP from request
function getClientIP(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take first IP in case of multiple proxies
    return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         req.socket?.remoteAddress ||
         'unknown';
}

// Session configuration
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  
  // Configure session store using the same SSL-configured pool as the main database
  const sessionStore = new pgStore({
    pool: pool, // Reuse the SSL-configured pool from db.ts
    createTableIfMissing: false,
    ttl: Math.floor(sessionTtl / 1000), // TTL expects seconds, not milliseconds
    tableName: "sessions",
  });
  
  return session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // 'none' is required for the session cookie to survive cross-origin
      // requests (the client's fetch() calls use credentials: "include" for
      // exactly this reason). Browsers require secure:true whenever
      // sameSite:'none' is used, so only do this in production (where
      // secure is also true) — sameSite:'none' without secure is rejected
      // outright by modern browsers.
      sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
      maxAge: sessionTtl,
    },
  });
}

// Verify Telegram WebApp data integrity
export function verifyTelegramWebAppData(initData: string, botToken: string): { isValid: boolean; user?: any } {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) {
      return { isValid: false };
    }
    
    // Remove hash from params and sort alphabetically
    urlParams.delete('hash');
    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    // Create HMAC secret key
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    
    // Generate HMAC hash
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    const isValid = calculatedHash === hash;
    
    if (!isValid) {
      console.log('❌ Telegram data verification failed - invalid hash');
      return { isValid: false };
    }
    
    // Parse user data
    const userString = urlParams.get('user');
    if (!userString) {
      return { isValid: false };
    }
    
    const user = JSON.parse(userString);
    console.log('✅ Telegram data verified successfully for user:', user.id);
    
    return { isValid: true, user };
  } catch (error) {
    console.error('❌ Error verifying Telegram data:', error);
    return { isValid: false };
  }
}

// Modern Telegram authentication middleware
export const authenticateTelegram: RequestHandler = async (req: any, res, next) => {
  try {
    const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
    
    // Extract device tracking information
    const deviceId = req.headers['x-device-id'] as string;
    const deviceFingerprint = req.headers['x-device-fingerprint'];
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] as string;
    const appVersion = req.headers['x-app-version'] as string;
    
    // Build comprehensive device info for tracking
    let deviceInfo: DeviceInfo | null = null;
    if (deviceId || clientIP !== 'unknown') {
      let fingerprint: any = null;
      try {
        fingerprint = deviceFingerprint ? JSON.parse(deviceFingerprint as string) : {
          userAgent: userAgent,
          platform: req.headers['sec-ch-ua-platform'],
        };
      } catch (e) {
        fingerprint = { userAgent };
      }
      
      deviceInfo = {
        deviceId: deviceId || `ip_${clientIP}`,
        fingerprint,
        ip: clientIP,
        userAgent,
      };
    }

    // ── Known-bot signature — hard block, checked before EVERYTHING else ────
    // Placed here (not further down) so it can never be skipped by the
    // session-reuse shortcut, the dev-mode bypass, or the "same device,
    // different account → redirect to primary" logic below, all of which
    // return/next() early and would otherwise let a matching request through
    // without ever reaching the risk-scoring block.
    {
      const knownBot = checkKnownBotSignature(deviceInfo?.deviceId, deviceInfo?.fingerprint);
      if (knownBot.isKnownBot) {
        console.log(`🚫 Blocked at auth entry — known bot signature: ${knownBot.label} (deviceId=${deviceInfo?.deviceId})`);
        // Fire-and-forget: ban every existing account already using this
        // device/fingerprint, not just whichever one is logging in right now.
        setImmediate(async () => {
          try {
            await db.execute(sql`
              UPDATE users SET
                banned = true,
                banned_reason = ${`Known bot signature: ${knownBot.label}`},
                banned_at = NOW(),
                suspicion_score = 100,
                flagged = true,
                flag_reason = 'Known bot signature match (auth entry block)',
                updated_at = NOW()
              WHERE device_id = ${deviceInfo?.deviceId}
            `);
          } catch (e) {
            console.error('⚠️ Failed to ban known-bot device on auth entry:', e);
          }
        });
        return res.status(403).json({
          banned: true,
          message: "Your account has been banned due to suspicious multi-account activity",
          reason: "Automated access detected",
        });
      }
    }

    // Check for existing session first (before requiring Telegram data)
    if (!telegramData && req.session?.user?.user?.id) {
      console.log('🔄 Using existing session for user:', req.session.user.user.id);
      req.user = req.session.user;
      return next();
    }
    
    // Development mode - allow test users ONLY when TELEGRAM_BOT_TOKEN is not configured.
    // IMPORTANT: REPL_ID is NOT used here. Even on Replit, if the bot token is set this
    // bypass is disabled so production deployments are always fully authenticated.
    if (!telegramData && process.env.NODE_ENV === 'development' && !process.env.TELEGRAM_BOT_TOKEN) {
      console.log('🔧 Development mode (no bot token): Using test user authentication');
      
      const devAdminId = (process.env.TELEGRAM_ADMIN_IDS || process.env.TELEGRAM_ADMIN_ID || '123456789').split(',')[0].trim();
      const testUser = {
        id: devAdminId,
        username: 'testuser',
        first_name: 'Test',
        last_name: 'User'
      };
      
      const testUserId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      
      const { user: upsertedUser } = await storage.upsertUser({
        id: testUserId,
        email: `${testUser.username}@telegram.user`,
        firstName: testUser.first_name,
        lastName: testUser.last_name,
        username: testUser.username,
        telegram_id: testUser.id.toString(),
        personalCode: testUser.username || testUser.id.toString(),
        withdrawBalance: '0',
        totalEarnings: '0',
        adsWatched: 0,
        dailyAdsWatched: 0,
        dailyEarnings: '0',
        level: 1,
        flagged: false,
        banned: false,
        referralCode: 'ff0269235650', // Use migrated test user code
      });
      
      // Ensure test user has referral code
      if (!upsertedUser.referralCode) {
        await storage.generateReferralCode(upsertedUser.id);
      }
      
      req.user = { 
        telegramUser: { ...testUser, id: testUserId },
        user: upsertedUser
      };
      
      // Save user data to session for WebSocket authentication
      req.session.user = req.user;
      return next();
    }
    
    if (!telegramData) {
      return res.status(401).json({ 
        message: "Authentication required. Please open this app from your Telegram app to continue.",
        telegram_required: true,
        error_code: "NO_TELEGRAM_DATA"
      });
    }
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('❌ TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ 
        message: "Service temporarily unavailable. Please try again later.",
        error_code: "AUTH_SERVICE_ERROR"
      });
    }
    
    // Verify Telegram data integrity
    const { isValid, user: telegramUser } = verifyTelegramWebAppData(telegramData, botToken);
    
    if (!isValid || !telegramUser) {
      console.log('❌ Authentication failed - invalid Telegram data');
      return res.status(401).json({ 
        message: "Authentication failed. Please restart the app from Telegram and try again.",
        error_code: "INVALID_AUTH_DATA"
      });
    }
    
    if (deviceInfo) {
      const deviceValidation = await validateDeviceAndDetectDuplicate(
        telegramUser.id.toString(),
        deviceInfo
      );
      
      // Same device, different Telegram account → seamlessly load the original/primary account.
      // We never ban for this — just redirect to their real account.
      if (deviceValidation.redirectToPrimary && deviceValidation.primaryAccountId) {
        try {
          const [primaryUser] = await db.select().from(users).where(eq(users.id, deviceValidation.primaryAccountId));
          if (primaryUser && !primaryUser.banned) {
            console.log(`🔄 Same-device login: serving primary account ${primaryUser.id} instead of new Telegram ${telegramUser.id}`);
            // Update last login tracking for the primary account
            await db.update(users).set({
              lastLoginAt: new Date(),
              lastLoginIp: clientIP,
              lastLoginUserAgent: userAgent,
            }).where(eq(users.id, primaryUser.id));

            req.user = { telegramUser, user: primaryUser };
            req.session.user = req.user;
            return next();
          }
        } catch (e) {
          console.error('⚠️ Failed to load primary account, falling through to normal login:', e);
        }
      }

      // Hard ban only if the account itself is explicitly flagged (manual admin ban).
      // Automated device-conflict bans are disabled in favour of account recovery above.
      if (deviceValidation.shouldBan) {
        const existingUser = await storage.getUserByTelegramId(telegramUser.id.toString());
        if (existingUser?.banned) {
          console.log(`🚫 Manually-banned account attempted login: ${existingUser.id}`);
          return res.status(403).json({
            banned: true,
            message: "Your account has been banned. Contact support: https://t.me/PaidAdsSupportbot",
            reason: existingUser.bannedReason || "Account banned"
          });
        }
      }
    }
    
    // Get or create user in database using Telegram-specific method
    const { user: upsertedUser, isNewUser } = await storage.upsertTelegramUser(telegramUser.id.toString(), {
      email: `${telegramUser.username || telegramUser.id}@telegram.user`,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username,
      personalCode: telegramUser.username || telegramUser.id.toString(),
      withdrawBalance: '0',
      totalEarnings: '0',
      adsWatched: 0,
      dailyAdsWatched: 0,
      dailyEarnings: '0',
      level: 1,
      flagged: false,
      banned: false,
      referralCode: '',
    }, deviceInfo);
    
    // CRITICAL: Check if returning user is already banned
    if (upsertedUser.banned) {
      console.log(`🚫 Banned user attempted login: ${upsertedUser.id} (Telegram: ${telegramUser.id})`);
      return res.status(403).json({ 
        banned: true,
        message: "Your account has been banned due to suspicious multi-account activity. Contact support: https://t.me/PaidAdsSupportbot",
        reason: upsertedUser.bannedReason || "Account banned"
      });
    }
    
    // Update user tracking data on every login (IP, user agent, app version, etc.)
    try {
      const trackingDeviceId = deviceId || deviceInfo?.deviceId;
      await db.update(users).set({
        lastLoginAt: new Date(),
        lastLoginIp: clientIP,
        lastLoginUserAgent: userAgent,
        lastLoginDevice: trackingDeviceId,
        deviceId: trackingDeviceId || undefined,
        isPrimaryAccount: true,
        appVersion: appVersion || undefined,
        browserFingerprint: deviceInfo?.fingerprint ? JSON.stringify(deviceInfo.fingerprint) : undefined,
        updatedAt: new Date(),
      }).where(eq(users.id, upsertedUser.id));
      console.log(`📍 Updated tracking data for user ${upsertedUser.id}: IP=${clientIP}`);
    } catch (trackingError) {
      console.error('⚠️ Failed to update user tracking data:', trackingError);
    }

    // ── Risk scoring (non-blocking, fire-and-forget) ──────────────────────
    // Compute and persist a risk score for every login. Does NOT ban.
    // Only used for admin visibility and flagging (score >= 56).
    setImmediate(async () => {
      try {
        // Rate-limit guard: skip scoring if user is hammering the auth endpoint
        if (checkRateLimit(`auth:${upsertedUser.id}`, 20)) return;

        const riskResult = await computeRiskScore({
          telegramId: telegramUser.id.toString(),
          userId: upsertedUser.id,
          deviceId: deviceInfo?.deviceId,
          fingerprint: deviceInfo?.fingerprint,
          ip: clientIP,
          userAgent,
          initData: telegramData as string,
          appVersion: appVersion || null,
          includeBehavior: false, // behavior analysis only at ad-watch time
        });

        await persistRiskScore(upsertedUser.id, riskResult);

        if (riskResult.level !== 'LOW') {
          console.log(`⚠️ Login risk [${riskResult.level}] score=${riskResult.score} user=${upsertedUser.id} platform=${riskResult.platformInfo.platform}`);
        }

        // Known-bot signature is a deterministic match (not a combined heuristic
        // that could false-positive on a legitimate user), so ban immediately
        // instead of waiting for manual review.
        const knownBotSignal = riskResult.signals.find((s) => s.startsWith('Known bot signature matched'));
        if (knownBotSignal) {
          await db.update(users).set({
            banned: true,
            bannedReason: knownBotSignal,
            updatedAt: new Date(),
          }).where(eq(users.id, upsertedUser.id));
          console.log(`🚫 Auto-banned user ${upsertedUser.id}: ${knownBotSignal}`);
        }
      } catch (riskErr) {
        // Never let risk scoring break auth
        console.error('⚠️ Risk scoring failed (non-critical):', riskErr);
      }
    });
    // ─────────────────────────────────────────────────────────────────────
    
    // Send welcome message for new users with referral code
    if (isNewUser) {
      try {
        const { sendWelcomeMessage } = await import('./telegram');
        await sendWelcomeMessage(telegramUser.id.toString());
      } catch (error) {
        console.error('❌ Failed to send welcome message:', error);
      }
    }
    
    req.user = { 
      telegramUser,
      user: upsertedUser 
    };
    
    // Save user data to session for WebSocket authentication
    req.session.user = req.user;
    
    next();
  } catch (error) {
    console.error("❌ Telegram authentication error:", error);
    res.status(500).json({ message: "Authentication failed" });
  }
};

// Setup modern authentication system
export async function setupAuth(app: express.Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  
  console.log('✅ Modern Telegram WebApp authentication configured');
  
  // Clean auth routes
  app.get("/api/login", (req, res) => {
    res.json({ 
      message: "Please use Telegram WebApp authentication",
      telegram_required: true 
    });
  });
  
  app.get("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out successfully" });
    });
  });
}

// Simple authentication check middleware - also populates user from session
export const requireAuth: RequestHandler = (req: any, res, next) => {
  // Try to get user from req.user first, then from session
  if (!req.user && req.session?.user) {
    req.user = req.session.user;
  }
  
  if (!req.user || !req.user.user) {
    return res.status(401).json({ 
      message: "Authentication required. Please use Telegram WebApp.",
      telegram_required: true 
    });
  }
  next();
};

// optionalAuth is DEPRECATED and intentionally broken to fail-closed.
// All previously "optional" routes now use authenticateTelegram directly.
// Kept here only so old imports don't crash — it always returns 401.
export const optionalAuth: RequestHandler = (req: any, res, _next) => {
  console.error(`⚠️ [SECURITY] optionalAuth called on ${req.method} ${req.path} — this middleware is deprecated. Route must use authenticateTelegram instead.`);
  return res.status(401).json({
    success: false,
    message: "Authentication required.",
    errorType: "auth_required",
    telegram_required: true,
  });
};