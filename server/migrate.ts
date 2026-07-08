import pkg from 'pg';
const { Pool } = pkg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema";
import { sql } from 'drizzle-orm';

export async function ensureDatabaseSchema(): Promise<void> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000,
  });
  const db = drizzle(pool, { schema });
  
  try {
    console.log('🔄 [MIGRATION] Ensuring all database tables exist...');
    
    // Enable pgcrypto extension for gen_random_uuid() support
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    } catch {
      // Already exists or not available — fine
    }

    // ─── BATCH 1: Create all tables in one go ──────────────────────────────────
    // Sessions table - CRITICAL for connect-pg-simple authentication
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);

    // Users table — all known columns included so ALTER TABLE is a no-op on new DBs
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id VARCHAR(20) UNIQUE,
        username VARCHAR,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        profile_image_url TEXT,
        personal_code TEXT,
        balance DECIMAL(20, 0) DEFAULT '0',
        withdraw_balance DECIMAL(30, 10),
        total_earnings DECIMAL(30, 10),
        total_earned DECIMAL(30, 10) DEFAULT '0',
        ads_watched INTEGER DEFAULT 0,
        daily_ads_watched INTEGER DEFAULT 0,
        ads_watched_today INTEGER DEFAULT 0,
        daily_earnings DECIMAL(12, 8),
        last_ad_watch TIMESTAMP,
        last_ad_date TIMESTAMP,
        current_streak INTEGER DEFAULT 0,
        last_streak_date TIMESTAMP,
        level INTEGER DEFAULT 1,
        referred_by VARCHAR,
        referral_code TEXT,
        flagged BOOLEAN DEFAULT false,
        flag_reason TEXT,
        banned BOOLEAN DEFAULT false,
        banned_reason TEXT,
        banned_at TIMESTAMP,
        device_id TEXT,
        device_fingerprint JSONB,
        is_primary_account BOOLEAN DEFAULT true,
        last_login_at TIMESTAMP,
        last_login_ip TEXT,
        last_login_device TEXT,
        last_login_user_agent TEXT,
        channel_visited BOOLEAN DEFAULT false,
        app_shared BOOLEAN DEFAULT false,
        friends_invited INTEGER DEFAULT 0,
        first_ad_watched BOOLEAN DEFAULT false,
        last_reset_date TIMESTAMP,
        extra_ads_watched_today INTEGER DEFAULT 0,
        last_extra_ad_date TIMESTAMP,
        ton_wallet_address TEXT,
        ton_wallet_comment TEXT,
        telegram_username_wallet TEXT,
        cwallet_id TEXT,
        wallet_updated_at TIMESTAMP,
        pending_referral_bonus DECIMAL(12, 8) DEFAULT '0',
        total_claimed_referral_bonus DECIMAL(12, 8) DEFAULT '0',
        ton_balance DECIMAL(30, 10) DEFAULT '0',
        usd_balance DECIMAL(30, 10) DEFAULT '0',
        pdz_balance DECIMAL(30, 10) DEFAULT '0',
        bug_balance DECIMAL(30, 10) DEFAULT '0',
        usdt_wallet_address TEXT,
        telegram_stars_username TEXT,
        task_share_completed_today BOOLEAN DEFAULT false,
        task_channel_completed_today BOOLEAN DEFAULT false,
        task_community_completed_today BOOLEAN DEFAULT false,
        task_checkin_completed_today BOOLEAN DEFAULT false,
        app_version TEXT,
        browser_fingerprint TEXT,
        registered_at TIMESTAMP DEFAULT NOW(),
        referrer_uid TEXT,
        is_channel_group_verified BOOLEAN DEFAULT false,
        last_membership_check TIMESTAMP,
        language VARCHAR(5) DEFAULT 'en',
        preferred_language VARCHAR(5) DEFAULT 'en',
        hourly_ads_watched INTEGER DEFAULT 0,
        last_hourly_reset TIMESTAMP,
        last_bonus_claimed_date TEXT,
        daily_login_streak INTEGER DEFAULT 0,
        last_daily_login_date TEXT,
        suspicion_score INTEGER DEFAULT 0,
        platform VARCHAR(20),
        monetag_ads_watched_today INTEGER DEFAULT 0,
        gigapub_ads_watched_today INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS earnings (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(30, 10) NOT NULL,
        source VARCHAR NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(30, 10) NOT NULL,
        type VARCHAR NOT NULL,
        source VARCHAR NOT NULL,
        description TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(12, 8) NOT NULL,
        status VARCHAR DEFAULT 'pending',
        method VARCHAR NOT NULL,
        details JSONB,
        comment TEXT,
        transaction_hash VARCHAR,
        admin_notes TEXT,
        deducted BOOLEAN DEFAULT false,
        refunded BOOLEAN DEFAULT false,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promotions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id VARCHAR NOT NULL REFERENCES users(id),
        type VARCHAR NOT NULL,
        url TEXT NOT NULL,
        cost DECIMAL(12, 8) NOT NULL DEFAULT '0.01',
        reward_per_user DECIMAL(12, 8) NOT NULL DEFAULT '0.00025',
        "limit" INTEGER NOT NULL DEFAULT 1000,
        claimed_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR NOT NULL DEFAULT 'active',
        title VARCHAR(255),
        description TEXT,
        reward INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS task_completions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        promotion_id VARCHAR NOT NULL REFERENCES promotions(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(12, 8) NOT NULL,
        verified BOOLEAN DEFAULT false,
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(promotion_id, user_id)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_balances (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR UNIQUE NOT NULL REFERENCES users(id),
        balance DECIMAL(20, 8) DEFAULT '0',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referrals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id VARCHAR NOT NULL REFERENCES users(id),
        referee_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(12, 5) DEFAULT '0.01',
        usd_reward_amount DECIMAL(30, 10) DEFAULT '0',
        bug_reward_amount DECIMAL(30, 10) DEFAULT '0',
        status VARCHAR DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(referrer_id, referee_id)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referral_commissions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id VARCHAR NOT NULL REFERENCES users(id),
        referred_user_id VARCHAR NOT NULL REFERENCES users(id),
        original_earning_id INTEGER NOT NULL REFERENCES earnings(id),
        commission_amount DECIMAL(12, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR UNIQUE NOT NULL,
        reward_amount DECIMAL(30, 10) NOT NULL,
        reward_type VARCHAR DEFAULT 'PAD' NOT NULL,
        reward_currency VARCHAR DEFAULT 'USDT',
        usage_limit INTEGER,
        usage_count INTEGER DEFAULT 0,
        per_user_limit INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_code_usage (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        promo_code_id VARCHAR NOT NULL REFERENCES promo_codes(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(30, 10) NOT NULL,
        used_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS daily_tasks (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        task_level INTEGER NOT NULL,
        progress INTEGER DEFAULT 0,
        required INTEGER NOT NULL,
        completed BOOLEAN DEFAULT false,
        claimed BOOLEAN DEFAULT false,
        reward_amount DECIMAL(12, 8) NOT NULL,
        completed_at TIMESTAMP,
        claimed_at TIMESTAMP,
        reset_date VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_level, reset_date)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR NOT NULL,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_by VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Advertiser tasks table — ALL columns included to avoid ALTER TABLE on new DBs
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS advertiser_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        advertiser_id VARCHAR NOT NULL REFERENCES users(id),
        task_type VARCHAR NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        link TEXT NOT NULL,
        total_clicks_required INTEGER NOT NULL,
        current_clicks INTEGER DEFAULT 0 NOT NULL,
        cost_per_click DECIMAL(12, 8) DEFAULT 0.0003 NOT NULL,
        total_cost DECIMAL(12, 8) NOT NULL,
        status VARCHAR DEFAULT 'active' NOT NULL,
        channel_verified BOOLEAN NOT NULL DEFAULT false,
        verification_required BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS task_clicks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id VARCHAR NOT NULL REFERENCES advertiser_tasks(id) ON DELETE CASCADE,
        publisher_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(12, 8) DEFAULT 0.0001750 NOT NULL,
        clicked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(task_id, publisher_id)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ban_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        banned_user_id VARCHAR NOT NULL REFERENCES users(id),
        banned_user_uid TEXT,
        ip TEXT,
        device_id TEXT,
        user_agent TEXT,
        fingerprint JSONB,
        reason TEXT NOT NULL,
        ban_type VARCHAR NOT NULL,
        banned_by VARCHAR,
        related_account_ids JSONB,
        referrer_uid TEXT,
        telegram_id TEXT,
        app_version TEXT,
        browser_fingerprint TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS daily_missions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        mission_type TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        claimed_at TIMESTAMP,
        reset_date TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT daily_missions_user_type_date_unique UNIQUE (user_id, mission_type, reset_date)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promotion_claims (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        promotion_id VARCHAR NOT NULL REFERENCES promotions(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(12, 8) NOT NULL,
        claimed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(promotion_id, user_id)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blocked_countries (
        id SERIAL PRIMARY KEY,
        country_code VARCHAR(2) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ton_deposits (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(30, 10) NOT NULL,
        boc TEXT NOT NULL UNIQUE,
        status VARCHAR DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        confirmed_at TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spin_data (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL UNIQUE REFERENCES users(id),
        free_spin_used BOOLEAN DEFAULT false,
        extra_spins INTEGER DEFAULT 0,
        spin_ads_watched INTEGER DEFAULT 0,
        invite_spins_earned INTEGER DEFAULT 0,
        last_spin_date VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spin_history (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        reward_type VARCHAR NOT NULL,
        reward_amount DECIMAL(30, 10) NOT NULL,
        spin_type VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_roles (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(100) DEFAULT 'Admin',
        role VARCHAR(30) NOT NULL DEFAULT 'moderator',
        permissions TEXT NOT NULL DEFAULT '[]',
        added_by VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ [MIGRATION] All tables created');

    // ─── BATCH 2: Indexes ──────────────────────────────────────────────────────
    // Run all index creations together — each is idempotent (IF NOT EXISTS)
    await Promise.all([
      db.execute(sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions(expire)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_earnings_user_id ON earnings(user_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_task_completions_user_id ON task_completions(user_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, reset_date)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_user_id ON ban_logs(banned_user_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_device_id ON ban_logs(device_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_ip ON ban_logs(ip)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_created_at ON ban_logs(created_at)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_blocked_countries_code ON blocked_countries(country_code)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ton_deposits_user ON ton_deposits(user_id)`),
      db.execute(sql`CREATE INDEX IF NOT EXISTS idx_spin_history_user ON spin_history(user_id)`),
    ]).catch(() => {
      // Indexes are performance-only; failure is non-fatal
    });
    console.log('✅ [MIGRATION] Indexes ensured');

    // ─── BATCH 3: Backfill + unique constraints ────────────────────────────────
    // Safely add unique constraint on admin_settings.setting_key
    try {
      await db.execute(sql`
        DELETE FROM admin_settings a
        USING admin_settings b
        WHERE a.id < b.id AND a.setting_key = b.setting_key
      `);
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'admin_settings_setting_key_unique'
          ) THEN
            ALTER TABLE admin_settings ADD CONSTRAINT admin_settings_setting_key_unique UNIQUE (setting_key);
          END IF;
        END $$
      `);
    } catch {
      // Already exists
    }

    // Ensure referral codes for all users
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);
      await db.execute(sql`
        UPDATE users
        SET referral_code = 'REF' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8))
        WHERE referral_code IS NULL OR referral_code = ''
      `);
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'users_referral_code_unique'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_referral_code_unique UNIQUE (referral_code);
          END IF;
        END $$
      `);
    } catch {
      // Already exists
    }

    // Default admin settings
    await db.execute(sql`
      INSERT INTO admin_settings (setting_key, setting_value, description)
      VALUES
        ('daily_ad_limit', '510', 'Maximum number of ads a user can watch per day'),
        ('hourly_ad_limit', '63', 'Maximum number of ads a user can watch per hour'),
        ('ad_reward_pad', '1000', 'PAD reward amount per ad watched'),
        ('ad_reward_ton', '0.00010000', 'TON reward amount per ad watched'),
        ('withdrawal_currency', 'TON', 'Currency used for withdrawal displays (TON or PAD)')
      ON CONFLICT (setting_key) DO NOTHING
    `);
    console.log('✅ [MIGRATION] Admin settings defaults ensured');

    // ─── BATCH 4: ALTER TABLE for existing production DBs ─────────────────────
    // These are all idempotent (ADD COLUMN IF NOT EXISTS). Batched into a few
    // DO blocks so the total round-trips drop from 40+ to just a handful.

    // Users: columns that may be missing on older production databases
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_ads_watched_today INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_extra_ad_date TIMESTAMP;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_address TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_comment TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username_wallet TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS cwallet_id TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_updated_at TIMESTAMP;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_referral_bonus DECIMAL(12, 8) DEFAULT '0';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS total_claimed_referral_bonus DECIMAL(12, 8) DEFAULT '0';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_balance DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS usd_balance DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS pdz_balance DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS bug_balance DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS usdt_wallet_address TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_stars_username TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS task_share_completed_today BOOLEAN DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS task_channel_completed_today BOOLEAN DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS task_community_completed_today BOOLEAN DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS task_checkin_completed_today BOOLEAN DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS app_version TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP DEFAULT NOW();
          ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_uid TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS is_channel_group_verified BOOLEAN DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_membership_check TIMESTAMP;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'en';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) DEFAULT 'en';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_ads_watched INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_hourly_reset TIMESTAMP;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_bonus_claimed_date TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_login_streak INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily_login_date TEXT;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS suspicion_score INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS platform VARCHAR(20);
          ALTER TABLE users ADD COLUMN IF NOT EXISTS monetag_ads_watched_today INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS gigapub_ads_watched_today INTEGER DEFAULT 0;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_message_sent BOOLEAN DEFAULT false;
          ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_stars INTEGER DEFAULT 0;
        END $$
      `);
      console.log('✅ [MIGRATION] User columns ensured');
    } catch (err) {
      console.log('ℹ️ [MIGRATION] User column batch skipped (may already exist):', String(err).slice(0, 100));
    }

    // Users: fix column precisions (separate block because TYPE changes can fail if type is already correct)
    try {
      await db.execute(sql`ALTER TABLE users ALTER COLUMN balance TYPE DECIMAL(20, 0) USING ROUND(balance)`);
    } catch { /* already correct type */ }
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE users ALTER COLUMN usd_balance TYPE DECIMAL(30, 10);
          ALTER TABLE users ALTER COLUMN ton_balance TYPE DECIMAL(30, 10);
          ALTER TABLE users ALTER COLUMN pdz_balance TYPE DECIMAL(30, 10);
          ALTER TABLE users ALTER COLUMN total_earned TYPE DECIMAL(30, 10);
          ALTER TABLE users ALTER COLUMN total_earnings TYPE DECIMAL(30, 10);
          ALTER TABLE users ALTER COLUMN withdraw_balance TYPE DECIMAL(30, 10);
        END $$
      `);
    } catch { /* already correct type */ }

    // Withdrawals: missing columns on older DBs
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS comment TEXT;
          ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS deducted BOOLEAN DEFAULT false;
          ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT false;
          ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
        END $$
      `);
      // Backfill legacy withdrawal states
      await db.execute(sql`
        UPDATE withdrawals SET deducted = true
        WHERE status IN ('Approved','Successfull','paid') AND (deducted IS NULL OR deducted = false)
      `);
      await db.execute(sql`
        UPDATE withdrawals SET deducted = false, refunded = false
        WHERE status IN ('rejected','pending') AND (deducted IS NULL OR refunded IS NULL)
      `);
    } catch { /* already exists */ }

    // Advertiser tasks: columns that may be missing on older DBs
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE advertiser_tasks ADD COLUMN IF NOT EXISTS description TEXT;
          ALTER TABLE advertiser_tasks ADD COLUMN IF NOT EXISTS verification_required BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE advertiser_tasks ADD COLUMN IF NOT EXISTS channel_verified BOOLEAN NOT NULL DEFAULT false;
        END $$
      `);
      console.log('✅ [MIGRATION] advertiser_tasks columns ensured');
    } catch (err) {
      console.log('ℹ️ [MIGRATION] advertiser_tasks columns already exist:', String(err).slice(0, 100));
    }

    // Referrals: usd/bug reward columns
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE referrals ADD COLUMN IF NOT EXISTS usd_reward_amount DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bug_reward_amount DECIMAL(30, 10) DEFAULT '0';
        END $$
      `);
    } catch { /* already exists */ }

    // Ban logs: missing columns
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS referrer_uid TEXT;
          ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS telegram_id TEXT;
          ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS app_version TEXT;
          ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT;
        END $$
      `);
    } catch { /* already exists */ }

    // Promo codes: reward_type column
    try {
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS reward_type VARCHAR DEFAULT 'PAD' NOT NULL`);
    } catch { /* already exists */ }

    // Fix amount column precisions for financial accuracy
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE earnings ALTER COLUMN amount TYPE numeric(30,10);
          ALTER TABLE transactions ALTER COLUMN amount TYPE numeric(30,10);
          ALTER TABLE promo_codes ALTER COLUMN reward_amount TYPE numeric(30,10);
          ALTER TABLE promo_code_usage ALTER COLUMN reward_amount TYPE numeric(30,10);
        END $$
      `);
      console.log('✅ [MIGRATION] Amount column precisions fixed to numeric(30,10)');
    } catch { /* already correct */ }

    // ─── BATCH 5: Admin settings snake_case migration ─────────────────────────
    // Fix camelCase admin setting keys to snake_case (one-time migration)
    try {
      const allSettings = await db.execute(sql`SELECT id, setting_key FROM admin_settings`);
      const toSnakeCase = (key: string) =>
        key.replace(/([a-z\d])([A-Z])/g, '$1_$2')
           .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
           .toLowerCase();

      for (const row of (allSettings as any).rows ?? []) {
        const correctKey = toSnakeCase(row.setting_key);
        if (correctKey !== row.setting_key) {
          await db.execute(sql`
            INSERT INTO admin_settings (setting_key, setting_value, updated_at)
            SELECT ${correctKey}, setting_value, NOW() FROM admin_settings WHERE id = ${row.id}
            ON CONFLICT (setting_key) DO NOTHING
          `);
          await db.execute(sql`DELETE FROM admin_settings WHERE id = ${row.id}`);
        }
      }
    } catch { /* non-critical */ }

    // ─── Ambassador Program Tables ─────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ambassador_applications (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        channel_link TEXT NOT NULL,
        channel_title TEXT,
        channel_username TEXT,
        subscriber_count INTEGER,
        status VARCHAR NOT NULL DEFAULT 'pending',
        rejection_reason TEXT,
        reviewed_by VARCHAR,
        reviewed_at TIMESTAMP,
        terms_accepted BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ambassadors (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL UNIQUE REFERENCES users(id),
        application_id VARCHAR REFERENCES ambassador_applications(id),
        promo_code_name VARCHAR NOT NULL UNIQUE,
        promo_prefix VARCHAR,
        custom_promo_request VARCHAR,
        custom_promo_request_status VARCHAR DEFAULT 'none',
        daily_promo_count INTEGER DEFAULT 1,
        channel_verified BOOLEAN DEFAULT false,
        channel_id VARCHAR,
        next_promo_at TIMESTAMP,
        posting_schedule TEXT,
        total_claims INTEGER DEFAULT 0,
        today_claims INTEGER DEFAULT 0,
        week_claims INTEGER DEFAULT 0,
        month_claims INTEGER DEFAULT 0,
        total_earnings_usd DECIMAL(30,10) DEFAULT '0',
        pending_earnings_usd DECIMAL(30,10) DEFAULT '0',
        status VARCHAR NOT NULL DEFAULT 'active',
        last_promo_sent_at TIMESTAMP,
        last_claim_reset_date VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add new ambassador columns to existing rows
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS promo_prefix VARCHAR;
          ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS channel_verified BOOLEAN DEFAULT false;
          ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS channel_id VARCHAR;
          ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS next_promo_at TIMESTAMP;
          ALTER TABLE ambassadors ADD COLUMN IF NOT EXISTS posting_schedule TEXT;
        END $$
      `);
    } catch { /* columns may already exist */ }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ambassador_earnings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        ambassador_id VARCHAR NOT NULL REFERENCES ambassadors(id),
        promo_code_id VARCHAR NOT NULL REFERENCES promo_codes(id),
        claim_user_id VARCHAR NOT NULL REFERENCES users(id),
        promo_code VARCHAR NOT NULL,
        commission_usd DECIMAL(30,10) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(ambassador_id, claim_user_id, promo_code_id)
      )
    `);

    console.log('✅ [MIGRATION] Ambassador tables created successfully');

    console.log('✅ [MIGRATION] All tables and indexes created successfully');
    
  } catch (error) {
    console.error('⚠️ [MIGRATION] Migration error (server will still start):', error instanceof Error ? error.message : error);
  } finally {
    await pool.end();
  }
}
