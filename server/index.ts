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
// ─────────────────────────────────────────────────────────────────────────────

// CRITICAL: Run database migrations before ANYTHING else
// This ensures the telegram_id column exists before any database operations
console.log('🚀 Starting Paid Adz server...');
await ensureDatabaseSchema();
console.log('✅ Database schema verified, starting server setup...');

// Ensure admin user exists for production deployment
try {
  const { storage } = await import('./storage');
  await storage.ensureAdminUserExists();

  // Run heavy startup tasks in background — don't block server startup
  (async () => {
    try {
      // Ensure stars_locked is always false — old auto-weekly system removed
      const { db: dbBg } = await import('./db');
      const { sql: sqlBg } = await import('drizzle-orm');
      await dbBg.execute(sqlBg`
        INSERT INTO admin_settings (setting_key, setting_value, description)
        VALUES ('stars_locked', 'false', 'Stars are never locked — contest system is now admin-controlled')
        ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'false', updated_at = NOW()
      `);

      const repairStats = await storage.fullReferralRepair();
      if (repairStats.referralsCreated > 0 || repairStats.referralsActivated > 0) {
        console.log(`✅ Referral repair complete — created:${repairStats.referralsCreated} activated:${repairStats.referralsActivated}`);
      }
    } catch (bgErr) {
      console.log('⚠️ Background startup tasks error:', bgErr);
    }
  })();
} catch (error) {
  console.log('⚠️ Could not ensure system setup:', error);
  // Continue server startup even if setup fails
}

// One-time migration: fix admin settings keys that were incorrectly snake_cased
// (e.g. referralRewardPOWEnabled was saved as referral_reward_p_a_d_enabled instead of referral_reward_pad_enabled)
try {
  const { db } = await import('./db');
  const { adminSettings } = await import('../shared/schema');
  const { sql } = await import('drizzle-orm');

  const toSnakeCase = (key: string): string =>
    key
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();

  const allSettings = await db.select().from(adminSettings);
  let fixed = 0;
  for (const setting of allSettings) {
    const correctKey = toSnakeCase(setting.settingKey);
    if (correctKey !== setting.settingKey) {
      // Check if snake_case version already exists — if so, just delete the camelCase duplicate
      const existing = allSettings.find(s => s.settingKey === correctKey);
      if (!existing) {
        // No snake_case version yet — rename by inserting snake_case
        await db.insert(adminSettings)
          .values({ settingKey: correctKey, settingValue: setting.settingValue, updatedAt: new Date() })
          .onConflictDoNothing();
      }
      // Always delete the old camelCase key so it never overwrites snake_case on next restart
      await db.execute(sql`DELETE FROM admin_settings WHERE setting_key = ${setting.settingKey}`);
      fixed++;
      console.log(`🔧 Fixed admin setting key: ${setting.settingKey} → ${correctKey}`);
    }
  }
  if (fixed > 0) console.log(`✅ Migrated ${fixed} admin setting keys to correct snake_case`);
} catch (err) {
  console.log('⚠️ Admin settings key migration skipped:', err);
}

// Migration: add description column to advertiser_tasks if missing
try {
  const { db } = await import('./db');
  const { sql: sqlRaw } = await import('drizzle-orm');
  await db.execute(sqlRaw`ALTER TABLE advertiser_tasks ADD COLUMN IF NOT EXISTS description text`);
} catch (err) {
  console.log('⚠️ advertiser_tasks.description migration skipped:', err);
}

// Migration: add per-provider ad tracking columns
try {
  const { db: db2 } = await import('./db');
  const { sql: sql2 } = await import('drizzle-orm');
  await db2.execute(sql2`ALTER TABLE users ADD COLUMN IF NOT EXISTS monetag_ads_watched_today integer DEFAULT 0`);
  await db2.execute(sql2`ALTER TABLE users ADD COLUMN IF NOT EXISTS gigapub_ads_watched_today integer DEFAULT 0`);
  console.log('✅ Per-provider ad tracking columns ready');
} catch (err) {
  console.log('⚠️ Per-provider ad tracking columns migration skipped:', err);
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Country blocking middleware - must be early to block requests before any other processing
app.use(countryBlockingMiddleware);

// Webhook is handled in routes.ts to avoid duplicate processing

// Emergency referral fix endpoint - SECURED for production
app.post('/api/emergency-fix-referrals', async (req: any, res) => {
  try {
    // Only allow in development - disabled in production for security
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Emergency endpoint disabled in production for security'
      });
    }
    
    console.log('🚨 EMERGENCY: Running referral data repair...');
    
    const { storage } = await import('./storage');
    
    // Step 1: Run the referral data synchronization
    await storage.fixExistingReferralData();
    
    // Step 2: Ensure all users have referral codes
    await storage.ensureAllUsersHaveReferralCodes();
    
    console.log('✅ Emergency referral repair completed successfully!');
    
    res.json({
      success: true,
      message: 'Emergency referral data repair completed successfully!',
      instructions: 'All missing referral data has been restored. Refresh your app to see the updated referral count and balance!'
    });
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
  console.log('✅ Direct test route called!');
  res.json({ status: 'Direct API route working!', timestamp: new Date().toISOString() });
});

// Webhook status endpoint
app.get('/api/telegram/webhook/status', async (req: any, res) => {
  try {
    const { checkBotStatus, getWebhookInfo } = await import('./telegram');
    
    const botStatus = await checkBotStatus();
    const webhookInfo = await getWebhookInfo();
    
    res.json({
      bot: botStatus,
      webhook: webhookInfo,
      timestamp: new Date().toISOString()
    });
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

  // Safely intercept res.json without interfering with response flow
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    try {
      capturedJsonResponse = bodyJson;
    } catch (error) {
      // Ignore JSON capture errors to prevent response interference
      console.warn('⚠️ Failed to capture response JSON for logging:', error);
    }
    // Always call original method regardless of capture success
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
    } catch (error) {
      // Ignore logging errors to prevent interference with response
      console.warn('⚠️ Failed to log response:', error);
    }
  });

  next();
});

(async () => {
  // Database migration already completed at module load time
  
  // Setup modern authentication system
  await setupAuth(app);
  
  // IMPORTANT: Register API routes BEFORE Vite middleware to prevent catch-all interference
  const server = await registerRoutes(app);

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Setup Vite/static serving AFTER API routes are registered
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // For Replit, use port 5000. For Render, use PORT env variable (default 10000).
  // this serves both the API and the client.
  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  
  // Ensure port is valid
  if (isNaN(port) || port <= 0 || port >= 65536) {
    console.error(`Invalid port: ${process.env.PORT}, using default 5000`);
    port = 5000;
  }
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, async () => {
    log(`serving on port ${port}`);
    
    // Set up new daily reset check (runs every 5 minutes at 18:30 UTC = 12 AM IST)
    setInterval(async () => {
      try {
        const { storage } = await import('./storage');
        await storage.checkAndPerformDailyResetV2();
      } catch (error) {
        console.error('❌ Error in daily reset check:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // ── Admin-controlled Monthly Contest monitor ───────────────────────────
    // Runs every 5 min. Fires when monthly_contest_end_date passes:
    // saves snapshot, resets weekly_stars, notifies admin, clears dates.
    setInterval(async () => {
      try {
        const { db } = await import('./db');
        const { adminSettings, users, leaderboardSnapshots } = await import('../shared/schema');
        const { sql } = await import('drizzle-orm');

        const allSettings = await db.select().from(adminSettings);
        const getSetting = (key: string, def: string) =>
          (allSettings as any[]).find((s: any) => s.settingKey === key)?.settingValue || def;

        const endDateStr = getSetting('monthly_contest_end_date', '');
        const startDateStr = getSetting('monthly_contest_start_date', '');
        if (!endDateStr || !startDateStr) return;

        const endDate = new Date(endDateStr);
        if (isNaN(endDate.getTime()) || Date.now() < endDate.getTime()) return;

        const guardKey = `monthly_contest_done_${endDateStr.replace(/[^0-9]/g, '_')}`;
        if (getSetting(guardKey, 'false') === 'true') return;

        const topN = parseInt(getSetting('monthly_contest_top_users', '20'));
        log(`🏁 Monthly contest ended (${endDateStr}). Saving snapshot…`);

        const topUsers = await db.execute(sql`
          SELECT id, username, first_name, weekly_stars
          FROM users
          WHERE COALESCE(weekly_stars, 0) > 0
            AND COALESCE(banned, false) = false
          ORDER BY weekly_stars DESC
          LIMIT ${topN}
        `);

        if (topUsers.rows.length > 0) {
          const snapshotKey = `monthly_${endDateStr.replace(/[^0-9]/g, '_')}`;
          for (let i = 0; i < topUsers.rows.length; i++) {
            const u = topUsers.rows[i] as any;
            await db.insert(leaderboardSnapshots).values({
              weekKey: snapshotKey,
              rank: i + 1,
              userId: u.id,
              username: u.username,
              firstName: u.first_name,
              weeklyStars: Number(u.weekly_stars || 0),
            }).onConflictDoNothing();
          }
        }

        const adminId = process.env.SUPER_ADMIN_ID || process.env.TELEGRAM_ADMIN_ID;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (adminId && botToken) {
          const medals = ['🥇', '🥈', '🥉'];
          let msg = `🏆 <b>Monthly Contest Ended!</b>\n\n`;
          msg += `📅 Period: <code>${startDateStr}</code> → <code>${endDateStr}</code>\n`;
          msg += `👥 Participants: ${topUsers.rows.length}\n\n`;
          if (topUsers.rows.length > 0) {
            (topUsers.rows as any[]).slice(0, 10).forEach((u: any, i: number) => {
              const name = u.username ? `@${u.username}` : (u.first_name || `User`);
              msg += `${medals[i] || `${i + 1}.`} <b>${name}</b> — ${u.weekly_stars} ⭐\n   <code>${u.id}</code>\n`;
            });
          } else {
            msg += `No participants this period.\n`;
          }
          msg += `\n💡 Please distribute rewards manually.\n🔄 Stars have been reset to 0.`;
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminId, text: msg, parse_mode: 'HTML' }),
          }).catch(() => {});
        }

        await db.execute(sql`UPDATE users SET weekly_stars = 0, weekly_star_week = NULL, updated_at = NOW()`);

        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES (${guardKey}, 'true', 'Monthly contest done guard')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'true', updated_at = NOW()
        `);
        // Clear dates so leaderboard correctly shows "Not Active"
        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('monthly_contest_start_date', '', 'Monthly contest start date')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = '', updated_at = NOW()
        `);
        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('monthly_contest_end_date', '', 'Monthly contest end date')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = '', updated_at = NOW()
        `);

        log(`✅ Monthly contest done: ${topUsers.rows.length} entries snapshotted, weekly_stars reset.`);
      } catch (err) {
        console.error('❌ Error in monthly contest monitor:', err);
      }
    }, 5 * 60 * 1000);

    // ── Admin-controlled Referral Contest monitor ─────────────────────────────
    // Runs every 5 min. Fires when weekly_referral_end_date passes:
    // sends referral leaderboard snapshot to admin, clears dates.
    setInterval(async () => {
      try {
        const { db } = await import('./db');
        const { adminSettings } = await import('../shared/schema');
        const { sql } = await import('drizzle-orm');

        const allSettings = await db.select().from(adminSettings);
        const getSetting = (key: string, def: string) =>
          (allSettings as any[]).find((s: any) => s.settingKey === key)?.settingValue || def;

        const endDateStr = getSetting('weekly_referral_end_date', '');
        const startDateStr = getSetting('weekly_referral_start_date', '');
        if (!endDateStr || !startDateStr) return;

        const endDate = new Date(endDateStr);
        if (isNaN(endDate.getTime()) || Date.now() < endDate.getTime()) return;

        const guardKey = `referral_contest_done_${endDateStr.replace(/[^0-9]/g, '_')}`;
        if (getSetting(guardKey, 'false') === 'true') return;

        const topN = parseInt(getSetting('weekly_referral_top_users', '10'));
        log(`🏁 Referral contest ended (${endDateStr}). Saving referral snapshot…`);

        const topReferrers = await db.execute(sql`
          SELECT
            r.referrer_id AS id,
            u.username,
            u.first_name,
            COUNT(*)::int AS referral_count
          FROM referrals r
          JOIN users u ON u.id = r.referrer_id
          WHERE r.status = 'active'
            AND r.created_at >= ${startDateStr}::timestamptz
            AND COALESCE(u.banned, false) = false
          GROUP BY r.referrer_id, u.username, u.first_name
          ORDER BY referral_count DESC
          LIMIT ${topN}
        `);

        const adminId = process.env.SUPER_ADMIN_ID || process.env.TELEGRAM_ADMIN_ID;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (adminId && botToken) {
          const medals = ['🥇', '🥈', '🥉'];
          let msg = `👥 <b>Referral Contest Ended!</b>\n\n`;
          msg += `📅 Period: <code>${startDateStr}</code> → <code>${endDateStr}</code>\n`;
          if (topReferrers.rows.length > 0) {
            msg += `\n`;
            (topReferrers.rows as any[]).slice(0, 10).forEach((u: any, i: number) => {
              const name = u.username ? `@${u.username}` : (u.first_name || `User`);
              msg += `${medals[i] || `${i + 1}.`} <b>${name}</b> — ${u.referral_count} invites\n   <code>${u.id}</code>\n`;
            });
          } else {
            msg += `No participants this period.\n`;
          }
          msg += `\n💡 Please distribute rewards manually.`;
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminId, text: msg, parse_mode: 'HTML' }),
          }).catch(() => {});
        }

        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES (${guardKey}, 'true', 'Referral contest done guard')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'true', updated_at = NOW()
        `);
        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('weekly_referral_start_date', '', 'Referral contest start date')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = '', updated_at = NOW()
        `);
        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('weekly_referral_end_date', '', 'Referral contest end date')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = '', updated_at = NOW()
        `);

        log(`✅ Referral contest done: snapshot sent, dates cleared.`);
      } catch (err) {
        console.error('❌ Error in referral contest monitor:', err);
      }
    }, 5 * 60 * 1000)
    
    // Auto-setup Telegram webhook on server start with retry logic
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const { setupTelegramWebhook, checkBotStatus, getWebhookInfo } = await import('./telegram');
        
        // Use the correct domain for the webhook (Render, Replit, or require env)
        const replitDomains = process.env.REPLIT_DOMAINS?.split(',')[0]?.trim();
        const domain = process.env.RENDER_EXTERNAL_URL?.replace(/^https?:\/\//, '') ||
                      replitDomains ||
                      process.env.REPLIT_DOMAIN ||
                      process.env.REPLIT_DEV_DOMAIN ||
                      (process.env.REPL_SLUG ? `${process.env.REPL_SLUG}.replit.app` : null);
        
        if (!domain) {
          log('❌ No webhook domain configured - set RENDER_EXTERNAL_URL or ensure Replit environment variables are available');
          return;
        }
        
        const webhookUrl = `https://${domain}/api/telegram/webhook`;
        log(`🔧 Setting up Telegram webhook: ${webhookUrl}`);
        
        const success = await setupTelegramWebhook(webhookUrl);
        if (success) {
          log('✅ Telegram bot is active and ready to receive messages');
        } else {
          log('❌ Failed to configure Telegram webhook - bot may not respond to messages');
          
          setTimeout(async () => {
            log('🔄 Retrying webhook setup...');
            const retrySuccess = await setupTelegramWebhook(webhookUrl);
            if (retrySuccess) {
              log('✅ Webhook configured on retry');
            }
          }, 10000);
        }
        
        setInterval(async () => {
          try {
            const webhookInfo = await getWebhookInfo();
            if (webhookInfo.error || !webhookInfo.url) {
              log('⚠️ Webhook connection lost, reconnecting...');
              await setupTelegramWebhook(webhookUrl);
            }
          } catch (error) {
            log('⚠️ Webhook health check failed:', String(error));
          }
        }, 5 * 60 * 1000);
        
      } catch (error) {
        log('❌ Error setting up Telegram webhook:', String(error));
      }
    } else {
      log('⚠️ TELEGRAM_BOT_TOKEN not set - bot functionality disabled');
    }
  });
})();
