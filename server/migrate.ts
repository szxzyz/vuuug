import pkg from 'pg';
const { Pool } = pkg;
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema";
import { sql } from 'drizzle-orm';

export async function ensureDatabaseSchema(): Promise<void> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const db = drizzle(pool, { schema });
  
  try {
    console.log('🔄 [MIGRATION] Ensuring all database tables exist...');
    
    // Enable pgcrypto extension for gen_random_uuid() support
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      console.log('✅ [MIGRATION] pgcrypto extension enabled');
    } catch (error) {
      console.log('⚠️ [MIGRATION] pgcrypto extension already exists or not available');
    }
    
    // Create all essential tables with correct schema
    
    // Sessions table - CRITICAL for connect-pg-simple authentication
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP NOT NULL
      )
    `);
    console.log('✅ [MIGRATION] Sessions table ensured');
    
    // Users table with full schema
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Add missing columns to existing users table (for production databases)
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint JSONB`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_primary_account BOOLEAN DEFAULT true`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_visited BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_shared BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS friends_invited INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_ad_watched BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_address TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_comment TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username_wallet TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cwallet_id TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_updated_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_referral_bonus DECIMAL(12, 8) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_claimed_referral_bonus DECIMAL(12, 8) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS usd_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pdz_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bug_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS usdt_wallet_address TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_stars_username TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_share_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_channel_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_community_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_checkin_completed_today BOOLEAN DEFAULT false`);
      
      // Add auto-ban system columns
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_version TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP DEFAULT NOW()`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_uid TEXT`);
      
      // Add mandatory channel/group join verification columns
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_channel_group_verified BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_membership_check TIMESTAMP`);
      
      // Alter existing balance columns to new precision (safely handle existing data)
      await db.execute(sql`ALTER TABLE users ALTER COLUMN balance TYPE DECIMAL(20, 0) USING ROUND(balance)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN usd_balance TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN ton_balance TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN pdz_balance TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN total_earned TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN total_earnings TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN withdraw_balance TYPE DECIMAL(30, 10)`);
      
      console.log('✅ [MIGRATION] Missing user task and wallet columns added');
    } catch (error) {
      // Columns might already exist - this is fine
      console.log('ℹ️ [MIGRATION] User task and wallet columns already exist or cannot be added');
    }
    
    // Ensure referral_code column exists and has proper constraints
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);
      
      // Backfill referral codes for users that don't have them
      await db.execute(sql`
        UPDATE users 
        SET referral_code = 'REF' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8))
        WHERE referral_code IS NULL OR referral_code = ''
      `);
      
      // Create unique constraint if it doesn't exist
      await db.execute(sql`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'users_referral_code_unique'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_referral_code_unique UNIQUE (referral_code);
          END IF;
        END $$
      `);
      
      console.log('✅ [MIGRATION] Referral code column and constraints ensured');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Referral code setup complete or already exists');
    }
    
    // Earnings table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS earnings (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(12, 8) NOT NULL,
        source VARCHAR NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Transactions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(12, 8) NOT NULL,
        type VARCHAR NOT NULL,
        source VARCHAR NOT NULL,
        description TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Withdrawals table
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Add comment column to existing withdrawals table if missing
    try {
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS comment TEXT`);
      console.log('✅ [MIGRATION] Comment column added to withdrawals table');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Comment column already exists in withdrawals table');
    }
    
    // Add deducted and refunded columns to prevent double deduction/refund bugs
    try {
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS deducted BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT false`);
      
      // For existing withdrawals created under OLD system (balance was deducted during approval, not submission):
      // - Approved/Completed ones: Mark as deducted=true (balance was already taken during approval)
      // - Rejected ones: Mark as deducted=false and refunded=false (balance was never taken, or was returned)
      // - Pending ones: Mark as deducted=false (balance will be deducted when approved with compatibility logic)
      
      await db.execute(sql`
        UPDATE withdrawals 
        SET deducted = true 
        WHERE status IN ('Approved', 'Successfull', 'paid') AND (deducted IS NULL OR deducted = false)
      `);
      
      await db.execute(sql`
        UPDATE withdrawals 
        SET deducted = false, refunded = false
        WHERE status = 'rejected' AND (deducted IS NULL OR refunded IS NULL)
      `);
      
      await db.execute(sql`
        UPDATE withdrawals 
        SET deducted = false, refunded = false
        WHERE status = 'pending' AND (deducted IS NULL OR refunded IS NULL)
      `);
      
      console.log('✅ [MIGRATION] Deducted and refunded columns added to withdrawals table with correct legacy states');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Deducted and refunded columns already exist in withdrawals table');
    }
    
    // Add rejection_reason column for admin rejection messages
    try {
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
      console.log('✅ [MIGRATION] Rejection reason column added to withdrawals table');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Rejection reason column already exists in withdrawals table');
    }
    
    // Promotions table
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
    
    // Task completions table
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
    
    // User balances table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_balances (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR UNIQUE NOT NULL REFERENCES users(id),
        balance DECIMAL(20, 8) DEFAULT '0',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Referrals table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referrals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id VARCHAR NOT NULL REFERENCES users(id),
        referee_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(12, 5) DEFAULT '0.01',
        status VARCHAR DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(referrer_id, referee_id)
      )
    `);
    
    // Referral commissions table
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
    
    // Promo codes table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR UNIQUE NOT NULL,
        reward_amount DECIMAL(12, 2) NOT NULL,
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
    
    // Add reward_type column to existing promo_codes table if missing
    try {
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS reward_type VARCHAR DEFAULT 'PAD' NOT NULL`);
      console.log('✅ [MIGRATION] Reward type column added to promo_codes table');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Reward type column already exists in promo_codes table');
    }
    
    // Promo code usage tracking table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_code_usage (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        promo_code_id VARCHAR NOT NULL REFERENCES promo_codes(id),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(12, 2) NOT NULL,
        used_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Daily tasks table
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
    
    // Admin settings table - for configurable app parameters
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
    
    // Safely add unique constraint on setting_key after removing duplicates
    try {
      // Remove duplicate entries, keeping the one with the highest ID (most recent)
      await db.execute(sql`
        DELETE FROM admin_settings a
        USING admin_settings b
        WHERE a.id < b.id
        AND a.setting_key = b.setting_key
      `);
      
      // Add unique constraint if it doesn't exist
      await db.execute(sql`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'admin_settings_setting_key_unique'
          ) THEN
            ALTER TABLE admin_settings ADD CONSTRAINT admin_settings_setting_key_unique UNIQUE (setting_key);
          END IF;
        END $$
      `);
      
      console.log('✅ [MIGRATION] admin_settings unique constraint ensured');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] admin_settings unique constraint already exists or cannot be added');
    }
    
    // Initialize default admin settings if they don't exist
    await db.execute(sql`
      INSERT INTO admin_settings (setting_key, setting_value, description)
      VALUES 
        ('daily_ad_limit', '50', 'Maximum number of ads a user can watch per day'),
        ('ad_reward_pad', '1000', 'PAD reward amount per ad watched'),
        ('ad_reward_ton', '0.00010000', 'TON reward amount per ad watched'),
        ('withdrawal_currency', 'TON', 'Currency used for withdrawal displays (TON or PAD)')
      ON CONFLICT (setting_key) DO NOTHING
    `);
    
    // Advertiser tasks table - CRITICAL for task creation system
    console.log('🔄 [MIGRATION] Creating advertiser_tasks table...');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS advertiser_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        advertiser_id VARCHAR NOT NULL REFERENCES users(id),
        task_type VARCHAR NOT NULL,
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        total_clicks_required INTEGER NOT NULL,
        current_clicks INTEGER DEFAULT 0 NOT NULL,
        cost_per_click DECIMAL(12, 8) DEFAULT 0.0003 NOT NULL,
        total_cost DECIMAL(12, 8) NOT NULL,
        status VARCHAR DEFAULT 'active' NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    console.log('✅ [MIGRATION] advertiser_tasks table created');
    
    // Task clicks tracking table - CRITICAL for preventing duplicate clicks
    console.log('🔄 [MIGRATION] Creating task_clicks table...');
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
    console.log('✅ [MIGRATION] task_clicks table created');
    
    // Ban logs table for auto-ban system
    console.log('🔄 [MIGRATION] Creating ban_logs table...');
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
    console.log('✅ [MIGRATION] ban_logs table created');
    
    // Add missing columns to ban_logs if table already exists
    try {
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS referrer_uid TEXT`);
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS telegram_id TEXT`);
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS app_version TEXT`);
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT`);
      console.log('✅ [MIGRATION] ban_logs columns updated');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] ban_logs columns already exist');
    }
    
    // Daily missions table for Share with Friends and Daily Check-in
    console.log('🔄 [MIGRATION] Creating daily_missions table...');
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
    console.log('✅ [MIGRATION] daily_missions table created');
    
    // Create index for daily missions performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, reset_date)`);
    
    // Create index for ban logs performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_user_id ON ban_logs(banned_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_device_id ON ban_logs(device_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_ip ON ban_logs(ip)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_created_at ON ban_logs(created_at)`);
    
    // Promotion claims table
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
    
    // Blocked countries table for geo-restriction
    console.log('🔄 [MIGRATION] Creating blocked_countries table...');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blocked_countries (
        id SERIAL PRIMARY KEY,
        country_code VARCHAR(2) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [MIGRATION] blocked_countries table created');
    
    // Create index for blocked countries
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_blocked_countries_code ON blocked_countries(country_code)`);

    // Create indexes for performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions(expire)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_earnings_user_id ON earnings(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_task_completions_user_id ON task_completions(user_id)`);
    
    console.log('✅ [MIGRATION] All tables and indexes created successfully');
    
  } catch (error) {
    console.error('❌ [MIGRATION] Critical error ensuring database schema:', error);
    throw new Error(`Database migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}