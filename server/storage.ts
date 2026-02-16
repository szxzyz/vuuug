import {
  users,
  earnings,
  referrals,
  referralCommissions,
  promoCodes,
  promoCodeUsage,
  withdrawals,
  userBalances,
  transactions,
  dailyTasks,
  advertiserTasks,
  taskClicks,
  adminSettings,
  type User,
  type UpsertUser,
  type InsertEarning,
  type Earning,
  type Referral,
  type InsertReferral,
  type ReferralCommission,
  type InsertReferralCommission,
  type PromoCode,
  type InsertPromoCode,
  type PromoCodeUsage,
  type InsertPromoCodeUsage,
  type Withdrawal,
  type InsertWithdrawal,
  type UserBalance,
  type InsertUserBalance,
  type Transaction,
  type InsertTransaction,
  type DailyTask,
  type InsertDailyTask,
} from "../shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lt, sql } from "drizzle-orm";
import crypto from "crypto";

// Payment system configuration
export interface PaymentSystem {
  id: string;
  name: string;
  emoji: string;
  minWithdrawal: number;
  fee: number;
}

export const PAYMENT_SYSTEMS: PaymentSystem[] = [
  { id: 'telegram_stars', name: 'Telegram Stars', emoji: '⭐', minWithdrawal: 1.00, fee: 0.0 },
  { id: 'tether_polygon', name: 'Tether (Polygon POS)', emoji: '🌐', minWithdrawal: 0.01, fee: 0.0 },
  { id: 'ton_coin', name: 'TON', emoji: '💎', minWithdrawal: 0.5, fee: 0.0 },
  { id: 'litecoin', name: 'Litecoin', emoji: '⏺', minWithdrawal: 0.35, fee: 0.0 }
];

// Interface for storage operations
export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<{ user: User; isNewUser: boolean }>;
  
  // Earnings operations
  addEarning(earning: InsertEarning): Promise<Earning>;
  getUserEarnings(userId: string, limit?: number): Promise<Earning[]>;
  getUserStats(userId: string): Promise<{
    todayEarnings: string;
    weekEarnings: string;
    monthEarnings: string;
    totalEarnings: string;
  }>;
  
  // Balance operations
  updateUserBalance(userId: string, amount: string): Promise<void>;
  
  // Streak operations
  updateUserStreak(userId: string): Promise<{ newStreak: number; rewardEarned: string }>;
  
  // Ads tracking
  incrementAdsWatched(userId: string): Promise<void>;
  incrementExtraAdsWatched(userId: string): Promise<void>;
  resetDailyAdsCount(userId: string): Promise<void>;
  canWatchAd(userId: string): Promise<boolean>;
  canWatchExtraAd(userId: string): Promise<boolean>;
  
  // Withdrawal operations
  createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal>;
  getUserWithdrawals(userId: string): Promise<Withdrawal[]>;
  
  // Admin withdrawal operations
  getAllPendingWithdrawals(): Promise<Withdrawal[]>;
  getAllWithdrawals(): Promise<Withdrawal[]>;
  updateWithdrawalStatus(withdrawalId: string, status: string, transactionHash?: string, adminNotes?: string): Promise<Withdrawal>;
  
  // Referral operations
  createReferral(referrerId: string, referredId: string): Promise<Referral>;
  getUserReferrals(userId: string): Promise<Referral[]>;
  
  // Generate referral code
  generateReferralCode(userId: string): Promise<string>;
  getUserByReferralCode(referralCode: string): Promise<User | null>;
  
  // Admin operations
  getAllUsers(): Promise<User[]>;
  updateUserBanStatus(userId: string, banned: boolean): Promise<void>;
  
  // Telegram user operations
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  upsertTelegramUser(telegramId: string, userData: Omit<UpsertUser, 'id' | 'telegramId'>): Promise<{ user: User; isNewUser: boolean }>;
  
  
  // Daily reset system
  performDailyReset(): Promise<void>;
  checkAndPerformDailyReset(): Promise<void>;
  
  // User balance operations
  getUserBalance(userId: string): Promise<UserBalance | undefined>;
  createOrUpdateUserBalance(userId: string, balance?: string): Promise<UserBalance>;
  deductBalance(userId: string, amount: string): Promise<{ success: boolean; message: string }>;
  addBalance(userId: string, amount: string): Promise<void>;
  
  // Admin/Statistics operations
  getAppStats(): Promise<{
    totalUsers: number;
    activeUsersToday: number;
    totalInvites: number;
    totalEarnings: string;
    totalReferralEarnings: string;
    totalPayouts: string;
    newUsersLast24h: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async updateUserVerificationStatus(userId: string, isVerified: boolean): Promise<void> {
    await db.update(users)
      .set({ 
        isChannelGroupVerified: isVerified,
        lastMembershipCheck: new Date()
      })
      .where(eq(users.id, userId));
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    try {
      // Use raw SQL to avoid Drizzle ORM issues
      const result = await db.execute(sql`
        SELECT * FROM users WHERE telegram_id = ${telegramId} LIMIT 1
      `);
      const user = result.rows[0] as User | undefined;
      return user;
    } catch (error) {
      console.error('Error in getUserByTelegramId:', error);
      throw error;
    }
  }

  async upsertUser(userData: UpsertUser): Promise<{ user: User; isNewUser: boolean }> {
    // Check if user already exists
    const existingUser = await this.getUser(userData.id!);
    const isNewUser = !existingUser;
    
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    
    // Auto-generate referral code for new users if they don't have one
    if (isNewUser && !user.referralCode) {
      try {
        await this.generateReferralCode(user.id);
      } catch (error) {
        console.error('Failed to generate referral code for new user:', error);
      }
    }
    
    // Auto-create balance record for new users
    if (isNewUser) {
      try {
        await this.createOrUpdateUserBalance(user.id, '0');
        console.log(`✅ Created balance record for new user: ${user.id}`);
      } catch (error) {
        console.error('Failed to create balance record for new user:', error);
      }
    }
    
    return { user, isNewUser };
  }

  async upsertTelegramUser(telegramId: string, userData: Omit<UpsertUser, 'id' | 'telegramId'>): Promise<{ user: User; isNewUser: boolean }> {
    // Sanitize user data to prevent SQL issues
    const sanitizedData = {
      ...userData,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      username: userData.username || null,
      personalCode: userData.personalCode || telegramId,
      withdrawBalance: userData.withdrawBalance || '0',
      totalEarnings: userData.totalEarnings || '0',
      adsWatched: userData.adsWatched || 0,
      dailyAdsWatched: userData.dailyAdsWatched || 0,
      dailyEarnings: userData.dailyEarnings || '0',
      level: userData.level || 1,
      flagged: userData.flagged || false,
      banned: userData.banned || false
      // NOTE: Don't generate referral code here - it will be handled separately for new users only
    };
    
    // Check if user already exists by Telegram ID
    let existingUser = await this.getUserByTelegramId(telegramId);
    
    // If not found by telegram_id, check if user exists by personal_code (for migration scenarios)
    if (!existingUser && sanitizedData.personalCode) {
      const result = await db.execute(sql`
        SELECT * FROM users WHERE personal_code = ${sanitizedData.personalCode} LIMIT 1
      `);
      const userByPersonalCode = result.rows[0] as User | undefined;
      
      if (userByPersonalCode) {
        // User exists but doesn't have telegram_id set - update it
        const updateResult = await db.execute(sql`
          UPDATE users 
          SET telegram_id = ${telegramId},
              first_name = ${sanitizedData.firstName}, 
              last_name = ${sanitizedData.lastName}, 
              username = ${sanitizedData.username},
              updated_at = NOW()
          WHERE personal_code = ${sanitizedData.personalCode}
          RETURNING *
        `);
        const user = updateResult.rows[0] as User;
        return { user, isNewUser: false };
      }
    }
    
    const isNewUser = !existingUser;
    
    if (existingUser) {
      // For existing users, update fields and ensure referral code exists
      const result = await db.execute(sql`
        UPDATE users 
        SET first_name = ${sanitizedData.firstName}, 
            last_name = ${sanitizedData.lastName}, 
            username = ${sanitizedData.username},
            updated_at = NOW()
        WHERE telegram_id = ${telegramId}
        RETURNING *
      `);
      const user = result.rows[0] as User;
      
      // Ensure existing user has referral code
      if (!user.referralCode) {
        console.log('🔄 Generating missing referral code for existing user:', user.id);
        try {
          await this.generateReferralCode(user.id);
          // Fetch updated user with referral code
          const updatedUser = await this.getUser(user.id);
          return { user: updatedUser || user, isNewUser };
        } catch (error) {
          console.error('Failed to generate referral code for existing user:', error);
          return { user, isNewUser };
        }
      }
      
      return { user, isNewUser };
    } else {
      // For new users, check if email already exists
      // If it does, we'll create a unique email by appending the telegram ID
      let finalEmail = userData.email;
      try {
        // Try to create with the provided email first
        const result = await db.execute(sql`
          INSERT INTO users (
            telegram_id, email, first_name, last_name, username, personal_code, 
            withdraw_balance, total_earnings, ads_watched, daily_ads_watched, 
            daily_earnings, level, flagged, banned
          )
          VALUES (
            ${telegramId}, ${finalEmail}, ${sanitizedData.firstName}, ${sanitizedData.lastName}, 
            ${sanitizedData.username}, ${sanitizedData.personalCode}, ${sanitizedData.withdrawBalance}, 
            ${sanitizedData.totalEarnings}, ${sanitizedData.adsWatched}, ${sanitizedData.dailyAdsWatched}, 
            ${sanitizedData.dailyEarnings}, ${sanitizedData.level}, ${sanitizedData.flagged}, 
            ${sanitizedData.banned}
          )
          RETURNING *
        `);
        const user = result.rows[0] as User;
        
        // Auto-generate referral code for new users
        try {
          await this.generateReferralCode(user.id);
        } catch (error) {
          console.error('Failed to generate referral code for new Telegram user:', error);
        }
        
        // Auto-create balance record for new users
        try {
          await this.createOrUpdateUserBalance(user.id, '0');
          console.log(`✅ Created balance record for new Telegram user: ${user.id}`);
        } catch (error) {
          console.error('Failed to create balance record for new Telegram user:', error);
        }
        
        // Fetch updated user with referral code
        const updatedUser = await this.getUser(user.id);
        return { user: updatedUser || user, isNewUser };
      } catch (error: any) {
        // Handle unique constraint violations
        if (error.code === '23505') {
          if (error.constraint === 'users_email_unique') {
            finalEmail = `${telegramId}@telegram.user`;
          } else if (error.constraint === 'users_personal_code_unique') {
            // If personal_code conflict, use telegram ID as personal code
            sanitizedData.personalCode = `tg_${telegramId}`;
          }
          
          // Try again with modified data
          const result = await db.execute(sql`
            INSERT INTO users (
              telegram_id, email, first_name, last_name, username, personal_code, 
              withdraw_balance, total_earnings, ads_watched, daily_ads_watched, 
              daily_earnings, level, flagged, banned
            )
            VALUES (
              ${telegramId}, ${finalEmail}, ${sanitizedData.firstName}, ${sanitizedData.lastName}, 
              ${sanitizedData.username}, ${sanitizedData.personalCode}, ${sanitizedData.withdrawBalance}, 
              ${sanitizedData.totalEarnings}, ${sanitizedData.adsWatched}, ${sanitizedData.dailyAdsWatched}, 
              ${sanitizedData.dailyEarnings}, ${sanitizedData.level}, ${sanitizedData.flagged}, 
              ${sanitizedData.banned}
            )
            RETURNING *
          `);
          const user = result.rows[0] as User;
          
          // Auto-generate referral code for new users
          try {
            await this.generateReferralCode(user.id);
          } catch (error) {
            console.error('Failed to generate referral code for new Telegram user:', error);
          }
          
          // Auto-create balance record for new users
          try {
            await this.createOrUpdateUserBalance(user.id, '0');
            console.log(`✅ Created balance record for new Telegram user: ${user.id}`);
          } catch (error) {
            console.error('Failed to create balance record for new Telegram user:', error);
          }
          
          // Fetch updated user with referral code
          const updatedUser = await this.getUser(user.id);
          return { user: updatedUser || user, isNewUser };
        } else {
          throw error;
        }
      }
    }
  }

  // Transaction operations
  async addTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db
      .insert(transactions)
      .values(transaction)
      .returning();
    
    console.log(`📊 Transaction recorded: ${transaction.type} of $${transaction.amount} for user ${transaction.userId} - ${transaction.source}`);
    return newTransaction;
  }

  // Helper function to log transactions for referral system
  async logTransaction(transactionData: InsertTransaction): Promise<Transaction> {
    return this.addTransaction(transactionData);
  }

  // Earnings operations
  async addEarning(earning: InsertEarning): Promise<Earning> {
    const [newEarning] = await db
      .insert(earnings)
      .values(earning)
      .returning();
    
    // Log transaction for security and tracking
    await this.logTransaction({
      userId: earning.userId,
      amount: earning.amount,
      type: 'addition',
      source: earning.source,
      description: earning.description || `${earning.source} earning`,
      metadata: { earningId: newEarning.id }
    });
    
    // Update canonical user_balances table and keep users table in sync
    // All earnings contribute to available balance
    if (parseFloat(earning.amount) !== 0) {
      try {
        // Ensure user has a balance record first with improved error handling
        await this.createOrUpdateUserBalance(earning.userId);
        
        // Update canonical user_balances table
        await db
          .update(userBalances)
          .set({
            balance: sql`COALESCE(${userBalances.balance}, 0) + ${earning.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, earning.userId));
      } catch (balanceError) {
        console.error('Error updating user balance in addEarning:', balanceError);
        // Auto-create the record if it doesn't exist instead of throwing error
        try {
          console.log('🔄 Attempting to auto-create missing balance record...');
          await this.createOrUpdateUserBalance(earning.userId, '0');
          // Retry the balance update
          await db
            .update(userBalances)
            .set({
              balance: sql`COALESCE(${userBalances.balance}, 0) + ${earning.amount}`,
              updatedAt: new Date(),
            })
            .where(eq(userBalances.userId, earning.userId));
          console.log('✅ Successfully recovered from balance error');
        } catch (recoveryError) {
          console.error('❌ Failed to recover from balance error:', recoveryError);
          // Continue with the function - don't let balance errors block earnings
        }
      }
      
      try {
        // Keep users table in sync for compatibility
        await db
          .update(users)
          .set({
            balance: sql`COALESCE(${users.balance}, 0) + ${earning.amount}`,
            withdrawBalance: sql`COALESCE(${users.withdrawBalance}, 0) + ${earning.amount}`,
            totalEarned: sql`COALESCE(${users.totalEarned}, 0) + ${earning.amount}`,
            totalEarnings: sql`COALESCE(${users.totalEarnings}, 0) + ${earning.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, earning.userId));
      } catch (userUpdateError) {
        console.error('Error updating users table in addEarning:', userUpdateError);
        // Don't throw - the earning was already recorded
      }
    }
    
    // Check and activate referral bonuses FIRST after ad watch (critical for referral system)
    // This must happen BEFORE processing commissions so the referral status is updated to 'completed'
    if (earning.source === 'ad_watch') {
      await this.checkAndActivateReferralBonus(earning.userId);
    }
    
    // Process referral commission (10% of user's earnings)
    // Only process commissions for non-referral earnings to avoid recursion
    // This runs AFTER activation so the referral is already 'completed' when checking
    if (earning.source !== 'referral_commission' && earning.source !== 'referral') {
      await this.processReferralCommission(earning.userId, newEarning.id, earning.amount);
    }
    
    return newEarning;
  }

  async getUserEarnings(userId: string, limit: number = 20): Promise<Earning[]> {
    return db
      .select()
      .from(earnings)
      .where(eq(earnings.userId, userId))
      .orderBy(desc(earnings.createdAt))
      .limit(limit);
  }

  async getUserStats(userId: string): Promise<{
    todayEarnings: string;
    weekEarnings: string;
    monthEarnings: string;
    totalEarnings: string;
  }> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

    const [todayResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          gte(earnings.createdAt, today),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    const [weekResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          gte(earnings.createdAt, weekAgo),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    const [monthResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          gte(earnings.createdAt, monthAgo),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    const [totalResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    return {
      todayEarnings: todayResult.total,
      weekEarnings: weekResult.total,
      monthEarnings: monthResult.total,
      totalEarnings: totalResult.total,
    };
  }

  async updateUserBalance(userId: string, amount: string): Promise<void> {
    // Ensure user has a balance record first
    await this.createOrUpdateUserBalance(userId);
    
    // Update the canonical user_balances table
    await db
      .update(userBalances)
      .set({
        balance: sql`${userBalances.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, userId));
  }

  // Helper function to get the correct day bucket start (12:00 PM UTC)
  private getDayBucketStart(date: Date): Date {
    const bucketStart = new Date(date);
    bucketStart.setUTCHours(12, 0, 0, 0);
    
    // If the event occurred before 12:00 PM UTC on its calendar day,
    // it belongs to the previous day's bucket
    if (date.getTime() < bucketStart.getTime()) {
      bucketStart.setUTCDate(bucketStart.getUTCDate() - 1);
    }
    
    return bucketStart;
  }

  async updateUserStreak(userId: string): Promise<{ newStreak: number; rewardEarned: string; isBonusDay: boolean }> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      throw new Error("User not found");
    }

    const now = new Date();
    const lastStreakDate = user.lastStreakDate;
    let newStreak = (user.currentStreak || 0) + 1;
    let rewardEarned = "1";
    let isBonusDay = false;

    if (lastStreakDate) {
      const lastClaim = new Date(lastStreakDate);
      const minutesSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1000 * 60);
      
      if (minutesSinceLastClaim < 5) {
        return { newStreak: user.currentStreak || 0, rewardEarned: "0", isBonusDay: false };
      }
    }

    await db
      .update(users)
      .set({
        currentStreak: newStreak,
        lastStreakDate: now,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    if (parseFloat(rewardEarned) > 0) {
      await this.addEarning({
        userId,
        amount: rewardEarned,
        source: 'bonus_claim',
        description: `Bonus claim - earned 1 PAD`,
      });
    }

    return { newStreak, rewardEarned, isBonusDay };
  }

  async incrementExtraAdsWatched(userId: string): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return;
    const now = new Date();
    await db.update(users).set({
      extraAdsWatchedToday: sql`${users.extraAdsWatchedToday} + 1`,
      lastExtraAdDate: now,
      updatedAt: now,
    }).where(eq(users.id, userId));
  }

  async canWatchExtraAd(userId: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    const now = new Date();
    const lastAdDate = user.lastExtraAdDate;
    const isSameDay = lastAdDate && 
      lastAdDate.getUTCFullYear() === now.getUTCFullYear() &&
      lastAdDate.getUTCMonth() === now.getUTCMonth() &&
      lastAdDate.getUTCDate() === now.getUTCDate();
    
    if (!isSameDay) {
      await db.update(users).set({ extraAdsWatchedToday: 0, lastExtraAdDate: now }).where(eq(users.id, userId));
      return true;
    }

    return (user.extraAdsWatchedToday || 0) < 100;
  }

  // Helper function for consistent 12:00 PM UTC reset date calculation
  private getResetDate(date = new Date()): string {
    const utcDate = date.toISOString().split('T')[0];
    
    // If current time is before 12:00 PM UTC, consider it still "yesterday" for tasks
    if (date.getUTCHours() < 12) {
      const yesterday = new Date(date);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return yesterday.toISOString().split('T')[0];
    }
    
    return utcDate;
  }

  async incrementAdsWatched(userId: string): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) return;

    const now = new Date();
    const currentResetDate = this.getCurrentResetDate(); // Use new reset method

    // Check if last ad was watched today (same reset period)
    let adsCount = 1; // Default for first ad of the day
    
    if (user.lastAdDate) {
      const lastAdResetDate = this.getCurrentResetDate(); // Use consistent method
      const lastAdDateString = user.lastAdDate.toISOString().split('T')[0];
      
      // If same reset period, increment current count
      if (lastAdDateString === currentResetDate) {
        adsCount = (user.adsWatchedToday || 0) + 1;
      }
    }

    console.log(`📊 ADS_COUNT_DEBUG: User ${userId}, Reset Date: ${currentResetDate}, New Count: ${adsCount}, Previous Count: ${user.adsWatchedToday || 0}`);

    await db
      .update(users)
      .set({
        adsWatchedToday: adsCount,
        adsWatched: sql`COALESCE(${users.adsWatched}, 0) + 1`, // Increment total ads watched
        lastAdDate: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    // NEW: Update task progress for the new task system
    await this.updateTaskProgress(userId, adsCount);
  }

  async resetDailyAdsCount(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        adsWatchedToday: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async canWatchAd(userId: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    
    const now = new Date();
    const currentResetDate = this.getResetDate(now);

    let currentCount = 0;
    
    if (user.lastAdDate) {
      const lastAdResetDate = this.getResetDate(user.lastAdDate);
      
      // If same reset period, use current count
      if (lastAdResetDate === currentResetDate) {
        currentCount = user.adsWatchedToday || 0;
      }
    }
    
    return currentCount < 160; // Daily limit of 160 ads
  }


  async createReferral(referrerId: string, referredId: string): Promise<Referral> {
    // Validate inputs
    if (!referrerId || !referredId) {
      throw new Error(`Invalid referral parameters: referrerId=${referrerId}, referredId=${referredId}`);
    }
    
    // Prevent self-referrals
    if (referrerId === referredId) {
      throw new Error('Users cannot refer themselves');
    }
    
    // Verify both users exist
    const referrer = await this.getUser(referrerId);
    const referred = await this.getUser(referredId);
    
    if (!referrer) {
      throw new Error(`Referrer user not found: ${referrerId}`);
    }
    
    if (!referred) {
      throw new Error(`Referred user not found: ${referredId}`);
    }
    
    // Check if referral already exists
    const existingReferral = await db
      .select()
      .from(referrals)
      .where(and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.refereeId, referredId)
      ))
      .limit(1);
    
    if (existingReferral.length > 0) {
      throw new Error('Referral relationship already exists');
    }
    
    // Create the referral relationship (initially pending)
    const [referral] = await db
      .insert(referrals)
      .values({
        referrerId,
        refereeId: referredId,
        rewardAmount: "0.01",
        status: 'pending', // Pending until friend watches 10 ads
      })
      .returning();
    
    // CRITICAL: Also update the referred user's referred_by field with the referrer's referral code
    // This ensures both the referrals table and the user's referred_by field are synchronized
    await db
      .update(users)
      .set({
        referredBy: referrer.referralCode, // Store the referrer's referral code, not their ID
        updatedAt: new Date(),
      })
      .where(eq(users.id, referredId));
    
    console.log(`✅ Referral relationship created (pending): ${referrerId} referred ${referredId}, referred_by updated to: ${referrer.referralCode}`);
    return referral;
  }

  // Check and activate referral bonus when friend watches required number of ads (PAD + USD rewards)
  // Uses admin-configured 'referral_ads_required' setting instead of hardcoded value
  async checkAndActivateReferralBonus(userId: string): Promise<void> {
    try {
      // Check if this user has already received their referral bonus
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.firstAdWatched) {
        // Referral bonus already processed for this user
        return;
      }

      // Get admin-configured referral ads requirement (no hardcoded values)
      const referralAdsRequired = parseInt(await this.getAppSetting('referral_ads_required', '1'));
      
      // Count ads watched by this user
      const [adCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(earnings)
        .where(and(
          eq(earnings.userId, userId),
          eq(earnings.source, 'ad_watch')
        ));

      const adsWatched = adCount?.count || 0;
      
      // If user has watched the admin-configured required number of ads, activate referral bonuses
      if (adsWatched >= referralAdsRequired) {
        // Mark this user as having completed the referral ad requirement
        await db
          .update(users)
          .set({ firstAdWatched: true })
          .where(eq(users.id, userId));

        // Get referral reward settings from admin (no hardcoded values)
        const referralRewardEnabled = await this.getAppSetting('referral_reward_enabled', 'false');
        const referralRewardPAD = parseInt(await this.getAppSetting('referral_reward_pad', '50'));
        const referralRewardUSD = parseFloat(await this.getAppSetting('referral_reward_usd', '0.0005'));

        // Find pending referrals where this user is the referee
        const pendingReferrals = await db
          .select()
          .from(referrals)
          .where(and(
            eq(referrals.refereeId, userId),
            eq(referrals.status, 'pending')
          ));

        // Activate each pending referral
        for (const referral of pendingReferrals) {
          // Update referral status to completed AND STORE the reward amounts at time of earning
          await db
            .update(referrals)
            .set({ 
              status: 'completed',
              usdRewardAmount: String(referralRewardUSD),
              bugRewardAmount: String(referralRewardUSD === '0' ? '0' : (parseFloat(String(referralRewardUSD)) * 50).toFixed(10))
            })
            .where(eq(referrals.id, referral.id));

          // Award PAD referral bonus to referrer (uses admin-configured amount)
          await this.addEarning({
            userId: referral.referrerId,
            amount: String(referralRewardPAD),
            source: 'referral',
            description: `Referral bonus - friend watched ${referralAdsRequired} ads (+${referralRewardPAD} PAD)`,
          });

          console.log(`✅ Referral bonus: ${referralRewardPAD} PAD awarded to ${referral.referrerId} from ${userId}'s ${referralAdsRequired} ad watches`);

          // Award USD bonus if enabled (uses admin-configured amount)
          if (referralRewardEnabled === 'true' && referralRewardUSD > 0) {
            await this.addUSDBalance(
              referral.referrerId,
              String(referralRewardUSD),
              'referral',
              `Referral bonus - friend watched ${referralAdsRequired} ads (+$${referralRewardUSD} USD)`
            );
            console.log(`✅ Referral bonus: $${referralRewardUSD} USD awarded to ${referral.referrerId} from ${userId}'s ${referralAdsRequired} ad watches`);

            // CRITICAL FIX: Also credit BUG balance for referral bonus
            const bugRewardAmount = parseFloat(String(referralRewardUSD)) * 50; // Calculate BUG from USD
            await this.addBUGBalance(
              referral.referrerId,
              String(bugRewardAmount),
              'referral',
              `Referral bonus - BUG earned (+${bugRewardAmount} BUG)`
            );
            console.log(`✅ Referral bonus: ${bugRewardAmount} BUG awarded to ${referral.referrerId}`);
          }

          // CRITICAL: Send ONLY ONE notification to referrer when their friend watches their first ad
          // Uses USD reward amount from Admin Settings (no PAD/commission messages)
          try {
            const { sendReferralRewardNotification } = await import('./telegram');
            const referrer = await this.getUser(referral.referrerId);
            const referredUser = await this.getUser(userId);
            
            if (referrer && referrer.telegram_id && referredUser) {
              const referredName = referredUser.username || referredUser.firstName || 'your friend';
              // Send notification with USD amount from Admin Settings (not PAD)
              await sendReferralRewardNotification(
                referrer.telegram_id,
                referredName,
                String(referralRewardUSD) // USD amount from admin settings
              );
              console.log(`📩 Referral reward notification sent to ${referrer.telegram_id} with $${referralRewardUSD} USD`);
            }
          } catch (notifyError) {
            console.error('❌ Error sending referral reward notification:', notifyError);
            // Don't throw - notification failure shouldn't block the referral process
          }
        }
      }
    } catch (error) {
      console.error('Error checking referral bonus activation:', error);
    }
  }

  async getUserReferrals(userId: string): Promise<Referral[]> {
    return db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, userId))
      .orderBy(desc(referrals.createdAt));
  }

  // Get total count of ALL invites (regardless of status or if user watched ads)
  async getTotalInvitesCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(referrals)
      .where(eq(referrals.referrerId, userId));
    
    return result[0]?.count || 0;
  }

  // Clear orphaned referral - when referrer no longer exists
  async clearOrphanedReferral(userId: string): Promise<void> {
    try {
      // Clear the referredBy field on the user
      await db
        .update(users)
        .set({ 
          referredBy: null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log(`✅ Cleared orphaned referral for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error clearing orphaned referral for user ${userId}:`, error);
      // Don't throw - this is a cleanup operation that shouldn't block main flow
    }
  }

  async getUserByReferralCode(referralCode: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, referralCode)).limit(1);
    return user || null;
  }


  async getReferralByUsers(referrerId: string, refereeId: string): Promise<Referral | null> {
    const [referral] = await db
      .select()
      .from(referrals)
      .where(and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.refereeId, refereeId)
      ))
      .limit(1);
    return referral || null;
  }

  // Helper method to ensure all users have referral codes
  async ensureAllUsersHaveReferralCodes(): Promise<void> {
    const usersWithoutCodes = await db
      .select()
      .from(users)
      .where(sql`${users.referralCode} IS NULL OR ${users.referralCode} = ''`);
    
    for (const user of usersWithoutCodes) {
      try {
        await this.generateReferralCode(user.id);
        console.log(`Generated referral code for user ${user.id}`);
      } catch (error) {
        console.error(`Failed to generate referral code for user ${user.id}:`, error);
      }
    }
  }

  // CRITICAL: Fix existing referral data by synchronizing referrals table with referred_by fields
  async fixExistingReferralData(): Promise<void> {
    try {
      console.log('🔄 Starting referral data synchronization...');
      
      // Find all users who have referred_by but no entry in referrals table
      const usersWithReferredBy = await db
        .select({
          userId: users.id,
          referredBy: users.referredBy,
          referralCode: users.referralCode
        })
        .from(users)
        .where(and(
          sql`${users.referredBy} IS NOT NULL`,
          sql`${users.referredBy} != ''`
        ));

      console.log(`Found ${usersWithReferredBy.length} users with referred_by field set`);

      for (const user of usersWithReferredBy) {
        try {
          // Skip if referredBy is null or empty
          if (!user.referredBy) continue;
          
          // Find the referrer by their referral code
          const referrer = await this.getUserByReferralCode(user.referredBy);
          
          if (referrer) {
            // Check if referral relationship already exists
            const existingReferral = await db
              .select()
              .from(referrals)
              .where(and(
                eq(referrals.referrerId, referrer.id),
                eq(referrals.refereeId, user.userId)
              ))
              .limit(1);

            if (existingReferral.length === 0) {
              // Create the missing referral relationship
              await db
                .insert(referrals)
                .values({
                  referrerId: referrer.id,
                  refereeId: user.userId,
                  rewardAmount: "0.01",
                  status: 'pending', // Will be updated by checkAndActivateReferralBonus if user has 10+ ads
                });
              
              console.log(`✅ Created missing referral: ${referrer.id} -> ${user.userId}`);
              
              // Check if this user should have activated referral bonus
              await this.checkAndActivateReferralBonus(user.userId);
            }
          } else {
            console.log(`⚠️  Referrer not found for referral code: ${user.referredBy}`);
          }
        } catch (error) {
          console.error(`❌ Error processing user ${user.userId}:`, error);
        }
      }
      
      console.log('✅ Referral data synchronization completed');
    } catch (error) {
      console.error('❌ Error in fixExistingReferralData:', error);
    }
  }

  async generateReferralCode(userId: string): Promise<string> {
    // First check if user already has a referral code
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (user && user.referralCode) {
      return user.referralCode;
    }
    
    // Generate a secure random referral code using crypto
    const code = crypto.randomBytes(6).toString('hex'); // 12-character hex code
    
    await db
      .update(users)
      .set({
        referralCode: code,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    
    return code;
  }

  // Admin operations
  async getAllUsers(): Promise<User[]> {
    return db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt));
  }

  async updateUserBanStatus(userId: string, banned: boolean): Promise<void> {
    await db
      .update(users)
      .set({
        banned,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  // Promo code operations
  async createPromoCode(promoCodeData: InsertPromoCode): Promise<PromoCode> {
    const [promoCode] = await db
      .insert(promoCodes)
      .values(promoCodeData)
      .returning();
    
    return promoCode;
  }

  async getAllPromoCodes(): Promise<PromoCode[]> {
    return db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt));
  }

  async getPromoCode(code: string): Promise<PromoCode | undefined> {
    const [promoCode] = await db
      .select()
      .from(promoCodes)
      .where(sql`LOWER(${promoCodes.code}) = LOWER(${code})`);
    
    return promoCode;
  }

  async updatePromoCodeStatus(id: string, isActive: boolean): Promise<PromoCode> {
    const [promoCode] = await db
      .update(promoCodes)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(promoCodes.id, id))
      .returning();
    
    return promoCode;
  }

  async usePromoCode(code: string, userId: string): Promise<{ success: boolean; message: string; reward?: string; errorType?: string }> {
    // Get promo code
    const promoCode = await this.getPromoCode(code);
    
    if (!promoCode) {
      return { success: false, message: "Invalid promo code", errorType: "invalid" };
    }

    // Check per-user limit first (already applied)
    const userUsageCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(promoCodeUsage)
      .where(and(
        eq(promoCodeUsage.promoCodeId, promoCode.id),
        eq(promoCodeUsage.userId, userId)
      ));

    if (userUsageCount[0]?.count >= (promoCode.perUserLimit || 1)) {
      return { success: false, message: "Promo code already applied", errorType: "already_applied" };
    }

    // Check if expired
    if (promoCode.expiresAt && new Date() > new Date(promoCode.expiresAt)) {
      return { success: false, message: "Promo code has expired", errorType: "expired" };
    }

    // Check if active
    if (!promoCode.isActive) {
      return { success: false, message: "Promo code not active", errorType: "not_active" };
    }

    // Check usage limit (global limit reached)
    if (promoCode.usageLimit && (promoCode.usageCount || 0) >= promoCode.usageLimit) {
      return { success: false, message: "Promo code not active", errorType: "not_active" };
    }

    // Record usage
    await db.insert(promoCodeUsage).values({
      promoCodeId: promoCode.id,
      userId,
      rewardAmount: promoCode.rewardAmount,
    });

    // Update usage count
    await db
      .update(promoCodes)
      .set({
        usageCount: sql`${promoCodes.usageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(promoCodes.id, promoCode.id));

    // NOTE: Reward is added by the routes.ts handler, not here
    // This prevents double-rewarding and allows routes.ts to handle different reward types (PAD, TON, USD)

    return {
      success: true,
      message: `Promo code redeemed! You earned ${promoCode.rewardAmount} ${promoCode.rewardCurrency || 'PAD'}`,
      reward: promoCode.rewardAmount,
    };
  }

  // Process referral commission (10% of user's earnings)
  async processReferralCommission(userId: string, originalEarningId: number, earningAmount: string): Promise<void> {
    try {
      // Only process commissions for ad watching earnings
      const [earning] = await db
        .select()
        .from(earnings)
        .where(eq(earnings.id, originalEarningId))
        .limit(1);

      if (!earning || earning.source !== 'ad_watch') {
        // Only ad earnings generate commissions
        return;
      }

      // Find who referred this user (must be completed referral)
      const [referralInfo] = await db
        .select({ referrerId: referrals.referrerId })
        .from(referrals)
        .where(and(
          eq(referrals.refereeId, userId),
          eq(referrals.status, 'completed') // Only completed referrals earn commissions
        ))
        .limit(1);

      if (!referralInfo) {
        // User was not referred by anyone or referral not activated
        return;
      }

      // Calculate 10% commission on ad earnings only
      const commissionAmount = (parseFloat(earningAmount) * 0.10).toFixed(8);
      
      // Record the referral commission
      await db.insert(referralCommissions).values({
        referrerId: referralInfo.referrerId,
        referredUserId: userId,
        originalEarningId,
        commissionAmount,
      });

      // Add commission as earnings to the referrer
      await this.addEarning({
        userId: referralInfo.referrerId,
        amount: commissionAmount,
        source: 'referral_commission',
        description: `10% commission from referred user's ad earnings`,
      });

      // Log commission transaction
      await this.logTransaction({
        userId: referralInfo.referrerId,
        amount: commissionAmount,
        type: 'addition',
        source: 'referral_commission',
        description: `10% commission from referred user's ad earnings`,
        metadata: { 
          originalEarningId, 
          referredUserId: userId,
          commissionRate: '10%'
        }
      });

      console.log(`✅ Referral commission of ${commissionAmount} awarded to ${referralInfo.referrerId} from ${userId}'s ad earnings`);
      
      // NOTE: Commission notifications removed to prevent spam on every ad watch
      // Only first-ad referral notifications are sent via sendReferralRewardNotification in checkAndActivateReferralBonus
    } catch (error) {
      console.error('Error processing referral commission:', error);
      // Don't throw error to avoid disrupting the main earning process
    }
  }

  async getUserReferralEarnings(userId: string): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
      .from(earnings)
      .where(and(
        eq(earnings.userId, userId),
        sql`${earnings.source} IN ('referral_commission', 'referral')`
      ));

    return result.total;
  }


  async createPayoutRequest(userId: string, amount: string, paymentSystemId: string, paymentDetails?: string): Promise<{ success: boolean; message: string; withdrawalId?: string }> {
    try {
      // Get user data
      const user = await this.getUser(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Find payment system and calculate fee
      const paymentSystem = PAYMENT_SYSTEMS.find(p => p.id === paymentSystemId);
      if (!paymentSystem) {
        return { success: false, message: 'Invalid payment system' };
      }
      
      const requestedAmount = parseFloat(amount);
      const fee = paymentSystem.fee;
      const netAmount = requestedAmount - fee;
      
      // Validate minimum withdrawal amount and ensure net amount is positive
      if (requestedAmount < paymentSystem.minWithdrawal) {
        return { success: false, message: `Minimum withdrawal is ${paymentSystem.minWithdrawal} ${paymentSystem.name}` };
      }
      
      if (netAmount <= 0) {
        return { success: false, message: `Withdrawal amount must be greater than the fee of ${fee} ${paymentSystem.name}` };
      }

      // Check balance (but don't deduct yet - wait for admin approval)
      // Note: Admins have unlimited balance, so skip balance check for them
      const isAdmin = user.telegram_id === process.env.TELEGRAM_ADMIN_ID;
      const userBalance = parseFloat(user.balance || '0');
      
      if (!isAdmin && userBalance < requestedAmount) {
        return { success: false, message: 'Insufficient balance' };
      }

      // Create pending withdrawal record (DO NOT deduct balance yet)
      const withdrawalDetails = {
        paymentSystem: paymentSystem.name,
        paymentDetails: paymentDetails,
        paymentSystemId: paymentSystemId,
        requestedAmount: requestedAmount.toString(),
        fee: fee.toString(),
        netAmount: netAmount.toString()
      };

      const [withdrawal] = await db.insert(withdrawals).values({
        userId: userId,
        amount: amount, // Store the full requested amount that will be deducted from balance
        status: 'pending',
        method: paymentSystem.name,
        details: withdrawalDetails
      }).returning();

      return { 
        success: true, 
        message: `Payout request created successfully. Fee: ${fee} ${paymentSystem.name}, Net transfer: ${netAmount.toFixed(8)} ${paymentSystem.name}`,
        withdrawalId: withdrawal.id
      };
    } catch (error) {
      console.error('Error creating payout request:', error);
      return { success: false, message: 'Error processing payout request' };
    }
  }

  async getAppStats(): Promise<{
    totalUsers: number;
    activeUsersToday: number;
    totalInvites: number;
    totalEarnings: string;
    totalReferralEarnings: string;
    totalPayouts: string;
    newUsersLast24h: number;
  }> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    // Total users
    const [totalUsersResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);

    // Active users today (users who earned something today)
    const [activeUsersResult] = await db
      .select({ count: sql<number>`count(DISTINCT ${earnings.userId})` })
      .from(earnings)
      .where(gte(earnings.createdAt, today));

    // Total invites
    const [totalInvitesResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(referrals);

    // Total earnings (positive amounts only)
    const [totalEarningsResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
      .from(earnings)
      .where(sql`${earnings.amount} > 0`);

    // Total referral earnings
    const [totalReferralEarningsResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
      .from(earnings)
      .where(sql`${earnings.source} IN ('referral_commission', 'referral')`);

    // Total payouts (negative amounts)
    const [totalPayoutsResult] = await db
      .select({ total: sql<string>`COALESCE(ABS(SUM(${earnings.amount})), '0')` })
      .from(earnings)
      .where(eq(earnings.source, 'payout'));

    // New users in last 24h
    const [newUsersResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.createdAt, yesterday));

    return {
      totalUsers: totalUsersResult.count || 0,
      activeUsersToday: activeUsersResult.count || 0,
      totalInvites: totalInvitesResult.count || 0,
      totalEarnings: totalEarningsResult.total || '0',
      totalReferralEarnings: totalReferralEarningsResult.total || '0',
      totalPayouts: totalPayoutsResult.total || '0',
      newUsersLast24h: newUsersResult.count || 0,
    };
  }

  // Withdrawal operations (missing implementations)
  async createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal> {
    const [result] = await db.insert(withdrawals).values(withdrawal).returning();
    return result;
  }

  async getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(desc(withdrawals.createdAt));
  }

  async getAllPendingWithdrawals(): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).where(eq(withdrawals.status, 'pending')).orderBy(desc(withdrawals.createdAt));
  }

  async getAllWithdrawals(): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt));
  }

  async updateWithdrawalStatus(withdrawalId: string, status: string, transactionHash?: string, adminNotes?: string): Promise<Withdrawal> {
    const updateData: any = { status, updatedAt: new Date() };
    if (transactionHash) updateData.transactionHash = transactionHash;
    if (adminNotes) updateData.adminNotes = adminNotes;
    
    const [result] = await db.update(withdrawals).set(updateData).where(eq(withdrawals.id, withdrawalId)).returning();
    return result;
  }

  async approveWithdrawal(withdrawalId: string, adminNotes?: string, transactionHash?: string): Promise<{ success: boolean; message: string; withdrawal?: Withdrawal }> {
    try {
      // Get withdrawal details
      const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      if (!withdrawal) {
        return { success: false, message: 'Withdrawal not found' };
      }
      
      if (withdrawal.status !== 'pending') {
        return { success: false, message: 'Withdrawal is not pending' };
      }

      // Get user for logging and balance management
      const user = await this.getUser(withdrawal.userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const withdrawalAmount = parseFloat(withdrawal.amount);
      
      // Get the total amount that should be deducted (includes fee) from withdrawal details
      // The withdrawal.amount is the NET amount after fee, but we need to deduct the TOTAL (with fee)
      const withdrawalDetails = withdrawal.details as any;
      const totalToDeduct = withdrawalDetails?.totalDeducted 
        ? parseFloat(withdrawalDetails.totalDeducted) 
        : withdrawalAmount;
      
      // ALL withdrawals use USD balance (the method just indicates payment preference: TON, USD, STARS, etc.)
      // This matches the withdrawal creation flow where all amounts are in USD
      const currency = 'USD';
      const userBalance = parseFloat(user.usdBalance || '0');

      // Handle balance deduction with support for legacy withdrawals
      // Legacy withdrawals (created before the fix) already had balance deducted at request time
      // New withdrawals have balance deducted only on approval
      const bugDeducted = withdrawalDetails?.bugDeducted ? parseFloat(withdrawalDetails.bugDeducted) : 0;
      const currentBugBalance = parseFloat(user.bugBalance || '0');
      
      if (userBalance >= totalToDeduct) {
        // User has sufficient balance - this is a NEW withdrawal (or user earned more since request)
        // Deduct balance now on approval
        console.log(`💰 Deducting USD balance now for approved withdrawal`);
        console.log(`💰 Net amount: $${withdrawalAmount}, Total to deduct (with fee): $${totalToDeduct}`);
        console.log(`💰 Previous USD balance: ${userBalance}, New balance: ${(userBalance - totalToDeduct).toFixed(10)}`);

        const newUsdBalance = (userBalance - totalToDeduct).toFixed(10);
        const newBugBalance = Math.max(0, currentBugBalance - bugDeducted).toFixed(10);
        
        await db
          .update(users)
          .set({
            usdBalance: newUsdBalance,
            bugBalance: newBugBalance,
            updatedAt: new Date()
          })
          .where(eq(users.id, withdrawal.userId));
        console.log(`✅ USD balance deducted: ${userBalance} → ${newUsdBalance}`);
        if (bugDeducted > 0) {
          console.log(`✅ BUG balance deducted: ${currentBugBalance} → ${newBugBalance}`);
        }
      } else {
        // User doesn't have sufficient balance - this is a LEGACY withdrawal
        // Balance was already deducted at request time (old flow), so just approve without deducting again
        console.log(`⚠️ Legacy withdrawal detected - balance was already deducted at request time`);
        console.log(`💰 Current USD balance: ${userBalance}, Required: ${totalToDeduct}`);
        console.log(`✅ Approving without additional balance deduction (legacy flow)`);
      }

      // Record withdrawal in earnings history for proper stats tracking
      const paymentSystemName = withdrawal.method;
      const description = `Withdrawal approved: ${withdrawal.amount} ${currency} via ${paymentSystemName}`;
      
      await db.insert(earnings).values({
        userId: withdrawal.userId,
        amount: `-${withdrawalAmount.toString()}`,
        source: 'withdrawal',
        description: description,
      });

      // Also log the transaction for audit trail
      await this.logTransaction({
        userId: withdrawal.userId,
        amount: `-${withdrawalAmount.toString()}`,
        type: 'debit',
        source: 'withdrawal',
        description: description,
        metadata: { withdrawalId, currency, method: paymentSystemName }
      });

      // Update withdrawal status to Approved and mark as deducted
      const updateData: any = { 
        status: 'Approved', 
        deducted: true,
        updatedAt: new Date() 
      };
      if (transactionHash) updateData.transactionHash = transactionHash;
      if (adminNotes) updateData.adminNotes = adminNotes;
      
      const [updatedWithdrawal] = await db.update(withdrawals).set(updateData).where(eq(withdrawals.id, withdrawalId)).returning();
      
      console.log(`✅ Withdrawal #${withdrawalId} approved with balance deduction — ${currency} balance updated ✅`);
      
      // Send group notification for approval
      try {
        const { sendWithdrawalApprovedNotification } = require('./telegram');
        await sendWithdrawalApprovedNotification(updatedWithdrawal);
      } catch (notifyError) {
        console.error('⚠️ Failed to send withdrawal approval notification:', notifyError);
      }
      
      return { success: true, message: 'Withdrawal approved and processed', withdrawal: updatedWithdrawal };
    } catch (error) {
      console.error('Error approving withdrawal:', error);
      return { success: false, message: 'Error processing withdrawal approval' };
    }
  }

  async rejectWithdrawal(withdrawalId: string, adminNotes?: string): Promise<{ success: boolean; message: string; withdrawal?: Withdrawal }> {
    try {
      // Get withdrawal details
      const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      if (!withdrawal) {
        return { success: false, message: 'Withdrawal not found' };
      }
      
      if (withdrawal.status !== 'pending') {
        return { success: false, message: 'Withdrawal is not pending' };
      }

      // Get user and withdrawal details for potential refund
      const user = await this.getUser(withdrawal.userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }
      
      const withdrawalAmount = parseFloat(withdrawal.amount);
      const withdrawalDetails = withdrawal.details as any;
      const totalToRefund = withdrawalDetails?.totalDeducted 
        ? parseFloat(withdrawalDetails.totalDeducted) 
        : withdrawalAmount;
      const bugToRefund = withdrawalDetails?.bugDeducted ? parseFloat(withdrawalDetails.bugDeducted) : 0;
      const currentUsdBalance = parseFloat(user.usdBalance || '0');
      const currentBugBalance = parseFloat(user.bugBalance || '0');
      
      // Check if this is a LEGACY withdrawal (balance was already deducted at request time)
      // Legacy withdrawals have insufficient balance because it was already taken
      // We detect this by checking if the user's balance is lower than expected
      // For legacy withdrawals, we need to REFUND the balance
      if (currentUsdBalance < totalToRefund) {
        // LEGACY withdrawal - refund the balance that was already deducted
        console.log(`⚠️ Legacy withdrawal detected - refunding balance that was deducted at request time`);
        const newUsdBalance = (currentUsdBalance + totalToRefund).toFixed(10);
        const newBugBalance = (currentBugBalance + bugToRefund).toFixed(10);
        
        await db
          .update(users)
          .set({
            usdBalance: newUsdBalance,
            bugBalance: newBugBalance,
            updatedAt: new Date()
          })
          .where(eq(users.id, withdrawal.userId));
        console.log(`💰 USD balance refunded: ${currentUsdBalance} → ${newUsdBalance}`);
        if (bugToRefund > 0) {
          console.log(`💰 BUG balance refunded: ${currentBugBalance} → ${newBugBalance}`);
        }
      } else {
        // NEW withdrawal - balance was never deducted, nothing to refund
        console.log(`❌ Withdrawal #${withdrawalId} rejected - no refund needed (balance was never deducted)`);
        console.log(`💡 User balance remains unchanged`);
      }

      // Update withdrawal status to rejected
      const updateData: any = { 
        status: 'rejected', 
        refunded: false,
        deducted: false,
        updatedAt: new Date() 
      };
      if (adminNotes) updateData.adminNotes = adminNotes;
      
      const [updatedWithdrawal] = await db.update(withdrawals).set(updateData).where(eq(withdrawals.id, withdrawalId)).returning();
      
      console.log(`✅ Withdrawal #${withdrawalId} rejected - balance remains untouched`);
      
      return { success: true, message: 'Withdrawal rejected', withdrawal: updatedWithdrawal };
    } catch (error) {
      console.error('Error rejecting withdrawal:', error);
      return { success: false, message: 'Error processing withdrawal rejection' };
    }
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
    return withdrawal;
  }


  // Ensure all required system tasks exist for production deployment
  async ensureSystemTasksExist(): Promise<void> {
    try {
      // Get first available user to be the owner, or create a system user
      let firstUser = await db.select({ id: users.id }).from(users).limit(1).then(users => users[0]);
      
      if (!firstUser) {
        console.log('⚠️ No users found, creating system user for task ownership');
        // Create a system user for task ownership
        const systemUser = await db.insert(users).values({
          id: 'system-user',
          username: 'System',
          firstName: 'System',
          lastName: 'Tasks',
          referralCode: 'SYSTEM',
          createdAt: new Date(),
          updatedAt: new Date()
        }).returning({ id: users.id });
        firstUser = systemUser[0];
        console.log('✅ System user created for task ownership');
      }

      // Define all system tasks with exact specifications
      const systemTasks = [
        // Fixed daily tasks
        {
          id: 'channel-visit-check-update',
          type: 'channel_visit',
          url: 'https://t.me/PaidAdsNews',
          rewardPerUser: '0.00015000', // 0.00015 TON formatted to 8 digits for precision
          title: 'Channel visit (Check Update)',
          description: 'Visit our Telegram channel for updates and news'
        },
        {
          id: 'app-link-share',
          type: 'share_link',
          url: 'share://referral',
          rewardPerUser: '0.00020000', // 0.00020 TON formatted to 8 digits for precision
          title: 'App link share (Share link)',
          description: 'Share your affiliate link with friends'
        },
        {
          id: 'invite-friend-valid',
          type: 'invite_friend',
          url: 'invite://friend',
          rewardPerUser: '0.00050000', // 0.00050 TON formatted to 8 digits for precision
          title: 'Invite friend (valid)',
          description: 'Invite 1 valid friend to earn rewards'
        },
        // Daily ads goal tasks
        {
          id: 'ads-goal-mini',
          type: 'ads_goal_mini',
          url: 'watch://ads/mini',
          rewardPerUser: '0.00045000', // 0.00045 TON formatted to 8 digits for precision
          title: 'Mini (Watch 15 ads)',
          description: 'Watch 15 ads to complete this daily goal'
        },
        {
          id: 'ads-goal-light',
          type: 'ads_goal_light',
          url: 'watch://ads/light',
          rewardPerUser: '0.00060000', // 0.00060 TON formatted to 8 digits for precision
          title: 'Light (Watch 25 ads)',
          description: 'Watch 25 ads to complete this daily goal'
        },
        {
          id: 'ads-goal-medium',
          type: 'ads_goal_medium',
          url: 'watch://ads/medium',
          rewardPerUser: '0.00070000', // 0.00070 TON formatted to 8 digits for precision
          title: 'Medium (Watch 45 ads)',
          description: 'Watch 45 ads to complete this daily goal'
        },
        {
          id: 'ads-goal-hard',
          type: 'ads_goal_hard',
          url: 'watch://ads/hard',
          rewardPerUser: '0.00080000', // 0.00080 TON formatted to 8 digits for precision
          title: 'Hard (Watch 75 ads)',
          description: 'Watch 75 ads to complete this daily goal'
        }
      ];

      // Create or update each system task
      for (const task of systemTasks) {
        const existingTask = await this.getPromotion(task.id);
        
        if (existingTask) {
          // Update existing task to match current specifications
          await db.update(promotions)
            .set({
              type: task.type,
              url: task.url,
              rewardPerUser: task.rewardPerUser,
              title: task.title,
              description: task.description,
              status: 'active',
              isApproved: true // System tasks are pre-approved
            })
            .where(eq(promotions.id, task.id));
          
          console.log(`✅ System task updated: ${task.title}`);
        } else {
          // Create new system task
          await db.insert(promotions).values({
            id: task.id,
            ownerId: firstUser.id,
            type: task.type,
            url: task.url,
            cost: '0',
            rewardPerUser: task.rewardPerUser,
            limit: 100000, // High limit for system tasks
            claimedCount: 0,
            status: 'active',
            isApproved: true, // System tasks are pre-approved
            title: task.title,
            description: task.description,
            createdAt: new Date()
          });
          
          console.log(`✅ System task created: ${task.title}`);
        }
      }

      console.log('✅ All system tasks ensured successfully');
    } catch (error) {
      console.error('❌ Error ensuring system tasks exist:', error);
      // Don't throw - server should still start even if task creation fails
    }
  }


  // Ensure admin user with unlimited balance exists for production deployment
  async ensureAdminUserExists(): Promise<void> {
    try {
      const adminTelegramId = process.env.TELEGRAM_ADMIN_ID || '6653616672';
      const maxBalance = '99.999'; // Admin balance as requested
      
      // Check if admin user already exists
      const existingAdmin = await this.getUserByTelegramId(adminTelegramId);
      if (existingAdmin) {
        // Update balance if it's less than max
        if (parseFloat(existingAdmin.balance || '0') < parseFloat(maxBalance)) {
          await db.update(users)
            .set({ 
              balance: maxBalance,
              updatedAt: new Date()
            })
            .where(eq(users.telegram_id, adminTelegramId));
          
          // Also update user_balances table
          await db.insert(userBalances).values({
            userId: existingAdmin.id,
            balance: maxBalance,
            createdAt: new Date(),
            updatedAt: new Date()
          }).onConflictDoUpdate({
            target: [userBalances.userId],
            set: {
              balance: maxBalance,
              updatedAt: new Date()
            }
          });
          
          console.log('✅ Admin balance updated to unlimited:', adminTelegramId);
        } else {
          console.log('✅ Admin user already exists with unlimited balance:', adminTelegramId);
        }
        return;
      }

      // Create admin user with unlimited balance
      const adminUser = await db.insert(users).values({
        telegram_id: adminTelegramId,
        username: 'admin',
        balance: maxBalance,
        referralCode: 'ADMIN001',
        createdAt: new Date(),
        updatedAt: new Date()
      }).returning();

      if (adminUser[0]) {
        // Also create user balance record
        await db.insert(userBalances).values({
          userId: adminUser[0].id,
          balance: maxBalance,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log('✅ Admin user created with unlimited balance:', adminTelegramId);
      }
    } catch (error) {
      console.error('❌ Error ensuring admin user exists:', error);
      // Don't throw - server should still start even if admin creation fails
    }
  }

  // Promotion system removed - using Ads Watch Tasks system only

  async getAvailablePromotionsForUser(userId: string): Promise<any> {
    // Get all active and approved promotions - ALWAYS show them
    const allPromotions = await db.select().from(promotions)
      .where(and(eq(promotions.status, 'active'), eq(promotions.isApproved, true)))
      .orderBy(desc(promotions.createdAt));

    const currentDate = this.getCurrentTaskDate();
    const availablePromotions = [];

    for (const promotion of allPromotions) {
      // Check if this is a daily task type
      const isDailyTask = [
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ].includes(promotion.type);

      const periodDate = isDailyTask ? currentDate : undefined;
      
      // Get current task status from the new system
      const taskStatus = await this.getTaskStatus(userId, promotion.id, periodDate);
      
      let completionStatus = 'locked';
      let statusMessage = 'Click to start';
      let progress = null;
      let buttonText = 'Start';

      if (taskStatus) {
        if (taskStatus.status === 'claimed') {
          completionStatus = 'claimed';
          statusMessage = '✅ Done';
          buttonText = '✅ Done';
        } else if (taskStatus.status === 'claimable') {
          completionStatus = 'claimable';
          statusMessage = 'Ready to claim!';
          buttonText = 'Claim';
        } else {
          // Status is 'locked' - check if we can make it claimable
          const verificationResult = await this.verifyTask(userId, promotion.id, promotion.type);
          if (verificationResult.status === 'claimable') {
            completionStatus = 'claimable';
            statusMessage = 'Ready to claim!';
            buttonText = 'Claim';
          } else {
            completionStatus = 'locked';
            if (promotion.type.startsWith('ads_goal_')) {
              const user = await this.getUser(userId);
              const adsWatchedToday = user?.adsWatchedToday || 0;
              const adsGoalThresholds = {
                'ads_goal_mini': 15,
                'ads_goal_light': 25,
                'ads_goal_medium': 45,
                'ads_goal_hard': 75
              };
              const requiredAds = adsGoalThresholds[promotion.type as keyof typeof adsGoalThresholds] || 0;
              statusMessage = `Watch ${Math.max(0, requiredAds - adsWatchedToday)} more ads (${adsWatchedToday}/${requiredAds})`;
              progress = {
                current: adsWatchedToday,
                required: requiredAds,
                percentage: Math.min(100, (adsWatchedToday / requiredAds) * 100)
              };
              buttonText = 'Watch Ads';
            } else if (promotion.type === 'invite_friend') {
              statusMessage = 'Invite a friend first';
              buttonText = 'Copy Link';
            } else if (promotion.type === 'share_link') {
              statusMessage = 'Share your affiliate link first';
              buttonText = 'Share Link';
            } else if (promotion.type === 'channel_visit') {
              statusMessage = 'Visit the channel';
              buttonText = 'Visit Channel';
            }
          }
        }
      } else {
        // No task status yet - create initial status
        await this.setTaskStatus(userId, promotion.id, 'locked', periodDate);
        
        // Set default messages based on task type
        if (promotion.type === 'channel_visit') {
          statusMessage = 'Visit the channel';
          buttonText = 'Visit Channel';
        } else if (promotion.type === 'share_link') {
          statusMessage = 'Share your affiliate link';
          buttonText = 'Share Link';
        } else if (promotion.type === 'invite_friend') {
          statusMessage = 'Invite a friend';
          buttonText = 'Copy Link';
        } else if (promotion.type.startsWith('ads_goal_')) {
          const adsGoalThresholds = {
            'ads_goal_mini': 15,
            'ads_goal_light': 25,
            'ads_goal_medium': 45,
            'ads_goal_hard': 75
          };
          const requiredAds = adsGoalThresholds[promotion.type as keyof typeof adsGoalThresholds] || 0;
          const user = await this.getUser(userId);
          const adsWatchedToday = user?.adsWatchedToday || 0;
          statusMessage = `Watch ${Math.max(0, requiredAds - adsWatchedToday)} more ads (${adsWatchedToday}/${requiredAds})`;
          progress = {
            current: adsWatchedToday,
            required: requiredAds,
            percentage: Math.min(100, (adsWatchedToday / requiredAds) * 100)
          };
          buttonText = 'Watch Ads';
        }
      }

      // ALWAYS add the task - never filter out
      availablePromotions.push({
        ...promotion,
        completionStatus,
        statusMessage,
        buttonText,
        progress
      });
    }

    return {
      success: true,
      tasks: availablePromotions.map(p => ({
        id: p.id,
        title: p.title || 'Untitled Task',
        description: p.description || '',
        type: p.type,
        channelUsername: p.url?.match(/t\.me\/([^/?]+)/)?.[1],
        botUsername: p.url?.match(/t\.me\/([^/?]+)/)?.[1],
        reward: p.rewardPerUser || '0',
        completedCount: p.claimedCount || 0,
        totalSlots: p.limit || 1000,
        isActive: p.status === 'active',
        createdAt: p.createdAt,
        claimUrl: p.url,
        // New task status system properties
        completionStatus: (p as any).completionStatus,
        statusMessage: (p as any).statusMessage,
        buttonText: (p as any).buttonText,
        progress: (p as any).progress
      })),
      total: availablePromotions.length
    };
  }


  // Task completion system removed - using Ads Watch Tasks system only


  // Get current date in YYYY-MM-DD format for 12:00 PM UTC reset
  private getCurrentTaskDate(): string {
    const now = new Date();
    const resetHour = 12; // 12:00 PM UTC
    
    // If current time is before 12:00 PM UTC, use yesterday's date
    if (now.getUTCHours() < resetHour) {
      now.setUTCDate(now.getUTCDate() - 1);
    }
    
    return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
  }


  async completeDailyTask(promotionId: string, userId: string, rewardAmount: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if promotion exists
      const promotion = await this.getPromotion(promotionId);
      if (!promotion) {
        return { success: false, message: 'Daily task not found' };
      }

      // Check if user already completed this daily task today
      const hasCompleted = await this.hasUserCompletedDailyTask(promotionId, userId);
      if (hasCompleted) {
        return { success: false, message: 'You have already completed this daily task today' };
      }

      const currentDate = this.getCurrentTaskDate();

      // Record daily task completion
      await db.insert(dailyTaskCompletions).values({
        promotionId,
        userId,
        taskType: promotion.type, // Use promotion type as task type
        rewardAmount,
        progress: 1,
        required: 1,
        completed: true,
        claimed: true,
        completionDate: currentDate,
      });

      console.log(`📊 DAILY_TASK_COMPLETION_LOG: UserID=${userId}, TaskID=${promotionId}, AmountRewarded=${rewardAmount}, Date=${currentDate}, Status=SUCCESS, Title="${promotion.title}"`);

      // Add reward to user's earnings balance
      await this.addBalance(userId, rewardAmount);

      // Add earning record
      await this.addEarning({
        userId,
        amount: rewardAmount,
        source: 'daily_task_completion',
        description: `Daily task completed: ${promotion.title}`,
      });

      // Send task completion notification to user via Telegram
      try {
        const { sendTaskCompletionNotification } = await import('./telegram');
        await sendTaskCompletionNotification(userId, rewardAmount);
      } catch (error) {
        console.error('Failed to send task completion notification:', error);
        // Don't fail the task completion if notification fails
      }

      return { success: true, message: 'Daily task completed successfully' };
    } catch (error) {
      console.error('Error completing daily task:', error);
      return { success: false, message: 'Error completing daily task' };
    }
  }

  async checkAdsGoalCompletion(userId: string, adsGoalType: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;

    const currentDate = this.getCurrentTaskDate();
    const adsWatchedToday = user.adsWatchedToday || 0;

    // Define ads goal thresholds
    const adsGoalThresholds = {
      'ads_goal_mini': 15,
      'ads_goal_light': 25, 
      'ads_goal_medium': 45,
      'ads_goal_hard': 75
    };

    const requiredAds = adsGoalThresholds[adsGoalType as keyof typeof adsGoalThresholds];
    if (!requiredAds) return false;

    // Check if user has watched enough ads today
    return adsWatchedToday >= requiredAds;
  }

  // Helper method to check if user has valid referral today (only 1 allowed per day)
  async hasValidReferralToday(userId: string): Promise<boolean> {
    try {
      // Check if there's an actual new referral created today in the referrals table
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      
      const todayReferrals = await db
        .select({ count: sql`count(*)` })
        .from(referrals)
        .where(
          and(
            eq(referrals.referrerId, userId),
            gte(referrals.createdAt, startOfDay),
            lt(referrals.createdAt, endOfDay)
          )
        );

      const count = Number(todayReferrals[0]?.count || 0);
      console.log(`🔍 Referral validation for user ${userId}: ${count} new referrals today`);
      
      return count >= 1;
    } catch (error) {
      console.error('Error checking valid referral today:', error);
      return false;
    }
  }

  // Helper method to check if user has shared their link today
  async hasSharedLinkToday(userId: string): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;
      
      // Use the new appShared field for faster lookup
      return user.appShared || false;
    } catch (error) {
      console.error('Error checking link share today:', error);
      return false;
    }
  }

  // Helper method to check if user has visited channel today
  async hasVisitedChannelToday(userId: string): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;
      
      // Use the new channelVisited field for faster lookup
      return user.channelVisited || false;
    } catch (error) {
      console.error('Error checking channel visit today:', error);
      return false;
    }
  }

  // Method to record that user shared their link (called from frontend)
  async recordLinkShare(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user already shared today
      const hasShared = await this.hasSharedLinkToday(userId);
      if (hasShared) {
        return { success: true, message: 'Link share already recorded today' };
      }

      // Update the appShared field
      await db.update(users)
        .set({ appShared: true })
        .where(eq(users.id, userId));

      return { success: true, message: 'Link share recorded successfully' };
    } catch (error) {
      console.error('Error recording link share:', error);
      return { success: false, message: 'Failed to record link share' };
    }
  }

  // ============== NEW TASK STATUS SYSTEM FUNCTIONS ==============
  
  // Get or create task status for user
  async getTaskStatus(userId: string, promotionId: string, periodDate?: string): Promise<TaskStatus | null> {
    try {
      const [taskStatus] = await db.select().from(taskStatuses)
        .where(and(
          eq(taskStatuses.userId, userId),
          eq(taskStatuses.promotionId, promotionId),
          periodDate ? eq(taskStatuses.periodDate, periodDate) : sql`${taskStatuses.periodDate} IS NULL`
        ));
      return taskStatus || null;
    } catch (error) {
      console.error('Error getting task status:', error);
      return null;
    }
  }

  // Update or create task status
  async setTaskStatus(
    userId: string, 
    promotionId: string, 
    status: 'locked' | 'claimable' | 'claimed',
    periodDate?: string,
    progressCurrent?: number,
    progressRequired?: number,
    metadata?: any
  ): Promise<{ success: boolean; message: string }> {
    try {
      const existingStatus = await this.getTaskStatus(userId, promotionId, periodDate);
      
      if (existingStatus) {
        // Update existing status
        await db.update(taskStatuses)
          .set({
            status,
            progressCurrent,
            progressRequired,
            metadata,
            updatedAt: sql`now()`
          })
          .where(eq(taskStatuses.id, existingStatus.id));
      } else {
        // Create new status
        await db.insert(taskStatuses).values({
          userId,
          promotionId,
          periodDate,
          status,
          progressCurrent: progressCurrent || 0,
          progressRequired: progressRequired || 0,
          metadata
        });
      }
      
      return { success: true, message: 'Task status updated successfully' };
    } catch (error) {
      console.error('Error setting task status:', error);
      return { success: false, message: 'Failed to update task status' };
    }
  }

  // Verify task and update status to claimable
  async verifyTask(userId: string, promotionId: string, taskType: string): Promise<{ success: boolean; message: string; status?: 'claimable' | 'locked' | 'claimed' }> {
    try {
      const promotion = await this.getPromotion(promotionId);
      if (!promotion) {
        return { success: false, message: 'Task not found' };
      }

      const isDailyTask = ['channel_visit', 'share_link', 'invite_friend', 'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'].includes(taskType);
      const periodDate = isDailyTask ? this.getCurrentTaskDate() : undefined;

      // Check current status
      const currentStatus = await this.getTaskStatus(userId, promotionId, periodDate);
      if (currentStatus?.status === 'claimed') {
        return { success: false, message: 'Task already claimed', status: 'claimed' };
      }

      let verified = false;
      let progressCurrent = 0;
      let progressRequired = 0;

      // Perform verification based on task type
      switch (taskType) {
        case 'channel_visit':
          // Channel visit is immediately claimable after user clicks
          verified = true;
          break;
          
        case 'share_link':
          // Check if user has shared their link
          verified = await this.hasSharedLinkToday(userId);
          break;
          
        case 'invite_friend':
          // Check if user has valid referral today
          verified = await this.hasValidReferralToday(userId);
          break;
          
        case 'ads_goal_mini':
        case 'ads_goal_light':
        case 'ads_goal_medium':
        case 'ads_goal_hard':
          // Check if user met ads goal
          const user = await this.getUser(userId);
          const adsWatchedToday = user?.adsWatchedToday || 0;
          
          const adsGoalThresholds = {
            'ads_goal_mini': 15,
            'ads_goal_light': 25,
            'ads_goal_medium': 45,
            'ads_goal_hard': 75
          };
          
          progressRequired = adsGoalThresholds[taskType as keyof typeof adsGoalThresholds] || 0;
          progressCurrent = adsWatchedToday;
          verified = adsWatchedToday >= progressRequired;
          break;
          
        default:
          verified = true; // For other task types, assume verified
      }

      const newStatus = verified ? 'claimable' : 'locked';
      await this.setTaskStatus(userId, promotionId, newStatus, periodDate, progressCurrent, progressRequired);

      return { 
        success: true, 
        message: verified ? 'Task verified, ready to claim!' : 'Task requirements not met yet',
        status: newStatus
      };
    } catch (error) {
      console.error('Error verifying task:', error);
      return { success: false, message: 'Failed to verify task' };
    }
  }

  // Claim task reward
  async claimTaskReward(userId: string, promotionId: string): Promise<{ success: boolean; message: string; rewardAmount?: string; newBalance?: string }> {
    try {
      const promotion = await this.getPromotion(promotionId);
      if (!promotion) {
        return { success: false, message: 'Task not found' };
      }

      const isDailyTask = ['channel_visit', 'share_link', 'invite_friend', 'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'].includes(promotion.type);
      const periodDate = isDailyTask ? this.getCurrentTaskDate() : undefined;

      // Check current status
      const currentStatus = await this.getTaskStatus(userId, promotionId, periodDate);
      if (!currentStatus) {
        return { success: false, message: 'Task status not found' };
      }
      
      if (currentStatus.status === 'claimed') {
        return { success: false, message: 'Task already claimed' };
      }
      
      if (currentStatus.status !== 'claimable') {
        return { success: false, message: 'Task not ready to claim' };
      }

      // Prevent users from claiming their own tasks
      if (promotion.ownerId === userId) {
        return { success: false, message: 'You cannot claim your own task' };
      }

      const rewardAmount = promotion.rewardPerUser || '0';
      
      // Record claim in appropriate table
      if (isDailyTask) {
        await db.insert(dailyTaskCompletions).values({
          promotionId,
          userId,
          taskType: promotion.type,
          rewardAmount,
          progress: 1,
          required: 1,
          completed: true,
          claimed: true,
          completionDate: periodDate!,
        });
      } else {
        await db.insert(taskCompletions).values({
          promotionId,
          userId,
          rewardAmount,
          verified: true,
        });
      }

      // Add reward to balance
      await this.addBalance(userId, rewardAmount);

      // Add earning record
      await this.addEarning({
        userId,
        amount: rewardAmount,
        source: isDailyTask ? 'daily_task_completion' : 'task_completion',
        description: `Task completed: ${promotion.title}`,
      });

      // Update task status to claimed
      await this.setTaskStatus(userId, promotionId, 'claimed', periodDate);

      // Get updated balance
      const updatedBalance = await this.getUserBalance(userId);

      console.log(`📊 TASK_CLAIM_LOG: UserID=${userId}, TaskID=${promotionId}, AmountRewarded=${rewardAmount}, Status=SUCCESS, Title="${promotion.title}"`);

      // Send notification
      try {
        const { sendTaskCompletionNotification } = await import('./telegram');
        await sendTaskCompletionNotification(userId, rewardAmount);
      } catch (error) {
        console.error('Failed to send task completion notification:', error);
      }

      return { 
        success: true, 
        message: 'Task claimed successfully!',
        rewardAmount,
        newBalance: updatedBalance?.balance || '0'
      };
    } catch (error) {
      console.error('Error claiming task reward:', error);
      return { success: false, message: 'Failed to claim task reward' };
    }
  }

  // ============== END NEW TASK STATUS SYSTEM FUNCTIONS ==============

  // Method to record that user visited channel (called from frontend)
  async recordChannelVisit(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user already visited today
      const hasVisited = await this.hasVisitedChannelToday(userId);
      if (hasVisited) {
        return { success: true, message: 'Channel visit already recorded today' };
      }

      // Update the channelVisited field
      await db.update(users)
        .set({ channelVisited: true })
        .where(eq(users.id, userId));

      return { success: true, message: 'Channel visit recorded successfully' };
    } catch (error) {
      console.error('Error recording channel visit:', error);
      return { success: false, message: 'Failed to record channel visit' };
    }
  }

  // Method to increment referrals today count when a referral is made
  async incrementReferralsToday(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get current user data
      const user = await this.getUser(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Increment referrals today count
      const newCount = (user.friendsInvited || 0) + 1;
      await db.update(users)
        .set({ friendsInvited: newCount })
        .where(eq(users.id, userId));

      return { success: true, message: `Referrals today count updated to ${newCount}` };
    } catch (error) {
      console.error('Error incrementing referrals today:', error);
      return { success: false, message: 'Failed to increment referrals today' };
    }
  }

  // Daily reset system - runs at 12:00 PM UTC
  async performDailyReset(): Promise<void> {
    try {
      console.log('🔄 Starting daily reset at 12:00 PM UTC...');
      
      const currentDate = new Date();
      const currentDateString = currentDate.toISOString().split('T')[0];
      const periodStart = new Date(currentDate);
      periodStart.setUTCHours(12, 0, 0, 0); // 12:00 PM UTC period start
      
      // 1. Check if reset was already performed for this period (idempotency)
      const usersNeedingReset = await db.select({ id: users.id })
        .from(users)
        .where(sql`${users.lastResetAt} < ${periodStart.toISOString()} OR ${users.lastResetAt} IS NULL`)
        .limit(1000); // Process in batches
      
      if (usersNeedingReset.length === 0) {
        console.log('🔄 Daily reset already completed for this period');
        return;
      }
      
      console.log(`🔄 Resetting ${usersNeedingReset.length} users for period ${currentDateString}`);
      
      // 2. Reset all users' daily counters and tracking fields
      await db.update(users)
        .set({ 
          adsWatchedToday: 0,
          channelVisited: false,
          appShared: false,
          linkShared: false,
          friendInvited: false,
          friendsInvited: 0,
          lastResetDate: currentDate,
          lastResetAt: periodStart,
          lastAdDate: currentDate 
        })
        .where(sql`${users.lastResetAt} < ${periodStart.toISOString()} OR ${users.lastResetAt} IS NULL`);
      
      // 3. Create daily task completion records for all task types for this period
      const taskTypes = ['channel_visit', 'share_link', 'invite_friend', 'ads_mini', 'ads_light', 'ads_medium', 'ads_hard'];
      const taskRewards = {
        'channel_visit': '0.000025',
        'share_link': '0.000025', 
        'invite_friend': '0.00005',
        'ads_mini': '0.000035', // 15 ads
        'ads_light': '0.000055', // 25 ads
        'ads_medium': '0.000095', // 45 ads
        'ads_hard': '0.000155' // 75 ads
      };
      const taskRequirements = {
        'channel_visit': 1,
        'share_link': 1,
        'invite_friend': 1,
        'ads_mini': 15,
        'ads_light': 25,
        'ads_medium': 45,
        'ads_hard': 75
      };
      
      for (const user of usersNeedingReset) {
        for (const taskType of taskTypes) {
          try {
            await db.insert(dailyTaskCompletions).values({
              userId: user.id,
              taskType,
              rewardAmount: taskRewards[taskType as keyof typeof taskRewards],
              progress: 0,
              required: taskRequirements[taskType as keyof typeof taskRequirements],
              completed: false,
              claimed: false,
              completionDate: currentDateString,
            }).onConflictDoNothing(); // Ignore if already exists
          } catch (error) {
            console.warn(`⚠️ Failed to create daily task ${taskType} for user ${user.id}:`, error);
          }
        }
      }
      
      // 4. Clean up old daily task completions (older than 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoString = weekAgo.toISOString().split('T')[0];
      
      await db.delete(dailyTaskCompletions)
        .where(sql`${dailyTaskCompletions.completionDate} < ${weekAgoString}`);
      
      console.log('✅ Daily reset completed successfully at 12:00 PM UTC');
      console.log(`   - Reset ${usersNeedingReset.length} users for period ${currentDateString}`);
      console.log('   - Reset ads watched today to 0');
      console.log('   - Reset channel visited, app shared, link shared, friend invited to false');
      console.log('   - Reset friends invited count to 0');
      console.log('   - Created daily task completion records');
      console.log('   - Cleaned up old task completions');
    } catch (error) {
      console.error('❌ Error during daily reset:', error);
    }
  }

  // Check if it's time for daily reset (12:00 PM UTC)
  async checkAndPerformDailyReset(): Promise<void> {
    const now = new Date();
    
    // Check if it's exactly 12:00 PM UTC (within 1 minute window)
    const isResetTime = now.getUTCHours() === 12 && now.getUTCMinutes() === 0;
    
    if (isResetTime) {
      await this.performDailyReset();
    }
  }

  // Simplified methods for the new schema - no complex tracking needed
  async updatePromotionCompletedCount(promotionId: string): Promise<void> {
    // No-op since we removed complex tracking
    return;
  }

  async updatePromotionMessageId(promotionId: string, messageId: string): Promise<void> {
    // Note: message_id field doesn't exist in promotions schema
    // This could be tracked separately if needed in the future
    console.log(`📌 Promotion ${promotionId} posted with message ID: ${messageId}`);
  }

  async deactivateCompletedPromotions(): Promise<void> {
    // No-op since we removed complex tracking  
    return;
  }

  // User balance operations
  async getUserBalance(userId: string): Promise<UserBalance | undefined> {
    try {
      const [balance] = await db.select().from(userBalances).where(eq(userBalances.userId, userId));
      return balance;
    } catch (error) {
      console.error('Error getting user balance:', error);
      return undefined;
    }
  }

  async createOrUpdateUserBalance(userId: string, balance?: string): Promise<UserBalance> {
    try {
      // Use upsert pattern with ON CONFLICT to handle race conditions
      const [result] = await db.insert(userBalances)
        .values({
          userId,
          balance: balance || '0',
        })
        .onConflictDoUpdate({
          target: userBalances.userId,
          set: {
            balance: balance ? balance : sql`${userBalances.balance}`,
            updatedAt: new Date()
          }
        })
        .returning();
      return result;
    } catch (error) {
      console.error('Error creating/updating user balance:', error);
      // Fallback: try to get existing balance if upsert fails
      try {
        const existingBalance = await this.getUserBalance(userId);
        if (existingBalance) {
          return existingBalance;
        }
      } catch (fallbackError) {
        console.error('Fallback getUserBalance also failed:', fallbackError);
      }
      throw error;
    }
  }

  async deductBalance(userId: string, amount: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user is admin - admins have unlimited balance
      const user = await this.getUser(userId);
      const isAdmin = user?.telegram_id === process.env.TELEGRAM_ADMIN_ID;
      
      if (isAdmin) {
        console.log('🔑 Admin has unlimited balance - allowing deduction');
        return { success: true, message: 'Balance deducted successfully (admin unlimited)' };
      }

      let balance = await this.getUserBalance(userId);
      if (!balance) {
        // Create balance record with 0 if user not found
        balance = await this.createOrUpdateUserBalance(userId, '0');
      }

      const currentBalance = parseFloat(balance.balance || '0');
      const deductAmount = parseFloat(amount);

      if (currentBalance < deductAmount) {
        return { success: false, message: 'Insufficient balance' };
      }

      await db.update(userBalances)
        .set({
          balance: sql`${userBalances.balance} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(userBalances.userId, userId));

      // Record transaction for balance deduction
      await this.addTransaction({
        userId,
        amount: `-${amount}`,
        type: 'deduction',
        source: 'task_creation',
        description: `Task creation cost deducted - fixed rate`,
        metadata: { 
          deductedAmount: amount,
          fixedCost: '0.01',
          reason: 'task_creation_fee'
        }
      });

      return { success: true, message: 'Balance deducted successfully' };
    } catch (error) {
      console.error('Error deducting balance:', error);
      return { success: false, message: 'Error deducting balance' };
    }
  }

  async addBalance(userId: string, amount: string): Promise<void> {
    try {
      // First ensure the user has a balance record
      let existingBalance = await this.getUserBalance(userId);
      if (!existingBalance) {
        // Create new balance record with the amount if user not found
        await this.createOrUpdateUserBalance(userId, amount);
      } else {
        // Add to existing balance
        await db.update(userBalances)
          .set({
            balance: sql`${userBalances.balance} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, userId));
      }
    } catch (error) {
      console.error('Error adding balance:', error);
      throw error;
    }
  }

  // Promotion claims methods
  async hasUserClaimedPromotion(promotionId: string, userId: string): Promise<boolean> {
    const [claim] = await db.select().from(promotionClaims)
      .where(and(
        eq(promotionClaims.promotionId, promotionId),
        eq(promotionClaims.userId, userId)
      ));
    return !!claim;
  }


  async incrementPromotionClaimedCount(promotionId: string): Promise<void> {
    await db.update(promotions)
      .set({
        claimedCount: sql`${promotions.claimedCount} + 1`,
      })
      .where(eq(promotions.id, promotionId));
  }

  // ===== NEW SIMPLE TASK SYSTEM =====
  
  // Fixed task configuration for the 9 sequential ads-based tasks
  private readonly TASK_CONFIG = [
    { level: 1, required: 20, reward: "0.00033000" },
    { level: 2, required: 20, reward: "0.00033000" },
    { level: 3, required: 20, reward: "0.00033000" },
    { level: 4, required: 20, reward: "0.00033000" },
    { level: 5, required: 20, reward: "0.00033000" },
    { level: 6, required: 20, reward: "0.00033000" },
    { level: 7, required: 20, reward: "0.00033000" },
    { level: 8, required: 20, reward: "0.00033000" },
    { level: 9, required: 20, reward: "0.00033000" },
  ];

  // Get current reset date in YYYY-MM-DD format (resets at 00:00 UTC)
  private getCurrentResetDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  // Initialize or get daily tasks for a user
  async getUserDailyTasks(userId: string): Promise<DailyTask[]> {
    const resetDate = this.getCurrentResetDate();
    
    // Get existing tasks for today
    const existingTasks = await db
      .select()
      .from(dailyTasks)
      .where(and(
        eq(dailyTasks.userId, userId),
        eq(dailyTasks.resetDate, resetDate)
      ))
      .orderBy(dailyTasks.taskLevel);

    // If no tasks exist for today, create them
    if (existingTasks.length === 0) {
      const tasksToInsert: InsertDailyTask[] = this.TASK_CONFIG.map(config => ({
        userId,
        taskLevel: config.level,
        progress: 0,
        required: config.required,
        completed: false,
        claimed: false,
        rewardAmount: config.reward,
        resetDate,
      }));

      await db.insert(dailyTasks).values(tasksToInsert);
      
      // Fetch the newly created tasks
      return await db
        .select()
        .from(dailyTasks)
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.resetDate, resetDate)
        ))
        .orderBy(dailyTasks.taskLevel);
    }

    return existingTasks;
  }

  // Update task progress when user watches ads (truly independent task progress)
  async updateTaskProgress(userId: string, adsWatchedToday: number): Promise<void> {
    const resetDate = this.getCurrentResetDate();
    
    // Get all tasks for today ordered by level
    const tasks = await this.getUserDailyTasks(userId);
    
    // Find the currently active task (first task that hasn't been claimed and all previous tasks are claimed)
    let currentTask = null;
    
    for (const task of tasks) {
      if (!task.claimed) {
        // Check if all previous tasks are claimed (sequential unlock)
        let canActivate = true;
        for (const prevTask of tasks) {
          if (prevTask.taskLevel < task.taskLevel && !prevTask.claimed) {
            canActivate = false;
            break;
          }
        }
        
        if (canActivate) {
          currentTask = task;
          break;
        }
      }
    }
    
    // If no current task found, all tasks are claimed or blocked by prerequisites
    if (!currentTask) {
      return;
    }
    
    // Calculate how many ads have been "consumed" by previous claimed tasks
    let adsConsumedByPreviousTasks = 0;
    for (const task of tasks) {
      if (task.taskLevel < currentTask.taskLevel && task.claimed) {
        adsConsumedByPreviousTasks += task.required;
      }
    }
    
    // Calculate independent progress for current task
    // This ensures each task starts at 0 when it becomes active and only counts ads from that point
    const adsAvailableForCurrentTask = Math.max(0, adsWatchedToday - adsConsumedByPreviousTasks);
    const newProgress = Math.min(adsAvailableForCurrentTask, currentTask.required);
    const isCompleted = newProgress >= currentTask.required;
    
    // Only update the currently active task with independent progress
    await db
      .update(dailyTasks)
      .set({
        progress: newProgress,
        completed: isCompleted,
        completedAt: isCompleted && !currentTask.completed ? new Date() : currentTask.completedAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(dailyTasks.userId, userId),
        eq(dailyTasks.taskLevel, currentTask.taskLevel),
        eq(dailyTasks.resetDate, resetDate)
      ));
    
    // Reset progress of all non-active tasks to ensure they start fresh when they become active
    await db
      .update(dailyTasks)
      .set({
        progress: 0,
        completed: false,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(dailyTasks.userId, userId),
        eq(dailyTasks.resetDate, resetDate),
        sql`${dailyTasks.taskLevel} > ${currentTask.taskLevel}`,
        eq(dailyTasks.claimed, false)
      ));
  }

  // Claim a completed daily task reward
  async claimDailyTaskReward(userId: string, taskLevel: number): Promise<{ success: boolean; message: string; rewardAmount?: string }> {
    const resetDate = this.getCurrentResetDate();
    
    // Get the specific task
    const [task] = await db
      .select()
      .from(dailyTasks)
      .where(and(
        eq(dailyTasks.userId, userId),
        eq(dailyTasks.taskLevel, taskLevel),
        eq(dailyTasks.resetDate, resetDate)
      ));

    if (!task) {
      return { success: false, message: "Task not found" };
    }

    if (!task.completed) {
      return { success: false, message: "Task not completed yet" };
    }

    if (task.claimed) {
      return { success: false, message: "Task already claimed" };
    }

    // Check if this is sequential (can only claim if previous tasks are claimed)
    if (taskLevel > 1) {
      const previousTask = await db
        .select()
        .from(dailyTasks)
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.taskLevel, taskLevel - 1),
          eq(dailyTasks.resetDate, resetDate)
        ));

      if (previousTask.length === 0 || !previousTask[0].claimed) {
        return { success: false, message: "Complete previous tasks first" };
      }
    }

    // Mark task as claimed
    await db
      .update(dailyTasks)
      .set({
        claimed: true,
        claimedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(dailyTasks.userId, userId),
        eq(dailyTasks.taskLevel, taskLevel),
        eq(dailyTasks.resetDate, resetDate)
      ));

    // Add reward to user balance
    await this.addEarning({
      userId,
      amount: task.rewardAmount,
      source: 'task_completion',
      description: `Task ${taskLevel} completed: Watch ${task.required} ads`,
    });

    // Log transaction
    await this.logTransaction({
      userId,
      amount: task.rewardAmount,
      type: 'addition',
      source: 'task_completion',
      description: `Task ${taskLevel} reward`,
      metadata: { taskLevel, required: task.required, resetDate }
    });

    return {
      success: true,
      message: "Task reward claimed successfully",
      rewardAmount: task.rewardAmount
    };
  }

  // Get next available task (first unclaimed task)
  async getNextAvailableTask(userId: string): Promise<DailyTask | null> {
    const tasks = await this.getUserDailyTasks(userId);
    
    // Find the first unclaimed task
    for (const task of tasks) {
      if (!task.claimed) {
        return task;
      }
    }
    
    return null; // All tasks claimed
  }

  // New daily reset - runs at 00:00 UTC instead of 12:00 PM UTC
  async performDailyResetV2(): Promise<void> {
    try {
      console.log('🔄 Starting daily reset at 00:00 UTC (new task system)...');
      
      const currentDate = new Date();
      const currentDateString = currentDate.toISOString().split('T')[0];
      const resetTime = new Date(currentDate);
      resetTime.setUTCHours(0, 0, 0, 0); // 00:00 UTC reset
      
      // Check if today's reset has already been performed
      const usersNeedingReset = await db.select({ id: users.id })
        .from(users)
        .where(sql`${users.lastResetDate} != ${currentDateString} OR ${users.lastResetDate} IS NULL`)
        .limit(1000);
      
      if (usersNeedingReset.length === 0) {
        console.log('🔄 Daily reset already completed for today');
        return;
      }
      
      console.log(`🔄 Resetting ${usersNeedingReset.length} users for ${currentDateString}`);
      
      // Reset all users' daily counters
      await db.update(users)
        .set({ 
          adsWatchedToday: 0,
          lastResetDate: currentDate,
          updatedAt: new Date(),
        })
        .where(sql`${users.lastResetDate} != ${currentDateString} OR ${users.lastResetDate} IS NULL`);
      
      console.log('✅ Daily reset completed successfully (new task system)');
      
    } catch (error) {
      console.error('❌ Error in daily reset (new task system):', error);
      throw error;
    }
  }

  // Check and perform daily reset (called every 5 minutes)
  async checkAndPerformDailyResetV2(): Promise<void> {
    try {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      
      // Run reset at 00:00-00:05 UTC to catch the reset window
      if (currentHour === 0 && currentMinute < 5) {
        await this.performDailyResetV2();
      }
    } catch (error) {
      console.error('❌ Error checking daily reset:', error);
      // Don't throw to avoid disrupting the interval
    }
  }

  // Get all advertiser tasks (for admin panel)
  async getAllTasks(): Promise<any[]> {
    const result = await db
      .select()
      .from(advertiserTasks)
      .orderBy(desc(advertiserTasks.createdAt));
    return result;
  }

  // Get pending tasks (under_review status) for admin approval
  async getPendingTasks(): Promise<any[]> {
    const result = await db
      .select()
      .from(advertiserTasks)
      .where(eq(advertiserTasks.status, 'under_review'))
      .orderBy(desc(advertiserTasks.createdAt));
    return result;
  }

  // Create a new advertiser task
  async createTask(taskData: {
    advertiserId: string;
    taskType: string;
    title: string;
    link: string;
    totalClicksRequired: number;
    costPerClick: string;
    totalCost: string;
    status?: string;
  }): Promise<any> {
    const [task] = await db
      .insert(advertiserTasks)
      .values({
        advertiserId: taskData.advertiserId,
        taskType: taskData.taskType,
        title: taskData.title,
        link: taskData.link,
        totalClicksRequired: taskData.totalClicksRequired,
        costPerClick: taskData.costPerClick,
        totalCost: taskData.totalCost,
        status: taskData.status || 'under_review',
        currentClicks: 0,
      })
      .returning();
    
    console.log(`📝 Task created: ${task.id} by ${taskData.advertiserId}`);
    return task;
  }

  // Get monthly leaderboard
  async getMonthlyLeaderboard(currentUserId?: string): Promise<any> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const leaderboard = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        totalEarned: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(users)
      .leftJoin(earnings, and(
        eq(users.id, earnings.userId),
        gte(earnings.createdAt, monthStart),
        sql`${earnings.source} NOT IN ('withdrawal', 'referral_commission')`
      ))
      .where(eq(users.banned, false))
      .groupBy(users.id)
      .orderBy(desc(sql`COALESCE(SUM(${earnings.amount}), 0)`))
      .limit(100);

    let userRank = null;
    if (currentUserId) {
      const userIndex = leaderboard.findIndex(u => u.id === currentUserId);
      if (userIndex !== -1) {
        userRank = userIndex + 1;
      }
    }

    return {
      leaderboard: leaderboard.map((u, i) => ({
        ...u,
        rank: i + 1,
        displayName: u.username || u.firstName || 'Anonymous'
      })),
      userRank
    };
  }

  // Get valid (completed) referral count for a user
  async getValidReferralCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(referrals)
      .innerJoin(users, eq(referrals.refereeId, users.id))
      .where(and(
        eq(referrals.referrerId, userId),
        eq(referrals.status, 'completed'),
        eq(users.banned, false)
      ));
    
    return result[0]?.count || 0;
  }

  // Get tasks created by a specific user (my tasks)
  async getMyTasks(userId: string): Promise<any[]> {
    const result = await db
      .select()
      .from(advertiserTasks)
      .where(eq(advertiserTasks.advertiserId, userId))
      .orderBy(desc(advertiserTasks.createdAt));
    return result;
  }

  // Get active tasks for a user (excludes tasks they've already completed, their own tasks, and tasks that hit click limit)
  async getActiveTasksForUser(userId: string): Promise<any[]> {
    const result = await db
      .select()
      .from(advertiserTasks)
      .where(and(
        eq(advertiserTasks.status, 'running'),
        sql`${advertiserTasks.advertiserId} != ${userId}`,
        sql`${advertiserTasks.currentClicks} < ${advertiserTasks.totalClicksRequired}`,
        sql`NOT EXISTS (
          SELECT 1 FROM task_clicks 
          WHERE task_clicks.task_id = ${advertiserTasks.id} 
          AND task_clicks.publisher_id = ${userId}
        )`
      ))
      .orderBy(desc(advertiserTasks.createdAt));
    return result;
  }

  // Get a specific task by ID
  async getTaskById(taskId: string): Promise<any | null> {
    const [task] = await db
      .select()
      .from(advertiserTasks)
      .where(eq(advertiserTasks.id, taskId));
    return task || null;
  }

  // Approve a task (change status from under_review to running)
  async approveTask(taskId: string): Promise<any> {
    const [updatedTask] = await db
      .update(advertiserTasks)
      .set({
        status: 'running',
        updatedAt: new Date()
      })
      .where(eq(advertiserTasks.id, taskId))
      .returning();
    
    console.log(`✅ Task ${taskId} approved and set to running`);
    return updatedTask;
  }

  // Reject a task (change status to rejected)
  async rejectTask(taskId: string): Promise<any> {
    const [updatedTask] = await db
      .update(advertiserTasks)
      .set({
        status: 'rejected',
        updatedAt: new Date()
      })
      .where(eq(advertiserTasks.id, taskId))
      .returning();
    
    console.log(`❌ Task ${taskId} rejected`);
    return updatedTask;
  }

  // Pause a task (change status from running to paused)
  async pauseTask(taskId: string): Promise<any> {
    const [updatedTask] = await db
      .update(advertiserTasks)
      .set({
        status: 'paused',
        updatedAt: new Date()
      })
      .where(eq(advertiserTasks.id, taskId))
      .returning();
    
    console.log(`⏸️ Task ${taskId} paused`);
    return updatedTask;
  }

  // Resume a task (change status from paused to running)
  async resumeTask(taskId: string): Promise<any> {
    const [updatedTask] = await db
      .update(advertiserTasks)
      .set({
        status: 'running',
        updatedAt: new Date()
      })
      .where(eq(advertiserTasks.id, taskId))
      .returning();
    
    console.log(`▶️ Task ${taskId} resumed`);
    return updatedTask;
  }

  // Delete a task
  async deleteTask(taskId: string): Promise<boolean> {
    try {
      const result = await db
        .delete(advertiserTasks)
        .where(eq(advertiserTasks.id, taskId))
        .returning({ id: advertiserTasks.id });
      
      if (result.length === 0) {
        console.log(`⚠️ Task ${taskId} not found for deletion`);
        return false;
      }
      
      console.log(`🗑️ Task ${taskId} deleted`);
      return true;
    } catch (error) {
      console.error(`❌ Error deleting task ${taskId}:`, error);
      return false;
    }
  }

  // Record a task click (when publisher clicks on a task)
  async recordTaskClick(taskId: string, publisherId: string): Promise<{
    success: boolean;
    message: string;
    reward?: number;
    task?: any;
  }> {
    try {
      // Get the task
      const task = await this.getTaskById(taskId);
      
      if (!task) {
        return { success: false, message: "Task not found" };
      }

      // Check if task is active and running
      if (task.status !== 'running') {
        return { success: false, message: "Task is not active" };
      }

      // Check if user is clicking their own task
      if (task.advertiserId === publisherId) {
        return { success: false, message: "You cannot click your own task" };
      }

      // Check if user already clicked this task
      const existingClick = await db
        .select()
        .from(taskClicks)
        .where(and(
          eq(taskClicks.taskId, taskId),
          eq(taskClicks.publisherId, publisherId)
        ))
        .limit(1);

      if (existingClick.length > 0) {
        return { success: false, message: "You have already completed this task" };
      }

      // Check if task has reached its click limit
      if (task.currentClicks >= task.totalClicksRequired) {
        return { success: false, message: "Task has reached its click limit" };
      }

      // Get reward amount from admin settings based on task type
      const rewardSettingKey = task.taskType === 'bot' ? 'bot_task_reward' : 
                               task.taskType === 'partner' ? 'partner_task_reward' : 
                               'channel_task_reward';
      const rewardSetting = await db
        .select()
        .from(adminSettings)
        .where(eq(adminSettings.settingKey, rewardSettingKey))
        .limit(1);
      
      // Get partner task reward from settings if partner task, otherwise use regular rewards
      const partnerRewardSetting = await db
        .select()
        .from(adminSettings)
        .where(eq(adminSettings.settingKey, 'partner_task_reward'))
        .limit(1);
      const partnerReward = parseInt(partnerRewardSetting[0]?.settingValue || '5');
      
      const rewardPAD = task.taskType === 'partner' ? partnerReward : 
                        parseInt(rewardSetting[0]?.settingValue || (task.taskType === 'bot' ? '20' : '30'));

      // Insert click record
      await db.insert(taskClicks).values({
        taskId: taskId,
        publisherId: publisherId,
        rewardAmount: rewardPAD.toString(),
      });

      // Increment current clicks on the task
      const newClickCount = task.currentClicks + 1;
      const isCompleted = newClickCount >= task.totalClicksRequired;

      await db
        .update(advertiserTasks)
        .set({
          currentClicks: newClickCount,
          status: isCompleted ? 'completed' : 'running',
          completedAt: isCompleted ? new Date() : undefined,
          updatedAt: new Date()
        })
        .where(eq(advertiserTasks.id, taskId));

      // Add reward to user's balance
      const [publisher] = await db
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, publisherId));

      const currentBalance = parseInt(publisher?.balance || '0');
      const newBalance = currentBalance + rewardPAD;

      await db
        .update(users)
        .set({
          balance: newBalance.toString(),
          updatedAt: new Date()
        })
        .where(eq(users.id, publisherId));

      // Record the earning
      await db.insert(earnings).values({
        userId: publisherId,
        amount: rewardPAD.toString(),
        source: 'task_completion',
        description: `Completed ${task.taskType} task: ${task.title}`,
      });

      console.log(`✅ Task click recorded: ${taskId} by ${publisherId} - Reward: ${rewardPAD} PAD`);

      return {
        success: true,
        message: "Task click recorded successfully",
        reward: rewardPAD,
        task: {
          ...task,
          currentClicks: newClickCount,
          status: isCompleted ? 'completed' : 'running'
        }
      };
    } catch (error: any) {
      // Handle unique constraint violation (user already clicked)
      if (error.code === '23505') {
        return { success: false, message: "You have already completed this task" };
      }
      console.error(`❌ Error recording task click:`, error);
      return { success: false, message: "Failed to record task click" };
    }
  }

  // Get app setting from admin_settings table
  async getAppSetting(key: string, defaultValue: string | number): Promise<string> {
    try {
      const [setting] = await db
        .select({ settingValue: adminSettings.settingValue })
        .from(adminSettings)
        .where(eq(adminSettings.settingKey, key))
        .limit(1);
      
      if (setting && setting.settingValue) {
        return setting.settingValue;
      }
      return String(defaultValue);
    } catch (error) {
      console.error(`Error getting app setting ${key}:`, error);
      return String(defaultValue);
    }
  }

  // Add USD balance to user
  async addUSDBalance(userId: string, amount: string, source: string, description: string): Promise<void> {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid USD amount');
      }

      // Get current USD balance
      const [user] = await db
        .select({ usdBalance: users.usdBalance })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        throw new Error('User not found');
      }

      const currentUsdBalance = parseFloat(user.usdBalance || '0');
      const newUsdBalance = (currentUsdBalance + amountNum).toFixed(10);

      // Update user's USD balance
      await db
        .update(users)
        .set({
          usdBalance: newUsdBalance,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Log the transaction
      await this.logTransaction({
        userId,
        amount: amount,
        type: 'credit',
        source: source,
        description: description,
        metadata: { rewardType: 'USD' }
      });

      console.log(`✅ Added $${amountNum} USD to user ${userId}. New balance: $${newUsdBalance}`);
    } catch (error) {
      console.error(`Error adding USD balance:`, error);
      throw error;
    }
  }

  // Add BUG balance to user (CRITICAL FIX for referral earnings)
  async addBUGBalance(userId: string, amount: string, source: string, description: string): Promise<void> {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid BUG amount');
      }

      // Get current BUG balance
      const [user] = await db
        .select({ bugBalance: users.bugBalance })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        throw new Error('User not found');
      }

      const currentBugBalance = parseFloat(user.bugBalance || '0');
      const newBugBalance = (currentBugBalance + amountNum).toFixed(10);

      // Update user's BUG balance
      await db
        .update(users)
        .set({
          bugBalance: newBugBalance,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Log the transaction
      await this.logTransaction({
        userId,
        amount: amount,
        type: 'credit',
        source: source,
        description: description,
        metadata: { rewardType: 'BUG' }
      });

      console.log(`✅ Added ${amountNum} BUG to user ${userId}. New balance: ${newBugBalance}`);
    } catch (error) {
      console.error(`Error adding BUG balance:`, error);
      throw error;
    }
  }

  // Backfill BUG rewards for existing referrals (fix for users who earned before the update)
  async backfillExistingReferralBUGRewards(): Promise<void> {
    try {
      console.log('🔄 Starting backfill of BUG rewards for existing referrals...');
      
      // First, ensure columns exist
      try {
        await db.execute(sql`
          ALTER TABLE referrals ADD COLUMN IF NOT EXISTS usd_reward_amount DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bug_reward_amount DECIMAL(30, 10) DEFAULT '0';
        `);
      } catch (error) {
        console.log('ℹ️ Referral columns already exist');
      }
      
      // Get all completed referrals that don't have bugRewardAmount set
      const referralsNeedingBugCredit = await db.execute(sql`
        SELECT id, referrer_id, status, usd_reward_amount, bug_reward_amount 
        FROM referrals 
        WHERE status = 'completed' AND (bug_reward_amount = '0' OR bug_reward_amount IS NULL)
        AND usd_reward_amount > 0
      `);

      const rows = referralsNeedingBugCredit.rows || [];
      console.log(`📊 Found ${rows.length} referrals needing BUG credit backfill`);

      for (const ref of rows) {
        try {
          // Parse USD amount with strict validation
          const usdReward = ref.usd_reward_amount;
          if (!usdReward || usdReward === null) {
            console.log(`⏭️ Skipping referral ${ref.id} - no USD reward amount stored`);
            continue;
          }

          const usdAmount = parseFloat(String(usdReward));
          if (isNaN(usdAmount) || usdAmount <= 0) {
            console.log(`⏭️ Skipping referral ${ref.id} - invalid USD amount: ${usdReward}`);
            continue;
          }

          // Calculate BUG from USD amount (50 BUG per USD)
          const bugAmount = usdAmount * 50;
          if (isNaN(bugAmount) || bugAmount <= 0) {
            console.log(`⏭️ Skipping referral ${ref.id} - calculated BUG amount is invalid: ${bugAmount}`);
            continue;
          }

          // Update referral record with BUG amount
          await db.execute(sql`
            UPDATE referrals 
            SET bug_reward_amount = ${bugAmount.toFixed(10)}
            WHERE id = ${ref.id}
          `);

          // Credit BUG to referrer's balance
          await this.addBUGBalance(
            ref.referrer_id,
            bugAmount.toFixed(10),
            'referral_backfill',
            `Backfilled BUG from referral reward (+${bugAmount.toFixed(2)} BUG)`
          );

          console.log(`✅ Backfilled ${bugAmount.toFixed(2)} BUG for referral ${ref.id} to user ${ref.referrer_id}`);
        } catch (error) {
          console.error(`⚠️ Failed to backfill referral ${ref.id}:`, error);
        }
      }

      console.log(`✅ Backfill of BUG rewards completed!`);
    } catch (error) {
      console.error('❌ Error during BUG rewards backfill:', error);
    }
  }

  // Deduct balance for withdrawal approval (direct deduction method)
  async deductBalanceForWithdrawal(userId: string, amount: string, currency: string = 'TON'): Promise<boolean> {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        console.error('Invalid deduction amount:', amount);
        return false;
      }

      if (currency === 'TON') {
        // Deduct from TON balance
        const [user] = await db
          .select({ tonBalance: users.tonBalance })
          .from(users)
          .where(eq(users.id, userId));

        if (!user) {
          console.error('User not found for balance deduction');
          return false;
        }

        const currentBalance = parseFloat(user.tonBalance || '0');
        if (currentBalance < amountNum) {
          console.error(`Insufficient TON balance: ${currentBalance} < ${amountNum}`);
          return false;
        }

        const newBalance = (currentBalance - amountNum).toFixed(8);

        await db
          .update(users)
          .set({
            tonBalance: newBalance,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        console.log(`💰 Deducted ${amountNum} TON from user ${userId}. New balance: ${newBalance}`);
      } else if (currency === 'USD') {
        // Deduct from USD balance
        const [user] = await db
          .select({ usdBalance: users.usdBalance })
          .from(users)
          .where(eq(users.id, userId));

        if (!user) {
          console.error('User not found for USD balance deduction');
          return false;
        }

        const currentBalance = parseFloat(user.usdBalance || '0');
        if (currentBalance < amountNum) {
          console.error(`Insufficient USD balance: ${currentBalance} < ${amountNum}`);
          return false;
        }

        const newBalance = (currentBalance - amountNum).toFixed(10);

        await db
          .update(users)
          .set({
            usdBalance: newBalance,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        console.log(`💰 Deducted $${amountNum} USD from user ${userId}. New balance: $${newBalance}`);
      } else {
        // Deduct from PAD balance (default)
        const [user] = await db
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, userId));

        if (!user) {
          console.error('User not found for PAD balance deduction');
          return false;
        }

        const currentBalance = parseInt(user.balance || '0');
        if (currentBalance < amountNum) {
          console.error(`Insufficient PAD balance: ${currentBalance} < ${amountNum}`);
          return false;
        }

        const newBalance = Math.round(currentBalance - amountNum);

        await db
          .update(users)
          .set({
            balance: newBalance.toString(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        console.log(`💰 Deducted ${amountNum} PAD from user ${userId}. New balance: ${newBalance}`);
      }

      return true;
    } catch (error) {
      console.error('Error deducting balance for withdrawal:', error);
      return false;
    }
  }

  async getRunningTasksForUser(userId: string): Promise<any[]> {
    const runningTasks = await db
      .select()
      .from(advertiserTasks)
      .where(eq(advertiserTasks.status, 'running'))
      .orderBy(desc(advertiserTasks.createdAt));

    const completedClicksResult = await db
      .select({ taskId: taskClicks.taskId })
      .from(taskClicks)
      .where(eq(taskClicks.publisherId, userId));

    const completedTaskIds = new Set(completedClicksResult.map(c => c.taskId));

    return runningTasks
      .filter(task => 
        task.advertiserId !== userId && 
        !completedTaskIds.has(task.id) &&
        task.currentClicks < task.totalClicksRequired
      )
      .map(task => ({
        ...task,
        isAdminTask: true,
        rewardPAD: Math.round(parseFloat(task.costPerClick || '0.0001750') * 10000000),
      }));
  }
}

export const storage = new DatabaseStorage();
