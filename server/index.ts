// Load .env file manually as fallback (tsx uses --env-file flag, but this
// ensures .env is loaded in all execution contexts including compiled builds).
import { readFileSync, existsSync } from 'fs';
if (existsSync('.env')) {
  try {
    const envContents = readFileSync('.env', 'utf8');
    for (const line of envContents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
    console.log('✅ Loaded environment variables from .env');
  } catch (e) {
    console.warn('⚠️ Could not parse .env file:', e);
  }
}

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { ensureDatabaseSchema } from "./migrate";
import { countryBlockingMiddleware } from "./countryBlocking";

// ─── PROXY SETUP (for Telegram API access on restricted networks) ───────────
const TELEGRAM_PROXY = process.env.TELEGRAM_PROXY_URL || process.env.HTTPS_PROXY || '';
if (TELEGRAM_PROXY) {
  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    const dispatcher = new ProxyAgent({ uri: TELEGRAM_PROXY });
    setGlobalDispatcher(dispatcher);
    console.log(`✅ Proxy configured for all outgoing requests: ${TELEGRAM_PROXY}`);
  } catch (e) {
    console.log('⚠️ Failed to configure proxy:', e);
  }
}

console.log('🚀 Starting server...');

// Run database schema migration. All CREATE TABLE statements execute first so
// the server is ready to handle requests. ALTER TABLE column additions are
// batched to minimise round-trips (see server/migrate.ts).
await ensureDatabaseSchema();
console.log('✅ Database schema verified, starting server setup...');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Country blocking middleware — must be early to block requests before any other processing
app.use(countryBlockingMiddleware);

// Emergency referral fix endpoint - SECURED for production
app.post('/api/emergency-fix-referrals', async (req: any, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Emergency endpoint disabled in production for security'
      });
    }
    console.log('🚨 EMERGENCY: Running referral data repair...');
    const { storage } = await import('./storage');
    await storage.fixExistingReferralData();
    await storage.ensureAllUsersHaveReferralCodes();
    console.log('✅ Emergency referral repair completed successfully!');
    res.json({ success: true, message: 'Emergency referral data repair completed successfully!' });
  } catch (error) {
    console.error('❌ Error in emergency referral repair:', error);
    res.status(500).json({
      success: false,
      message: 'Emergency repair failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Test endpoint
app.get('/api/test-direct', (req: any, res) => {
  res.json({ status: 'Direct API route working!', timestamp: new Date().toISOString() });
});

// Webhook status endpoint
app.get('/api/telegram/webhook/status', async (req: any, res) => {
  try {
    const { checkBotStatus, getWebhookInfo } = await import('./telegram');
    const botStatus = await checkBotStatus();
    const webhookInfo = await getWebhookInfo();
    res.json({ bot: botStatus, webhook: webhookInfo, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check webhook status',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    try {
      capturedJsonResponse = bodyJson;
    } catch {
      // Ignore JSON capture errors
    }
    return originalResJson.apply(this, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    try {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          const responseStr = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${responseStr}`;
        }
        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }
        log(logLine);
      }
    } catch {
      // Ignore logging errors
    }
  });

  next();
});

(async () => {
  await setupAuth(app);
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  if (isNaN(port) || port <= 0 || port >= 65536) {
    console.error(`Invalid port: ${process.env.PORT}, using default 5000`);
    port = 5000;
  }

  server.listen({ port, host: "0.0.0.0", reusePort: true }, async () => {
    log(`serving on port ${port}`);

    // ── Non-blocking background tasks ──────────────────────────────────────
    // Run these AFTER the server is listening so they never delay startup.

    // Ensure admin user exists (non-critical, background)
    setImmediate(async () => {
      try {
        const { storage } = await import('./storage');
        await storage.ensureAdminUserExists();
      } catch (err) {
        console.log('⚠️ ensureAdminUserExists:', err instanceof Error ? err.message : err);
      }
    });

    // Referral data repair (heavy background task)
    setImmediate(async () => {
      try {
        const { storage } = await import('./storage');
        const repairStats = await storage.fullReferralRepair();
        if (repairStats.referralsCreated > 0 || repairStats.referralsActivated > 0) {
          console.log(`✅ Referral repair — created:${repairStats.referralsCreated} activated:${repairStats.referralsActivated}`);
        }
      } catch (bgErr) {
        console.log('⚠️ Background referral repair error:', bgErr);
      }
    });

    // Daily reset interval — check every 5 minutes
    setInterval(async () => {
      try {
        const { storage } = await import('./storage');
        await storage.checkAndPerformDailyResetV2();
      } catch (error) {
        console.error('❌ Error in daily reset check:', error);
      }
    }, 5 * 60 * 1000);

    // Expired promo code cleanup — every promo code auto-expires 24h after creation;
    // this sweeps expired codes (and their usage rows) out of the database so the
    // table doesn't grow unbounded. Runs immediately on boot, then every 10 minutes.
    (async () => {
      try {
        const { storage } = await import('./storage');
        const deleted = await storage.deleteExpiredPromoCodes();
        if (deleted > 0) console.log(`🗑️ [Promo Cleanup] Removed ${deleted} expired promo code(s) on startup`);
      } catch (error) {
        console.error('❌ Error in startup promo code cleanup:', error);
      }
    })();
    setInterval(async () => {
      try {
        const { storage } = await import('./storage');
        const deleted = await storage.deleteExpiredPromoCodes();
        if (deleted > 0) console.log(`🗑️ [Promo Cleanup] Removed ${deleted} expired promo code(s)`);
      } catch (error) {
        console.error('❌ Error in promo code cleanup:', error);
      }
    }, 10 * 60 * 1000);

    // Contest snapshot check — runs every 5 minutes, auto-sends results when period ends
    setInterval(async () => {
      try {
        const { checkAndSendContestSnapshots } = await import('./telegram');
        await checkAndSendContestSnapshots();
      } catch (error) {
        console.error('❌ Error in contest snapshot check:', error);
      }
    }, 5 * 60 * 1000);

    // Ambassador auto-scheduler — checks every minute for due posts
    try {
      const { startAmbassadorScheduler } = await import('./telegram');
      startAmbassadorScheduler();
    } catch (error) {
      console.error('❌ Error starting ambassador scheduler:', error);
    }

    // TON pending deposit poller — retries unconfirmed deposits every 2 minutes
    try {
      const { startTonDepositPoller } = await import('./telegram');
      startTonDepositPoller();
    } catch (error) {
      console.error('❌ Error starting TON deposit poller:', error);
    }

    // Channel penalty poller — checks membership every 5 minutes
    try {
      const { startChannelPenaltyPoller } = await import('./telegram');
      startChannelPenaltyPoller();
    } catch (error) {
      console.error('❌ Error starting channel penalty poller:', error);
    }

    // Automatic task reminder — notifies users with unfinished tasks once per day
    try {
      const { startTaskReminderScheduler } = await import('./telegram');
      startTaskReminderScheduler();
    } catch (error) {
      console.error('❌ Error starting task reminder scheduler:', error);
    }

    // Auto-setup Telegram webhook
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const { setupTelegramWebhook, getWebhookInfo } = await import('./telegram');

        const replitDomains = process.env.REPLIT_DOMAINS?.split(',')[0]?.trim();
        const domain = process.env.RENDER_EXTERNAL_URL?.replace(/^https?:\/\//, '') ||
                      replitDomains ||
                      process.env.REPLIT_DOMAIN ||
                      process.env.REPLIT_DEV_DOMAIN ||
                      (process.env.REPL_SLUG ? `${process.env.REPL_SLUG}.replit.app` : null);

        if (!domain) {
          log('❌ No webhook domain configured - set RENDER_EXTERNAL_URL or REPLIT_DOMAINS');
        } else {
          const webhookUrl = `https://${domain}/api/telegram/webhook`;
          log(`🔧 Setting up Telegram webhook: ${webhookUrl}`);

          const success = await setupTelegramWebhook(webhookUrl);
          if (success) {
            log('✅ Telegram bot is active and ready to receive messages');
          } else {
            log('❌ Failed to configure Telegram webhook - retrying in 10s');
            setTimeout(async () => {
              const retrySuccess = await setupTelegramWebhook(webhookUrl);
              if (retrySuccess) log('✅ Webhook configured on retry');
            }, 10000);
          }

          // Health check every 5 minutes
          setInterval(async () => {
            try {
              const webhookInfo = await getWebhookInfo();
              if (webhookInfo.error || !webhookInfo.url) {
                log('⚠️ Webhook connection lost, reconnecting...');
                await setupTelegramWebhook(webhookUrl);
              }
            } catch {
              // Non-fatal
            }
          }, 5 * 60 * 1000);
        }
      } catch (error) {
        log('❌ Error setting up Telegram webhook:', String(error));
      }
    } else {
      log('⚠️ TELEGRAM_BOT_TOKEN not set - bot functionality disabled');
    }
  });
})();
