/**
 * Anti-Fraud Referral Network System
 *
 * Handles:
 *  - Building full referral trees (direct + indirect)
 *  - Detecting fraud clusters (shared device/IP/fingerprint/wallet/telegram)
 *  - Scoped banning (user only | user+direct | full network)
 *  - Reward freezing and removal
 *  - Account restoration
 *  - Full moderation audit logging
 *
 * Philosophy: NEVER auto-ban innocent referrals. Default action is "Under Review".
 * Admin approval required for broader bans.
 */

import { db, pool } from "./db";
import { users, referrals, earnings, withdrawals, moderationLogs, banLogs } from "../shared/schema";
import { eq, sql, and, or, inArray, ne } from "drizzle-orm";
import { createBanLog } from "./deviceTracking";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReferralNode {
  userId: string;
  uid: string | null;
  username: string | null;
  telegramId: string | null;
  banned: boolean;
  underReview: boolean;
  rewardsFrozen: boolean;
  suspicionScore: number;
  balance: string;
  totalEarned: string;
  referralCount: number;
  deviceId: string | null;
  lastLoginIp: string | null;
  browserFingerprint: string | null;
  tonWalletAddress: string | null;
  registeredAt: string | null;
  children: ReferralNode[];
  depth: number;
}

export interface FraudCluster {
  clusterType: 'device' | 'ip' | 'fingerprint' | 'wallet' | 'telegram';
  sharedValue: string;
  userIds: string[];
  users: Array<{
    userId: string;
    uid: string | null;
    username: string | null;
    telegramId: string | null;
    banned: boolean;
    underReview: boolean;
  }>;
}

export interface NetworkAnalysis {
  rootUser: ReferralNode | null;
  treeSize: number;
  maxDepth: number;
  bannedCount: number;
  underReviewCount: number;
  frozenCount: number;
  clusters: FraudCluster[];
}

// ─── Referral Tree Builder ─────────────────────────────────────────────────────

/**
 * Recursively build the full referral tree for a given user.
 * Returns the tree rooted at userId, going down all levels.
 */
export async function buildReferralTree(
  userId: string,
  depth = 0,
  visited = new Set<string>(),
): Promise<ReferralNode | null> {
  if (visited.has(userId) || depth > 8) return null;
  visited.add(userId);

  // Fetch user data
  const result = await pool.query(
    `SELECT u.id, u.personal_code, u.username, u.telegram_id, u.banned, u.under_review,
            u.rewards_frozen, u.suspicion_score, u.balance, u.total_earned,
            u.device_id, u.last_login_ip, u.browser_fingerprint, u.ton_wallet_address,
            u.registered_at,
            (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id) AS referral_count
     FROM users u WHERE u.id = $1 LIMIT 1`,
    [userId],
  );
  if (!result.rows[0]) return null;

  const u = result.rows[0];

  // Fetch direct referrals (people this user referred)
  const refResult = await pool.query(
    `SELECT referee_id FROM referrals WHERE referrer_id = $1`,
    [userId],
  );

  const children: ReferralNode[] = [];
  for (const ref of refResult.rows) {
    const child = await buildReferralTree(ref.referee_id, depth + 1, visited);
    if (child) children.push(child);
  }

  return {
    userId: u.id,
    uid: u.personal_code,
    username: u.username,
    telegramId: u.telegram_id,
    banned: u.banned ?? false,
    underReview: u.under_review ?? false,
    rewardsFrozen: u.rewards_frozen ?? false,
    suspicionScore: u.suspicion_score ?? 0,
    balance: u.balance ?? '0',
    totalEarned: u.total_earned ?? '0',
    referralCount: parseInt(u.referral_count ?? '0'),
    deviceId: u.device_id,
    lastLoginIp: u.last_login_ip,
    browserFingerprint: u.browser_fingerprint,
    tonWalletAddress: u.ton_wallet_address,
    registeredAt: u.registered_at,
    children,
    depth,
  };
}

/** Flatten a referral tree into a list of all user IDs */
export function flattenTree(node: ReferralNode | null): string[] {
  if (!node) return [];
  return [node.userId, ...node.children.flatMap(flattenTree)];
}

/** Get only direct referrals of a user */
export async function getDirectReferrals(userId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT referee_id FROM referrals WHERE referrer_id = $1`,
    [userId],
  );
  return result.rows.map((r: any) => r.referee_id);
}

// ─── Fraud Cluster Detector ───────────────────────────────────────────────────

/**
 * Find all accounts sharing key signals with the target user.
 * Returns clusters grouped by signal type.
 */
export async function detectFraudClusters(userId: string): Promise<FraudCluster[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return [];

  const clusters: FraudCluster[] = [];

  // Helper to fetch users sharing a value
  async function clusterFor(
    type: FraudCluster['clusterType'],
    column: string,
    value: string | null | undefined,
  ): Promise<void> {
    if (!value) return;
    const res = await pool.query(
      `SELECT id, personal_code, username, telegram_id, banned, under_review
       FROM users WHERE ${column} = $1 AND id != $2`,
      [value, userId],
    );
    if (res.rows.length === 0) return;
    clusters.push({
      clusterType: type,
      sharedValue: value,
      userIds: res.rows.map((r: any) => r.id),
      users: res.rows.map((r: any) => ({
        userId: r.id,
        uid: r.personal_code,
        username: r.username,
        telegramId: r.telegram_id,
        banned: r.banned ?? false,
        underReview: r.under_review ?? false,
      })),
    });
  }

  await Promise.all([
    clusterFor('device', 'device_id', user.deviceId),
    clusterFor('ip', 'last_login_ip', user.lastLoginIp),
    clusterFor('fingerprint', 'browser_fingerprint', user.browserFingerprint),
    clusterFor('wallet', 'ton_wallet_address', user.tonWalletAddress),
    clusterFor('telegram', 'telegram_id', user.telegram_id),
  ]);

  return clusters;
}

// ─── Moderation Log ──────────────────────────────────────────────────────────

export async function logModerationAction(data: {
  adminId?: string;
  adminName?: string;
  targetUserId: string;
  action: string;
  scope?: string;
  reason: string;
  affectedUserIds?: string[];
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const targetUser = await pool.query(
      `SELECT personal_code FROM users WHERE id = $1 LIMIT 1`,
      [data.targetUserId],
    );
    const uid = targetUser.rows[0]?.personal_code ?? null;

    await db.insert(moderationLogs).values({
      adminId: data.adminId,
      adminName: data.adminName,
      targetUserId: data.targetUserId,
      targetUserUid: uid,
      action: data.action,
      scope: data.scope,
      reason: data.reason,
      affectedUserIds: (data.affectedUserIds ?? []) as any,
      metadata: (data.metadata ?? {}) as any,
    });
  } catch (err) {
    console.error('Failed to write moderation log:', err);
  }
}

// ─── Core Moderation Actions ──────────────────────────────────────────────────

/**
 * Permanently ban a single user account.
 * - Sets banned = true
 * - Freezes rewards
 * - Rejects pending withdrawals
 * - Blacklists device/fingerprint/IP via ban_log
 */
export async function banUserFully(
  targetUserId: string,
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, targetUserId));
    if (!user) return { success: false, error: 'User not found' };
    if ((user as any).role === 'admin') return { success: false, error: 'Cannot ban admin accounts' };

    // Ban + freeze
    await db.update(users)
      .set({
        banned: true,
        bannedReason: reason,
        bannedAt: new Date(),
        rewardsFrozen: true,
        frozenAt: new Date(),
        underReview: false,
        reviewReason: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, targetUserId));

    // Freeze pending withdrawals
    await pool.query(
      `UPDATE withdrawals SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE user_id = $2 AND status = 'pending'`,
      [`Account banned: ${reason}`, targetUserId],
    );

    // Ban log for device/IP blacklisting
    await createBanLog({
      bannedUserId: targetUserId,
      bannedUserUid: user.personalCode || user.referralCode || undefined,
      ip: user.lastLoginIp || undefined,
      deviceId: user.deviceId || undefined,
      userAgent: user.lastLoginUserAgent || undefined,
      fingerprint: user.deviceFingerprint || undefined,
      reason,
      banType: 'manual',
      bannedBy: adminId,
      telegramId: user.telegram_id || undefined,
      browserFingerprint: (user as any).browserFingerprint || undefined,
    });

    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: 'ban_user',
      scope: 'user',
      reason,
      affectedUserIds: [targetUserId],
    });

    console.log(`🚫 [Fraud] User ${targetUserId} permanently banned by ${adminId}: ${reason}`);
    return { success: true };
  } catch (err: any) {
    console.error('banUserFully error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Mark a user as "Under Review" — does NOT ban.
 * Freezes referral rewards until admin completes review.
 */
export async function markUnderReview(
  targetUserId: string,
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, targetUserId));
    if (!user) return { success: false, error: 'User not found' };

    await db.update(users)
      .set({
        underReview: true,
        reviewReason: reason,
        rewardsFrozen: true,
        frozenAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, targetUserId));

    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: 'mark_review',
      reason,
      affectedUserIds: [targetUserId],
    });

    console.log(`🔍 [Fraud] User ${targetUserId} marked Under Review by ${adminId}: ${reason}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Scoped ban: 'user' | 'direct' | 'network'
 *
 * - 'user'    → ban only the target
 * - 'direct'  → ban target + direct referrals
 * - 'network' → ban entire referral tree (all depths)
 *
 * Referrals are always marked "Under Review" first; only the root is permanently banned
 * unless scope = 'network' with explicit admin intent.
 */
export async function banWithScope(
  targetUserId: string,
  scope: 'user' | 'direct' | 'network',
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; bannedCount: number; reviewCount: number; error?: string }> {
  try {
    // Always ban the root user fully
    const rootResult = await banUserFully(targetUserId, reason, adminId, adminName);
    if (!rootResult.success) return { success: false, bannedCount: 0, reviewCount: 0, error: rootResult.error };

    let bannedCount = 1;
    let reviewCount = 0;
    const affectedIds: string[] = [targetUserId];

    if (scope === 'direct') {
      const directRefs = await getDirectReferrals(targetUserId);
      for (const refId of directRefs) {
        await markUnderReview(refId, `Direct referral of banned user (${reason})`, adminId, adminName);
        reviewCount++;
        affectedIds.push(refId);
      }
    } else if (scope === 'network') {
      const tree = await buildReferralTree(targetUserId);
      const allIds = flattenTree(tree).filter(id => id !== targetUserId);
      for (const refId of allIds) {
        // In network scope: mark ALL as under review, let admin decide per-user bans
        await markUnderReview(refId, `Part of fraud network (root: ${targetUserId}, reason: ${reason})`, adminId, adminName);
        reviewCount++;
        affectedIds.push(refId);
      }
    }

    // Log the full scoped action
    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: `ban_${scope}` as any,
      scope,
      reason,
      affectedUserIds: affectedIds,
      metadata: { bannedCount, reviewCount },
    });

    return { success: true, bannedCount, reviewCount };
  } catch (err: any) {
    return { success: false, bannedCount: 0, reviewCount: 0, error: err.message };
  }
}

/**
 * Freeze rewards for a user without banning them.
 */
export async function freezeUserRewards(
  targetUserId: string,
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.update(users)
      .set({
        rewardsFrozen: true,
        frozenAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, targetUserId));

    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: 'freeze',
      reason,
      affectedUserIds: [targetUserId],
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Unfreeze rewards.
 */
export async function unfreezeUserRewards(
  targetUserId: string,
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.update(users)
      .set({
        rewardsFrozen: false,
        frozenAt: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, targetUserId));

    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: 'unfreeze',
      reason,
      affectedUserIds: [targetUserId],
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Remove all referral earnings from a user.
 * Deducts referral-sourced balance and marks referral records as voided.
 */
export async function removeReferralEarnings(
  targetUserId: string,
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; removedAmount: number; error?: string }> {
  try {
    // Sum referral earnings
    const earningsRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM earnings
       WHERE user_id = $1 AND source IN ('referral', 'referral_bonus', 'referral_commission')`,
      [targetUserId],
    );
    const totalReferralEarnings = parseFloat(earningsRes.rows[0]?.total ?? '0');

    if (totalReferralEarnings > 0) {
      // Deduct balance (floor at 0)
      await pool.query(
        `UPDATE users SET balance = GREATEST(0, balance - $1), total_earned = GREATEST(0, total_earned - $1), updated_at = NOW() WHERE id = $2`,
        [totalReferralEarnings, targetUserId],
      );

      // Mark earning records as voided
      await pool.query(
        `UPDATE earnings SET source = 'referral_voided', description = COALESCE(description, '') || ' [voided: ${reason}]'
         WHERE user_id = $1 AND source IN ('referral', 'referral_bonus', 'referral_commission')`,
        [targetUserId],
      );
    }

    // Cancel pending referral records
    await pool.query(
      `UPDATE referrals SET status = 'voided' WHERE referrer_id = $1 AND status = 'pending'`,
      [targetUserId],
    );
    await pool.query(
      `UPDATE referrals SET status = 'voided' WHERE referee_id = $1 AND status = 'pending'`,
      [targetUserId],
    );

    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: 'remove_earnings',
      reason,
      affectedUserIds: [targetUserId],
      metadata: { removedAmount: totalReferralEarnings },
    });

    return { success: true, removedAmount: totalReferralEarnings };
  } catch (err: any) {
    return { success: false, removedAmount: 0, error: err.message };
  }
}

/**
 * Restore a reviewed/banned account to good standing.
 */
export async function restoreAccount(
  targetUserId: string,
  reason: string,
  adminId: string,
  adminName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.update(users)
      .set({
        banned: false,
        bannedReason: null,
        bannedAt: null,
        underReview: false,
        reviewReason: null,
        rewardsFrozen: false,
        frozenAt: null,
        flagged: false,
        flagReason: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, targetUserId));

    await logModerationAction({
      adminId,
      adminName,
      targetUserId,
      action: 'restore',
      reason,
      affectedUserIds: [targetUserId],
    });

    console.log(`✅ [Fraud] User ${targetUserId} restored by ${adminId}: ${reason}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Network Analysis ────────────────────────────────────────────────────────

/**
 * Full network analysis: build tree + detect clusters.
 */
export async function analyzeNetwork(userId: string): Promise<NetworkAnalysis> {
  const [tree, clusters] = await Promise.all([
    buildReferralTree(userId),
    detectFraudClusters(userId),
  ]);

  const allNodes = collectNodes(tree);
  const treeSize = allNodes.length;
  const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const bannedCount = allNodes.filter(n => n.banned).length;
  const underReviewCount = allNodes.filter(n => n.underReview).length;
  const frozenCount = allNodes.filter(n => n.rewardsFrozen).length;

  return { rootUser: tree, treeSize, maxDepth, bannedCount, underReviewCount, frozenCount, clusters };
}

function collectNodes(node: ReferralNode | null): ReferralNode[] {
  if (!node) return [];
  return [node, ...node.children.flatMap(collectNodes)];
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

export async function getReviewQueue(): Promise<any[]> {
  const result = await pool.query(
    `SELECT u.id, u.personal_code, u.username, u.telegram_id, u.balance, u.total_earned,
            u.review_reason, u.frozen_at, u.suspicion_score, u.referred_by,
            u.last_login_ip, u.device_id, u.created_at,
            (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id) AS referral_count,
            (SELECT COUNT(*) FROM referrals r WHERE r.referee_id = u.id) AS referred_by_count
     FROM users u
     WHERE u.under_review = true AND u.banned = false
     ORDER BY u.frozen_at DESC NULLS LAST, u.created_at DESC
     LIMIT 200`,
  );
  return result.rows;
}

export async function getModerationLogs(limit = 100, targetUserId?: string): Promise<any[]> {
  const baseQuery = targetUserId
    ? `SELECT * FROM moderation_logs WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT $2`
    : `SELECT * FROM moderation_logs ORDER BY created_at DESC LIMIT $1`;
  const params = targetUserId ? [targetUserId, limit] : [limit];
  const result = await pool.query(baseQuery, params);
  return result.rows;
}
