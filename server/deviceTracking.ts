import crypto from "crypto";
import { db, pool } from "./db";
import { users, banLogs } from "../shared/schema";
import { eq, and, ne, or, sql } from "drizzle-orm";
import { config } from "./config";

const ADMIN_TELEGRAM_ID = config.bot.adminId || process.env.TELEGRAM_ADMIN_ID || '';

async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    
    if (user.role === 'admin') return true;
    
    if (ADMIN_TELEGRAM_ID && user.telegram_id === ADMIN_TELEGRAM_ID) return true;
    
    return false;
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

async function isAdminTelegramId(telegramId: string): Promise<boolean> {
  if (!telegramId) return false;
  
  if (ADMIN_TELEGRAM_ID && telegramId === ADMIN_TELEGRAM_ID) return true;
  
  try {
    const [user] = await db.select().from(users).where(eq(users.telegram_id, telegramId));
    if (user && user.role === 'admin') return true;
  } catch (error) {
    console.error("Error checking admin telegram ID:", error);
  }
  
  return false;
}

async function filterOutAdminIds(userIds: string[]): Promise<string[]> {
  const nonAdminIds: string[] = [];
  for (const userId of userIds) {
    if (!(await isAdminUser(userId))) {
      nonAdminIds.push(userId);
    }
  }
  return nonAdminIds;
}

export interface DeviceInfo {
  deviceId: string;
  fingerprint?: {
    userAgent?: string;
    platform?: string;
    language?: string;
    screenResolution?: string;
    timezone?: string;
  };
  ip?: string;
  userAgent?: string;
}

export interface BanLogData {
  bannedUserId: string;
  bannedUserUid?: string;
  ip?: string;
  deviceId?: string;
  userAgent?: string;
  fingerprint?: any;
  reason: string;
  banType: 'auto' | 'manual';
  bannedBy?: string;
  relatedAccountIds?: string[];
  referrerUid?: string;
  telegramId?: string;
  appVersion?: string;
  browserFingerprint?: string;
}

export async function createBanLog(data: BanLogData): Promise<void> {
  try {
    await db.insert(banLogs).values({
      bannedUserId: data.bannedUserId,
      bannedUserUid: data.bannedUserUid,
      ip: data.ip,
      deviceId: data.deviceId,
      userAgent: data.userAgent,
      fingerprint: data.fingerprint,
      reason: data.reason,
      banType: data.banType,
      bannedBy: data.bannedBy,
      relatedAccountIds: data.relatedAccountIds as any,
      referrerUid: data.referrerUid,
      telegramId: data.telegramId,
      appVersion: data.appVersion,
      browserFingerprint: data.browserFingerprint,
    });
    console.log(`📝 Ban log created for user ${data.bannedUserId}: ${data.reason}`);
  } catch (error) {
    console.error("Error creating ban log:", error);
  }
}

export async function validateDeviceAndDetectDuplicate(
  telegramId: string,
  deviceInfo: DeviceInfo,
  userId?: string
): Promise<{
  isValid: boolean;
  shouldBan: boolean;
  redirectToPrimary?: boolean;
  primaryAccountId?: string;
  primaryTelegramId?: string;
  duplicateAccountIds?: string[];
  reason?: string;
}> {
  try {
    // Check both telegramId and userId for admin status
    if (await isAdminTelegramId(telegramId)) {
      console.log(`✅ Admin account detected (telegram_id: ${telegramId}) - skipping multi-account detection`);
      return {
        isValid: true,
        shouldBan: false
      };
    }

    if (userId && await isAdminUser(userId)) {
      console.log(`✅ Admin account detected (userId: ${userId}) - skipping multi-account detection`);
      return {
        isValid: true,
        shouldBan: false
      };
    }

    const { deviceId, fingerprint, ip, userAgent } = deviceInfo;

    if (!deviceId) {
      return {
        isValid: false,
        shouldBan: false,
        reason: "No device ID provided"
      };
    }

    // Check for existing accounts with same device ID
    const existingUsersWithDevice = await db
      .select()
      .from(users)
      .where(eq(users.deviceId, deviceId));

    // Also check for accounts with same IP if provided
    let existingUsersWithIP: any[] = [];
    if (ip) {
      existingUsersWithIP = await db
        .select()
        .from(users)
        .where(eq(users.lastLoginIp, ip));
    }

    // Only deviceId matches are used for ban decisions.
    // IP-only matches are NOT a ban signal — many legitimate users share IPs
    // (hotspots, WiFi, NAT, mobile carriers). We log them for monitoring only.
    const allRelatedUsers = [...existingUsersWithDevice];

    // Log IP-only matches for monitoring (no ban action)
    if (ip && existingUsersWithIP.length > 0) {
      const ipOnlyUsers = existingUsersWithIP.filter(u => !allRelatedUsers.find(x => x.id === u.id));
      if (ipOnlyUsers.length > 0) {
        console.log(`ℹ️ Shared IP (${ip}): ${ipOnlyUsers.length} other user(s) on same network — normal for hotspot/WiFi. No ban action.`);
      }
    }

    // Enhanced check: same deviceId + high fingerprint similarity → extra logging
    if (fingerprint && allRelatedUsers.length > 0) {
      for (const existingUser of allRelatedUsers) {
        if (existingUser.telegram_id !== telegramId && existingUser.deviceFingerprint) {
          const similarity = calculateFingerprintSimilarity(fingerprint, existingUser.deviceFingerprint);
          if (similarity > 0.85) {
            console.log(`🔍 Very high fingerprint similarity (${Math.round(similarity * 100)}%) + same device for telegram ${telegramId}`);
          }
        }
      }
    }

    if (allRelatedUsers.length === 0) {
      return {
        isValid: true,
        shouldBan: false
      };
    }

    const currentUserAccount = allRelatedUsers.find(
      u => u.telegram_id === telegramId
    );

    if (currentUserAccount) {
      if (currentUserAccount.banned) {
        return {
          isValid: false,
          shouldBan: true,
          reason: currentUserAccount.bannedReason || "Account is banned"
        };
      }

      // Update device info and login tracking
      await db
        .update(users)
        .set({
          deviceFingerprint: fingerprint as any,
          lastLoginAt: new Date(),
          lastLoginIp: ip || currentUserAccount.lastLoginIp,
          lastLoginUserAgent: userAgent || currentUserAccount.lastLoginUserAgent,
        })
        .where(eq(users.id, currentUserAccount.id));

      return {
        isValid: true,
        shouldBan: false
      };
    }

    // New account on existing device/IP - this is multi-account abuse
    // But first, check if any of the related accounts are admins - if so, don't flag as abuse
    const adminRelatedAccount = allRelatedUsers.find(
      u => u.role === 'admin' || (ADMIN_TELEGRAM_ID && u.telegram_id === ADMIN_TELEGRAM_ID)
    );
    
    if (adminRelatedAccount) {
      console.log(`🛡️ Admin account found in related accounts - not flagging as multi-account abuse`);
      return {
        isValid: true,
        shouldBan: false
      };
    }

    // Find the primary (original) account registered to this device
    const primaryAccount = allRelatedUsers.find(u => u.isPrimaryAccount === true) || allRelatedUsers[0];

    // Policy: same device → seamlessly load the primary account, never ban.
    // Banning due to device conflicts causes false positives and bad UX.
    // The person simply gets logged in as their original account.
    console.log(`🔄 Same device (${deviceInfo.deviceId}) — redirecting new login to primary account ${primaryAccount.id} (telegram: ${primaryAccount.telegram_id})`);

    return {
      isValid: false,
      shouldBan: false,
      redirectToPrimary: true,
      primaryAccountId: primaryAccount.id,
      primaryTelegramId: primaryAccount.telegram_id,
      reason: "Same device — loading your existing account"
    };
  } catch (error) {
    console.error("Device validation error:", error);
    return {
      isValid: false,
      shouldBan: false,
      reason: "Device validation failed"
    };
  }
}

export async function checkIPForDuplicates(
  ip: string,
  telegramId: string
): Promise<{
  hasDuplicates: boolean;
  duplicateCount: number;
  primaryAccountId?: string;
}> {
  try {
    if (!ip) {
      return { hasDuplicates: false, duplicateCount: 0 };
    }

    const usersWithSameIP = await db
      .select()
      .from(users)
      .where(and(
        eq(users.lastLoginIp, ip),
        ne(users.telegram_id, telegramId)
      ));

    if (usersWithSameIP.length === 0) {
      return { hasDuplicates: false, duplicateCount: 0 };
    }

    const primaryAccount = usersWithSameIP.find(u => u.isPrimaryAccount === true) || usersWithSameIP[0];

    return {
      hasDuplicates: true,
      duplicateCount: usersWithSameIP.length,
      primaryAccountId: primaryAccount.id
    };
  } catch (error) {
    console.error("IP duplicate check error:", error);
    return { hasDuplicates: false, duplicateCount: 0 };
  }
}

export async function banUserForMultipleAccounts(
  userId: string,
  reason: string,
  deviceInfo?: DeviceInfo,
  relatedAccountIds?: string[]
): Promise<void> {
  try {
    if (await isAdminUser(userId)) {
      console.log(`🛡️ PROTECTED: Admin account ${userId} cannot be auto-banned - skipping ban`);
      return;
    }

    // Get user info for logging
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (user && await isAdminTelegramId(user.telegram_id || '')) {
      console.log(`🛡️ PROTECTED: Admin telegram_id ${user.telegram_id} cannot be banned - skipping ban`);
      return;
    }
    
    // Filter out admin IDs from relatedAccountIds to prevent any secondary operations on admins
    const filteredRelatedIds = relatedAccountIds ? await filterOutAdminIds(relatedAccountIds) : undefined;
    
    // Check if user is already banned - track to prevent duplicate ban logs
    const wasAlreadyBanned = user?.banned === true;
    
    // Always update ban metadata (even if already banned, in case of new reason/info)
    // Note: We never modify isPrimaryAccount for admin users (already checked above)
    await db
      .update(users)
      .set({
        banned: true,
        bannedReason: reason,
        bannedAt: user?.bannedAt || new Date(), // Keep original ban date if exists
        isPrimaryAccount: false,
      })
      .where(eq(users.id, userId));

    // Only create ban log if this is a NEW ban (prevents duplicate entries)
    if (!wasAlreadyBanned) {
      await createBanLog({
        bannedUserId: userId,
        bannedUserUid: user?.personalCode || user?.referralCode || undefined,
        ip: deviceInfo?.ip || user?.lastLoginIp || undefined,
        deviceId: deviceInfo?.deviceId || user?.deviceId || undefined,
        userAgent: deviceInfo?.userAgent || user?.lastLoginUserAgent || undefined,
        fingerprint: deviceInfo?.fingerprint || user?.deviceFingerprint || undefined,
        reason,
        banType: 'auto',
        relatedAccountIds: filteredRelatedIds, // Use filtered list without admin IDs
        telegramId: user?.telegram_id || undefined,
        appVersion: (user as any)?.appVersion || undefined,
        browserFingerprint: (user as any)?.browserFingerprint || undefined,
        referrerUid: (user as any)?.referrerUid || undefined,
      });
      console.log(`✅ User ${userId} banned for: ${reason}`);
    } else {
      console.log(`⚠️ User ${userId} already banned, skipping duplicate ban log`);
    }
  } catch (error) {
    console.error("Error banning user:", error);
    throw error;
  }
}

export async function banMultipleUsers(
  userIds: string[],
  reason: string,
  deviceInfo?: DeviceInfo
): Promise<void> {
  try {
    if (userIds.length === 0) return;

    const nonAdminUserIds: string[] = [];
    for (const userId of userIds) {
      if (!(await isAdminUser(userId))) {
        nonAdminUserIds.push(userId);
      } else {
        console.log(`🛡️ PROTECTED: Skipping admin user ${userId} from multi-ban`);
      }
    }

    for (const userId of nonAdminUserIds) {
      await banUserForMultipleAccounts(userId, reason, deviceInfo, nonAdminUserIds);
    }

    console.log(`✅ Banned ${nonAdminUserIds.length} accounts for: ${reason} (${userIds.length - nonAdminUserIds.length} admin accounts protected)`);
  } catch (error) {
    console.error("Error banning multiple users:", error);
    throw error;
  }
}

export async function manualBanUser(
  userId: string,
  reason: string,
  bannedBy: string,
  deviceInfo?: DeviceInfo
): Promise<void> {
  try {
    // Get user info for logging
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      throw new Error("User not found");
    }

    if (user.role === 'admin' || (ADMIN_TELEGRAM_ID && user.telegram_id === ADMIN_TELEGRAM_ID)) {
      console.log(`🛡️ PROTECTED: Cannot manually ban admin user ${userId}`);
      throw new Error("Cannot ban admin accounts");
    }

    await db
      .update(users)
      .set({
        banned: true,
        bannedReason: reason,
        bannedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Create comprehensive ban log for manual ban with all tracking data
    await createBanLog({
      bannedUserId: userId,
      bannedUserUid: user.personalCode || user.referralCode || undefined,
      ip: user.lastLoginIp || deviceInfo?.ip || undefined,
      deviceId: user.deviceId || deviceInfo?.deviceId || undefined,
      userAgent: user.lastLoginUserAgent || deviceInfo?.userAgent || undefined,
      fingerprint: user.deviceFingerprint || deviceInfo?.fingerprint || undefined,
      reason,
      banType: 'manual',
      bannedBy,
      telegramId: user.telegram_id || undefined,
      appVersion: (user as any)?.appVersion || undefined,
      browserFingerprint: (user as any)?.browserFingerprint || undefined,
      referrerUid: (user as any)?.referrerUid || undefined,
    });

    console.log(`✅ User ${userId} manually banned by ${bannedBy} for: ${reason}`);
  } catch (error) {
    console.error("Error manually banning user:", error);
    throw error;
  }
}

export async function sendWarningToMainAccount(
  primaryAccountId: string
): Promise<void> {
  console.log(`⏭️ Ban warning message disabled - skipping warning to account: ${primaryAccountId}`);
}

export async function detectSelfReferral(
  userId: string,
  referrerCode: string,
  deviceInfo?: DeviceInfo
): Promise<{
  isSelfReferral: boolean;
  shouldBan: boolean;
  referrerId?: string;
  reason?: string;
}> {
  try {
    const currentUser = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (currentUser.length === 0) {
      return { isSelfReferral: false, shouldBan: false };
    }

    const referrer = await db
      .select()
      .from(users)
      .where(eq(users.referralCode, referrerCode))
      .limit(1);

    if (referrer.length === 0) {
      return { isSelfReferral: false, shouldBan: false };
    }

    const currentDeviceId = currentUser[0].deviceId;
    const referrerDeviceId = referrer[0].deviceId;
    const currentIP = deviceInfo?.ip || currentUser[0].lastLoginIp;
    const referrerIP = referrer[0].lastLoginIp;

    // Check device ID match
    if (currentDeviceId && referrerDeviceId && currentDeviceId === referrerDeviceId) {
      return {
        isSelfReferral: true,
        shouldBan: true,
        referrerId: referrer[0].id,
        reason: "Self-referral detected: Same device ID as referrer"
      };
    }

    // Check IP match
    if (currentIP && referrerIP && currentIP === referrerIP) {
      return {
        isSelfReferral: true,
        shouldBan: true,
        referrerId: referrer[0].id,
        reason: "Self-referral detected: Same IP address as referrer"
      };
    }

    // Check browser fingerprint similarity
    const currentFingerprint = deviceInfo?.fingerprint || currentUser[0].deviceFingerprint;
    const referrerFingerprint = referrer[0].deviceFingerprint;

    if (currentFingerprint && referrerFingerprint) {
      const similarity = calculateFingerprintSimilarity(currentFingerprint, referrerFingerprint);
      if (similarity > 0.8) {
        return {
          isSelfReferral: true,
          shouldBan: true,
          referrerId: referrer[0].id,
          reason: `Self-referral detected: Similar browser fingerprint (${Math.round(similarity * 100)}% match)`
        };
      }
    }

    return { isSelfReferral: false, shouldBan: false };
  } catch (error) {
    console.error("Self-referral detection error:", error);
    return { isSelfReferral: false, shouldBan: false };
  }
}

function calculateFingerprintSimilarity(fp1: any, fp2: any): number {
  if (!fp1 || !fp2) return 0;
  
  const keys = ['userAgent', 'platform', 'language', 'screenResolution', 'timezone'];
  let matches = 0;
  let total = 0;

  for (const key of keys) {
    if (fp1[key] !== undefined && fp2[key] !== undefined) {
      total++;
      if (fp1[key] === fp2[key]) {
        matches++;
      }
    }
  }

  return total > 0 ? matches / total : 0;
}

export async function getBanLogs(limit: number = 50, filters?: {
  deviceId?: string;
  ip?: string;
  reason?: string;
  startDate?: Date;
  endDate?: Date;
  banType?: 'auto' | 'manual';
}): Promise<any[]> {
  try {
    let query = db
      .select()
      .from(banLogs)
      .orderBy(sql`${banLogs.createdAt} DESC`)
      .limit(limit);
    
    // Note: For now, filtering is done in-memory for simplicity
    // Production should use proper Drizzle where clauses
    const logs = await query;
    
    if (!filters) return logs;
    
    return logs.filter(log => {
      if (filters.deviceId && log.deviceId !== filters.deviceId) return false;
      if (filters.ip && log.ip !== filters.ip) return false;
      if (filters.reason && !log.reason?.toLowerCase().includes(filters.reason.toLowerCase())) return false;
      if (filters.banType && log.banType !== filters.banType) return false;
      if (filters.startDate && log.createdAt && new Date(log.createdAt) < filters.startDate) return false;
      if (filters.endDate && log.createdAt && new Date(log.createdAt) > filters.endDate) return false;
      return true;
    });
  } catch (error) {
    console.error("Error fetching ban logs:", error);
    return [];
  }
}

// Detect multi-account ad watching abuse
export async function detectAdWatchingAbuse(
  userId: string,
  deviceId: string,
  adId?: string
): Promise<{
  isAbuse: boolean;
  shouldBan: boolean;
  reason?: string;
  relatedAccountIds?: string[];
}> {
  try {
    if (await isAdminUser(userId)) {
      console.log(`✅ Admin account ${userId} - skipping ad watching abuse detection`);
      return { isAbuse: false, shouldBan: false };
    }

    if (!deviceId) {
      return { isAbuse: false, shouldBan: false };
    }

    // Find all users with the same device ID
    const usersWithSameDevice = await db
      .select()
      .from(users)
      .where(eq(users.deviceId, deviceId));

    if (usersWithSameDevice.length <= 1) {
      return { isAbuse: false, shouldBan: false };
    }

    // Check if multiple accounts are watching ads from the same device
    const activeAccountsWatchingAds = usersWithSameDevice.filter(
      u => (u.adsWatched || 0) > 0 && !u.banned
    );

    if (activeAccountsWatchingAds.length > 1) {
      // Multiple accounts on same device watching ads - this is abuse
      const currentUser = usersWithSameDevice.find(u => u.id === userId);
      const otherActiveAccounts = activeAccountsWatchingAds.filter(u => u.id !== userId);
      
      // Find the primary account (oldest or marked as primary)
      // Admin accounts are always considered primary and protected
      const adminAccount = usersWithSameDevice.find(u => 
        u.role === 'admin' || (ADMIN_TELEGRAM_ID && u.telegram_id === ADMIN_TELEGRAM_ID)
      );
      const primaryAccount = adminAccount || usersWithSameDevice.find(u => u.isPrimaryAccount === true) ||
        usersWithSameDevice.reduce((oldest, current) => {
          const oldestDate = oldest.createdAt ? new Date(oldest.createdAt) : new Date();
          const currentDate = current.createdAt ? new Date(current.createdAt) : new Date();
          return currentDate < oldestDate ? current : oldest;
        });

      // If current user is not the primary and not an admin, they should be banned
      if (currentUser && currentUser.id !== primaryAccount.id) {
        const isCurrentAdmin = currentUser.role === 'admin' || 
          (ADMIN_TELEGRAM_ID && currentUser.telegram_id === ADMIN_TELEGRAM_ID);
        
        if (isCurrentAdmin) {
          console.log(`🛡️ PROTECTED: Current user ${userId} is admin - not banning for multi-account`);
          return { isAbuse: false, shouldBan: false };
        }
        
        return {
          isAbuse: true,
          shouldBan: true,
          reason: "Multiple accounts detected watching ads from the same device. Only one account per device is allowed.",
          relatedAccountIds: usersWithSameDevice.filter(u => 
            u.role !== 'admin' && !(ADMIN_TELEGRAM_ID && u.telegram_id === ADMIN_TELEGRAM_ID)
          ).map(u => u.id)
        };
      }
    }

    return { isAbuse: false, shouldBan: false };
  } catch (error) {
    console.error("Ad watching abuse detection error:", error);
    return { isAbuse: false, shouldBan: false };
  }
}

// Get all banned users with full details for admin panel
export async function getBannedUsersWithDetails(): Promise<any[]> {
  try {
    const bannedUsers = await db
      .select()
      .from(users)
      .where(eq(users.banned, true))
      .orderBy(sql`${users.bannedAt} DESC`);
    
    // Enrich with ban log data
    const enrichedUsers = await Promise.all(
      bannedUsers.map(async (user) => {
        const banLog = await db
          .select()
          .from(banLogs)
          .where(eq(banLogs.bannedUserId, user.id))
          .orderBy(sql`${banLogs.createdAt} DESC`)
          .limit(1);
        
        return {
          ...user,
          banLog: banLog[0] || null
        };
      })
    );
    
    return enrichedUsers;
  } catch (error) {
    console.error("Error fetching banned users with details:", error);
    return [];
  }
}

// Unban a user and create an unban log entry
export async function unbanUser(userId: string, unbannedBy: string): Promise<boolean> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      console.error("User not found for unban:", userId);
      return false;
    }
    
    await db
      .update(users)
      .set({
        banned: false,
        bannedReason: null,
        bannedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    
    // Create an unban log entry
    await createBanLog({
      bannedUserId: userId,
      bannedUserUid: user.personalCode || user.referralCode || undefined,
      ip: user.lastLoginIp || undefined,
      deviceId: user.deviceId || undefined,
      reason: `Unbanned by admin`,
      banType: 'manual',
      bannedBy: unbannedBy,
      telegramId: user.telegram_id || undefined,
    });
    
    console.log(`✅ User ${userId} unbanned by ${unbannedBy}`);
    return true;
  } catch (error) {
    console.error("Error unbanning user:", error);
    return false;
  }
}
