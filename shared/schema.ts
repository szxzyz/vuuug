import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  decimal,
  integer,
  boolean,
  text,
  serial,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  telegram_id: varchar("telegram_id", { length: 20 }).unique(), // ✅ Telegram ID for authentication (stored as string for compatibility)
  username: varchar("username"),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  personalCode: text("personal_code"),
  balance: decimal("balance", { precision: 20, scale: 0 }).default("0"), // PAD stored as BIGINT (integer with large precision)
  usdBalance: decimal("usd_balance", { precision: 30, scale: 10 }).default("0"), // USD with high precision to prevent overflow
  tonBalance: decimal("ton_balance", { precision: 30, scale: 10 }).default("0"),
  pdzBalance: decimal("pdz_balance", { precision: 30, scale: 10 }).default("0"),
  bugBalance: decimal("bug_balance", { precision: 30, scale: 10 }).default("0"), // BUG currency for withdrawal requirements
  withdrawBalance: decimal("withdraw_balance", { precision: 30, scale: 10 }),
  totalEarnings: decimal("total_earnings", { precision: 30, scale: 10 }),
  totalEarned: decimal("total_earned", { precision: 30, scale: 10 }).default("0"),
  adsWatched: integer("ads_watched").default(0),
  dailyAdsWatched: integer("daily_ads_watched").default(0),
  adsWatchedToday: integer("ads_watched_today").default(0),
  dailyEarnings: decimal("daily_earnings", { precision: 30, scale: 10 }),
  lastAdWatch: timestamp("last_ad_watch"),
  lastAdDate: timestamp("last_ad_date"),
  currentStreak: integer("current_streak").default(0),
  lastStreakDate: timestamp("last_streak_date"),
  level: integer("level").default(1),
  referredBy: varchar("referred_by"),
  referralCode: text("referral_code"),
  friendsInvited: integer("friends_invited"),
  firstAdWatched: boolean("first_ad_watched").default(false),
  flagged: boolean("flagged").default(false),
  flagReason: text("flag_reason"),
  banned: boolean("banned").default(false),
  bannedReason: text("banned_reason"),
  bannedAt: timestamp("banned_at"),
  deviceId: text("device_id"),
  deviceFingerprint: jsonb("device_fingerprint"),
  isPrimaryAccount: boolean("is_primary_account").default(true),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: text("last_login_ip"),
  lastLoginDevice: text("last_login_device"),
  lastLoginUserAgent: text("last_login_user_agent"),
  // Daily task tracking fields for eligibility validation  
  channelVisited: boolean("channel_visited").default(false),
  appShared: boolean("app_shared").default(false),
  lastResetDate: timestamp("last_reset_date"),
  // Daily task completion tracking
  taskShareCompletedToday: boolean("task_share_completed_today").default(false),
  taskChannelCompletedToday: boolean("task_channel_completed_today").default(false),
  taskCommunityCompletedToday: boolean("task_community_completed_today").default(false),
  taskCheckinCompletedToday: boolean("task_checkin_completed_today").default(false),
  extraAdsWatchedToday: integer("extra_ads_watched_today").default(0),
  lastExtraAdDate: timestamp("last_extra_ad_date"),
  hourlyAdsWatched: integer("hourly_ads_watched").default(0),
  lastHourlyReset: timestamp("last_hourly_reset"),
  lastBonusClaimedDate: text("last_bonus_claimed_date"),
  // Wallet details
  tonWalletAddress: text("ton_wallet_address"),
  tonWalletComment: text("ton_wallet_comment"),
  usdtWalletAddress: text("usdt_wallet_address"),
  telegramStarsUsername: text("telegram_stars_username"),
  telegramUsername: text("telegram_username_wallet"),
  cwalletId: text("cwallet_id"),
  walletUpdatedAt: timestamp("wallet_updated_at"),
  pendingReferralBonus: decimal("pending_referral_bonus", { precision: 30, scale: 10 }).default("0"),
  totalClaimedReferralBonus: decimal("total_claimed_referral_bonus", { precision: 30, scale: 10 }).default("0"),
  // Enhanced tracking for auto-ban system
  appVersion: text("app_version"),
  browserFingerprint: text("browser_fingerprint"), // Full fingerprint hash for WebApp detection
  registeredAt: timestamp("registered_at").defaultNow(), // First account registration timestamp
  referrerUid: text("referrer_uid"), // Referrer's UID for ban logs
  // Mandatory channel/group join verification
  isChannelGroupVerified: boolean("is_channel_group_verified").default(false),
  lastMembershipCheck: timestamp("last_membership_check"),
  dailyLoginStreak: integer("daily_login_streak").default(0),
  lastDailyLoginDate: text("last_daily_login_date"),
  starBalance: integer("star_balance").default(0),
  weeklyStars: integer("weekly_stars").default(0),
  weeklyStarWeek: text("weekly_star_week"),
  language: varchar("language", { length: 5 }).default("en"),
  // Risk scoring & platform detection
  suspicionScore: integer("suspicion_score").default(0),
  platform: varchar("platform", { length: 20 }),        // android/ios/tdesktop/web/unknown/script
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Earnings table
export const earnings = pgTable("earnings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  source: varchar("source").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transactions table - For tracking all balance changes (deductions and additions)
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  type: varchar("type").notNull(), // "deduction" or "addition"
  source: varchar("source").notNull(), // "task_creation", "task_completion", "withdrawal", "ad_reward", etc.
  description: text("description"),
  metadata: jsonb("metadata"), // Additional data like promotionId, taskType, etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// Withdrawals table
export const withdrawals = pgTable("withdrawals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  status: varchar("status").default('pending'),
  method: varchar("method").notNull(),
  details: jsonb("details"),
  comment: text("comment"),
  transactionHash: varchar("transaction_hash"),
  adminNotes: text("admin_notes"),
  rejectionReason: text("rejection_reason"),
  deducted: boolean("deducted").default(false),
  refunded: boolean("refunded").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Referrals table
export const referrals = pgTable("referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: varchar("referrer_id").references(() => users.id).notNull(),
  refereeId: varchar("referee_id").references(() => users.id).notNull(),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).default("0.50"),
  usdRewardAmount: decimal("usd_reward_amount", { precision: 30, scale: 10 }).default("0"),
  bugRewardAmount: decimal("bug_reward_amount", { precision: 30, scale: 10 }).default("0"),
  status: varchar("status").default('pending'),
  createdAt: timestamp("created_at").defaultNow(),
});

// Promo codes table
export const promoCodes = pgTable("promo_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code").notNull().unique(),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).notNull(),
  rewardType: varchar("reward_type").default('PAD').notNull(), // 'PAD' or 'PDZ'
  rewardCurrency: varchar("reward_currency").default('USDT'),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").default(0),
  perUserLimit: integer("per_user_limit").default(1),
  isActive: boolean("is_active").default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Promo code usage table
export const promoCodeUsage = pgTable("promo_code_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promoCodeId: varchar("promo_code_id").references(() => promoCodes.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).notNull(),
  usedAt: timestamp("used_at").defaultNow(),
});

// Referral commissions table
export const referralCommissions = pgTable("referral_commissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: varchar("referrer_id").references(() => users.id).notNull(),
  referredUserId: varchar("referred_user_id").references(() => users.id).notNull(),
  originalEarningId: integer("original_earning_id").references(() => earnings.id).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 30, scale: 10 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});


// User balances table - separate balance tracking  
export const userBalances = pgTable("user_balances", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").unique().notNull().references(() => users.id),
  balance: decimal("balance", { precision: 20, scale: 8 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Simple daily tasks system - fixed sequential ads-based tasks
export const dailyTasks = pgTable("daily_tasks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  taskLevel: integer("task_level").notNull(), // 1-9 for the 9 tasks
  progress: integer("progress").default(0), // current ads watched
  required: integer("required").notNull(), // ads required for this task
  completed: boolean("completed").default(false),
  claimed: boolean("claimed").default(false),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).notNull(),
  completedAt: timestamp("completed_at"),
  claimedAt: timestamp("claimed_at"),
  resetDate: varchar("reset_date").notNull(), // YYYY-MM-DD format for daily reset
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("daily_tasks_user_task_date_unique").on(table.userId, table.taskLevel, table.resetDate),
]);

// Admin settings table - for configurable app parameters
export const adminSettings = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  settingKey: varchar("setting_key").notNull().unique(),
  settingValue: text("setting_value").notNull(),
  description: text("description"),
  updatedBy: varchar("updated_by"), // Admin user ID who last updated
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Advertiser tasks table
// Status values: under_review (pending admin approval), running (active/approved), paused, completed, rejected
export const advertiserTasks = pgTable("advertiser_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advertiserId: varchar("advertiser_id").references(() => users.id).notNull(),
  taskType: varchar("task_type").notNull(), // "channel" or "bot" or "partner"
  title: text("title").notNull(),
  description: text("description"), // Optional task description (admin-editable)
  link: text("link").notNull(),
  totalClicksRequired: integer("total_clicks_required").notNull(),
  currentClicks: integer("current_clicks").default(0).notNull(),
  costPerClick: decimal("cost_per_click", { precision: 30, scale: 10 }).default("0.0003").notNull(),
  totalCost: decimal("total_cost", { precision: 30, scale: 10 }).notNull(),
  status: varchar("status").default("under_review").notNull(), // under_review, running, paused, completed, rejected
  verificationRequired: boolean("verification_required").default(false).notNull(),
  channelVerified: boolean("channel_verified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Task clicks tracking table - to prevent duplicate clicks
export const taskClicks = pgTable("task_clicks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").references(() => advertiserTasks.id, { onDelete: 'cascade' }).notNull(),
  publisherId: varchar("publisher_id").references(() => users.id).notNull(),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).default("0.0001750").notNull(), // 1750 PAD = 0.000175 TON
  clickedAt: timestamp("clicked_at").defaultNow(),
}, (table) => [
  unique("task_clicks_unique").on(table.taskId, table.publisherId),
]);

// Ban logs table - stores all ban records for admin panel
export const banLogs = pgTable("ban_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bannedUserId: varchar("banned_user_id").references(() => users.id).notNull(),
  bannedUserUid: text("banned_user_uid"),
  ip: text("ip"),
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  fingerprint: jsonb("fingerprint"),
  reason: text("reason").notNull(),
  banType: varchar("ban_type").notNull(), // 'auto' or 'manual'
  bannedBy: varchar("banned_by"), // Admin user ID for manual bans, null for auto
  relatedAccountIds: jsonb("related_account_ids"), // Array of related account IDs
  referrerUid: text("referrer_uid"), // UID of the referrer if self-referral ban
  telegramId: text("telegram_id"), // Telegram ID for tracking (not displayed)
  appVersion: text("app_version"), // App version at time of ban
  browserFingerprint: text("browser_fingerprint"), // Full fingerprint for detection
  createdAt: timestamp("created_at").defaultNow(),
});

// Spin data table - tracks user spin state for the Free Spin feature
export const spinData = pgTable("spin_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull().unique(),
  freeSpinUsed: boolean("free_spin_used").default(false), // Whether daily free spin was used
  extraSpins: integer("extra_spins").default(0), // Extra spins earned from ads/invites
  spinAdsWatched: integer("spin_ads_watched").default(0), // Ads watched for spins (0-50 per day)
  inviteSpinsEarned: integer("invite_spins_earned").default(0), // Total spins from verified invites
  lastSpinDate: varchar("last_spin_date"), // YYYY-MM-DD for daily reset tracking
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Spin history table - tracks all spin results
export const spinHistory = pgTable("spin_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  rewardType: varchar("reward_type").notNull(), // 'PAD' or 'TON'
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).notNull(),
  spinType: varchar("spin_type").notNull(), // 'free', 'ad', 'invite'
  createdAt: timestamp("created_at").defaultNow(),
});

// Daily mission completion tracking
export const dailyMissions = pgTable("daily_missions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  missionType: varchar("mission_type").notNull(), // 'share_story', 'daily_checkin'
  completed: boolean("completed").default(false),
  claimedAt: timestamp("claimed_at"),
  resetDate: varchar("reset_date").notNull(), // YYYY-MM-DD format for daily reset
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("daily_missions_user_type_date_unique").on(table.userId, table.missionType, table.resetDate),
]);

// Blocked countries for geo-restriction
export const blockedCountries = pgTable("blocked_countries", {
  id: serial("id").primaryKey(),
  countryCode: varchar("country_code", { length: 2 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Admin roles table — one row per admin Telegram ID
// role: 'super_admin' | 'finance' | 'moderator' | 'content'
// permissions: JSON array of permission strings
export const adminRoles = pgTable("admin_roles", {
  id: serial("id").primaryKey(),
  telegramId: varchar("telegram_id", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).default("Admin"),
  role: varchar("role", { length: 30 }).notNull().default("moderator"),
  permissions: text("permissions").notNull().default("[]"), // JSON array stored as text
  addedBy: varchar("added_by", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEarningSchema = createInsertSchema(earnings).omit({ createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertWithdrawalSchema = createInsertSchema(withdrawals).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserBalanceSchema = createInsertSchema(userBalances).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDailyTaskSchema = createInsertSchema(dailyTasks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export const insertReferralCommissionSchema = createInsertSchema(referralCommissions).omit({ id: true, createdAt: true });
export const insertPromoCodeSchema = createInsertSchema(promoCodes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPromoCodeUsageSchema = createInsertSchema(promoCodeUsage).omit({ id: true, usedAt: true });
export const insertAdminSettingSchema = createInsertSchema(adminSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAdvertiserTaskSchema = createInsertSchema(advertiserTasks).omit({ id: true, createdAt: true, updatedAt: true, completedAt: true });
export const insertTaskClickSchema = createInsertSchema(taskClicks).omit({ id: true, clickedAt: true });
export const insertBanLogSchema = createInsertSchema(banLogs).omit({ id: true, createdAt: true });
export const insertSpinDataSchema = createInsertSchema(spinData).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSpinHistorySchema = createInsertSchema(spinHistory).omit({ id: true, createdAt: true });
export const insertDailyMissionSchema = createInsertSchema(dailyMissions).omit({ id: true, createdAt: true });
export const insertBlockedCountrySchema = createInsertSchema(blockedCountries).omit({ id: true, createdAt: true });
export const insertAdminRoleSchema = createInsertSchema(adminRoles).omit({ id: true, createdAt: true, updatedAt: true });

// Leaderboard snapshots — weekly top-50 saved every Monday before reset
export const leaderboardSnapshots = pgTable("leaderboard_snapshots", {
  id: serial("id").primaryKey(),
  weekKey: varchar("week_key", { length: 20 }).notNull(),   // e.g. '2026-W24'
  rank: integer("rank").notNull(),
  userId: varchar("user_id").notNull(),
  username: varchar("username"),
  firstName: text("first_name"),
  profileImageUrl: text("profile_image_url"),
  weeklyStars: integer("weekly_stars").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// TON Deposits table - tracks blockchain deposits to prevent duplicates
export const tonDeposits = pgTable("ton_deposits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  boc: text("boc").notNull().unique(), // Transaction BOC (unique to prevent duplicates)
  status: varchar("status").default("pending"), // pending | confirmed | failed
  createdAt: timestamp("created_at").defaultNow(),
  confirmedAt: timestamp("confirmed_at"),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertEarning = z.infer<typeof insertEarningSchema>;
export type Earning = typeof earnings.$inferSelect;
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type ReferralCommission = typeof referralCommissions.$inferSelect;
export type InsertReferralCommission = z.infer<typeof insertReferralCommissionSchema>;
export type PromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCodeUsage = typeof promoCodeUsage.$inferSelect;
export type InsertPromoCodeUsage = z.infer<typeof insertPromoCodeUsageSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type UserBalance = typeof userBalances.$inferSelect;
export type InsertUserBalance = z.infer<typeof insertUserBalanceSchema>;
export type DailyTask = typeof dailyTasks.$inferSelect;
export type InsertDailyTask = z.infer<typeof insertDailyTaskSchema>;
export type AdminSetting = typeof adminSettings.$inferSelect;
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type AdvertiserTask = typeof advertiserTasks.$inferSelect;
export type InsertAdvertiserTask = z.infer<typeof insertAdvertiserTaskSchema>;
export type TaskClick = typeof taskClicks.$inferSelect;
export type InsertTaskClick = z.infer<typeof insertTaskClickSchema>;
export type BanLog = typeof banLogs.$inferSelect;
export type InsertBanLog = z.infer<typeof insertBanLogSchema>;
export type SpinData = typeof spinData.$inferSelect;
export type InsertSpinData = z.infer<typeof insertSpinDataSchema>;
export type SpinHistory = typeof spinHistory.$inferSelect;
export type InsertSpinHistory = z.infer<typeof insertSpinHistorySchema>;
export type DailyMission = typeof dailyMissions.$inferSelect;
export type InsertDailyMission = z.infer<typeof insertDailyMissionSchema>;
export type BlockedCountry = typeof blockedCountries.$inferSelect;
export type InsertBlockedCountry = z.infer<typeof insertBlockedCountrySchema>;