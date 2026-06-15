import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { ensureDatabaseSchema } from "./migrate";
import { countryBlockingMiddleware } from "./countryBlocking";

// CRITICAL: Run database migrations before ANYTHING else
// This ensures the telegram_id column exists before any database operations
console.log('🚀 Starting CashWatch server...');
await ensureDatabaseSchema();
console.log('✅ Database schema verified, starting server setup...');

// Ensure admin user exists for production deployment
try {
  const { storage } = await import('./storage');
  await storage.ensureAdminUserExists();

  // Run heavy startup tasks in background — don't block server startup
  (async () => {
    try {
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

    // Contest-end detector — runs every 5 minutes
    // When weekly_contest_end_date passes: zero all weekly_stars and lock star earning
    // Stars stay locked until Monday 12 AM IST (Sunday 18:30 UTC daily reset) unlocks them
    setInterval(async () => {
      try {
        const { db } = await import('./db');
        const { adminSettings, users } = await import('../shared/schema');
        const { eq, sql } = await import('drizzle-orm');

        // Read current lock state + optional admin-set end date
        const [endDateRow, lockedRow] = await Promise.all([
          db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'weekly_contest_end_date')).limit(1),
          db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'stars_locked')).limit(1),
        ]);

        const alreadyLocked = lockedRow[0]?.settingValue === 'true';
        if (alreadyLocked) return; // Already locked, nothing to do

        // Trigger 1: Admin-set contest end date has passed
        const endDateStr = endDateRow[0]?.settingValue || '';
        const endDate = endDateStr ? new Date(endDateStr) : null;
        const adminEndTriggered = endDate && !isNaN(endDate.getTime()) && Date.now() >= endDate.getTime();

        // Trigger 2: Automatic — every Saturday at or after 18:30 UTC (= Sunday 12 AM IST, contest ends)
        const checkNow = new Date();
        const isSaturday = checkNow.getUTCDay() === 6;
        const afterContestEndTime = checkNow.getUTCHours() >= 18 && checkNow.getUTCMinutes() >= 30;
        const autoEndTriggered = isSaturday && afterContestEndTime;

        if (!adminEndTriggered && !autoEndTriggered) return;

        const triggerReason = adminEndTriggered
          ? `admin end date ${endDateStr}`
          : `auto Saturday 18:30 UTC (Sunday 12 AM IST)`;

        // Contest has ended → lock now
        log(`🏁 Weekly contest ended (${triggerReason}). Saving snapshot, locking star earning…`);

        // Calculate current week key for snapshot
        const now = new Date();
        const year = now.getUTCFullYear();
        const startOfYear = new Date(Date.UTC(year, 0, 1));
        const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
        const weekNum = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
        const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;

        // 1. Save leaderboard snapshot (only if not already saved)
        const { leaderboardSnapshots } = await import('../shared/schema');
        const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM leaderboard_snapshots WHERE week_key = ${weekKey}`);
        const alreadySaved = Number((existing.rows[0] as any)?.cnt || 0) > 0;

        if (!alreadySaved) {
          const top50 = await db.execute(sql`
            SELECT id, username, first_name, profile_image_url, weekly_stars
            FROM users
            WHERE COALESCE(weekly_stars, 0) > 0
              AND COALESCE(banned, false) = false
            ORDER BY weekly_stars DESC
            LIMIT 50
          `);
          if (top50.rows.length > 0) {
            for (let i = 0; i < top50.rows.length; i++) {
              const u = top50.rows[i] as any;
              await db.insert(leaderboardSnapshots).values({
                weekKey,
                rank: i + 1,
                userId: u.id,
                username: u.username,
                firstName: u.first_name,
                profileImageUrl: u.profile_image_url,
                weeklyStars: Number(u.weekly_stars || 0),
              }).onConflictDoNothing();
            }
            log(`📸 Leaderboard snapshot saved: ${top50.rows.length} entries for ${weekKey}`);

            // 2. Notify admin about contest end + winner
            const adminId = process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID;
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (adminId && botToken) {
              const winner = top50.rows[0] as any;
              const winnerName = winner.username ? `@${winner.username}` : (winner.first_name || 'Unknown');
              const totalParticipants = top50.rows.length;
              const msg = `🏁 *Weekly Contest Ended!*\n\n` +
                `📅 Week: \`${weekKey}\`\n` +
                `🥇 Winner: ${winnerName} — *${winner.weekly_stars} ⭐ stars*\n` +
                `👥 Participants: ${totalParticipants}\n\n` +
                `🔒 Star earning is now *LOCKED* until Sunday midnight IST (Saturday 18:30 UTC)\n` +
                `All users' weekly stars have been reset to 0.`;
              fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: adminId, text: msg, parse_mode: 'Markdown' }),
              }).catch(() => {});
            }
          } else {
            log(`ℹ️ No participants found for ${weekKey} — snapshot skipped`);
          }
        }

        // 3. Zero all weekly_stars
        await db.execute(sql`UPDATE users SET weekly_stars = 0, weekly_star_week = NULL, updated_at = NOW()`);

        // 4. Set stars_locked = true (stays locked until Monday 12 AM IST = Sunday 18:30 UTC)
        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('stars_locked', 'true', 'Locks star earning between contest end and Monday 12 AM IST (Sunday 18:30 UTC)')
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'true', updated_at = NOW()
        `);

        log('✅ Contest ended: leaderboard saved, weekly_stars cleared, star earning locked until Monday 12 AM IST (Sunday 18:30 UTC)');
      } catch (err) {
        console.error('❌ Error in contest-end detector:', err);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Monday IST new-contest broadcast — runs every hour, fires Sun 18:30–18:59 UTC (= Mon 12 AM IST)
    // Sends "new weekly contest started" message to all users once per week
    setInterval(async () => {
      try {
        const now = new Date();
        // Sunday UTC 18:30 = Monday 12 AM IST (contest starts)
        const isMondayIST = now.getUTCDay() === 0;
        const isResetHour = now.getUTCHours() === 18 && now.getUTCMinutes() >= 30;
        if (!isMondayIST || !isResetHour) return;

        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || '';
        if (!botToken) return;

        const { db } = await import('./db');
        const { adminSettings, users } = await import('../shared/schema');
        const { sql, eq } = await import('drizzle-orm');

        // Idempotent guard — store this week key in admin_settings
        const year = now.getUTCFullYear();
        const startOfYear = new Date(Date.UTC(year, 0, 1));
        const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
        const weekNum = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
        const weekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;
        const guardKey = `contest_broadcast_sent_${weekKey}`;

        const guardRow = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, guardKey)).limit(1);
        if (guardRow.length > 0) return; // Already sent this week

        // Mark as sent BEFORE broadcasting (prevents duplicate on restart)
        await db.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES (${guardKey}, 'true', 'Monday broadcast sent flag for ' || ${weekKey})
          ON CONFLICT (setting_key) DO NOTHING
        `);

        // Fetch prize pool for the message
        const prizeRow = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'weekly_giveaway_amount')).limit(1);
        const prizePool = Number(prizeRow[0]?.settingValue || 10);
        const top1Prize = ((prizePool * 25) / 100).toFixed(0);
        const top2Prize = ((prizePool * 18) / 100).toFixed(0);
        const top3Prize = ((prizePool * 14) / 100).toFixed(0);

        const msg = `🌟 <b>New Weekly Contest Has Started!</b>\n\n` +
          `⭐ Earn stars by watching ads & completing tasks\n` +
          `🏆 Top 10 winners share <b>$${prizePool}</b> this week\n\n` +
          `🥇 1st Place — <b>$${top1Prize}</b>\n` +
          `🥈 2nd Place — <b>$${top2Prize}</b>\n` +
          `🥉 3rd Place — <b>$${top3Prize}</b>\n\n` +
          `The contest runs until <b>Saturday midnight IST (12 AM IST)</b>.\n` +
          `Start earning stars now! 👇`;

        const replyMarkup = botUsername ? {
          inline_keyboard: [[
            { text: '🎯 Earn Stars Now', url: `https://t.me/${botUsername}/MyWAdz` }
          ]]
        } : undefined;

        // Fetch all users with telegram_id
        const allUsers = await db.execute(sql`
          SELECT DISTINCT telegram_id FROM users
          WHERE telegram_id IS NOT NULL AND telegram_id != ''
          AND COALESCE(banned, false) = false
        `);

        log(`📢 Monday IST broadcast: sending new-contest message to ${allUsers.rows.length} users…`);

        let sent = 0, failed = 0;
        for (const row of allUsers.rows) {
          const tgId = (row as any).telegram_id;
          try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: tgId,
                text: msg,
                parse_mode: 'HTML',
                ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
              }),
            });
            const json = await res.json() as any;
            if (json.ok) sent++; else failed++;
          } catch {
            failed++;
          }
          // 35ms delay to stay well under Telegram's 30 msg/sec limit
          await new Promise(r => setTimeout(r, 35));
        }

        log(`✅ Monday IST broadcast done — ${sent} delivered, ${failed} failed`);
      } catch (err) {
        console.error('❌ Error in Monday contest broadcast:', err);
      }
    }, 60 * 60 * 1000); // Every hour

    // Weekly leaderboard report check (runs every 30 minutes on Monday UTC)
    setInterval(async () => {
      try {
        const { checkAndSendWeeklyLeaderboardReport } = await import('./telegram');
        await checkAndSendWeeklyLeaderboardReport();
      } catch (error) {
        console.error('❌ Error in weekly leaderboard report check:', error);
      }
    }, 30 * 60 * 1000); // Every 30 minutes

    // Weekly star reset — runs every hour, fires on Sunday UTC 18:30–18:59 (= Monday 12 AM IST)
    // Saves top-50 snapshot then resets weekly_stars = 0 for all users
    setInterval(async () => {
      try {
        const now = new Date();
        // Sunday UTC 18:30 = Monday 12 AM IST — contest week starts fresh
        const isMondayIST = now.getUTCDay() === 0;
        const isResetHour = now.getUTCHours() === 18 && now.getUTCMinutes() >= 30;
        if (!isMondayIST || !isResetHour) return;

        const { db } = await import('./db');
        const { users, leaderboardSnapshots } = await import('../shared/schema');
        const { sql } = await import('drizzle-orm');

        // Calculate last week key (the week that just ended = Saturday IST)
        const lastWeekDate = new Date(now);
        lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 1); // Saturday UTC = last week
        const year = lastWeekDate.getUTCFullYear();
        const startOfYear = new Date(Date.UTC(year, 0, 1));
        const dayOfYear = Math.floor((lastWeekDate.getTime() - startOfYear.getTime()) / 86400000);
        const weekNum = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
        const lastWeekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;

        // Check if already reset this week (idempotent guard)
        const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM leaderboard_snapshots WHERE week_key = ${lastWeekKey}`);
        const alreadyDone = Number((existing.rows[0] as any)?.cnt || 0) > 0;
        if (alreadyDone) return;

        log(`🔄 Weekly reset: saving snapshot for ${lastWeekKey} and resetting weekly_stars…`);

        // 1. Save top-50 snapshot
        const top50 = await db.execute(sql`
          SELECT id, username, first_name, profile_image_url, weekly_stars
          FROM users
          WHERE COALESCE(weekly_stars, 0) > 0
            AND COALESCE(banned, false) = false
          ORDER BY weekly_stars DESC
          LIMIT 50
        `);

        if (top50.rows.length > 0) {
          for (let i = 0; i < top50.rows.length; i++) {
            const u = top50.rows[i] as any;
            await db.insert(leaderboardSnapshots).values({
              weekKey: lastWeekKey,
              rank: i + 1,
              userId: u.id,
              username: u.username,
              firstName: u.first_name,
              profileImageUrl: u.profile_image_url,
              weeklyStars: Number(u.weekly_stars || 0),
            }).onConflictDoNothing();
          }
          log(`✅ Weekly snapshot saved: ${top50.rows.length} entries for ${lastWeekKey}`);
        }

        // 2. Reset weekly_stars = 0 for all users
        await db.execute(sql`UPDATE users SET weekly_stars = 0, weekly_star_week = NULL, updated_at = NOW()`);
        log(`✅ Weekly reset done — all weekly_stars cleared for new week`);

      } catch (error) {
        console.error('❌ Weekly star reset error:', error);
      }
    }, 60 * 60 * 1000); // Every hour
    
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
