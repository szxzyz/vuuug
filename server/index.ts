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
  
  // CRITICAL FIX: Backfill BUG rewards for users who earned referrals before the update
  await storage.backfillExistingReferralBUGRewards();
} catch (error) {
  console.log('⚠️ Could not ensure system setup:', error);
  // Continue server startup even if setup fails
}

// One-time migration: fix admin settings keys that were incorrectly snake_cased
// (e.g. referralRewardPADEnabled was saved as referral_reward_p_a_d_enabled instead of referral_reward_pad_enabled)
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
      // Save under the correct snake_case key (upsert)
      await db.insert(adminSettings)
        .values({ settingKey: correctKey, settingValue: setting.settingValue, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: adminSettings.settingKey,
          set: { settingValue: setting.settingValue, updatedAt: new Date() }
        });
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

// Add webhook route BEFORE any other middleware to ensure it works
app.post('/api/telegram/webhook', async (req: any, res) => {
  try {
    console.log('📨 Direct webhook called!', JSON.stringify(req.body, null, 2));
    
    const { handleTelegramMessage } = await import('./telegram');
    const handled = await handleTelegramMessage(req.body);
    console.log('✅ Message handled:', handled);
    
    res.status(200).json({ ok: true, handled });
  } catch (error) {
    console.error('❌ Direct webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    
    // Set up new daily reset check (runs every 5 minutes at 00:00 UTC)
    setInterval(async () => {
      try {
        const { storage } = await import('./storage');
        await storage.checkAndPerformDailyResetV2();
      } catch (error) {
        console.error('❌ Error in daily reset check:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Auto-setup Telegram webhook on server start with retry logic
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const { setupTelegramWebhook, checkBotStatus, getWebhookInfo } = await import('./telegram');
        
        // Use the correct domain for the webhook (Render, Replit, or require env)
        const domain = process.env.RENDER_EXTERNAL_URL?.replace(/^https?:\/\//, '') ||
                      process.env.REPLIT_DOMAIN || 
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
