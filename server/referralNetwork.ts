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

// ─── Referral Tree Builder ────────────────────────────────────────────────────

/**
 * Recursively build the referral tree for a user.
 * Returns null if user not found or on DB error (e.g. invalid UUID format).
 */
export async function buildReferralTree(
  userId: string,
  depth = 0,
  visited = new Set<string>(),
): Promise<ReferralNode | null> {
  if (!userId || visited.has(userId) || depth > 8) return null;
  visited.add(userId);

  let u: any;
  try {
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
    u = result.rows[0];
  } catch (err: any) {
    // Common cause: non-UUID search input → "invalid input syntax for type uuid"
    console.warn(`[referralNetwork] buildReferralTree(${userId}) DB error:`, err?.message);
    return null;
  }

  let childRows: any[] = [];
  try {
    const refResult = await pool.query(
      `SELECT referee_id FROM referrals WHERE referrer_id = $1`,
      [userId],
    );
    childRows = refResult.rows;
  } catch (err: any) {
    console.warn(`[referralNetwork] fetchChildren(${userId}) error:`, err?.message);
  }

  const children: ReferralNode[] = [];
  for (const ref of childRows) {
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
  try {
    const result = await pool.query(
      `SELECT referee_id FROM referrals WHERE referrer_id = $1`,
      [userId],
    );
    return result.rows.map((r: any) => r.referee_id);
  } catch (err: any) {
    console.warn(`[referralNetwork] getDirectReferrals(${userId}) error:`, err?.message);
    return [];
  }
}

// ─── Fraud Cluster Detector ───────────────────────────────────────────────────

export async function detectFraudClusters(userId: string): Promise<FraudCluster[]> {
  if (!userId) return [];

  let user: any;
  try {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    if (!row) return [];
    user = row;
  } catch (err: any) {
    console.warn(`[referralNetwork] detectFraudClusters user lookup error:`, err?.message);
    return [];
  }

  const clusters: FraudCluster[] = [];

  async function clusterFor(
    type: FraudCluster['clusterType'],
    column: string,
    value: string | null | undefined,
  ): Promise<void> {
    if (!value) return;
    try {
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
    } catch (err: any) {
      // A missing column (e.g. browser_fingerprint) should not abort all clusters
      console.warn(`[referralNetwork] clusterFor(${type}) error:`, err?.message);
    }
  }

  await Promise.allSettled([
    clusterFor('device',      'device_id',          (user as any).deviceId),
    clusterFor('ip',          'last_login_ip',       (user as any).lastLoginIp),
    clusterFor('fingerprint', 'browser_fingerprint', (user as any).browserFingerprint),
    clusterFor('wallet',      'ton_wallet_address',  (user as any).tonWalletAddress),
    clusterFor('telegram',    'telegram_id',         (user as any).telegram_id),
  ]);

  return clusters;
}

// ─── Moderation Log ───────────────────────────────────────────────────────────

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
    console.error('[referralNetwork] Failed to write moderation log:', err);
    // Non-critical — don't rethrow; the moderation action itself already succeeded
  }
}

// ─── Core Moderation Actions ──────────────────────────────────────────────────

export async function banUserFully(
  userId: string,
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string; affectedUsers: string[] }> {
  try {
    await db.execute(sql`
      UPDATE users SET
        banned         = true,
        banned_reason  = ${reason},
        rewards_frozen = true,
        updated_at     = NOW()
      WHERE id = ${userId}
    `);

    // Reject pending withdrawals
    try {
      await db.execute(sql`
        UPDATE withdrawals SET status = 'rejected', admin_notes = ${`Auto-rejected: account banned — ${reason}`}
        WHERE user_id = ${userId} AND LOWER(status) = 'pending'
      `);
    } catch (wErr: any) {
      console.warn('[referralNetwork] banUserFully withdrawal rejection error:', wErr?.message);
    }

    // Ban log
    try {
      await createBanLog({
        bannedUserId: userId, reason, adminId, banType: 'manual',
        metadata: { source: 'fraud_network', adminName },
      });
    } catch (logErr: any) {
      console.warn('[referralNetwork] banUserFully banLog error:', logErr?.message);
    }

    await logModerationAction({ adminId, adminName, targetUserId: userId, action: 'ban_user', reason, affectedUserIds: [userId] });
    return { success: true, message: `User ${userId} banned successfully`, affectedUsers: [userId] };
  } catch (err: any) {
    console.error('[referralNetwork] banUserFully error:', err);
    return { success: false, message: err?.message || 'Ban failed', affectedUsers: [] };
  }
}

export async function markUnderReview(
  userId: string,
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string; affectedUsers: string[] }> {
  try {
    await db.execute(sql`
      UPDATE users SET
        under_review   = true,
        review_reason  = ${reason},
        rewards_frozen = true,
        frozen_at      = NOW(),
        updated_at     = NOW()
      WHERE id = ${userId}
    `);
    await logModerationAction({ adminId, adminName, targetUserId: userId, action: 'mark_review', reason, affectedUserIds: [userId] });
    return { success: true, message: `User ${userId} marked under review`, affectedUsers: [userId] };
  } catch (err: any) {
    console.error('[referralNetwork] markUnderReview error:', err);
    return { success: false, message: err?.message || 'Failed', affectedUsers: [] };
  }
}

export async function banWithScope(
  userId: string,
  scope: 'direct' | 'network',
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string; bannedCount: number; reviewCount: number }> {
  try {
    // Ban the root user
    await db.execute(sql`
      UPDATE users SET banned = true, banned_reason = ${reason}, rewards_frozen = true, updated_at = NOW()
      WHERE id = ${userId}
    `);

    let reviewIds: string[] = [];

    if (scope === 'direct') {
      reviewIds = await getDirectReferrals(userId);
    } else {
      const tree = await buildReferralTree(userId);
      reviewIds = flattenTree(tree).filter(id => id !== userId);
    }

    // Mark referrals under review (don't auto-ban — policy requires admin review)
    for (const refId of reviewIds) {
      try {
        await db.execute(sql`
          UPDATE users SET under_review = true, review_reason = ${`Referred by banned user (${userId}): ${reason}`},
            rewards_frozen = true, frozen_at = NOW(), updated_at = NOW()
          WHERE id = ${refId} AND banned = false
        `);
      } catch (rErr: any) {
        console.warn(`[referralNetwork] banWithScope mark review(${refId}) error:`, rErr?.message);
      }
    }

    await logModerationAction({
      adminId, adminName, targetUserId: userId, action: `ban_${scope}`, scope, reason,
      affectedUserIds: [userId, ...reviewIds],
    });

    return { success: true, message: `Banned ${userId}, ${reviewIds.length} referrals marked under review`, bannedCount: 1, reviewCount: reviewIds.length };
  } catch (err: any) {
    console.error('[referralNetwork] banWithScope error:', err);
    return { success: false, message: err?.message || 'Failed', bannedCount: 0, reviewCount: 0 };
  }
}

export async function freezeUserRewards(
  userId: string,
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    await db.execute(sql`
      UPDATE users SET rewards_frozen = true, frozen_at = NOW(), updated_at = NOW()
      WHERE id = ${userId}
    `);
    await logModerationAction({ adminId, adminName, targetUserId: userId, action: 'freeze', reason, affectedUserIds: [userId] });
    return { success: true, message: `Rewards frozen for ${userId}` };
  } catch (err: any) {
    console.error('[referralNetwork] freezeUserRewards error:', err);
    return { success: false, message: err?.message || 'Failed' };
  }
}

export async function unfreezeUserRewards(
  userId: string,
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    await db.execute(sql`
      UPDATE users SET rewards_frozen = false, frozen_at = NULL, updated_at = NOW()
      WHERE id = ${userId}
    `);
    await logModerationAction({ adminId, adminName, targetUserId: userId, action: 'unfreeze', reason, affectedUserIds: [userId] });
    return { success: true, message: `Rewards unfrozen for ${userId}` };
  } catch (err: any) {
    console.error('[referralNetwork] unfreezeUserRewards error:', err);
    return { success: false, message: err?.message || 'Failed' };
  }
}

export async function removeReferralEarnings(
  userId: string,
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string; amountRemoved: string }> {
  try {
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(amount::numeric), 0) AS total
      FROM earnings
      WHERE user_id = ${userId} AND source IN ('referral_commission', 'referral', 'referral_commission_l2')
    `);
    const total = (result as any)?.rows?.[0]?.total ?? '0';

    await db.execute(sql`
      DELETE FROM earnings
      WHERE user_id = ${userId} AND source IN ('referral_commission', 'referral', 'referral_commission_l2')
    `);

    // Subtract from balance (don't go below 0)
    await db.execute(sql`
      UPDATE users SET
        balance    = GREATEST(0, COALESCE(balance::numeric, 0) - ${String(total)})::text,
        updated_at = NOW()
      WHERE id = ${userId}
    `);

    await logModerationAction({
      adminId, adminName, targetUserId: userId, action: 'remove_earnings', reason,
      affectedUserIds: [userId], metadata: { amountRemoved: total },
    });
    return { success: true, message: `Removed ${total} PAD referral earnings from ${userId}`, amountRemoved: String(total) };
  } catch (err: any) {
    console.error('[referralNetwork] removeReferralEarnings error:', err);
    return { success: false, message: err?.message || 'Failed', amountRemoved: '0' };
  }
}

export async function restoreAccount(
  userId: string,
  reason: string,
  adminId?: string,
  adminName?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    await db.execute(sql`
      UPDATE users SET
        banned         = false,
        banned_reason  = NULL,
        under_review   = false,
        review_reason  = NULL,
        rewards_frozen = false,
        frozen_at      = NULL,
        updated_at     = NOW()
      WHERE id = ${userId}
    `);
    await logModerationAction({ adminId, adminName, targetUserId: userId, action: 'restore', reason, affectedUserIds: [userId] });
    return { success: true, message: `Account ${userId} restored successfully` };
  } catch (err: any) {
    console.error('[referralNetwork] restoreAccount error:', err);
    return { success: false, message: err?.message || 'Failed' };
  }
}

// ─── analyzeNetwork ───────────────────────────────────────────────────────────

export async function analyzeNetwork(userId: string): Promise<NetworkAnalysis> {
  const empty: NetworkAnalysis = { rootUser: null, treeSize: 0, maxDepth: 0, bannedCount: 0, underReviewCount: 0, frozenCount: 0, clusters: [] };
  if (!userId) return empty;

  try {
    const [tree, clusters] = await Promise.all([
      buildReferralTree(userId),
      detectFraudClusters(userId),
    ]);

    const allNodes = collectNodes(tree);
    return {
      rootUser: tree,
      treeSize: allNodes.length,
      maxDepth: allNodes.reduce((m, n) => Math.max(m, n.depth), 0),
      bannedCount: allNodes.filter(n => n.banned).length,
      underReviewCount: allNodes.filter(n => n.underReview).length,
      frozenCount: allNodes.filter(n => n.rewardsFrozen).length,
      clusters,
    };
  } catch (err: any) {
    console.error('[referralNetwork] analyzeNetwork error:', err);
    return empty;
  }
}

function collectNodes(node: ReferralNode | null): ReferralNode[] {
  if (!node) return [];
  return [node, ...node.children.flatMap(collectNodes)];
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

export async function getReviewQueue(): Promise<any[]> {
  try {
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
  } catch (err: any) {
    console.error('[referralNetwork] getReviewQueue error:', err?.message);
    return [];
  }
}

export async function getModerationLogs(limit = 100, targetUserId?: string): Promise<any[]> {
  try {
    const baseQuery = targetUserId
      ? `SELECT * FROM moderation_logs WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT * FROM moderation_logs ORDER BY created_at DESC LIMIT $1`;
    const params = targetUserId ? [targetUserId, limit] : [limit];
    const result = await pool.query(baseQuery, params);
    return result.rows;
  } catch (err: any) {
    console.error('[referralNetwork] getModerationLogs error:', err?.message);
    return [];
  }
}
