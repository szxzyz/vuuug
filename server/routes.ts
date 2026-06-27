import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from 'ws';
import { 
  insertEarningSchema, 
  users, 
  earnings, 
  referrals, 
  referralCommissions,
  withdrawals,
  userBalances,
  dailyTasks,
  promoCodes,
  transactions,
  adminSettings,
  advertiserTasks,
  taskClicks,
  spinData,
  spinHistory,
  dailyMissions,
  adminRoles,
  leaderboardSnapshots,
} from "../shared/schema";
import { db } from "./db";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import crypto from "crypto";
import { sendTelegramMessage, sendUserTelegramNotification, sendWelcomeMessage, handleTelegramMessage, setupTelegramWebhook, verifyChannelMembership, sendSharePhotoToChat, withdrawalAdminMessages } from "./telegram";
import { authenticateTelegram, requireAuth, optionalAuth } from "./auth";
import { isAuthenticated } from "./replitAuth";
import { config, getChannelConfig } from "./config";

// Store WebSocket connections for real-time updates
// Map: sessionId -> { socket: WebSocket, userId: string }
const connectedUsers = new Map<string, { socket: WebSocket; userId: string }>();

// ── Anti-Fake Ad Session Store ────────────────────────────────────────────────
const adUsedSessions  = new Map<string, number>();  // sessionId  → usedAt timestamp
const adUserCooldowns = new Map<string, number>();  // userId     → lastRewardAt (ms)
const adAbuseStore    = new Map<string, { score: number; lockedUntil: number; failCount: number }>();

const AD_REWARD_COOLDOWN_MS = 5000;   // 5 s between rewards
const AD_ABUSE_LOCK_SCORE   = 5;      // lock after 5 consecutive failures
const AD_ABUSE_BASE_LOCK_MS = 60_000; // 1 min base lock, doubles per extra level

// Prune stale anti-fraud maps every 15 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff15m = Date.now() - 15 * 60 * 1000;
  const cutoff1h  = Date.now() - 60 * 60 * 1000;
  // Remove sessions older than 15 min
  for (const [sid, ts] of adUsedSessions) if (ts < cutoff15m) adUsedSessions.delete(sid);
  // Remove cooldown entries older than 1 hour (user hasn't watched an ad in a while)
  for (const [uid, ts] of adUserCooldowns) if (ts < cutoff1h) adUserCooldowns.delete(uid);
  // Remove abuse entries where lock has expired and score is 0
  for (const [uid, abuse] of adAbuseStore) {
    if (abuse.lockedUntil < Date.now() && abuse.score === 0) adAbuseStore.delete(uid);
  }
}, 15 * 60 * 1000);
// ─────────────────────────────────────────────────────────────────────────────

// Function to verify session token against PostgreSQL sessions table
async function verifySessionToken(sessionToken: string): Promise<{ isValid: boolean; userId?: string }> {
  try {
    const { pool } = await import('./db');
    
    // Query the sessions table to find the session
    const result = await pool.query(
      'SELECT sess, expire FROM sessions WHERE sid = $1',
      [sessionToken]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ Session not found in database:', sessionToken);
      return { isValid: false };
    }
    
    const sessionRow = result.rows[0];
    const sessionData = sessionRow.sess;
    const expireTime = new Date(sessionRow.expire);
    
    // Check if session has expired
    if (expireTime <= new Date()) {
      console.log('❌ Session expired:', sessionToken);
      return { isValid: false };
    }
    
    // Extract user information from session data
    // Session data structure from connect-pg-simple typically contains passport user data
    let userId: string | undefined;
    
    if (sessionData && typeof sessionData === 'object') {
      // Try different possible session data structures
      if (sessionData.user && sessionData.user.user && sessionData.user.user.id) {
        // Structure: { user: { user: { id: "uuid", ... } } }
        userId = sessionData.user.user.id;
      } else if (sessionData.user && sessionData.user.id) {
        // Structure: { user: { id: "uuid", ... } }
        userId = sessionData.user.id;
      } else if (sessionData.passport && sessionData.passport.user) {
        // Structure: { passport: { user: "userId" } }
        userId = sessionData.passport.user;
      }
    }
    
    if (!userId) {
      console.log('❌ No user ID found in session data:', sessionToken);
      return { isValid: false };
    }
    
    console.log(`✅ Session verified for user: ${userId}`);
    return { isValid: true, userId };
    
  } catch (error) {
    console.error('❌ Session verification error:', error);
    return { isValid: false };
  }
}

// Helper function to send real-time updates to a user
function sendRealtimeUpdate(userId: string, update: any) {
  let messagesSent = 0;
  
  // Find ALL sessions for this user and send to each one
  for (const [sessionId, connection] of connectedUsers.entries()) {
    if (connection.userId === userId && connection.socket.readyState === WebSocket.OPEN) {
      try {
        connection.socket.send(JSON.stringify(update));
        messagesSent++;
        console.log(`📤 Sent update to user ${userId}, session ${sessionId}`);
      } catch (error) {
        console.error(`❌ Failed to send update to user ${userId}, session ${sessionId}:`, error);
        // Remove dead connection
        connectedUsers.delete(sessionId);
      }
    }
  }
  
  console.log(`📊 Sent real-time update to ${messagesSent} sessions for user ${userId}`);
  return messagesSent > 0;
}

// Broadcast update to all connected users
function broadcastUpdate(update: any) {
  let messagesSent = 0;
  connectedUsers.forEach((connection, sessionId) => {
    if (connection.socket.readyState === WebSocket.OPEN) {
      try {
        connection.socket.send(JSON.stringify(update));
        messagesSent++;
      } catch (error) {
        console.error(`❌ Failed to broadcast to session ${sessionId}:`, error);
        connectedUsers.delete(sessionId);
      }
    }
  });
  console.log(`📡 Broadcast sent to ${messagesSent} connected sessions`);
  return messagesSent;
}

// Super admin check — TELEGRAM_ADMIN_ID or SUPER_ADMIN_ID env var (the one true master admin)
const isSuperAdmin = (telegramId: string): boolean => {
  const superAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || '').trim();
  if (!superAdminId) return false;
  return telegramId.toString() === superAdminId;
};

// Check if user is admin — super admin first, then sub-admins from TELEGRAM_ADMIN_IDS
const isAdmin = (telegramId: string): boolean => {
  // Super admin always has access
  if (isSuperAdmin(telegramId)) return true;
  // Sub-admins added by super admin (TELEGRAM_ADMIN_IDS is a separate pool)
  const subAdminIds = (process.env.TELEGRAM_ADMIN_IDS || '').trim();
  if (!subAdminIds) {
    if (!process.env.TELEGRAM_ADMIN_ID && !process.env.SUPER_ADMIN_ID) {
      console.warn('⚠️ TELEGRAM_ADMIN_ID / SUPER_ADMIN_ID not set - admin access disabled');
    }
    return false;
  }
  const ids = subAdminIds.split(',').map(id => id.trim()).filter(Boolean);
  return ids.includes(telegramId.toString());
};

// Admin authentication middleware with optional signature verification
const authenticateAdmin = async (req: any, res: any, next: any) => {
  try {
    const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    // Development mode: Allow admin access for configured admin user
    if (process.env.NODE_ENV === 'development' && !telegramData) {
      const devAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || process.env.TELEGRAM_ADMIN_IDS || '123456789').split(',')[0].trim();
      console.log('🔧 Development mode: Granting admin access to dev admin');
      req.user = { 
        telegramUser: { 
          id: devAdminId,
          username: 'testuser',
          first_name: 'Test',
          last_name: 'Admin'
        } 
      };
      return next();
    }
    
    if (!telegramData) {
      console.log('❌ Admin auth failed: No Telegram data in request');
      return res.status(401).json({ message: "Admin access denied - no authentication data" });
    }

    // If bot token is available, verify the signature for security
    if (botToken) {
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: verifiedUser } = verifyTelegramWebAppData(telegramData, botToken);
      
      if (isValid && verifiedUser) {
        if (!isAdmin(verifiedUser.id.toString())) {
          // Also check DB-added admins (added via super admin panel)
          const [dbAdmin] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, verifiedUser.id.toString())).limit(1);
          if (!dbAdmin) {
            console.log(`❌ Admin auth denied: User ${verifiedUser.id} is not admin`);
            return res.status(403).json({ message: "Admin access required" });
          }
          console.log(`✅ Admin authenticated via DB role: ${verifiedUser.id}`);
        }
        console.log(`✅ Admin authenticated via signature: ${verifiedUser.id}`);
        req.user = { telegramUser: verifiedUser };
        return next();
      } else {
        console.log('⚠️ Admin auth: Telegram signature verification failed, checking for manual bypass/development');
      }
    }

    // Bypass for debugging or if TELEGRAM_ADMIN_ID is set but verification failed (security risk but helps debugging production)
    if (telegramData) {
      try {
        const urlParams = new URLSearchParams(telegramData);
        const userString = urlParams.get('user');
        if (userString) {
          const telegramUser = JSON.parse(userString);
          if (isAdmin(telegramUser.id.toString())) {
            console.log(`✅ Admin authenticated (BYPASS/PARSED): ${telegramUser.id}`);
            req.user = { telegramUser };
            return next();
          }
          // Also allow DB-added admins in bypass mode
          try {
            const [dbAdmin] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramUser.id.toString())).limit(1);
            if (dbAdmin) {
              console.log(`✅ Admin authenticated via DB role (BYPASS): ${telegramUser.id}`);
              req.user = { telegramUser };
              return next();
            }
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('Error parsing telegram data in bypass:', e);
      }
    }
  } catch (error) {
    console.error("Admin auth error:", error);
    res.status(401).json({ message: "Authentication failed" });
  }
};

// Authentication middleware has been moved to server/auth.ts for better organization

// All permissions available in the system
const ALL_PERMISSIONS = [
  'view_stats',
  'manage_users',
  'manage_withdrawals',
  'manage_tasks',
  'manage_settings',
  'manage_promos',
  'manage_admins',
  'manage_bans',
];

const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_PERMISSIONS,
  finance: ['view_stats', 'manage_withdrawals'],
  moderator: ['view_stats', 'manage_users', 'manage_bans'],
  content: ['view_stats', 'manage_tasks'],
};

// Get the role + permissions for an admin telegram ID
// TELEGRAM_ADMIN_ID / SUPER_ADMIN_ID always gets super_admin with ALL permissions
// TELEGRAM_ADMIN_IDS sub-admins get their DB-assigned role (or moderator by default)
// Check admin status including DB-added admins (async version used in API routes)
async function isAdminAsync(telegramId: string): Promise<boolean> {
  if (!telegramId) return false;
  if (isAdmin(telegramId)) return true;
  // Check DB-added admins
  try {
    const [record] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId)).limit(1);
    return !!record;
  } catch { return false; }
}

async function getAdminRole(telegramId: string): Promise<{ role: string; permissions: string[]; name: string } | null> {
  if (!telegramId) return null;

  // Super admin always gets full super_admin role regardless of DB
  if (isSuperAdmin(telegramId)) {
    try {
      const [record] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId)).limit(1);
      return { role: 'super_admin', permissions: ALL_PERMISSIONS, name: record?.name || 'Super Admin' };
    } catch { /* ignore */ }
    return { role: 'super_admin', permissions: ALL_PERMISSIONS, name: 'Super Admin' };
  }

  // Always check DB for assigned role/permissions (covers both env sub-admins and DB-added admins)
  try {
    const [record] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId)).limit(1);
    if (record) {
      let perms: string[] = [];
      try { perms = JSON.parse(record.permissions || '[]'); } catch { perms = ROLE_DEFAULT_PERMISSIONS[record.role] || []; }
      return { role: record.role, permissions: perms, name: record.name || 'Admin' };
    }
  } catch { /* no DB record */ }

  // Env-listed sub-admin with no DB record — default to moderator
  if (isAdmin(telegramId)) {
    return { role: 'moderator', permissions: ROLE_DEFAULT_PERMISSIONS['moderator'] || [], name: 'Admin' };
  }

  return null;
}

// Returns deduplicated Telegram IDs of all admins (super admin + env sub-admins + DB-added admins)
async function getAllAdminTelegramIds(): Promise<string[]> {
  const ids = new Set<string>();
  const superAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || '').trim();
  if (superAdminId) ids.add(superAdminId);
  const envSubAdmins = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  envSubAdmins.forEach(id => ids.add(id));
  try {
    const dbRecords = await db.select({ telegramId: adminRoles.telegramId }).from(adminRoles);
    dbRecords.forEach(r => { if (r.telegramId) ids.add(r.telegramId); });
  } catch { /* DB unavailable — fall back to env-only */ }
  return Array.from(ids);
}

export async function registerRoutes(app: Express): Promise<Server> {
  console.log('🔧 Registering API routes...');
  
  // Create HTTP server first
  const httpServer = createServer(app);
  
  // Set up WebSocket server for real-time updates  
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Helper function to broadcast to all connected clients
  const broadcastToAll = (message: object) => {
    const messageStr = JSON.stringify(message);
    wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  };
  
  wss.on('connection', (ws: WebSocket, req) => {
    console.log('🔌 New WebSocket connection established');
    let sessionId: string | null = null;
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle different message types
        if (data.type === 'auth') {
          if (!data.sessionToken) {
            console.log('❌ Missing sessionToken in auth message');
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Missing sessionToken. Expected format: {"type": "auth", "sessionToken": "<token>"}'
            }));
            return;
          }

          // Verify session token securely
          try {
            // In development mode ONLY, allow test user authentication
            if (process.env.NODE_ENV === 'development' && data.sessionToken === 'test-session') {
              const testUserId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
              sessionId = `session_${Date.now()}_${Math.random()}`;
              connectedUsers.set(sessionId, { socket: ws, userId: testUserId });
              console.log(`👤 Test user connected via WebSocket: ${testUserId}`);
              
              ws.send(JSON.stringify({
                type: 'connected',
                message: 'Real-time updates enabled! 🚀'
              }));
              return;
            }
            
            // Production mode: Verify session token against PostgreSQL sessions table
            const { isValid, userId } = await verifySessionToken(data.sessionToken);
            
            if (!isValid || !userId) {
              console.log(`❌ WebSocket authentication failed for token: ${data.sessionToken}`);
              ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid or expired session. Please refresh the page and try again.'
              }));
              return;
            }
            
            // Session verified successfully - establish WebSocket connection
            sessionId = `session_${Date.now()}_${Math.random()}`;
            connectedUsers.set(sessionId, { socket: ws, userId });
            console.log(`👤 User ${userId} connected via WebSocket (verified session)`);
            
            ws.send(JSON.stringify({
              type: 'connected',
              message: 'Real-time updates enabled! 🚀',
              userId: userId
            }));
          } catch (authError) {
            console.error('❌ WebSocket auth error:', authError);
            ws.send(JSON.stringify({
              type: 'auth_error', 
              message: 'Authentication failed'
            }));
          }
        } else if (data.type === 'ping') {
          // Handle ping messages
          ws.send(JSON.stringify({ type: 'pong' }));
        } else {
          // Handle invalid message types
          console.log(`❌ Invalid WebSocket message type: ${data.type || 'undefined'}`);
          ws.send(JSON.stringify({
            type: 'error',
            message: `Invalid message type. Expected "auth" but received "${data.type || 'undefined'}". Format: {"type": "auth", "sessionToken": "<token>"}`
          }));
        }
      } catch (error) {
        console.error('❌ WebSocket message parsing error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON format. Expected: {"type": "auth", "sessionToken": "<token>"}'
        }));
      }
    });
    
    ws.on('close', () => {
      // Remove session from connected list
      if (sessionId) {
        const connection = connectedUsers.get(sessionId);
        if (connection) {
          connectedUsers.delete(sessionId);
          console.log(`👋 User ${connection.userId} disconnected from WebSocket`);
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  });
  
  // Simple test route to verify routing works
  app.get('/api/test', (req: any, res) => {
    console.log('✅ Test route called!');
    res.json({ status: 'API routes working!', timestamp: new Date().toISOString() });
  });

  // Production health check endpoint - checks database connectivity and user count
  app.get('/api/health', async (req: any, res) => {
    try {
      const dbCheck = await db.select({ count: sql<number>`count(*)` }).from(users);
      const userCount = dbCheck[0]?.count || 0;
      
      const envCheck = {
        DATABASE_URL: !!process.env.DATABASE_URL,
        TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
        NODE_ENV: process.env.NODE_ENV || 'unknown'
      };
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          userCount
        },
        environment: envCheck,
        websockets: {
          activeConnections: connectedUsers.size
        }
      });
    } catch (error) {
      console.error('❌ Health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: error instanceof Error ? error.message : String(error)
        },
        environment: {
          DATABASE_URL: !!process.env.DATABASE_URL,
          NODE_ENV: process.env.NODE_ENV || 'unknown'
        }
      });
    }
  });

  // Get channel configuration for frontend
  app.get('/api/config/channel', (req: any, res) => {
    res.json(getChannelConfig());
  });

  // Secure check-membership endpoint for initial app load
  // Verifies Telegram initData signature before trusting user ID
  app.get('/api/check-membership', async (req: any, res) => {
    try {
      const isDevMode = process.env.NODE_ENV === 'development';
      const channelConfig = getChannelConfig();
      
      // In dev mode, skip verification to allow easy testing
      if (isDevMode) {
        console.log('🔧 Development mode: Skipping channel join check');
        return res.json({
          success: true,
          isVerified: true,
          channelMember: true,
          groupMember: true,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName
        });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        // SECURITY: Fail closed when bot token is missing
        console.log('❌ TELEGRAM_BOT_TOKEN not configured - blocking access');
        return res.json({ 
          success: false, 
          isVerified: false,
          channelMember: false,
          groupMember: false,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName,
          message: 'Bot token not configured'
        });
      }
      
      // Get Telegram initData from headers - this contains the cryptographic signature
      const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
      
      if (!telegramData) {
        console.log('⚠️ check-membership: No Telegram data provided - requiring auth');
        return res.json({ 
          success: false, 
          isVerified: false,
          channelMember: false,
          groupMember: false,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName,
          message: 'Authentication required'
        });
      }
      
      // SECURITY: Verify Telegram initData signature to prevent spoofing
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(telegramData, botToken);
      
      if (!isValid || !telegramUser || !telegramUser.id) {
        console.log('❌ check-membership: Invalid Telegram signature - blocking access');
        return res.json({ 
          success: false, 
          isVerified: false,
          channelMember: false,
          groupMember: false,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName,
          message: 'Invalid authentication signature'
        });
      }
      
      const telegramId = telegramUser.id.toString();
      const userId = parseInt(telegramId, 10);

      // 1. BAN CHECK FIRST
      const user = await storage.getUserByTelegramId(telegramId);
      if (user?.banned) {
        console.log(`🚫 Banned user ${telegramId} blocked at membership check`);
        return res.json({
          success: true,
          banned: true,
          reason: user.bannedReason,
          isVerified: true // Don't show join screen if banned
        });
      }

      // 2. ADMIN BYPASS — admins and already-verified users skip the Telegram API check
      if (isAdmin(telegramId)) {
        console.log(`✅ Admin ${telegramId} bypasses channel check`);
        if (user) await storage.updateUserVerificationStatus(user.id, true);
        return res.json({
          success: true,
          isVerified: true,
          channelMember: true,
          groupMember: true,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName
        });
      }

      // 3. ALREADY VERIFIED IN DB — skip live Telegram API call
      if (user?.isChannelGroupVerified) {
        console.log(`✅ User ${telegramId} already verified in DB — skipping live check`);
        return res.json({
          success: true,
          isVerified: true,
          channelMember: true,
          groupMember: true,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName
        });
      }

      // 4. CHANNEL/GROUP JOIN CHECK - verify with Telegram Bot API
      let channelMember = false;
      let groupMember = false;

      const { verifyChannelMembership } = await import('./telegram');

      try {
        channelMember = await verifyChannelMembership(userId, channelConfig.channelId, botToken);
      } catch (e) {
        // Fail open if bot cannot check (bot not admin, API error, etc.)
        console.log(`⚠️ check-membership: channel check failed for ${telegramId}, failing open:`, e);
        channelMember = true;
      }

      try {
        groupMember = await verifyChannelMembership(userId, channelConfig.groupId, botToken);
      } catch (e) {
        console.log(`⚠️ check-membership: group check failed for ${telegramId}, failing open:`, e);
        groupMember = true;
      }

      const isVerified = channelMember && groupMember;
      console.log(`🔍 check-membership for ${telegramId}: channel=${channelMember} group=${groupMember} verified=${isVerified}`);

      // Update user status in database when verified
      if (isVerified && user) {
        await storage.updateUserVerificationStatus(user.id, true);
      }

      res.json({
        success: true,
        isVerified,
        channelMember,
        groupMember,
        channelUrl: channelConfig.channelUrl,
        groupUrl: channelConfig.groupUrl,
        channelName: channelConfig.channelName,
        groupName: channelConfig.groupName
      });
    } catch (error) {
      console.error('❌ check-membership error:', error);
      const channelConfig = getChannelConfig();
      res.json({ 
        success: false, 
        isVerified: false,
        channelMember: false,
        groupMember: false,
        channelUrl: channelConfig.channelUrl,
        groupUrl: channelConfig.groupUrl,
        channelName: channelConfig.channelName,
        groupName: channelConfig.groupName,
        message: 'Failed to check membership'
      });
    }
  });

  // Mandatory channel/group membership check endpoint - authenticated
  app.get('/api/membership/check', authenticateTelegram, async (req: any, res) => {
    try {
      const isDevMode = process.env.NODE_ENV === 'development';
      const channelConfig = getChannelConfig();
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (isDevMode || !botToken) {
        return res.json({
          success: true,
          isVerified: true,
          channelMember: true,
          groupMember: true,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName
        });
      }

      const telegramUser = req.telegramUser;
      if (!telegramUser?.id) {
        return res.json({ success: false, isVerified: false, channelMember: false, groupMember: false, channelUrl: channelConfig.channelUrl, groupUrl: channelConfig.groupUrl, channelName: channelConfig.channelName, groupName: channelConfig.groupName });
      }

      const telegramIdStr = telegramUser.id.toString();
      const userId = parseInt(telegramIdStr, 10);
      const { storage: s } = await import('./storage');
      const dbUser = await s.getUserByTelegramId(telegramIdStr);

      // Admin bypass — always let admins through
      if (isAdmin(telegramIdStr)) {
        if (dbUser) await s.updateUserVerificationStatus(dbUser.id, true);
        return res.json({ success: true, isVerified: true, channelMember: true, groupMember: true, channelUrl: channelConfig.channelUrl, groupUrl: channelConfig.groupUrl, channelName: channelConfig.channelName, groupName: channelConfig.groupName });
      }

      // Already verified in DB — skip live Telegram API call
      if (dbUser?.isChannelGroupVerified) {
        return res.json({ success: true, isVerified: true, channelMember: true, groupMember: true, channelUrl: channelConfig.channelUrl, groupUrl: channelConfig.groupUrl, channelName: channelConfig.channelName, groupName: channelConfig.groupName });
      }

      const { verifyChannelMembership } = await import('./telegram');

      let channelMember = false;
      let groupMember = false;

      try {
        channelMember = await verifyChannelMembership(userId, channelConfig.channelId, botToken);
      } catch {
        channelMember = true; // fail open
      }

      try {
        groupMember = await verifyChannelMembership(userId, channelConfig.groupId, botToken);
      } catch {
        groupMember = true; // fail open
      }

      const isVerified = channelMember && groupMember;

      if (isVerified && dbUser) {
        await s.updateUserVerificationStatus(dbUser.id, true);
      }

      res.json({
        success: true,
        isVerified,
        channelMember,
        groupMember,
        channelUrl: channelConfig.channelUrl,
        groupUrl: channelConfig.groupUrl,
        channelName: channelConfig.channelName,
        groupName: channelConfig.groupName
      });
    } catch (error) {
      console.error('❌ Membership check error:', error);
      const channelConfig = getChannelConfig();
      res.json({ 
        success: false, 
        message: 'Failed to check membership',
        isVerified: true,
        channelMember: true,
        groupMember: true,
        channelUrl: channelConfig.channelUrl,
        groupUrl: channelConfig.groupUrl,
        channelName: channelConfig.channelName,
        groupName: channelConfig.groupName
      });
    }
  });

  // Update user language preference
  app.post('/api/user/language', authenticateTelegram, async (req: any, res) => {
    try {
      const { language } = req.body;
      const validLanguages = ['en', 'ru', 'ar'];
      if (!language || !validLanguages.includes(language)) {
        return res.status(400).json({ success: false, message: 'Invalid language' });
      }
      const telegramUser = req.telegramUser;
      if (telegramUser?.id) {
        const dbUser = await storage.getUserByTelegramId(telegramUser.id.toString());
        if (dbUser) {
          await storage.updateUserLanguage(dbUser.id, language);
        }
      }
      res.json({ success: true, language });
    } catch (error) {
      res.json({ success: true }); // Non-critical, don't fail
    }
  });

  // Debug route to check database columns
  app.get('/api/debug/db-schema', async (req: any, res) => {
    try {
      const { pool } = await import('./db');
      
      // Check what columns exist in users table
      const result = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
        ORDER BY ordinal_position;
      `);
      
      res.json({ 
        success: true, 
        columns: result.rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Schema check failed:', error);
      res.status(500).json({ 
        success: false, 
        error: (error as Error).message
      });
    }
  });

  // Removed deprecated manual database setup - use proper Drizzle migrations instead

  // Removed deprecated schema fix routes - use Drizzle migrations instead
  
  // Telegram Bot Webhook endpoint - MUST be first to avoid Vite catch-all interference
  app.post('/api/telegram/webhook', async (req: any, res) => {
    try {
      const update = req.body;
      console.log('📨 Received Telegram update:', JSON.stringify(update, null, 2));
      
      // Verify the request is from Telegram (optional but recommended)
      // You can add signature verification here if needed
      
      const handled = await handleTelegramMessage(update);
      console.log('✅ Message handled:', handled);
      
      if (handled) {
        res.status(200).json({ ok: true });
      } else {
        res.status(200).json({ ok: true, message: 'No action taken' });
      }
    } catch (error) {
      console.error('❌ Telegram webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Function to verify Telegram WebApp initData with HMAC-SHA256
  function verifyTelegramWebAppData(initData: string, botToken: string): { isValid: boolean; user?: any } {
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      
      if (!hash) {
        return { isValid: false };
      }
      
      // Remove hash from params for verification
      urlParams.delete('hash');
      
      // Sort parameters and create data check string
      const sortedParams = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      
      // Create secret key from bot token
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      
      // Calculate expected hash
      const expectedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');
      
      // Verify hash
      const isValid = expectedHash === hash;
      
      if (isValid) {
        const userString = urlParams.get('user');
        if (userString) {
          try {
            const user = JSON.parse(userString);
            return { isValid: true, user };
          } catch (parseError) {
            console.error('Error parsing user data:', parseError);
            return { isValid: false };
          }
        }
      }
      
      return { isValid };
    } catch (error) {
      console.error('Error verifying Telegram data:', error);
      return { isValid: false };
    }
  }

  // New Telegram WebApp authentication route
  app.post('/api/auth/telegram', async (req: any, res) => {
    try {
      const { initData, startParam } = req.body;
      
      const refererUrl = req.headers['referer'] || req.headers['referrer'] || '';
      console.log(`🔐 Auth request received - initData: ${initData ? 'YES' : 'NO'}, startParam: ${startParam || 'NONE'}, referer: ${refererUrl}`);
      
      let effectiveStartParam = startParam;
      if (!effectiveStartParam && refererUrl) {
        try {
          const refUrl = new URL(refererUrl);
          effectiveStartParam = refUrl.searchParams.get('startapp') || refUrl.searchParams.get('tgWebAppStartParam') || undefined;
          if (effectiveStartParam) {
            console.log(`📎 Extracted startParam from referer URL: ${effectiveStartParam}`);
          }
        } catch (e) {}
      }
      
      if (!initData) {
        console.log('⚠️ No initData provided - checking for cached user_id in headers');
        const cachedUserId = req.headers['x-user-id'];
        
        if (cachedUserId) {
          console.log('✅ Using cached user_id from headers:', cachedUserId);
          
          // NOTE: Late referral binding for existing users is intentionally disabled.
          // Referrals are only created when a brand-new account is registered via a ref link.
          // Allowing existing users to be bound post-join is a spam/cheating vector.
          return res.json({ success: true, user: cachedUserId, referralProcessed: false });
        }
        
        console.log('ℹ️ No cached user_id found - returning skipAuth response');
        return res.status(200).json({ success: true, skipAuth: true });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ message: 'Bot token not configured' });
      }
      
      // Verify the initData with HMAC-SHA256
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(initData, botToken);
      
      if (!isValid || !telegramUser) {
        return res.status(401).json({ message: 'Invalid Telegram authentication data' });
      }
      
      // Use upsertTelegramUser method which properly handles telegram_id
      const { user: upsertedUser, isNewUser } = await storage.upsertTelegramUser(telegramUser.id.toString(), {
        email: `${telegramUser.username || telegramUser.id}@telegram.user`,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        profileImageUrl: (telegramUser as any).photo_url || '',
        personalCode: telegramUser.username || telegramUser.id.toString(),
        withdrawBalance: '0',
        totalEarnings: '0',
        adsWatched: 0,
        dailyAdsWatched: 0,
        dailyEarnings: '0',
        level: 1,
        flagged: false,
        banned: false,
        referralCode: '',
      });
      
      // Process referral ONLY for brand-new users joining via a referral link.
      // Existing users clicking promo links must NOT be retroactively linked — that is a spam vector.
      let referralProcessed = false;
      const finalStartParam = effectiveStartParam || startParam;

      // Send welcome message to new users — include referral code so the Open App button keeps it
      if (isNewUser) {
        try {
          await sendWelcomeMessage(telegramUser.id.toString(), finalStartParam || undefined);
        } catch (welcomeError) {
          console.error('Error sending welcome message:', welcomeError);
          // Don't fail authentication if welcome message fails
        }
      }
      if (isNewUser && finalStartParam && finalStartParam !== telegramUser.id.toString()) {
        console.log(`🔄 Processing Mini App referral: referralCode=${finalStartParam}, user=${telegramUser.id}, isNewUser=${isNewUser}`);
        try {
          // First, find the referrer by referral code
          const referrer = await storage.getUserByReferralCode(finalStartParam);
          
          if (!referrer) {
            console.log(`❌ Invalid referral code from Mini App: ${finalStartParam}`);
          } else if (referrer.id === upsertedUser.id) {
            console.log(`⚠️ Self-referral prevented: ${upsertedUser.id}`);
          } else {
            // CANONICAL CHECK: Use referrals table as source of truth to check if referral exists
            const existingReferral = await storage.getReferralByUsers(referrer.id, upsertedUser.id);
            
            if (existingReferral) {
              console.log(`ℹ️ Referral already exists in referrals table: ${referrer.id} -> ${upsertedUser.id}`);
            } else {
              console.log(`👤 Found referrer via Mini App: ${referrer.id} (${referrer.firstName || 'No name'})`);
              await storage.createReferral(referrer.id, upsertedUser.id);
              console.log(`✅ Referral created via Mini App: ${referrer.id} -> ${upsertedUser.id}`);
              referralProcessed = true;
            }
          }
        } catch (referralError) {
          console.error('❌ Mini App referral processing failed:', referralError);
          // Don't fail authentication if referral processing fails
        }
      }
      
      res.json({ ...upsertedUser, referralProcessed });
    } catch (error) {
      console.error('Telegram authentication error:', error);
      res.status(500).json({ message: 'Authentication failed' });
    }
  });

  // Session token endpoint for WebSocket authentication
  app.get('/api/auth/session-token', authenticateTelegram, async (req: any, res) => {
    try {
      let sessionToken: string;
      
      // Development mode: Return predictable test token
      if (process.env.NODE_ENV === 'development' || process.env.REPL_ID) {
        sessionToken = 'test-session';
        console.log('🔧 Development mode: Returning test session token');
      } else {
        // Production mode: Always use Express session ID
        if (!req.sessionID) {
          console.error('❌ No session ID found - session not created properly');
          return res.status(500).json({ 
            message: 'Session not established',
            error: 'Express session not found'
          });
        }
        
        sessionToken = req.sessionID;
        console.log('🔐 Production mode: Using Express session ID for WebSocket auth:', sessionToken);
      }
      
      res.json({ 
        sessionToken,
        message: 'Session token generated successfully'
      });
    } catch (error) {
      console.error('❌ Error generating session token:', error);
      res.status(500).json({ 
        message: 'Failed to generate session token',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Auth routes
  app.get('/api/auth/user', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id; // Use the database UUID, not Telegram ID
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Ensure referralCode exists
      if (!user.referralCode) {
        await storage.generateReferralCode(userId);
        const updatedUser = await storage.getUser(userId);
        user.referralCode = updatedUser?.referralCode || '';
      }
      
      // Ensure friendsInvited is properly calculated from COMPLETED referrals only
      // Pending referrals (where friend hasn't watched their first ad) don't count
      // Also exclude banned users from referral count
      const actualReferralsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .innerJoin(users, eq(referrals.refereeId, users.id))
        .where(and(
          eq(referrals.referrerId, userId),
          eq(referrals.status, 'completed'),
          eq(users.banned, false)
        ));
      
      const friendsInvited = actualReferralsCount[0]?.count || 0;
      
      // Update DB if count is different (sync)
      if (user.friendsInvited !== friendsInvited) {
        await db
          .update(users)
          .set({ friendsInvited: friendsInvited })
          .where(eq(users.id, userId));
      }
      
      // Add referral link - bot username fetched live from Telegram Bot API
      const { getBotUsername } = await import('./telegram');
      const botUsername = await getBotUsername();
      const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
      
      res.json({
        ...user,
        friendsInvited,
        referralLink
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Balance refresh endpoint - used after conversion to sync frontend
  app.get('/api/user/balance/refresh', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Balance refresh requested without session - sending empty response');
        return res.json({ 
          success: true, 
          skipAuth: true, 
          balance: '0', 
          tonBalance: '0' 
        });
      }

      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      console.log(`🔄 Balance refresh for user ${userId}: POW=${user.balance}, TON=${user.tonBalance}`);
      
      res.json({
        success: true,
        balance: user.balance,
        tonBalance: user.tonBalance,
        powBalance: user.balance
      });
    } catch (error) {
      console.error("Error refreshing balance:", error);
      res.status(500).json({ message: "Failed to refresh balance" });
    }
  });

  // Bot info endpoint - returns real bot username from Telegram API
  app.get('/api/bot-info', async (req: any, res) => {
    try {
      const { getBotUsername } = await import('./telegram');
      const username = await getBotUsername();
      res.json({ username: username || 'PaidAdzbot' });
    } catch (error) {
      res.json({ username: process.env.TELEGRAM_BOT_TOKEN ? 'unknown' : 'PaidAdzbot' });
    }
  });

  // Get current app settings (public endpoint for frontend to fetch ad limits and all dynamic settings)
  app.get('/api/app-settings', async (req: any, res) => {
    try {
      // Fetch all admin settings at once
      const allSettings = await db.select().from(adminSettings);
      
      // Helper function to get setting value with default
      const getSetting = (key: string, defaultValue: string): string => {
        const setting = allSettings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };
      
      // Parse all settings with NEW defaults
      const dailyAdLimit = parseInt(getSetting('daily_ad_limit', '510'));
      const hourlyAdLimit = parseInt(getSetting('hourly_ad_limit', '63'));
      const rewardPerAd = parseInt(getSetting('reward_per_ad', '3000')); // Default 3000 POW per ad
      const seasonBroadcastActive = getSetting('season_broadcast_active', 'false') === 'true';
      const affiliateCommission = parseFloat(getSetting('affiliate_commission', '10'));
      const walletChangeFeePOW = parseInt(getSetting('wallet_change_fee', '100')); // Default 100 PAD
      const minimumWithdrawalUSD = parseFloat(getSetting('minimum_withdrawal_usd', '1.00')); // Minimum USD withdrawal
      const minimumWithdrawalTON = parseFloat(getSetting('minimum_withdrawal_ton', '0.5')); // Minimum TON withdrawal
      const withdrawalFeeTON = parseFloat(getSetting('withdrawal_fee_ton', '5')); // TON withdrawal fee %
      const withdrawalFeeUSD = parseFloat(getSetting('withdrawal_fee_usd', '3')); // USD withdrawal fee %
      
      // Separate channel and bot task costs (in USD for admin, TON for users)
      const channelTaskCostUSD = parseFloat(getSetting('channel_task_cost_usd', '0.003')); // Default $0.003 per click
      const botTaskCostUSD = parseFloat(getSetting('bot_task_cost_usd', '0.003')); // Default $0.003 per click
      
      // TON costs for regular users
      const channelTaskCostTON = parseFloat(getSetting('channel_task_cost_ton', '0.0003')); // Default 0.0003 TON per click
      const botTaskCostTON = parseFloat(getSetting('bot_task_cost_ton', '0.0003')); // Default 0.0003 TON per click
      
      // Separate channel and bot task rewards (in PAD)
      const channelTaskRewardPOW = parseInt(getSetting('channel_task_reward', '1000')); // Default 1000 POW per click
      const botTaskRewardPOW = parseInt(getSetting('bot_task_reward', '1000')); // Default 1000 POW per click
      
      // Currency conversion: 10,000,000 POW = 1 USD
      const padPerUsd = parseInt(getSetting('pad_per_usd', '10000000')); // Default 10M POW = 1 USD
      const minimumConvertPOW = parseInt(getSetting('minimum_convert_pad', '100')); // Default 100 PAD
      const minimumConvertUSD = minimumConvertPOW / padPerUsd; // Convert to USD
      
      // Minimum clicks for task creation
      const minimumClicks = parseInt(getSetting('minimum_clicks', '500')); // Default 500 clicks
      
      const withdrawalCurrency = getSetting('withdrawal_currency', 'TON');
      
      // Referral reward settings
      const referralRewardEnabled = getSetting('referral_reward_enabled', 'false') === 'true';
      const referralRewardUSD = parseFloat(getSetting('referral_reward_usd', '0.0005'));
      const referralRewardPOW = parseInt(getSetting('referral_reward_pad', '50'));
      const referralRewardPOWEnabled = getSetting('referral_reward_pad_enabled', 'true') === 'true';
      const referralRewardUSDEnabled = getSetting('referral_reward_usd_enabled', 'false') === 'true';
      const referralAdsRequired = parseInt(getSetting('referral_ads_required', '1')); // Ads needed for affiliate bonus
      const l1CommissionPercent = parseFloat(getSetting('l1_commission_percent', '20')); // Level 1: 20%
      const l2CommissionPercent = parseFloat(getSetting('l2_commission_percent', '4')); // Level 2: 4%
      
      // Daily task rewards (for TaskSection.tsx)
      const streakReward = parseInt(getSetting('streak_reward', '100')); // Daily streak claim reward in PAD
      const shareTaskReward = parseInt(getSetting('share_task_reward', '1000')); // Share with friends reward in PAD
      const communityTaskReward = parseInt(getSetting('community_task_reward', '1000')); // Join community reward in PAD
      
      // Partner task reward
      const partnerTaskReward = parseInt(getSetting('partner_task_reward', '1000')); // Partner task reward in PAD
      
      // Withdrawal requirement settings
      const withdrawalAdRequirementEnabled = getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true';
      const minimumAdsForWithdrawal = parseInt(getSetting('minimum_ads_for_withdrawal', '100'));
      const withdrawalInviteRequirementEnabled = getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true';
      const minimumInvitesForWithdrawal = parseInt(getSetting('minimum_invites_for_withdrawal', '3'));
      
      // BUG currency settings
      const minimumConvertPadToTon = parseInt(getSetting('minimum_convert_pad_to_ton', '10000'));
      const minimumConvertPowToStar = parseInt(getSetting('minimum_convert_pow_to_star', '1000'));
      const padToTonRate = parseInt(getSetting('pad_to_ton_rate', '10000000')); // 10M POW = 1 TON
      const powToStarRate = parseInt(getSetting('pow_to_star_rate', '1')); // 1 POW = 1 STAR
      const starRewardPerAd = parseInt(getSetting('star_reward_per_ad', '1')); // BUG per ad watched
      const starRewardPerTask = parseInt(getSetting('star_reward_per_task', '10')); // BUG per task completed
      const activePromoCode = getSetting('active_promo_code', ''); // Current active promo code
      
      // Legacy compatibility - keep old values for backwards compatibility
      const taskCostPerClick = channelTaskCostUSD; // Use channel cost as default
      const taskRewardPerClick = channelTaskRewardPOW / 10000000; // Legacy TON format for compatibility
      const minimumWithdrawal = minimumWithdrawalTON; // Legacy field
      
      res.json({
        dailyAdLimit,
        hourlyAdLimit,
        rewardPerAd,
        rewardPerAdPOW: rewardPerAd,
        seasonBroadcastActive,
        affiliateCommission,
        affiliateCommissionPercent: affiliateCommission,
        walletChangeFee: walletChangeFeePOW,
        walletChangeFeePOW,
        minimumWithdrawal,
        minimumWithdrawalUSD,
        minimumWithdrawalTON,
        withdrawalFeeTON,
        withdrawalFeeUSD,
        channelTaskCostUSD,
        botTaskCostUSD,
        channelTaskCostTON,
        botTaskCostTON,
        channelTaskRewardPOW,
        botTaskRewardPOW,
        taskCostPerClick,
        taskRewardPerClick,
        taskRewardPAD: channelTaskRewardPOW, // Use channel reward as default
        minimumConvert: minimumConvertUSD,
        minimumConvertPOW,
        minimumConvertUSD,
        minimumClicks,
        withdrawalCurrency,
        referralRewardEnabled,
        referralRewardUSD,
        referralRewardPOW,
        referralRewardPOWEnabled,
        referralRewardUSDEnabled,
        referralAdsRequired,
        l1CommissionPercent,
        l2CommissionPercent,
        // Daily task rewards
        streakReward,
        shareTaskReward,
        communityTaskReward,
        partnerTaskReward,
        channelTaskReward: channelTaskRewardPOW,
        botTaskReward: botTaskRewardPOW,
        // Withdrawal requirement settings
        withdrawalAdRequirementEnabled,
        minimumAdsForWithdrawal,
        withdrawalInviteRequirementEnabled,
        minimumInvitesForWithdrawal,
        // BUG currency settings
        minimumConvertPadToTon,
        minimumConvertPowToStar,
        padToTonRate,
        powToStarRate,
        starRewardPerAd,
        starRewardPerTask,
        activePromoCode,
        // Withdrawal packages (JSON array of {usd, bug} objects)
        withdrawalPackages: JSON.parse(getSetting('withdrawal_packages', '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]')),
        // Weekly giveaway
        weeklyGiveawayAmount: parseFloat(getSetting('weekly_giveaway_amount', '10')),
        // Mission page ad platform settings
        monetagMissionReward: parseInt(getSetting('monetag_mission_reward', '1000')),
        monetagMissionLimit: parseInt(getSetting('monetag_mission_limit', '25')),
        adexiumMissionReward: parseInt(getSetting('adexium_mission_reward', '1000')),
        adexiumMissionLimit: parseInt(getSetting('adexium_mission_limit', '25')),
        gigaPubMissionReward: parseInt(getSetting('giga_pub_mission_reward', '1000')),
        gigaPubMissionLimit: parseInt(getSetting('giga_pub_mission_limit', '25')),
        monetixMissionReward: parseInt(getSetting('monetix_mission_reward', '1000')),
        monetixMissionLimit: parseInt(getSetting('monetix_mission_limit', '25')),
        weeklyContestEndDate: getSetting('weekly_contest_end_date', ''),
        starsLocked: getSetting('stars_locked', 'false') === 'true',
      });
    } catch (error) {
      console.error("Error fetching app settings:", error);
      res.status(500).json({ message: "Failed to fetch app settings" });
    }
  });

  // Ad watching endpoint - configurable daily limit and reward amount
  app.post('/api/ads/watch', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      
      // Get user to check daily ad limit
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if user is banned
      if (user.banned) {
        return res.status(403).json({ 
          banned: true,
          message: "Your account has been banned due to suspicious multi-account activity",
          reason: user.bannedReason
        });
      }
      
      // Check for multi-account ad watching abuse (before processing reward)
      if (user.deviceId) {
        try {
          const { detectAdWatchingAbuse, banUserForMultipleAccounts } = await import('./deviceTracking');
          const abuseCheck = await detectAdWatchingAbuse(userId, user.deviceId);
          
          if (abuseCheck.isAbuse && abuseCheck.shouldBan) {
            // Ban the user for multi-account ad watching
            const deviceInfo = {
              deviceId: user.deviceId,
              ip: user.lastLoginIp || undefined,
              userAgent: user.lastLoginUserAgent || undefined,
              fingerprint: user.deviceFingerprint || undefined,
            };
            
            await banUserForMultipleAccounts(
              userId,
              abuseCheck.reason || "Multiple accounts detected watching ads from the same device",
              deviceInfo,
              abuseCheck.relatedAccountIds
            );
            
            return res.status(403).json({
              banned: true,
              message: "Your account has been banned due to suspicious multi-account activity",
              reason: abuseCheck.reason
            });
          }
        } catch (abuseError) {
          console.error("⚠️ Ad watching abuse detection failed (non-critical):", abuseError);
        }
      }

      // ── Anti-Fake Session Validation ──────────────────────────────────────
      const { sessionId, backgroundDuration, sessionStart } = req.body as {
        sessionId?: string;
        backgroundDuration?: number;
        sessionStart?: number;
      };
      const userKey = String(userId);
      const abuse   = adAbuseStore.get(userKey) || { score: 0, lockedUntil: 0, failCount: 0 };

      // 1. Session ID must be present and well-formed
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) {
        return res.status(400).json({
          message: "Invalid session. Please start a new ad session.",
          errorType: 'invalid_session',
        });
      }

      // 2. Replay attack — same session used twice
      if (adUsedSessions.has(sessionId)) {
        return res.status(400).json({
          message: "Session already used. Please watch a new ad.",
          errorType: 'duplicate_session',
        });
      }

      // 3. Abuse lock — too many failures
      if (abuse.lockedUntil > Date.now()) {
        const secsLeft = Math.ceil((abuse.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({
          message: `Too many failed attempts. Try again in ${secsLeft}s.`,
          errorType: 'abuse_lock',
          secsLeft,
        });
      }

      // 4. Cooldown between rewards
      const lastRewardAt       = adUserCooldowns.get(userKey) || 0;
      const cooldownRemaining  = AD_REWARD_COOLDOWN_MS - (Date.now() - lastRewardAt);
      if (cooldownRemaining > 0) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(cooldownRemaining / 1000)}s before watching another ad.`,
          errorType: 'cooldown',
          secsLeft: Math.ceil(cooldownRemaining / 1000),
        });
      }

      // 5. Log background duration (Adsgram SDK validates ad completion on its side)
      const bgDuration = typeof backgroundDuration === 'number' ? backgroundDuration : 0;
      const sessionAgeMs = typeof sessionStart === 'number' ? Date.now() - sessionStart : 0;
      console.log(`ℹ️ Ad session bg time for user ${userId}: ${bgDuration}ms (total: ${sessionAgeMs}ms)`);

      // ✅ All checks passed — mark session used, update cooldown, decay abuse score
      adUsedSessions.set(sessionId, Date.now());
      adUserCooldowns.set(userKey, Date.now());
      if (abuse.score > 0) {
        adAbuseStore.set(userKey, { ...abuse, score: Math.max(0, abuse.score - 0.5) });
      }
      console.log(`✅ Ad session valid for user ${userId}: bgDuration=${bgDuration}ms`);
      // ─────────────────────────────────────────────────────────────────────

      // Fetch admin settings for limits and reward amounts
      const dailyAdLimitSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'daily_ad_limit')).limit(1);
      const hourlyAdLimitSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'hourly_ad_limit')).limit(1);
      const rewardPerAdSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'reward_per_ad')).limit(1);
      const starRewardPerAdSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'star_reward_per_ad')).limit(1);
      
      const DAILY_AD_LIMIT = dailyAdLimitSetting[0]?.settingValue ? parseInt(dailyAdLimitSetting[0].settingValue) : 510;
      const HOURLY_AD_LIMIT = hourlyAdLimitSetting[0]?.settingValue ? parseInt(hourlyAdLimitSetting[0].settingValue) : 63;
      const rewardPerAdPOW = rewardPerAdSetting[0]?.settingValue ? parseInt(rewardPerAdSetting[0].settingValue) : 1000;
      const starRewardPerAd = starRewardPerAdSetting[0]?.settingValue ? parseInt(starRewardPerAdSetting[0].settingValue) : 1;

      // Hourly refill logic: 63 ads/hour, 510 ads/day
      const now = new Date();
      const adsWatchedToday = user.adsWatchedToday || 0;
      const hourlyAdsWatched = (user as any).hourlyAdsWatched || 0;
      const lastHourlyReset = (user as any).lastHourlyReset ? new Date((user as any).lastHourlyReset) : new Date(0);

      const hoursSinceReset = (now.getTime() - lastHourlyReset.getTime()) / (1000 * 60 * 60);
      const needsHourlyReset = hoursSinceReset >= 1;
      const currentHourlyWatched = needsHourlyReset ? 0 : hourlyAdsWatched;

      // Check daily limit first
      if (adsWatchedToday >= DAILY_AD_LIMIT) {
        return res.status(429).json({ 
          message: `Daily limit reached (${DAILY_AD_LIMIT} ads/day). Come back tomorrow.`,
          limit: DAILY_AD_LIMIT,
          watched: adsWatchedToday,
          limitType: 'daily'
        });
      }

      // Check hourly limit
      if (currentHourlyWatched >= HOURLY_AD_LIMIT) {
        const nextRefillAt = new Date(lastHourlyReset.getTime() + 60 * 60 * 1000);
        const minsUntilRefill = Math.ceil((nextRefillAt.getTime() - now.getTime()) / 60000);
        return res.status(429).json({
          message: `Hourly limit reached (${HOURLY_AD_LIMIT} ads/hour). Refills in ${minsUntilRefill} min.`,
          hourlyLimit: HOURLY_AD_LIMIT,
          hourlyWatched: currentHourlyWatched,
          limitType: 'hourly',
          nextRefillAt: nextRefillAt.toISOString(),
          minsUntilRefill,
        });
      }
      
      // PAD reward amount (no conversion needed - store PAD directly)
      const adRewardPOW = rewardPerAdPOW;
      
      try {
        // Process reward with error handling to ensure success response
        // Capture the earning so we can reference its ID for referral commission tracking
        const adWatchEarning = await storage.addEarning({
          userId,
          amount: String(adRewardPOW),
          source: 'ad_watch',
          description: 'Watched advertisement',
        });
        
        // Increment ads watched count (daily)
        await storage.incrementAdsWatched(userId);

        // Update hourly counter
        await db
          .update(users)
          .set({
            hourlyAdsWatched: currentHourlyWatched + 1,
            lastHourlyReset: needsHourlyReset ? now : lastHourlyReset,
          } as any)
          .where(eq(users.id, userId));
        
        // Add STAR reward to weekly_stars ONLY (2 stars per ad, no permanent star_balance update)
        // Skip if stars are locked (contest ended, waiting for 07:30 UTC reset)
        const starsLockedSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'stars_locked')).limit(1);
        const starsLocked = starsLockedSetting[0]?.settingValue === 'true';
        if (starRewardPerAd > 0 && !starsLocked) {
          const currentWeek = getISOWeek();
          const userWeekStarWeek = (user as any).weeklyStarWeek;
          const weeklyReset = userWeekStarWeek !== currentWeek;
          await db.execute(sql`
            UPDATE users SET
              weekly_stars     = CASE WHEN ${weeklyReset} THEN ${starRewardPerAd}
                                      ELSE COALESCE(weekly_stars, 0) + ${starRewardPerAd} END,
              weekly_star_week = ${currentWeek},
              updated_at       = NOW()
            WHERE id = ${userId}
          `);
          console.log(`⭐ Ad watch: +${starRewardPerAd} STAR (weekly only) for ${userId}`);
        } else if (starsLocked) {
          console.log(`🔒 Star earning locked for ${userId} — contest ended, waiting for Sunday midnight IST reset`);
        }
        
        // Check and activate referral bonuses
        try {
          const activatedReferrerIds = await storage.checkAndActivateReferralBonus(userId);
          // Push live balance update to any referrer who just received the USD signup bonus
          for (const referrerId of activatedReferrerIds) {
            try {
              const referrerData = await storage.getUser(referrerId);
              sendRealtimeUpdate(referrerId, {
                type: 'balance_update',
                balance: referrerData?.balance,
                withdrawBalance: referrerData?.withdrawBalance,
                usdBalance: referrerData?.usdBalance,
                totalEarnings: referrerData?.totalEarnings,
                starBalance: Number(referrerData?.starBalance || 0),
              });
            } catch (_) {}
          }
        } catch (bonusError) {
          console.error("⚠️ Referral bonus processing failed (non-critical):", bonusError);
        }
        
        // Process 2-level referral commission (configurable from admin settings)
        if (user.referredBy) {
          try {
            const l1Setting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'l1_commission_percent')).limit(1);
            const l2Setting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'l2_commission_percent')).limit(1);
            const l1Rate = l1Setting[0]?.settingValue ? parseFloat(l1Setting[0].settingValue) / 100 : 0.20;
            const l2Rate = l2Setting[0]?.settingValue ? parseFloat(l2Setting[0].settingValue) / 100 : 0.04;

            // L1 referrer — the person who directly invited this user (stored as referral code)
            const l1Referrer = await storage.getUserByReferralCode(user.referredBy);
            if (l1Referrer) {
              // Use Math.ceil and ensure minimum 1 PAD commission so small rewards never round to 0
              const l1CommissionPOW = Math.max(1, Math.ceil(adRewardPOW * l1Rate));
              const l1RateDisplay = Math.round(l1Rate * 100);
              const l1Earning = await storage.addEarning({
                userId: l1Referrer.id,
                amount: String(l1CommissionPOW),
                source: 'referral_commission',
                description: `${l1RateDisplay}% L1 commission from ${user.username || user.telegram_id}'s ad watch`,
              });
              // Store in referralCommissions table for audit trail and affiliate statistics
              try {
                await db.insert(referralCommissions).values({
                  referrerId: l1Referrer.id,
                  referredUserId: userId,
                  originalEarningId: adWatchEarning.id,
                  commissionAmount: String(l1CommissionPOW),
                });
              } catch (rcErr) {
                console.warn('⚠️ referralCommissions insert failed (non-critical):', rcErr);
              }
              console.log(`💰 L1 commission: ${l1CommissionPOW} POW (${l1RateDisplay}%) → ${l1Referrer.id}`);
              // Push live balance update to L1 referrer's open session
              try {
                const l1Updated = await storage.getUser(l1Referrer.id);
                sendRealtimeUpdate(l1Referrer.id, {
                  type: 'balance_update',
                  balance: l1Updated?.balance,
                  withdrawBalance: l1Updated?.withdrawBalance,
                  usdBalance: l1Updated?.usdBalance,
                  totalEarnings: l1Updated?.totalEarnings,
                });
              } catch (_) {}

              // L2 referrer — the person who invited the L1 referrer
              if (l1Referrer.referredBy) {
                try {
                  const l2Referrer = await storage.getUserByReferralCode(l1Referrer.referredBy);
                  if (l2Referrer) {
                    const l2CommissionPOW = Math.max(1, Math.ceil(adRewardPOW * l2Rate));
                    const l2RateDisplay = Math.round(l2Rate * 100);
                    await storage.addEarning({
                      userId: l2Referrer.id,
                      amount: String(l2CommissionPOW),
                      source: 'referral_commission_l2',
                      description: `${l2RateDisplay}% L2 commission from ${user.username || user.telegram_id}'s ad watch`,
                    });
                    // Store L2 in referralCommissions table
                    try {
                      await db.insert(referralCommissions).values({
                        referrerId: l2Referrer.id,
                        referredUserId: userId,
                        originalEarningId: adWatchEarning.id,
                        commissionAmount: String(l2CommissionPOW),
                      });
                    } catch (rc2Err) {
                      console.warn('⚠️ L2 referralCommissions insert failed (non-critical):', rc2Err);
                    }
                    console.log(`💰 L2 commission: ${l2CommissionPOW} POW → ${l2Referrer.id}`);
                    // Push live balance update to L2 referrer
                    try {
                      const l2Updated = await storage.getUser(l2Referrer.id);
                      sendRealtimeUpdate(l2Referrer.id, {
                        type: 'balance_update',
                        balance: l2Updated?.balance,
                        withdrawBalance: l2Updated?.withdrawBalance,
                        usdBalance: l2Updated?.usdBalance,
                        totalEarnings: l2Updated?.totalEarnings,
                      });
                    } catch (_) {}
                  }
                } catch (l2Error) {
                  console.error("⚠️ L2 commission failed (non-critical):", l2Error);
                }
              }
            } else {
              // L1 referrer not found — log warning but do NOT clear the referral link
              // (referrer may be temporarily unavailable; clearing is irreversible)
              console.warn(`⚠️ L1 referrer with code ${user.referredBy} not found for user ${userId} — skipping commission this ad`);
            }
          } catch (commissionError) {
            console.error("⚠️ Referral commission processing failed (non-critical):", commissionError);
          }
        }
      } catch (earningError) {
        console.error("❌ Critical error adding earning:", earningError);
        // Even if earning fails, still try to return success to avoid user-facing errors
        // The ad was watched, so we should acknowledge it
      }
      
      // Get updated balance (with fallback)
      let updatedUser = await storage.getUser(userId);
      if (!updatedUser) {
        updatedUser = user; // Fallback to original user data
      }
      const newAdsWatched = updatedUser?.adsWatchedToday || (adsWatchedToday + 1);
      
      // Send real-time update to user (non-blocking) — include starBalance so header refreshes
      try {
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: updatedUser?.balance,
          usdBalance: updatedUser?.usdBalance,
          starBalance: Number(updatedUser?.starBalance || 0),
          weeklyStars: Number((updatedUser as any)?.weeklyStars || 0),
          amount: adRewardPOW.toString(),
          message: 'Ad reward earned!',
          timestamp: new Date().toISOString()
        });
      } catch (wsError) {
        // WebSocket errors should not affect the response
        console.error("⚠️ WebSocket update failed (non-critical):", wsError);
      }
      
      // ALWAYS return success response to ensure reward notification shows
      res.json({ 
        success: true, 
        rewardPOW: adRewardPOW,
        rewardSTAR: starRewardPerAd,
        newBalance: updatedUser?.balance || user.balance || "0",
        newStarBalance: updatedUser?.starBalance || "0",
        newWeeklyStars: Number((updatedUser as any)?.weeklyStars || 0),
        adsWatchedToday: newAdsWatched
      });
    } catch (error) {
      console.error("❌ Unexpected error in ad watch endpoint:", error);
      console.error("   Error details:", error instanceof Error ? error.message : String(error));
      console.error("   Stack trace:", error instanceof Error ? error.stack : 'N/A');
      
      // Return success anyway to prevent error notification from showing
      // The user watched the ad, so we should acknowledge it
      const adRewardPOW = Math.round(parseFloat("0.00010000") * 10000000);
      res.json({ 
        success: true, 
        rewardPOW: adRewardPOW,
        newBalance: "0",
        adsWatchedToday: 0,
        warning: "Reward processing encountered an issue but was acknowledged"
      });
    }
  });

  // Daily Activity Bonus endpoints
  const DAILY_BONUS_MILESTONES = [
    { ads: 100, starReward: 100,  usdReward: null  },
    { ads: 200, starReward: 500,  usdReward: null  },
    { ads: 300, starReward: 1000, usdReward: null  },
    { ads: 400, starReward: null, usdReward: 0.05  },
    { ads: 500, starReward: null, usdReward: 0.10  },
  ];

  function getISOWeek(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
    const week = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  function getDailyResetDateStr(): string {
    const now = new Date();
    // Reset at 18:30 UTC = 12:00 AM IST — before that, still "yesterday"
    if (now.getUTCHours() < 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() < 30)) {
      const prev = new Date(now);
      prev.setUTCDate(prev.getUTCDate() - 1);
      return prev.toISOString().split('T')[0];
    }
    return now.toISOString().split('T')[0];
  }

  app.get('/api/daily-bonus/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const adsWatchedToday = user.adsWatchedToday || 0;
      const today = getDailyResetDateStr();

      // Get which milestones were already claimed today
      const claimedRows = await db.select({ missionType: dailyMissions.missionType })
        .from(dailyMissions)
        .where(
          and(
            eq(dailyMissions.userId, String(userId)),
            eq(dailyMissions.resetDate, today),
            sql`${dailyMissions.missionType} LIKE 'ad_milestone_%'`
          )
        );
      const claimedIndices: number[] = claimedRows.map(r => parseInt(r.missionType.replace('ad_milestone_', ''))).filter(n => !isNaN(n));

      // Next claimable = lowest unclaimed milestone the user qualifies for
      let nextClaimableIndex = -1;
      for (let i = 0; i < DAILY_BONUS_MILESTONES.length; i++) {
        if (adsWatchedToday >= DAILY_BONUS_MILESTONES[i].ads && !claimedIndices.includes(i)) {
          nextClaimableIndex = i;
          break;
        }
      }

      // Calculate exact next reset time: 18:30 UTC = 12:00 AM IST
      const now = new Date();
      const nextReset = new Date();
      nextReset.setUTCHours(18, 30, 0, 0);
      if (now.getUTCHours() > 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() >= 30)) {
        nextReset.setUTCDate(nextReset.getUTCDate() + 1);
      }

      res.json({
        adsWatchedToday,
        milestones: DAILY_BONUS_MILESTONES,
        currentMilestoneIndex: nextClaimableIndex,
        currentBonus: nextClaimableIndex >= 0 ? DAILY_BONUS_MILESTONES[nextClaimableIndex] : null,
        claimedMilestones: claimedIndices,
        claimedToday: claimedIndices.length > 0,
        canUpgrade: false,
        nextResetAt: nextReset.toISOString(),
        resetHourUTC: 18,
      });
    } catch (error) {
      console.error('Daily bonus status error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/daily-bonus/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const adsWatchedToday = user.adsWatchedToday || 0;
      const today = getDailyResetDateStr();
      const currentWeek = getISOWeek();

      // Get which milestones were already claimed today
      const claimedRows = await db.select({ missionType: dailyMissions.missionType })
        .from(dailyMissions)
        .where(
          and(
            eq(dailyMissions.userId, String(userId)),
            eq(dailyMissions.resetDate, today),
            sql`${dailyMissions.missionType} LIKE 'ad_milestone_%'`
          )
        );
      const claimedIndices = new Set<number>(
        claimedRows.map(r => parseInt(r.missionType.replace('ad_milestone_', ''))).filter(n => !isNaN(n))
      );

      // Find the LOWEST unclaimed milestone the user qualifies for (must claim in order)
      let milestoneIndex = -1;
      for (let i = 0; i < DAILY_BONUS_MILESTONES.length; i++) {
        if (adsWatchedToday >= DAILY_BONUS_MILESTONES[i].ads && !claimedIndices.has(i)) {
          milestoneIndex = i;
          break;
        }
      }

      if (milestoneIndex < 0) {
        // Check whether user hasn't reached any milestone vs all claimed
        const anyReached = DAILY_BONUS_MILESTONES.some(m => adsWatchedToday >= m.ads);
        if (!anyReached) {
          return res.status(400).json({ message: 'No milestone reached yet', noMilestone: true });
        }
        return res.status(400).json({ message: 'All reached milestones already claimed today', alreadyClaimed: true });
      }

      const milestone = DAILY_BONUS_MILESTONES[milestoneIndex];

      // STEP 1: Atomically claim the milestone slot FIRST (prevents race condition / double-claim)
      // ON CONFLICT means another concurrent request already claimed it — return error immediately
      const inserted = await db.insert(dailyMissions).values({
        userId: String(userId),
        missionType: `ad_milestone_${milestoneIndex}`,
        completed: true,
        claimedAt: new Date(),
        resetDate: today,
        createdAt: new Date(),
      }).onConflictDoNothing().returning({ id: dailyMissions.id });

      if (inserted.length === 0) {
        // Slot was already taken — another request beat us to it
        return res.status(400).json({ message: 'Milestone already claimed', alreadyClaimed: true });
      }

      // STEP 2: Give the reward (safe — slot is already locked above)
      if (milestone.starReward) {
        // Check stars_locked — no stars while contest is paused
        const starsLockedRow = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'stars_locked')).limit(1);
        const milestoneStarsLocked = starsLockedRow[0]?.settingValue === 'true';
        if (!milestoneStarsLocked) {
          const starsToAdd = milestone.starReward;
          const freshUser = await storage.getUser(userId);
          const userWeek = (freshUser as any)?.weeklyStarWeek;
          const weeklyReset = userWeek !== currentWeek;
          await db.execute(sql`
            UPDATE users SET
              weekly_stars     = CASE WHEN ${weeklyReset} THEN ${starsToAdd}
                                     ELSE COALESCE(weekly_stars, 0) + ${starsToAdd} END,
              weekly_star_week = ${currentWeek},
              updated_at       = NOW()
            WHERE id = ${userId}
          `);
          console.log(`⭐ Milestone ${milestoneIndex} (${milestone.ads} ads): +${starsToAdd} STAR (weekly only) for ${userId}`);
        } else {
          console.log(`🔒 Milestone star reward skipped for ${userId} — contest ended, waiting for Monday 12 AM IST reset`);
        }
      } else if (milestone.usdReward) {
        // Credit USD directly to usd_balance — do NOT convert to PAD
        await db
          .update(users)
          .set({
            usdBalance: sql`COALESCE(${users.usdBalance}, 0) + ${milestone.usdReward}`,
            totalEarned: sql`COALESCE(${users.totalEarned}, 0) + ${String(milestone.usdReward)}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
        // Log transaction for audit trail
        await db.insert(transactions).values({
          userId,
          amount: String(milestone.usdReward),
          type: 'addition',
          source: 'daily_bonus_usd',
          description: `Daily activity bonus: $${milestone.usdReward} (${milestone.ads} ads milestone)`,
          metadata: { rewardType: 'USD', milestone: milestoneIndex, adsRequired: milestone.ads },
          createdAt: new Date(),
        });
        console.log(`💰 Milestone ${milestoneIndex} (${milestone.ads} ads): +$${milestone.usdReward} USD credited to usd_balance for ${userId}`);
      }

      // STEP 3: Update last_bonus_claimed_index to highest claimed (keeps legacy column in sync)
      try {
        await db.execute(sql`
          UPDATE users
          SET last_bonus_claimed_index = GREATEST(COALESCE(last_bonus_claimed_index, -1), ${milestoneIndex}),
              updated_at = NOW()
          WHERE id = ${userId}
        `);
      } catch (_) { /* non-critical legacy column */ }

      // STEP 4: Figure out the next unclaimed milestone for the UI
      const updatedClaimedIndices = new Set([...claimedIndices, milestoneIndex]);
      let nextMilestone: { index: number; ads: number; reward: string } | null = null;
      for (let i = milestoneIndex + 1; i < DAILY_BONUS_MILESTONES.length; i++) {
        if (!updatedClaimedIndices.has(i)) {
          const m = DAILY_BONUS_MILESTONES[i];
          nextMilestone = {
            index: i,
            ads: m.ads,
            reward: m.starReward ? `${m.starReward} Stars` : `$${m.usdReward} USD`,
          };
          break;
        }
      }

      // STEP 5: Fetch updated user and push real-time balance update
      try {
        const updatedUser = await storage.getUser(userId);
        const newStarBal = Number(updatedUser?.starBalance || 0);
        const newWeeklyStars = Number((updatedUser as any)?.weeklyStars || 0);
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: updatedUser?.balance,
          usdBalance: updatedUser?.usdBalance,
          starBalance: newStarBal,
          weeklyStars: newWeeklyStars,
        });
        return res.json({
          success: true,
          milestoneIndex,
          milestone,
          newStarBalance: newStarBal,
          newWeeklyStars,
          nextMilestone,
        });
      } catch (_) {
        // non-critical — still return success
      }

      res.json({ success: true, milestoneIndex, milestone, nextMilestone });
    } catch (error) {
      console.error('Daily bonus claim error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Helper: get ISO week key for N weeks ago (0 = current, 1 = last week)
  function getISOWeekOffset(weeksAgo: number): string {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - weeksAgo * 7);
    const year = now.getUTCFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
    const week = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  // Leaderboard — ranked by weekly_stars for current week contest (resets when contest ends)
  app.get('/api/leaderboard/weekly', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentWeek = getISOWeek();
      const isLastWeek = req.query.week === 'last';

      // ── LAST WEEK: serve from snapshot table ──────────────────────────────
      if (isLastWeek) {
        const lastWeekKey = getISOWeekOffset(1);
        const rows = await db
          .select()
          .from(leaderboardSnapshots)
          .where(sql`${leaderboardSnapshots.weekKey} = ${lastWeekKey}`)
          .orderBy(leaderboardSnapshots.rank);

        const leaderboard = rows.map(r => ({
          userId: r.userId,
          username: r.username,
          firstName: r.firstName,
          weeklyStars: r.weeklyStars,
          rank: r.rank,
          profileImageUrl: r.profileImageUrl,
        }));

        const myEntry = leaderboard.find(e => e.userId === userId);
        const userRank = myEntry ? { rank: myEntry.rank, weeklyStars: myEntry.weeklyStars } : null;

        return res.json({
          leaderboard,
          userRank,
          userStars: myEntry?.weeklyStars || 0,
          userStarBalance: myEntry?.weeklyStars || 0,
          currentWeek,
          lastWeek: lastWeekKey,
          isLastWeek: true,
        });
      }

      // ── CURRENT WEEK ──────────────────────────────────────────────────────

      // Top 50 users sorted by weekly_stars (ad watch only, 2 stars per ad)
      const top50 = await db
        .select({
          userId: users.id,
          username: users.username,
          firstName: users.firstName,
          weeklyStars: users.weeklyStars,
          starBalance: users.weeklyStars,
          profileImageUrl: users.profileImageUrl,
        })
        .from(users)
        .where(
          sql`COALESCE(${users.weeklyStars}, 0) > 0
              AND COALESCE(${users.banned}, false) = false`
        )
        .orderBy(sql`${users.weeklyStars} DESC NULLS LAST`)
        .limit(50);

      const leaderboard = top50.map((u, i) => ({
        ...u,
        weeklyStars: Number(u.weeklyStars || 0),
        rank: i + 1,
      }));

      // Current user's stats
      const currentUser = await storage.getUser(userId);
      const userWeeklyStars = Number((currentUser as any)?.weeklyStars || 0);

      let userRank: { rank: number; weeklyStars: number } | null = null;
      const myEntry = leaderboard.find((e) => e.userId === userId);
      if (myEntry) {
        userRank = { rank: myEntry.rank, weeklyStars: userWeeklyStars };
      } else if (userWeeklyStars > 0) {
        // User has stars but outside top 50 — calculate approximate rank
        const higherCount = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(
            sql`COALESCE(${users.weeklyStars}, 0) > ${userWeeklyStars}
                AND COALESCE(${users.banned}, false) = false`
          );
        const rank = (Number(higherCount[0]?.count) || 0) + 1;
        userRank = { rank, weeklyStars: userWeeklyStars };
      }

      res.json({
        leaderboard,
        userRank,
        userStars: userWeeklyStars,
        userStarBalance: userWeeklyStars,
        currentWeek,
        lastWeek: getISOWeekOffset(1),
        isLastWeek: false,
      });
    } catch (error) {
      console.error('Leaderboard error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Daily login streak reward tiers (in POW = PAD units, 1 USD = 10,000,000 POW)
  function getDailyStreakReward(streakDay: number): { usd: number; pow: number } {
    if (streakDay <= 10)  return { usd: 0.0005, pow: 5000 };
    if (streakDay <= 20)  return { usd: 0.001,  pow: 10000 };
    if (streakDay <= 30)  return { usd: 0.0015, pow: 15000 };
    if (streakDay <= 40)  return { usd: 0.002,  pow: 20000 };
    return                       { usd: 0.0025, pow: 25000 };
  }

  app.get('/api/daily-streak/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const today = getDailyResetDateStr();
      const lastLogin = (user as any).lastDailyLoginDate;
      const streak = (user as any).dailyLoginStreak || 0;
      const claimedToday = lastLogin === today;

      // Compute what the current (or next) day streak would be
      // Reset at 18:30 UTC = 12:00 AM IST
      const yesterday = (() => {
        const now = new Date();
        const pastReset = now.getUTCHours() > 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() >= 30);
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - (pastReset ? 1 : 2));
        return d.toISOString().split('T')[0];
      })();

      let nextStreakDay = streak + 1;
      if (claimedToday) {
        nextStreakDay = streak; // already claimed, show current streak
      } else if (lastLogin && lastLogin !== yesterday) {
        nextStreakDay = 1; // streak will reset
      }

      const now = new Date();
      const nextReset = new Date();
      nextReset.setUTCHours(18, 30, 0, 0);
      if (now.getUTCHours() > 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() >= 30)) nextReset.setUTCDate(nextReset.getUTCDate() + 1);

      const reward = getDailyStreakReward(nextStreakDay);

      res.json({
        streak,
        nextStreakDay,
        claimedToday,
        reward,
        nextResetAt: nextReset.toISOString(),
        lastDailyLoginDate: lastLogin,
      });
    } catch (error) {
      console.error('Daily streak status error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/daily-streak/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const today = getDailyResetDateStr();
      const lastLogin = (user as any).lastDailyLoginDate;
      const currentStreak = (user as any).dailyLoginStreak || 0;

      if (lastLogin === today) {
        return res.status(400).json({ message: 'Already claimed today', alreadyClaimed: true });
      }

      // Determine next streak day — reset at 18:30 UTC = 12:00 AM IST
      const yesterday = (() => {
        const now = new Date();
        const d = new Date(now);
        const pastReset = now.getUTCHours() > 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() >= 30);
        d.setUTCDate(d.getUTCDate() - (pastReset ? 1 : 2));
        return d.toISOString().split('T')[0];
      })();

      let newStreak: number;
      if (!lastLogin || lastLogin !== yesterday) {
        newStreak = 1; // missed a day or first time
      } else {
        newStreak = currentStreak + 1;
      }

      const reward = getDailyStreakReward(newStreak);

      // Give POW reward to user balance
      await storage.addEarning({
        userId,
        amount: String(reward.pow),
        source: 'daily_streak',
        description: `Daily streak reward — Day ${newStreak}`,
      });

      // Update streak fields
      await db.update(users).set({
        dailyLoginStreak: newStreak,
        lastDailyLoginDate: today,
        updatedAt: new Date(),
      } as any).where(eq(users.id, userId));

      res.json({ success: true, newStreak, reward });
    } catch (error) {
      console.error('Daily streak claim error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Check channel membership endpoint
  app.get('/api/streak/check-membership', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramId = req.user.user.telegram_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!botToken) {
        if (process.env.NODE_ENV === 'development') {
          return res.json({ 
            success: true,
            isMember: true,
            channelUsername: config.telegram.channelId,
            channelUrl: config.telegram.channelUrl,
            message: 'Development mode: membership check bypassed'
          });
        }
        
        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        return res.status(500).json({ 
          success: false,
          isMember: false, 
          message: 'Channel verification is temporarily unavailable. Please try again later.',
          error_code: 'VERIFICATION_UNAVAILABLE'
        });
      }
      
      // Check membership for configured channel
      const isMember = await verifyChannelMembership(
        parseInt(telegramId), 
        config.telegram.channelId, 
        botToken
      );
      
      res.json({ 
        success: true,
        isMember,
        channelUsername: config.telegram.channelId,
        channelUrl: config.telegram.channelUrl
      });
    } catch (error) {
      console.error("Error checking channel membership:", error);
      res.json({ 
        success: false,
        isMember: false,
        message: 'Unable to verify channel membership. Please make sure you have joined the channel and try again.',
        error_code: 'VERIFICATION_ERROR'
      });
    }
  });

  // Streak claim endpoint (Claim Bonus - every 5 minutes, 1 PAD)
  app.post('/api/streak/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramId = req.user.user.telegram_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const isDevMode = process.env.NODE_ENV === 'development';
      
      // Skip channel verification in development mode
      if (!isDevMode) {
        // Verify channel membership before allowing claim
        if (botToken) {
          const isMember = await verifyChannelMembership(
            parseInt(telegramId), 
            config.telegram.channelId, 
            botToken
          );
          
          if (!isMember) {
            return res.status(403).json({ 
              success: false,
              message: 'Please join our Telegram channel first to claim your bonus.',
              requiresChannelJoin: true,
              channelUsername: config.telegram.channelId,
              channelUrl: config.telegram.channelUrl
            });
          }
        } else {
          return res.status(500).json({ 
            success: false,
            message: 'Channel verification is temporarily unavailable. Please try again later.',
            error_code: 'VERIFICATION_UNAVAILABLE'
          });
        }
      }
      
      const result = await storage.updateUserStreak(userId);
      
      if (parseFloat(result.rewardEarned) === 0) {
        return res.status(400).json({ 
          success: false,
          message: 'Please wait 5 minutes before claiming again!'
        });
      }
      
      sendRealtimeUpdate(userId, {
        type: 'streak_reward',
        amount: result.rewardEarned,
        message: '✅ Bonus claimed!',
        timestamp: new Date().toISOString()
      });
      
      res.json({ 
        success: true,
        newStreak: result.newStreak,
        rewardEarned: result.rewardEarned,
        isBonusDay: result.isBonusDay,
        message: 'Bonus claimed successfully'
      });
    } catch (error) {
      console.error("Error processing bonus claim:", error);
      res.status(500).json({ message: "Failed to claim bonus" });
    }
  });



  // Legacy task eligibility endpoint removed - using daily tasks system only

  // User stats endpoint
  app.get('/api/user/stats', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const stats = await storage.getUserStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ message: "Failed to fetch user stats" });
    }
  });
  
  // Leaderboard endpoints
  app.get('/api/leaderboard/top', async (req: any, res) => {
    try {
      const topUser = await storage.getTopUserByEarnings();
      res.json(topUser || { username: 'No data', profileImage: '', totalEarnings: '0' });
    } catch (error) {
      console.error("Error fetching top user:", error);
      res.status(500).json({ message: "Failed to fetch top user" });
    }
  });
  
  app.get('/api/leaderboard/monthly', async (req: any, res) => {
    try {
      // Get userId from session if available (optional - for rank calculation)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const leaderboard = await storage.getMonthlyLeaderboard(userId);
      res.json(leaderboard);
    } catch (error) {
      console.error("Error fetching monthly leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch monthly leaderboard" });
    }
  });

  // Referral stats endpoint - auth removed to prevent popup spam on affiliates page
  app.get('/api/referrals/stats', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Referral stats requested without session - sending empty response');
        return res.json({ 
          success: true, 
          skipAuth: true, 
          totalInvites: 0,
          successfulInvites: 0,
          totalClaimed: '0', 
          availableBonus: '0', 
          readyToClaim: '0',
          totalStarEarned: 0,
          totalUsdEarned: 0
        });
      }
      const user = await storage.getUser(userId);

      // ── Friend count: use users.referred_by as primary source of truth ──
      // Some users may be missing referrals-table rows, so count directly from users table
      let totalInvitesCount = 0;
      let successfulInvitesCount = 0;
      if (user?.referralCode) {
        // Total L1 friends: anyone whose referred_by = my referral code
        const totalFromUsers = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(eq(users.referredBy, user.referralCode));
        const totalFromReferrals = await storage.getTotalInvitesCount(userId);
        // Take MAX of both counts to never under-count
        totalInvitesCount = Math.max(
          Number(totalFromUsers[0]?.count || 0),
          totalFromReferrals
        );

        // Successful: completed referrals (watched 1+ ad) from referrals table
        successfulInvitesCount = await storage.getValidReferralCount(userId);
        // Fallback: if referrals table < users table count, use users count
        if (successfulInvitesCount < totalInvitesCount) {
          // count completed referrals from users table (has ads_watched_today > 0 or balance > 0)
          const successFromUsers = await db.execute(sql`
            SELECT COUNT(*) as count FROM users
            WHERE referred_by = ${user.referralCode}
              AND (ads_watched > 0 OR COALESCE(total_earned,'0')::numeric > 0)
              AND COALESCE(banned, false) = false
          `);
          const countFromUsers = Number((successFromUsers.rows[0] as any)?.count || 0);
          successfulInvitesCount = Math.max(successfulInvitesCount, countFromUsers);
        }
      } else {
        totalInvitesCount = await storage.getTotalInvitesCount(userId);
        successfulInvitesCount = await storage.getValidReferralCount(userId);
      }

      // ── Earnings from referrals ──
      // USD earned: from referrals table (signup USD bonuses given to referrer)
      const completedReferrals = await db
        .select()
        .from(referrals)
        .where(and(
          eq(referrals.referrerId, userId),
          eq(referrals.status, 'completed')
        ));
      let totalUsdEarned = 0;
      for (const ref of completedReferrals) {
        totalUsdEarned += parseFloat(ref.usdRewardAmount || '0');
      }

      // POW earned: sum L1 commissions only from earnings table
      // (L2 commissions excluded from display)
      const powCommissionsResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0) AS total
        FROM earnings
        WHERE user_id = ${userId}
          AND source IN ('referral_commission', 'referral')
      `);
      const totalPowEarned = Number((powCommissionsResult.rows[0] as any)?.total || 0);

      // L2 count: users referred by my direct referrals
      let l2Count = 0;
      try {
        if (user?.referralCode) {
          const l1Users = await db
            .select({ referralCode: users.referralCode })
            .from(users)
            .where(eq(users.referredBy, user.referralCode));
          if (l1Users.length > 0) {
            const l1Codes = l1Users.map(u => u.referralCode).filter(Boolean) as string[];
            if (l1Codes.length > 0) {
              const l2Result = await db
                .select({ count: sql<number>`COUNT(*)` })
                .from(users)
                .where(sql`${users.referredBy} IN (${sql.join(l1Codes.map(c => sql`${c}`), sql`, `)})`);
              l2Count = Number(l2Result[0]?.count ?? 0);
            }
          }
        }
      } catch (l2Error) {
        console.error("Error computing L2 count:", l2Error);
      }

      res.json({
        totalInvites: totalInvitesCount,
        successfulInvites: successfulInvitesCount,
        l2Count,
        totalClaimed: user?.totalClaimedReferralBonus || '0',
        availableBonus: user?.pendingReferralBonus || '0',
        readyToClaim: user?.pendingReferralBonus || '0',
        totalPowEarned,
        totalUsdEarned,
        // legacy field kept for compatibility
        totalStarEarned: totalPowEarned,
      });
    } catch (error) {
      console.error("Error fetching referral stats:", error);
      res.status(500).json({ message: "Failed to fetch referral stats" });
    }
  });

  // Claim referral bonus endpoint - auth removed to prevent popup spam on affiliates page
  app.post('/api/referrals/claim', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Referral claim requested without session - skipping');
        return res.json({ success: true, skipAuth: true });
      }
      const result = await storage.claimReferralBonus(userId);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error claiming referral bonus:", error);
      res.status(500).json({ message: "Failed to claim referral bonus" });
    }
  });

  // Get valid referral count (friends who watched at least 1 ad)
  app.get('/api/referrals/valid-count', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ validReferralCount: 0 });
      }
      
      const validCount = await storage.getValidReferralCount(userId);
      res.json({ validReferralCount: validCount });
    } catch (error) {
      console.error("Error fetching valid referral count:", error);
      res.status(500).json({ message: "Failed to fetch valid referral count" });
    }
  });

  // Withdrawal eligibility - check if user has watched enough ads for this withdrawal
  app.get('/api/withdrawal-eligibility', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ adsWatchedSinceLastWithdrawal: 0, canWithdraw: false });
      }
      
      // Get user's total ads watched
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json({ adsWatchedSinceLastWithdrawal: 0, canWithdraw: false });
      }
      
      // Get user's last completed/approved withdrawal timestamp
      const lastWithdrawal = await db
        .select({ createdAt: withdrawals.createdAt })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          sql`${withdrawals.status} IN ('completed', 'approved')`
        ))
        .orderBy(desc(withdrawals.createdAt))
        .limit(1);
      
      // Get admin settings for withdrawal requirements
      const allSettings = await db.select().from(adminSettings);
      const getSetting = (key: string, defaultValue: string): string => {
        const setting = allSettings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };
      
      const withdrawalAdRequirementEnabled = getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true';
      const MINIMUM_ADS_FOR_WITHDRAWAL = parseInt(getSetting('minimum_ads_for_withdrawal', '100'));
      // STAR is not a withdrawal requirement — only used for weekly contest
      
      let adsWatchedSinceLastWithdrawal = 0;
      
      if (lastWithdrawal.length === 0) {
        // No previous withdrawal - count all ads watched
        adsWatchedSinceLastWithdrawal = user.adsWatched || 0;
      } else {
        // Count ads watched since last withdrawal
        // We use the earnings table to count ads since the last withdrawal
        const lastWithdrawalDate = lastWithdrawal[0].createdAt;
        
        const adsCountResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(earnings)
          .where(and(
            eq(earnings.userId, userId),
            eq(earnings.source, 'ad_watch'),
            gte(earnings.createdAt, lastWithdrawalDate)
          ));
        
        adsWatchedSinceLastWithdrawal = adsCountResult[0]?.count || 0;
      }
      
      // STAR is not a withdrawal gate — only used for weekly contest
      const canWithdraw = !withdrawalAdRequirementEnabled || adsWatchedSinceLastWithdrawal >= MINIMUM_ADS_FOR_WITHDRAWAL;
      
      res.json({ 
        adsWatchedSinceLastWithdrawal,
        canWithdraw,
        requiredAds: MINIMUM_ADS_FOR_WITHDRAWAL,
        adRequirementEnabled: withdrawalAdRequirementEnabled
      });
    } catch (error) {
      console.error("Error checking withdrawal eligibility:", error);
      res.status(500).json({ message: "Failed to check withdrawal eligibility" });
    }
  });

  // Search referral by code endpoint - auth removed to prevent popup spam on affiliates page
  app.get('/api/referrals/search/:code', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const currentUserId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!currentUserId) {
        console.log('⚠️ Referral search requested without session - skipping');
        return res.status(404).json({ message: "Referral not found", skipAuth: true });
      }
      const searchCode = req.params.code;

      // Find user by referral code
      const referralUser = await storage.getUserByReferralCode(searchCode);
      
      if (!referralUser) {
        return res.status(404).json({ message: "Referral not found" });
      }

      // Check if this referral belongs to the current user
      const referralRelationship = await storage.getReferralByUsers(currentUserId, referralUser.id);
      
      if (!referralRelationship) {
        return res.status(403).json({ message: "This referral does not belong to you" });
      }

      // Get referral stats
      const referralEarnings = await storage.getUserStats(referralUser.id);
      const referralCount = await storage.getUserReferrals(referralUser.id);

      res.json({
        id: searchCode,
        earnedToday: referralEarnings.todayEarnings || "0.00",
        allTime: referralUser.totalEarned || "0.00",
        invited: referralCount.length,
        joinedAt: referralRelationship.createdAt
      });
    } catch (error) {
      console.error("Error searching referral:", error);
      res.status(500).json({ message: "Failed to search referral" });
    }
  });

  // Earnings history endpoint
  app.get('/api/earnings', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const earnings = await storage.getUserEarnings(userId, limit);
      res.json(earnings);
    } catch (error) {
      console.error("Error fetching earnings:", error);
      res.status(500).json({ message: "Failed to fetch earnings" });
    }
  });

  // Earnings chart data endpoint - returns daily totals grouped by date
  app.get('/api/earnings/chart', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const period = req.query.period as string || 'week';
      const days = period === 'month' ? 31 : period === '2weeks' ? 14 : 7;

      const result_raw = await db.execute(sql`
        SELECT 
          TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'DD.MM') as date,
          (COALESCE(SUM(amount), 0) / 10000000.0)::float as amount
        FROM earnings
        WHERE user_id = ${userId}
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY DATE(created_at AT TIME ZONE 'UTC') ASC
      `);

      const rowsArr = Array.isArray(result_raw) ? result_raw : (result_raw as any).rows ?? [];
      const result = rowsArr.map((r: any) => ({
        date: r.date,
        amount: parseFloat(r.amount) || 0,
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching earnings chart:", error);
      res.status(500).json({ message: "Failed to fetch earnings chart" });
    }
  });

  // Referral earnings chart data endpoint
  app.get('/api/referrals/earnings/chart', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const period = req.query.period as string || 'week';
      const days = period === 'month' ? 31 : period === '2weeks' ? 14 : 7;

      const result_raw2 = await db.execute(sql`
        SELECT 
          TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'DD.MM') as date,
          (COALESCE(SUM(amount), 0) / 10000000.0)::float as amount
        FROM earnings
        WHERE user_id = ${userId}
          AND source IN ('referral', 'referral_commission', 'referral_commission_l2', 'referral_bonus')
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY DATE(created_at AT TIME ZONE 'UTC') ASC
      `);

      const rowsArr2 = Array.isArray(result_raw2) ? result_raw2 : (result_raw2 as any).rows ?? [];
      const result = rowsArr2.map((r: any) => ({
        date: r.date,
        amount: parseFloat(r.amount) || 0,
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching referral earnings chart:", error);
      res.status(500).json({ message: "Failed to fetch referral earnings chart" });
    }
  });





  // Debug endpoint for referral issues - auth removed to prevent popup spam
  app.get('/api/debug/referrals', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Debug referrals requested without session - sending empty response');
        return res.json({ success: true, skipAuth: true, data: {} });
      }
      
      // Get user info
      const user = await storage.getUser(userId);
      
      // Get all earnings for this user
      const userEarnings = await db
        .select()
        .from(earnings)
        .where(eq(earnings.userId, userId))
        .orderBy(desc(earnings.createdAt));
      
      // Get referrals where user is referrer
      const myReferrals = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));
      
      // Get referrals where user is referee  
      const referredBy = await db
        .select()
        .from(referrals)
        .where(eq(referrals.refereeId, userId));
      
      res.json({
        user: {
          id: user?.id,
          referralCode: user?.referralCode,
          balance: user?.balance,
          totalEarned: user?.totalEarned
        },
        earnings: userEarnings,
        myReferrals: myReferrals,
        referredBy: referredBy,
        counts: {
          totalEarnings: userEarnings.length,
          referralEarnings: userEarnings.filter(e => e.source === 'referral').length,
          commissionEarnings: userEarnings.filter(e => e.source === 'referral_commission').length,
          adEarnings: userEarnings.filter(e => e.source === 'ad_watch').length
        }
      });
    } catch (error) {
      console.error("Debug referrals error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Production database fix endpoint - run once to fix referrals
  app.post('/api/fix-production-referrals', async (req: any, res) => {
    try {
      console.log('🔧 Fixing production referral system...');
      
      // 1. Update existing referral bonuses from $0.50 to $0.01
      console.log('📝 Updating referral bonus amounts...');
      await db.execute(sql`
        UPDATE ${earnings} 
        SET amount = '0.01', 
            description = REPLACE(description, '$0.50', '$0.01')
        WHERE source = 'referral' 
        AND amount = '0.50'
      `);
      
      // 2. Ensure referrals table has correct default
      console.log('🔧 Updating referrals table...');
      await db.execute(sql`
        ALTER TABLE ${referrals} 
        ALTER COLUMN reward_amount SET DEFAULT 0.01
      `);
      
      // 3. Update existing pending referrals to new amount
      await db.execute(sql`
        UPDATE ${referrals} 
        SET reward_amount = '0.01' 
        WHERE reward_amount = '0.50'
      `);
      
      // 4. Generate referral codes for users who don't have them
      console.log('🔑 Generating missing referral codes...');
      const usersWithoutCodes = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.referralCode} IS NULL OR ${users.referralCode} = ''`);
      
      for (const user of usersWithoutCodes) {
        const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await db
          .update(users)
          .set({ referralCode })
          .where(eq(users.id, user.id));
      }
      
      // 5. Get stats for response
      const totalReferralEarnings = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
        .from(earnings)
        .where(eq(earnings.source, 'referral'));
      
      const totalReferrals = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);
      
      console.log('✅ Production referral system fixed successfully!');
      
      res.json({
        success: true,
        message: 'Production referral system fixed successfully!',
        changes: {
          updatedReferralBonuses: 'Changed from $0.50 to $0.01',
          totalReferralEarnings: totalReferralEarnings[0]?.total || '0',
          totalReferrals: totalReferrals[0]?.count || 0,
          generatedReferralCodes: usersWithoutCodes.length
        }
      });
      
    } catch (error) {
      console.error('❌ Error fixing production referrals:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  
  // Get user's daily tasks (new system) - DISABLED
  app.get('/api/tasks/daily', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      
      // Get user's current ads count
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const adsWatchedToday = user?.adsWatchedToday || 0;
      
      // Get daily tasks
      const tasks = await storage.getUserDailyTasks(userId);
      
      res.json({
        success: true,
        tasks: tasks.map(task => ({
          id: task.id,
          level: task.taskLevel,
          title: `Watch ${task.required} ads`,
          description: `Watch ${task.required} ads to earn ${parseFloat(task.rewardAmount).toFixed(5)} TON`,
          required: task.required,
          progress: task.progress,
          completed: task.completed,
          claimed: task.claimed,
          rewardAmount: task.rewardAmount,
          canClaim: task.completed && !task.claimed,
        })),
        adsWatchedToday,
        resetInfo: {
          nextReset: "00:00 UTC",
          resetDate: new Date().toISOString().split('T')[0]
        }
      });
      
    } catch (error) {
      console.error('Error fetching daily tasks:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch daily tasks' 
      });
    }
  });
  
  // Claim a task reward
  app.post('/api/tasks/claim/:taskLevel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const taskLevel = parseInt(req.params.taskLevel);
      
      if (!taskLevel || taskLevel < 1 || taskLevel > 9) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid task level' 
        });
      }
      
      const result = await storage.claimDailyTaskReward(userId, taskLevel);
      
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          rewardAmount: result.rewardAmount
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }
      
    } catch (error) {
      console.error('Error claiming task:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to claim task reward' 
      });
    }
  });

  // Get daily task completion status
  app.get('/api/tasks/daily/status', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, completedTasks: [] });
      }

      const [user] = await db
        .select({
          taskShareCompleted: users.taskShareCompletedToday,
          taskChannelCompleted: users.taskChannelCompletedToday,
          taskCommunityCompleted: users.taskCommunityCompletedToday,
          lastStreakDate: users.lastStreakDate
        })
        .from(users)
        .where(eq(users.id, userId));

      const completedTasks = [];
      if (user?.taskShareCompleted) completedTasks.push('share-friends');
      if (user?.taskChannelCompleted) completedTasks.push('check-updates');
      if (user?.taskCommunityCompleted) completedTasks.push('join-community');
      
      if (user?.lastStreakDate) {
        const lastClaim = new Date(user.lastStreakDate);
        const hoursSinceLastClaim = (new Date().getTime() - lastClaim.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastClaim < 24) {
          completedTasks.push('claim-streak');
        }
      }

      res.json({
        success: true,
        completedTasks
      });
      
    } catch (error) {
      console.error('Error fetching task status:', error);
      res.json({ success: true, completedTasks: [] });
    }
  });

  // Unified home tasks API - shows ONLY advertiser/user-created tasks (no daily tasks)
  // Uses getActiveTasksForUser - same data source as Mission page (/api/advertiser-tasks)
  app.get('/api/tasks/home/unified', async (req: any, res) => {
    try {
      let userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      // In development mode, use test user if no session
      if (!userId && process.env.NODE_ENV === 'development') {
        userId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      }
      
      if (!userId) {
        return res.json({ success: true, tasks: [], completedTaskIds: [], totalAvailableTasks: 0 });
      }

      // Get user info for referral code
      const [user] = await db
        .select({
          referralCode: users.referralCode
        })
        .from(users)
        .where(eq(users.id, userId));

      // Get reward settings for advertiser task types from admin settings
      const channelTaskReward = await storage.getAppSetting('channelTaskReward', '1000');
      const botTaskReward = await storage.getAppSetting('botTaskReward', '1000');
      const partnerTaskReward = await storage.getAppSetting('partnerTaskReward', '1000');
      const starRewardPerTask = await storage.getAppSetting('star_reward_per_task', '10');

      // Get ALL approved public tasks (admin-created AND user-created after admin approval)
      // Task eligibility: status = 'running' (approved/active), user hasn't completed, not their own task
      const advertiserTasks = await storage.getActiveTasksForUser(userId);
      
      // Format advertiser tasks with PAD and BUG rewards from admin settings
      const formattedTasks = advertiserTasks.map(task => {
        let rewardPOW = 0;
        if (task.taskType === 'channel') {
          rewardPOW = parseInt(channelTaskReward);
        } else if (task.taskType === 'bot') {
          rewardPOW = parseInt(botTaskReward);
        } else if (task.taskType === 'partner') {
          rewardPOW = parseInt(partnerTaskReward);
        } else {
          rewardPOW = 20;
        }
        
        return {
          id: task.id,
          type: 'advertiser',
          taskType: task.taskType,
          title: task.title,
          link: task.link,
          rewardPOW,
          rewardSTAR: 0,
          rewardType: 'POW',
          isAdminTask: false,
          isAdvertiserTask: true,
          priority: 1
        };
      });

      res.json({
        success: true,
        tasks: formattedTasks,
        completedTaskIds: [],
        referralCode: user?.referralCode,
        totalAvailableTasks: formattedTasks.length
      });
      
    } catch (error) {
      console.error('Error fetching unified home tasks:', error);
      res.json({ success: true, tasks: [], completedTaskIds: [], totalAvailableTasks: 0 });
    }
  });

  // New simplified task completion endpoints with daily tracking
  app.post('/api/tasks/complete/share', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }
      
      // Check if already completed today
      const [user] = await db
        .select({ taskShareCompletedToday: users.taskShareCompletedToday })
        .from(users)
        .where(eq(users.id, userId));
      
      if (user?.taskShareCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }
      
      // Reward: 0.0001 TON = 1,000 PAD
      const rewardAmount = '0.0001';
      
      await db.transaction(async (tx) => {
        // Update balance and mark task complete — no star reward from tasks
        await tx.execute(sql`
          UPDATE users SET
            balance                    = balance + ${rewardAmount}::numeric,
            task_share_completed_today = true,
            updated_at                 = NOW()
          WHERE id = ${userId}
        `);
        
        // Add earning record
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_share',
          description: 'Share with Friends task completed'
        });
      });
      
      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });
      
    } catch (error) {
      console.error('Error completing share task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  // Send rich share message with photo + caption + inline WebApp button
  app.post('/api/share/send-rich-message', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }
      
      // Get user data to find telegram ID and referral code
      const [user] = await db
        .select({
          telegramId: users.telegram_id,
          referralCode: users.referralCode
        })
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user || !user.telegramId) {
        return res.status(400).json({
          success: false,
          message: 'Telegram ID not found for user'
        });
      }
      
      if (!user.referralCode) {
        return res.status(400).json({
          success: false,
          message: 'Referral code not found for user'
        });
      }
      
      // Get app URL for WebApp button
      const appUrl = process.env.RENDER_EXTERNAL_URL || 
                    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                    'https://vuuug.onrender.com';
      
      // Build the referral URL - bot username fetched live from Telegram Bot API
      const { getBotUsername: getBotUsernameForShare } = await import('./telegram');
      const botUsername = await getBotUsernameForShare();
      const webAppUrl = `https://t.me/${botUsername}?start=${user.referralCode}`;
      
      // Get share banner image URL
      const shareImageUrl = `${appUrl}/images/share_v5.jpg`;
      
      // Caption for the share message
      const caption = '💵 Get paid for completing tasks and watching ads.';
      
      // Send the photo message with inline button
      const result = await sendSharePhotoToChat(
        user.telegramId,
        shareImageUrl,
        caption,
        webAppUrl,
        '🚀 Start Earning'
      );
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Share message sent! You can now forward it to friends.',
          messageId: result.messageId
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error || 'Failed to send share message'
        });
      }
      
    } catch (error: any) {
      console.error('Error sending rich share message:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to send share message'
      });
    }
  });

  app.post('/api/tasks/complete/channel', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id?.toString();
      
      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }
      
      // Check if already completed today
      const [user] = await db
        .select({ taskChannelCompletedToday: users.taskChannelCompletedToday })
        .from(users)
        .where(eq(users.id, userId));
      
      if (user?.taskChannelCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }
      
      // MANDATORY: VERIFY CHANNEL MEMBERSHIP BEFORE GIVING REWARD
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!botToken || !telegramUserId) {
        console.error('❌ Channel task claim rejected: Missing bot token or telegram user ID');
        return res.status(401).json({
          success: false,
          message: 'Authentication error - please try again'
        });
      }
      
      // ALWAYS verify membership - no exceptions
      // verifyChannelMembership handles the actual Telegram API check
      const isMember = await verifyChannelMembership(
        parseInt(telegramUserId), 
        config.telegram.channelId,
        botToken
      );
      
      if (!isMember) {
        console.log(`❌ User ${telegramUserId} tried to claim channel task but is not a member (verified via API)`);
        return res.status(403).json({
          success: false,
          message: `Please join the Telegram channel ${config.telegram.channelUrl || config.telegram.channelId} first to complete this task`,
          requiresChannelJoin: true,
          channelUsername: config.telegram.channelId,
          channelUrl: config.telegram.channelUrl
        });
      }
      
      // Reward: 0.0001 TON = 1,000 PAD
      const rewardAmount = '0.0001';
      
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE users SET
            balance                      = balance + ${rewardAmount}::numeric,
            task_channel_completed_today = true,
            updated_at                   = NOW()
          WHERE id = ${userId}
        `);
        
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_channel',
          description: 'Check for Updates task completed'
        });
      });
      
      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });
      
    } catch (error) {
      console.error('Error completing channel task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  app.post('/api/tasks/complete/community', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id?.toString();
      
      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }
      
      // Check if already completed today
      const [user] = await db
        .select({ taskCommunityCompletedToday: users.taskCommunityCompletedToday })
        .from(users)
        .where(eq(users.id, userId));
      
      if (user?.taskCommunityCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }
      
      // MANDATORY: VERIFY GROUP/COMMUNITY MEMBERSHIP BEFORE GIVING REWARD
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!botToken || !telegramUserId) {
        console.error('❌ Community task claim rejected: Missing bot token or telegram user ID');
        return res.status(401).json({
          success: false,
          message: 'Authentication error - please try again'
        });
      }
      
      // ALWAYS verify membership - no exceptions
      const isMember = await verifyChannelMembership(
        parseInt(telegramUserId), 
        config.telegram.groupId,
        botToken
      );
      
      if (!isMember) {
        console.log(`❌ User ${telegramUserId} tried to claim community task but is not a member (verified via API)`);
        return res.status(403).json({
          success: false,
          message: `Please join the Telegram group ${config.telegram.groupUrl || config.telegram.groupId} first to complete this task`,
          requiresGroupJoin: true,
          groupUsername: config.telegram.groupId,
          groupUrl: config.telegram.groupUrl
        });
      }
      
      // Reward: 0.0001 TON = 1,000 PAD
      const rewardAmount = '0.0001';
      
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE users SET
            balance                        = balance + ${rewardAmount}::numeric,
            task_community_completed_today = true,
            updated_at                     = NOW()
          WHERE id = ${userId}
        `);
        
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_community',
          description: 'Join Community task completed'
        });
      });
      
      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });
      
    } catch (error) {
      console.error('Error completing community task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  // Old task system removed - using daily tasks system only

  // ================================
  // NEW TASK SYSTEM ENDPOINTS
  // ================================

  // Get all task statuses for user
  app.get('/api/tasks/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      
      // Define hardcoded daily tasks that exactly match live system format
      // Fixed timestamp to prevent ordering issues
      const fallbackTimestamp = new Date('2025-09-18T11:15:16.000Z');
      
      const hardcodedDailyTasks = [
        {
          id: 'channel-visit-check-update',
          type: 'channel_visit',
          title: 'Channel visit (Check Update)',
          description: 'Visit our Telegram channel for updates and news',
          rewardPerUser: '0.00015000', // 8-decimal format to match live API
          url: 'https://t.me/PaidAdsNews',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'app-link-share',
          type: 'share_link', 
          title: 'App link share (Share link)',
          description: 'Share your affiliate link with friends',
          rewardPerUser: '0.00020000', // 8-decimal format to match live API
          url: 'share://referral',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'invite-friend-valid',
          type: 'invite_friend',
          title: 'Invite friend (valid)',
          description: 'Invite 1 valid friend to earn rewards',
          rewardPerUser: '0.00050000', // 8-decimal format to match live API
          url: 'invite://friend',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-mini',
          type: 'ads_goal_mini',
          title: 'Mini (Watch 15 ads)',
          description: 'Watch 15 ads to complete this daily goal',
          rewardPerUser: '0.00045000', // 8-decimal format to match live API
          url: 'watch://ads/mini',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-light',
          type: 'ads_goal_light',
          title: 'Light (Watch 25 ads)',
          description: 'Watch 25 ads to complete this daily goal',
          rewardPerUser: '0.00060000', // 8-decimal format to match live API
          url: 'watch://ads/light',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-medium',
          type: 'ads_goal_medium',
          title: 'Medium (Watch 45 ads)',
          description: 'Watch 45 ads to complete this daily goal',
          rewardPerUser: '0.00070000', // 8-decimal format to match live API
          url: 'watch://ads/medium',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-hard',
          type: 'ads_goal_hard',
          title: 'Hard (Watch 75 ads)',
          description: 'Watch 75 ads to complete this daily goal',
          rewardPerUser: '0.00080000', // 8-decimal format to match live API
          url: 'watch://ads/hard',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        }
      ];
      
      // Get active promotions from database (if any) - only show approved promotions
      let activeTasks = [];
      try {
        activeTasks = await db
          .select({
            id: promotions.id,
            type: promotions.type,
            url: promotions.url,
            rewardPerUser: promotions.rewardPerUser,
            limit: promotions.limit,
            claimedCount: promotions.claimedCount,
            title: promotions.title,
            description: promotions.description,
            channelMessageId: promotions.channelMessageId,
            createdAt: promotions.createdAt
          })
          .from(promotions)
          .where(and(
            eq(promotions.status, 'active'),
            eq(promotions.isApproved, true), // Only show admin-approved promotions
            sql`${promotions.claimedCount} < ${promotions.limit}`
          ))
          .orderBy(desc(promotions.createdAt));
      } catch (dbError) {
        console.log('⚠️ Database query failed, using hardcoded tasks only:', dbError);
        activeTasks = [];
      }
      
      // Use hardcoded tasks only if database has no active tasks
      let allTasks = [];
      
      if (activeTasks.length === 0) {
        console.log('🔄 Database empty, using hardcoded daily tasks fallback');
        allTasks = hardcodedDailyTasks;
      } else {
        allTasks = activeTasks;
      }
      
      // Check which tasks user has already completed
      const completedIds = new Set<string>();
      
      // Calculate current task date using 18:30 UTC (12:00 AM IST) reset logic
      const getCurrentTaskDate = (): string => {
        const now = new Date();
        // If current time is before 18:30 UTC, use yesterday's date
        if (now.getUTCHours() < 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() < 30)) {
          now.setUTCDate(now.getUTCDate() - 1);
        }
        return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
      };
      
      const currentTaskDate = getCurrentTaskDate();
      
      // Query non-daily task completions from taskCompletions table
      try {
        const nonDailyCompletions = await db
          .select({ promotionId: taskCompletions.promotionId })
          .from(taskCompletions)
          .where(eq(taskCompletions.userId, userId));
        
        // Add non-daily completed tasks (permanently hidden)
        for (const completion of nonDailyCompletions) {
          const task = allTasks.find(t => t.id === completion.promotionId);
          const isDailyTask = task && ['channel_visit', 'share_link', 'invite_friend', 'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard', 'daily'].includes(task.type);
          
          if (!isDailyTask) {
            // Only add non-daily tasks to completed set
            completedIds.add(completion.promotionId);
          }
        }
      } catch (dbError) {
        console.log('⚠️ Task completions query failed, continuing without completion check:', dbError);
      }
      
      // Query daily task completions from dailyTasks table for today only
      try {
        const dailyCompletions = await db
          .select({ promotionId: dailyTasks.promotionId })
          .from(dailyTasks)
          .where(and(
            eq(dailyTasks.userId, userId),
            eq(dailyTasks.completionDate, currentTaskDate)
          ));
        
        // Add daily completed tasks (hidden until tomorrow's reset at 12:00 PM UTC)
        for (const completion of dailyCompletions) {
          completedIds.add(completion.promotionId);
        }
      } catch (dbError) {
        console.log('⚠️ Daily task completions query failed, continuing without daily completion check:', dbError);
      }
      
      // Filter out completed tasks and generate proper task links
      const availableTasks = allTasks
        .filter(task => !completedIds.has(task.id))
        .map(task => {
          // Extract username from URL for link generation
          const urlMatch = task.url?.match(/t\.me\/([^/?]+)/);
          const username = urlMatch ? urlMatch[1] : null;
          
          let channelPostUrl = null;
          let claimUrl = null;
          
          if (task.type === 'channel' && username) {
            // Use channel message ID if available, otherwise fallback to channel URL
            if (task.channelMessageId) {
              channelPostUrl = `https://t.me/${username}/${task.channelMessageId}`;
            } else {
              channelPostUrl = `https://t.me/${username}`;
            }
            claimUrl = channelPostUrl;
          } else if (task.type === 'bot' && username) {
            // Bot deep link with task ID
            claimUrl = `https://t.me/${username}?start=task_${task.id}`;
          } else if (task.type === 'daily' && username) {
            // Daily task using channel link
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'channel_visit' && username) {
            // Channel visit task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'share_link' && username) {
            // Share link task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'invite_friend' && username) {
            // Invite friend task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type.startsWith('ads_goal_')) {
            // Ads goal tasks don't need external URLs
            claimUrl = 'internal://ads-goal';
          }
          
          return {
            ...task,
            reward: task.rewardPerUser, // Map rewardPerUser to reward for frontend compatibility
            channelPostUrl,
            claimUrl,
            username // Include username for mobile fallback
          };
        });
      
      res.json({
        success: true,
        tasks: availableTasks,
        total: availableTasks.length
      });
    } catch (error) {
      console.error('❌ Error fetching tasks:', error);
      
      // Fallback: Return hardcoded daily tasks with exact format matching
      const fallbackDailyTasks = hardcodedDailyTasks.map(task => ({
        ...task,
        reward: task.rewardPerUser, // Map rewardPerUser to reward for frontend compatibility
        channelPostUrl: task.type === 'channel_visit' ? task.url : null,
        claimUrl: task.type === 'channel_visit' ? task.url : 
                  task.type.startsWith('ads_goal_') ? null : task.url,
        username: task.type === 'channel_visit' ? 'PaidAdsNews' : null
      }));
      
      res.json({
        success: true,
        tasks: fallbackDailyTasks,
        total: fallbackDailyTasks.length
      });
    }
  });


  // CRITICAL: Public referral data repair endpoint (no auth needed for emergency fix)
  app.post('/api/emergency-fix-referrals', async (req: any, res) => {
    try {
      console.log('🚨 EMERGENCY: Running referral data repair...');
      
      // Step 1: Run the referral data synchronization
      await storage.fixExistingReferralData();
      
      // Step 2: Ensure all users have referral codes
      await storage.ensureAllUsersHaveReferralCodes();
      
      // Step 3: Sync friendsInvited counts from database for withdrawal unlock
      await storage.syncFriendsInvitedCounts();
      
      // Step 4: Get repair summary
      const totalReferralsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);
      
      const completedReferralsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.status, 'completed'));

      const totalReferralEarningsResult = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
        .from(earnings)
        .where(sql`${earnings.source} IN ('referral', 'referral_commission')`);
      
      console.log('✅ Emergency referral repair completed successfully!');
      
      res.json({
        success: true,
        message: 'Emergency referral data repair completed successfully! Your friendsInvited count has been synced for withdrawal unlock.',
        summary: {
          totalReferrals: totalReferralsResult[0]?.count || 0,
          completedReferrals: completedReferralsResult[0]?.count || 0,
          totalReferralEarnings: totalReferralEarningsResult[0]?.total || '0',
          message: 'All missing referral data has been restored. Check your app now!'
        }
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

  // Admin routes



  // Setup webhook endpoint (call this once to register with Telegram)
  app.post('/api/telegram/setup-webhook', async (req: any, res) => {
    try {
      const { webhookUrl } = req.body;
      
      if (!webhookUrl) {
        return res.status(400).json({ message: 'Webhook URL is required' });
      }
      
      const success = await setupTelegramWebhook(webhookUrl);
      
      if (success) {
        res.json({ success: true, message: 'Webhook set up successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to set up webhook' });
      }
    } catch (error) {
      console.error('Setup webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // One-time production database fix endpoint
  app.get('/api/fix-production-db', async (req: any, res) => {
    try {
      const { fixProductionDatabase } = await import('../server/fix-production-db.js');
      console.log('🔧 Running production database fix...');
      await fixProductionDatabase();
      res.json({ 
        success: true, 
        message: 'Production database fixed successfully! Your app should work now.',
        instructions: 'Try using your Telegram bot - it should now send messages properly!'
      });
    } catch (error) {
      console.error('Fix production DB error:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error),
        message: 'Database fix failed. Check the logs for details.'
      });
    }
  });

  // Auto-setup webhook endpoint (automatically determines URL)
  app.get('/api/telegram/auto-setup', async (req: any, res) => {
    try {
      // Get the current domain from the request
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
      
      console.log('Setting up Telegram webhook:', webhookUrl);
      
      const success = await setupTelegramWebhook(webhookUrl);
      
      if (success) {
        res.json({ 
          success: true, 
          message: 'Webhook set up successfully',
          webhookUrl 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to set up webhook',
          webhookUrl 
        });
      }
    } catch (error) {
      console.error('Auto-setup webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Test endpoint removed - bot uses inline buttons only
  app.get('/api/telegram/test/:chatId', async (req: any, res) => {
    res.json({ 
      success: false, 
      message: 'Test endpoint removed - bot uses inline buttons only'
    });
  });

  // Admin identity check — returns whether the current user is an admin
  // Checks: SUPER_ADMIN_ID/TELEGRAM_ADMIN_ID env → TELEGRAM_ADMIN_IDS env → DB admin_roles table
  // Returns: { isAdmin, role, permissions, name }
  app.get('/api/admin/check', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.json({ isAdmin: false, role: null, permissions: [], name: null });
      const user = await storage.getUser(userId);
      const telegramId = user?.telegram_id || '';
      const devStatus = process.env.NODE_ENV === 'development' && telegramId === '123456789';

      // Check env vars + DB (isAdminAsync covers both)
      const adminStatus = devStatus || await isAdminAsync(telegramId);
      if (!adminStatus) {
        return res.json({ isAdmin: false, role: null, permissions: [], name: null });
      }

      const roleInfo = await getAdminRole(telegramId);
      if (!roleInfo && !devStatus) {
        return res.json({ isAdmin: false, role: null, permissions: [], name: null });
      }
      return res.json({
        isAdmin: true,
        role: roleInfo?.role ?? 'super_admin',
        permissions: roleInfo?.permissions ?? ALL_PERMISSIONS,
        name: roleInfo?.name ?? 'Admin',
      });
    } catch {
      return res.json({ isAdmin: false, role: null, permissions: [], name: null });
    }
  });

  // --- Admin Role Management ---

  // List all admins (super admin first, then sub-admins from TELEGRAM_ADMIN_IDS + DB)
  app.get('/api/admin/admins', authenticateAdmin, async (req: any, res) => {
    try {
      const callerTelegramId = req.user?.telegramUser?.id?.toString() || '';
      const callerRole = await getAdminRole(callerTelegramId);
      if (!callerRole?.permissions.includes('manage_admins')) {
        return res.status(403).json({ message: 'Permission denied: manage_admins required' });
      }

      // The one true super admin (TELEGRAM_ADMIN_ID or SUPER_ADMIN_ID)
      const superAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || '').trim();

      // Sub-admins from TELEGRAM_ADMIN_IDS env var
      const subAdminEnvIds = (process.env.TELEGRAM_ADMIN_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);

      // DB admin records
      const dbRecords = await db.select().from(adminRoles).orderBy(adminRoles.createdAt);
      const dbById = new Map(dbRecords.map(r => [r.telegramId, r]));

      const list: any[] = [];

      // 1. Super admin entry (always first, always super_admin role)
      if (superAdminId) {
        const rec = dbById.get(superAdminId);
        list.push({
          telegramId: superAdminId,
          name: rec?.name || 'Super Admin',
          role: 'super_admin',
          permissions: ALL_PERMISSIONS,
          addedBy: null,
          isSuperAdmin: true,
          isPrimary: true,
          createdAt: rec?.createdAt || null,
        });
      }

      // 2. Sub-admins from TELEGRAM_ADMIN_IDS env var
      subAdminEnvIds.forEach(id => {
        if (id === superAdminId) return; // skip if same as super admin
        const rec = dbById.get(id);
        let perms: string[] = [];
        try { perms = JSON.parse(rec?.permissions || '[]'); } catch { perms = ROLE_DEFAULT_PERMISSIONS[rec?.role || 'moderator'] || []; }
        list.push({
          telegramId: id,
          name: rec?.name || 'Admin',
          role: rec?.role || 'moderator',
          permissions: perms,
          addedBy: rec?.addedBy || null,
          isSuperAdmin: false,
          isPrimary: true,
          createdAt: rec?.createdAt || null,
        });
      });

      // 3. DB-only admins (added via admin panel by super admin)
      dbRecords.forEach(rec => {
        if (rec.telegramId === superAdminId) return; // already listed
        if (subAdminEnvIds.includes(rec.telegramId)) return; // already listed
        let perms: string[] = [];
        try { perms = JSON.parse(rec.permissions || '[]'); } catch { perms = ROLE_DEFAULT_PERMISSIONS[rec.role] || []; }
        list.push({
          telegramId: rec.telegramId,
          name: rec.name || 'Admin',
          role: rec.role,
          permissions: perms,
          addedBy: rec.addedBy || null,
          isSuperAdmin: false,
          isPrimary: false,
          createdAt: rec.createdAt || null,
        });
      });

      res.json({ admins: list });
    } catch (error) {
      console.error('Error listing admins:', error);
      res.status(500).json({ message: 'Failed to list admins' });
    }
  });

  // Add or update an admin
  app.post('/api/admin/admins', authenticateAdmin, async (req: any, res) => {
    try {
      const callerTelegramId = req.user?.telegramUser?.id?.toString() || '';
      const callerRole = await getAdminRole(callerTelegramId);
      if (!callerRole?.permissions.includes('manage_admins')) {
        return res.status(403).json({ message: 'Permission denied: manage_admins required' });
      }

      const { telegramId, name, role, permissions } = req.body;
      if (!telegramId || !role) {
        return res.status(400).json({ message: 'telegramId and role are required' });
      }
      if (!['super_admin', 'finance', 'moderator', 'content'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }

      const permsToSave = Array.isArray(permissions)
        ? permissions
        : (ROLE_DEFAULT_PERMISSIONS[role] || []);

      await db.insert(adminRoles).values({
        telegramId: telegramId.toString(),
        name: name || 'Admin',
        role,
        permissions: JSON.stringify(permsToSave),
        addedBy: callerTelegramId,
      }).onConflictDoUpdate({
        target: adminRoles.telegramId,
        set: {
          name: name || 'Admin',
          role,
          permissions: JSON.stringify(permsToSave),
          updatedAt: new Date(),
        }
      });

      res.json({ success: true, message: 'Admin saved' });
    } catch (error) {
      console.error('Error saving admin:', error);
      res.status(500).json({ message: 'Failed to save admin' });
    }
  });

  // Remove an admin from DB (only DB-added admins can be removed; env admins just get reset to super_admin)
  app.delete('/api/admin/admins/:telegramId', authenticateAdmin, async (req: any, res) => {
    try {
      const callerTelegramId = req.user?.telegramUser?.id?.toString() || '';
      const callerRole = await getAdminRole(callerTelegramId);
      if (!callerRole?.permissions.includes('manage_admins')) {
        return res.status(403).json({ message: 'Permission denied: manage_admins required' });
      }

      const targetId = req.params.telegramId;

      // Prevent self-removal
      if (targetId === callerTelegramId) {
        return res.status(400).json({ message: 'Cannot remove yourself' });
      }

      // Super admin can never be removed
      if (isSuperAdmin(targetId)) {
        return res.status(400).json({ message: 'Cannot remove the super admin (TELEGRAM_ADMIN_ID / SUPER_ADMIN_ID).' });
      }

      // Sub-admins in TELEGRAM_ADMIN_IDS env var cannot be removed via UI either
      const subEnvIds = (process.env.TELEGRAM_ADMIN_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (subEnvIds.includes(targetId)) {
        return res.status(400).json({ message: 'Cannot remove env-configured admin. Remove from TELEGRAM_ADMIN_IDS env var instead.' });
      }

      await db.delete(adminRoles).where(eq(adminRoles.telegramId, targetId));
      res.json({ success: true, message: 'Admin removed' });
    } catch (error) {
      console.error('Error removing admin:', error);
      res.status(500).json({ message: 'Failed to remove admin' });
    }
  });

  // Admin stats endpoint
  app.get('/api/admin/stats', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('📊 Admin stats requested by:', req.user?.telegramUser?.id);
      
      // Get various statistics for admin dashboard using drizzle
      const totalUsersCount = await db.select({ count: sql<number>`count(*)` }).from(users);
      const totalEarningsSum = await db.select({ total: sql<string>`COALESCE(SUM(${users.totalEarned}), '0')` }).from(users);
      
      // Fixed status filters to match database values exactly
      const validStatuses = ['completed', 'success', 'paid', 'Approved'];
      const totalWithdrawalsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
      const pendingWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(eq(withdrawals.status, 'pending'));
      const successfulWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
      const rejectedWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`LOWER(${withdrawals.status}) = 'rejected'`);
      
      const activePromosCount = await db.select({ count: sql<number>`count(*)` }).from(promoCodes).where(eq(promoCodes.isActive, true));
      
      // Fixed daily active count logic
      const dailyActiveCount = await db.select({ count: sql<number>`count(distinct ${earnings.userId})` }).from(earnings).where(sql`DATE(${earnings.createdAt}) = CURRENT_DATE`);
      
      const totalAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatched}), 0)` }).from(users);
      const todayAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatchedToday}), 0)` }).from(users);
      const tonWithdrawnSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);

      const stats = {
        totalUsers: totalUsersCount[0]?.count || 0,
        totalEarnings: totalEarningsSum[0]?.total || '0',
        totalWithdrawals: totalWithdrawalsSum[0]?.total || '0',
        tonWithdrawn: tonWithdrawnSum[0]?.total || '0',
        pendingWithdrawals: pendingWithdrawalsCount[0]?.count || 0,
        successfulWithdrawals: successfulWithdrawalsCount[0]?.count || 0,
        rejectedWithdrawals: rejectedWithdrawalsCount[0]?.count || 0,
        activePromos: activePromosCount[0]?.count || 0,
        dailyActiveUsers: dailyActiveCount[0]?.count || 0,
        totalAdsWatched: totalAdsSum[0]?.total || 0,
        todayAdsWatched: todayAdsSum[0]?.total || 0,
      };
      
      console.log('✅ Admin stats calculated:', stats);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ 
        message: "Failed to fetch admin stats",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get admin settings
  app.get('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settings = await db.select().from(adminSettings);
      
      // Helper function to get setting value
      const getSetting = (key: string, defaultValue: any) => {
        const setting = settings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };
      
      // Return all settings in format expected by frontend with NEW defaults
      res.json({
        dailyAdLimit: parseInt(getSetting('daily_ad_limit', '50')),
        rewardPerAd: parseInt(getSetting('reward_per_ad', '2')), // Default 2 PAD
        affiliateCommission: parseFloat(getSetting('affiliate_commission', '10')),
        l1CommissionPercent: parseFloat(getSetting('l1_commission_percent', '20')),
        l2CommissionPercent: parseFloat(getSetting('l2_commission_percent', '4')),
        walletChangeFee: parseInt(getSetting('wallet_change_fee', '100')), // Return as PAD, default 100
        minimumWithdrawalUSD: parseFloat(getSetting('minimum_withdrawal_usd', '1.00')), // NEW: Min USD withdrawal
        minimumWithdrawalTON: parseFloat(getSetting('minimum_withdrawal_ton', '0.5')), // NEW: Min TON withdrawal
        withdrawalFeeTON: parseFloat(getSetting('withdrawal_fee_ton', '5')), // NEW: TON withdrawal fee %
        withdrawalFeeUSD: parseFloat(getSetting('withdrawal_fee_usd', '3')), // NEW: USD withdrawal fee %
        channelTaskCost: parseFloat(getSetting('channel_task_cost_usd', '0.003')), // NEW: Channel cost in USD (admin only)
        botTaskCost: parseFloat(getSetting('bot_task_cost_usd', '0.003')), // NEW: Bot cost in USD (admin only)
        channelTaskCostTON: parseFloat(getSetting('channel_task_cost_ton', '0.0003')), // TON cost for regular users
        botTaskCostTON: parseFloat(getSetting('bot_task_cost_ton', '0.0003')), // TON cost for regular users
        channelTaskReward: parseInt(getSetting('channel_task_reward', '1000')), // NEW: Channel reward in PAD
        botTaskReward: parseInt(getSetting('bot_task_reward', '1000')), // NEW: Bot reward in PAD
        partnerTaskReward: parseInt(getSetting('partner_task_reward', '1000')), // NEW: Partner reward in PAD
        minimumConvertPOW: parseInt(getSetting('minimum_convert_pad', '100')), // NEW: Min convert in PAD (100 PAD = $0.01)
        minimumConvertUSD: parseInt(getSetting('minimum_convert_pad', '100')) / 10000, // Convert to USD
        minimumClicks: parseInt(getSetting('minimum_clicks', '500')), // NEW: Min clicks for task creation
        seasonBroadcastActive: getSetting('season_broadcast_active', 'false') === 'true',
        hourlyAdLimit: parseInt(getSetting('hourly_ad_limit', '63')),
        referralRewardEnabled: getSetting('referral_reward_enabled', 'false') === 'true',
        referralRewardUSD: parseFloat(getSetting('referral_reward_usd', '0.0005')),
        referralRewardPOW: parseInt(getSetting('referral_reward_pad', '50')),
        referralRewardPOWEnabled: getSetting('referral_reward_pad_enabled', 'true') === 'true',
        referralRewardUSDEnabled: getSetting('referral_reward_usd_enabled', 'false') === 'true',
        referralAdsRequired: parseInt(getSetting('referral_ads_required', '1')),
        // Daily task rewards
        streakReward: parseInt(getSetting('streak_reward', '100')),
        shareTaskReward: parseInt(getSetting('share_task_reward', '1000')),
        communityTaskReward: parseInt(getSetting('community_task_reward', '1000')),
        // Withdrawal requirements
        withdrawalAdRequirementEnabled: getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true',
        minimumAdsForWithdrawal: parseInt(getSetting('minimum_ads_for_withdrawal', '100')),
        withdrawalInviteRequirementEnabled: getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true',
        minimumInvitesForWithdrawal: parseInt(getSetting('minimum_invites_for_withdrawal', '3')),
        // STAR currency settings (weekly contest only)
        starRewardPerAd: parseInt(getSetting('star_reward_per_ad', '2')),
        starRewardPerTask: 0,
        powToStarRate: parseInt(getSetting('pow_to_star_rate', '1')),
        minimumConvertPowToStar: parseInt(getSetting('minimum_convert_pow_to_star', '1000')),
        // Withdrawal packages
        withdrawalPackages: JSON.parse(getSetting('withdrawal_packages', '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]')),
        // Legacy fields for backwards compatibility
        minimumWithdrawal: parseFloat(getSetting('minimum_withdrawal_ton', '0.5')),
        taskPerClickReward: parseInt(getSetting('channel_task_reward', '1000')),
        taskCreationCost: parseFloat(getSetting('channel_task_cost_usd', '0.003')),
        minimumConvert: parseInt(getSetting('minimum_convert_pad', '100')) / 10000,
        // Weekly giveaway
        weeklyGiveawayAmount: parseFloat(getSetting('weekly_giveaway_amount', '10')),
        // Mission page ad platform settings
        monetagMissionReward: parseInt(getSetting('monetag_mission_reward', '1000')),
        monetagMissionLimit: parseInt(getSetting('monetag_mission_limit', '25')),
        adexiumMissionReward: parseInt(getSetting('adexium_mission_reward', '1000')),
        adexiumMissionLimit: parseInt(getSetting('adexium_mission_limit', '25')),
        gigaPubMissionReward: parseInt(getSetting('giga_pub_mission_reward', '1000')),
        gigaPubMissionLimit: parseInt(getSetting('giga_pub_mission_limit', '25')),
        monetixMissionReward: parseInt(getSetting('monetix_mission_reward', '1000')),
        monetixMissionLimit: parseInt(getSetting('monetix_mission_limit', '25')),
        weeklyContestEndDate: getSetting('weekly_contest_end_date', ''),
        starsLocked: getSetting('stars_locked', 'false') === 'true',
        // Daily mission rewards
        shareReferralReward: parseInt(getSetting('share_referral_reward', '1000')),
        checkAnnouncementReward: parseInt(getSetting('check_announcement_reward', '1000')),
        adsgramCheckinReward: parseInt(getSetting('adsgram_checkin_reward', '1000')),
        firstActiveReferralReward: parseInt(getSetting('first_active_referral_reward', '2500')),
      });
    } catch (error) {
      console.error("Error fetching admin settings:", error);
      res.status(500).json({ message: "Failed to fetch admin settings" });
    }
  });
  
  // Update admin settings (handled by the route below)

  // Mission Ads Watch endpoint — per-platform reward from admin settings
  app.post('/api/missions/ads/watch', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { platform } = req.body;

      if (!['monetag', 'gigapub', 'monetix'].includes(platform)) {
        return res.status(400).json({ success: false, message: 'Invalid platform' });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.banned) return res.status(403).json({ success: false, message: 'Account banned' });

      // Get per-platform reward from admin settings
      const settings = await db.select().from(adminSettings);
      const getSetting = (key: string, def: string) => settings.find(s => s.settingKey === key)?.settingValue || def;

      let reward: number;
      switch (platform) {
        case 'monetag':
          reward = parseInt(getSetting('monetag_mission_reward', '1000'));
          break;
        case 'gigapub':
          reward = parseInt(getSetting('giga_pub_mission_reward', '1000'));
          break;
        case 'monetix':
          reward = parseInt(getSetting('monetix_mission_reward', '1000'));
          break;
        default:
          reward = 1000;
      }

      await storage.addEarning({
        userId,
        amount: String(reward),
        source: 'mission_ad',
        description: `Mission ad reward (${platform})`,
      });

      return res.json({ success: true, reward });
    } catch (error) {
      console.error('Error in mission ad watch:', error);
      return res.status(500).json({ success: false, message: 'Internal error' });
    }
  });

  // Create or Update Task (Admin)
  app.post('/api/admin/tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const taskData = req.body;
      const [task] = await db.insert(dailyTasks)
        .values({
          ...taskData,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: dailyTasks.id,
          set: {
            ...taskData,
            updatedAt: new Date()
          }
        })
        .returning();
      res.json(task);
    } catch (error) {
      console.error("Error creating/updating task:", error);
      res.status(500).json({ message: "Failed to save task" });
    }
  });

  // Create or Update Promo (Admin)
  app.post('/api/admin/promos', authenticateAdmin, async (req: any, res) => {
    try {
      const promoData = req.body;
      const [promo] = await db.insert(promoCodes)
        .values({
          ...promoData,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: promoCodes.id,
          set: {
            ...promoData,
            updatedAt: new Date()
          }
        })
        .returning();
      res.json(promo);
    } catch (error) {
      console.error("Error creating/updating promo:", error);
      res.status(500).json({ message: "Failed to save promo" });
    }
  });

  // Admin settings update (Optimized)
  app.put('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settingsData = req.body;
      console.log('📝 Updating admin settings:', settingsData);
      
      // Proper camelCase → snake_case that handles acronyms (PAD, USD, BUG, etc.)
      const toSnakeCase2 = (key: string): string =>
        key
          .replace(/([a-z\d])([A-Z])/g, '$1_$2')
          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
          .toLowerCase();

      const updatePromises = Object.entries(settingsData).map(async ([key, value]) => {
        if (value === undefined || value === null) return;
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        
        await db.insert(adminSettings)
          .values({
            settingKey: key,
            settingValue: stringValue,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: adminSettings.settingKey,
            set: {
              settingValue: stringValue,
              updatedAt: new Date()
            }
          });
          
        const snakeKey = toSnakeCase2(key);
        if (snakeKey !== key) {
          await db.insert(adminSettings)
            .values({
              settingKey: snakeKey,
              settingValue: stringValue,
              updatedAt: new Date()
            })
            .onConflictDoUpdate({
              target: adminSettings.settingKey,
              set: {
                settingValue: stringValue,
                updatedAt: new Date()
              }
            });
        }
      });
      
      await Promise.all(updatePromises);
      
      // Broadcast update
      broadcastUpdate({
        type: 'settings_updated',
        message: 'App settings have been updated by admin'
      });
      
      res.json({ success: true, message: "Settings updated successfully" });
    } catch (error) {
      console.error("Error updating admin settings:", error);
      res.status(500).json({ success: false, message: "Failed to update admin settings" });
    }
  });
  
  // Toggle season broadcast
  app.post('/api/admin/season-broadcast', authenticateAdmin, async (req: any, res) => {
    try {
      const { active } = req.body;
      
      if (active === undefined) {
        return res.status(400).json({ message: "active field is required" });
      }
      
      await db.execute(sql`
        INSERT INTO admin_settings (setting_key, setting_value, updated_at)
        VALUES ('season_broadcast_active', ${active ? 'true' : 'false'}, NOW())
        ON CONFLICT (setting_key) 
        DO UPDATE SET setting_value = ${active ? 'true' : 'false'}, updated_at = NOW()
      `);
      
      res.json({ 
        success: true, 
        message: active ? "Season broadcast enabled" : "Season broadcast disabled",
        active 
      });
    } catch (error) {
      console.error("Error toggling season broadcast:", error);
      res.status(500).json({ success: false, message: "Failed to toggle season broadcast" });
    }
  });
  
  // Broadcast message to all users (for admin use)
  app.post('/api/admin/broadcast', authenticateAdmin, async (req: any, res) => {
    try {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      // Get all users with Telegram IDs
      const allUsers = await db.select({ 
        telegramId: users.telegram_id 
      }).from(users).where(sql`${users.telegram_id} IS NOT NULL`);
      
      let successCount = 0;
      let failCount = 0;
      
      // Send message to each user
      for (const user of allUsers) {
        if (user.telegramId) {
          const sent = await sendUserTelegramNotification(user.telegramId, message);
          if (sent) {
            successCount++;
          } else {
            failCount++;
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: `Broadcast sent`,
        details: {
          total: allUsers.length,
          sent: successCount,
          failed: failCount
        }
      });
    } catch (error) {
      console.error("Error broadcasting message:", error);
      res.status(500).json({ message: "Failed to broadcast message" });
    }
  });

  // Admin chart analytics endpoint - get real time-series data
  app.get('/api/admin/analytics/chart', authenticateAdmin, async (req: any, res) => {
    try {
      // Get data for last 7 days grouped by date
      const last7DaysData = await db.execute(sql`
        WITH date_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '6 days',
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS date
        ),
        daily_stats AS (
          SELECT 
            DATE(e.created_at) as date,
            COUNT(DISTINCT e.user_id) as active_users,
            COALESCE(SUM(e.amount), 0) as earnings
          FROM ${earnings} e
          WHERE e.created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY DATE(e.created_at)
        ),
        daily_withdrawals AS (
          SELECT 
            DATE(w.created_at) as date,
            COALESCE(SUM(w.amount), 0) as withdrawals
          FROM ${withdrawals} w
          WHERE w.created_at >= CURRENT_DATE - INTERVAL '6 days'
            AND w.status IN ('completed', 'success', 'paid', 'Approved')
          GROUP BY DATE(w.created_at)
        ),
        daily_user_count AS (
          SELECT 
            DATE(u.created_at) as date,
            COUNT(*) as new_users
          FROM ${users} u
          WHERE u.created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY DATE(u.created_at)
        )
        SELECT 
          ds.date,
          COALESCE(s.active_users, 0) as active_users,
          COALESCE(s.earnings, 0) as earnings,
          COALESCE(w.withdrawals, 0) as withdrawals,
          COALESCE(u.new_users, 0) as new_users
        FROM date_series ds
        LEFT JOIN daily_stats s ON ds.date = s.date
        LEFT JOIN daily_withdrawals w ON ds.date = w.date
        LEFT JOIN daily_user_count u ON ds.date = u.date
        ORDER BY ds.date ASC
      `);

      // Get cumulative user count for each day
      const totalUsersBeforeWeek = await db.select({ count: sql<number>`count(*)` })
        .from(users)
        .where(sql`${users.createdAt} < CURRENT_DATE - INTERVAL '6 days'`);
      
      // Ensure initial count is a number to prevent string concatenation
      let cumulativeUsers = Number(totalUsersBeforeWeek[0]?.count || 0);
      
      const chartData = last7DaysData.rows.map((row: any, index: number) => {
        cumulativeUsers += Number(row.new_users || 0);
        return {
          period: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          users: Number(cumulativeUsers), // Ensure it's a number in the output
          earnings: parseFloat(row.earnings || '0'),
          withdrawals: parseFloat(row.withdrawals || '0'),
          activeUsers: Number(row.active_users || 0)
        };
      });

      res.json({
        success: true,
        data: chartData
      });
    } catch (error) {
      console.error("Error fetching chart analytics:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to fetch analytics data" 
      });
    }
  });

  // Admin user tracking endpoint - search by UID/referral code OR user ID
  app.get('/api/admin/user-tracking/:uid', authenticateAdmin, async (req: any, res) => {
    try {
      const { uid } = req.params;
      
      // Search user by referral code OR user ID
      const userResults = await db
        .select()
        .from(users)
        .where(sql`${users.referralCode} = ${uid} OR ${users.id} = ${uid}`)
        .limit(1);
      
      if (userResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found - please check the UID/ID and try again'
        });
      }
      
      const user = userResults[0];
      
      // Get withdrawal count
      const withdrawalCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id));
      
      // Get referral count
      const referralCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.referrerId, user.id));
      
      res.json({
        success: true,
        user: {
          uid: user.referralCode,
          userId: user.id,
          balance: user.balance,
          totalEarnings: user.totalEarned,
          withdrawalCount: withdrawalCount[0]?.count || 0,
          referralCount: referralCount[0]?.count || 0,
          status: user.banned ? 'Banned' : 'Active',
          joinedDate: user.createdAt,
          adsWatched: user.adsWatched,
          walletAddress: user.tonWalletAddress || 'Not set'
        }
      });
    } catch (error) {
      console.error("Error fetching user tracking:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to fetch user data" 
      });
    }
  });

  // Admin users endpoint
  // Admin users list
  app.get('/api/admin/users', authenticateAdmin, async (req: any, res) => {
    try {
      const q = (req.query.q as string || '').trim().toLowerCase();
      let allUsers = await db.select().from(users).orderBy(desc(users.createdAt));

      if (q) {
        allUsers = allUsers.filter(u => {
          const tid = (u.telegram_id || '').toLowerCase();
          const fn = (u.first_name || '').toLowerCase();
          const ln = (u.last_name || '').toLowerCase();
          const un = (u.username || '').toLowerCase();
          const rc = (u.referralCode || '').toLowerCase();
          const pc = (u.personalCode || '').toLowerCase();
          return tid.includes(q) || fn.includes(q) || ln.includes(q) || un.includes(q) || rc.includes(q) || pc.includes(q) || `${fn} ${ln}`.includes(q);
        });
      }

      res.json(allUsers.map(u => ({
        ...u,
        id: u.id,
        telegramId: u.telegram_id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        balance: u.balance?.toString() || '0',
        totalEarned: u.totalEarned?.toString() || '0'
      })));
    } catch (error) {
      console.error("Error fetching admin users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Admin banned users endpoint
  app.get('/api/admin/banned-users', authenticateAdmin, async (req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const bannedUsers = allUsers.filter(user => user.banned);
      res.json(bannedUsers);
    } catch (error) {
      console.error("Error fetching banned users:", error);
      res.status(500).json({ message: "Failed to fetch banned users" });
    }
  });

  // Admin ban/unban user endpoint (by URL param)
  app.post('/api/admin/users/:id/ban', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { banned } = req.body;
      
      await storage.updateUserBanStatus(id, banned);
      
      res.json({ 
        success: true,
        message: banned ? 'User banned successfully' : 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error updating user ban status:", error);
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Admin ban/unban user endpoint (by body)
  app.post('/api/admin/users/ban', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId, banned, reason } = req.body;
      
      if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required" });
      }
      
      // Get admin user ID for logging
      const adminUserId = req.user?.telegramUser?.id?.toString() || 'admin';
      
      await storage.updateUserBanStatus(userId, banned, reason, adminUserId);
      
      res.json({ 
        success: true,
        message: banned ? 'User banned successfully' : 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error updating user ban status:", error);
      res.status(500).json({ success: false, message: "Failed to update user status" });
    }
  });

  // Admin get ban logs endpoint with filtering
  app.get('/api/admin/ban-logs', authenticateAdmin, async (req: any, res) => {
    try {
      const { getBanLogs } = await import('./deviceTracking');
      const limit = parseInt(req.query.limit as string) || 100;
      const filters: any = {};
      
      if (req.query.deviceId) filters.deviceId = req.query.deviceId;
      if (req.query.ip) filters.ip = req.query.ip;
      if (req.query.reason) filters.reason = req.query.reason;
      if (req.query.banType) filters.banType = req.query.banType;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate);
      
      const logs = await getBanLogs(limit, Object.keys(filters).length > 0 ? filters : undefined);
      
      res.json({ success: true, logs });
    } catch (error) {
      console.error("Error fetching ban logs:", error);
      res.status(500).json({ success: false, message: "Failed to fetch ban logs" });
    }
  });

  // Admin get banned users with full details for admin panel
  app.get('/api/admin/banned-users-details', authenticateAdmin, async (req: any, res) => {
    try {
      const { getBannedUsersWithDetails } = await import('./deviceTracking');
      const bannedUsers = await getBannedUsersWithDetails();
      
      res.json({ success: true, bannedUsers });
    } catch (error) {
      console.error("Error fetching banned users details:", error);
      res.status(500).json({ success: false, message: "Failed to fetch banned users" });
    }
  });

  // Admin: manually trigger full referral repair (sync + activate)
  app.post('/api/admin/referrals/sync', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('🔧 Admin triggered fullReferralRepair');
      const stats = await storage.fullReferralRepair();
      res.json({ success: true, stats });
    } catch (error) {
      console.error('Error in admin referral sync:', error);
      res.status(500).json({ success: false, message: 'Referral sync failed' });
    }
  });

  // Admin: manually link two users by referral code (recover missed referral links)
  app.post('/api/admin/referrals/manual-link', authenticateAdmin, async (req: any, res) => {
    try {
      const { referrerCode, refereeId } = req.body;
      if (!referrerCode || !refereeId) {
        return res.status(400).json({ success: false, message: 'referrerCode and refereeId are required' });
      }
      const referrer = await storage.getUserByReferralCode(referrerCode);
      if (!referrer) {
        return res.status(404).json({ success: false, message: `Referrer not found for code: ${referrerCode}` });
      }
      const referee = await storage.getUser(refereeId);
      if (!referee) {
        return res.status(404).json({ success: false, message: `Referee user not found: ${refereeId}` });
      }
      if (referrer.id === referee.id) {
        return res.status(400).json({ success: false, message: 'Cannot self-refer' });
      }
      const existing = await storage.getReferralByUsers(referrer.id, referee.id);
      if (existing) {
        return res.json({ success: false, message: 'Referral relationship already exists', referral: existing });
      }
      const referral = await storage.createReferral(referrer.id, referee.id);
      // Immediately try to activate if eligible
      await storage.checkAndActivateReferralBonus(referee.id);
      res.json({ success: true, message: `Linked ${referee.username || refereeId} under ${referrer.username || referrerCode}`, referral });
    } catch (error: any) {
      console.error('Error in manual referral link:', error);
      res.status(500).json({ success: false, message: error.message || 'Manual link failed' });
    }
  });

  // Admin: get referral overview stats
  app.get('/api/admin/referrals/stats', authenticateAdmin, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) AS total
        FROM referrals
      `);
      const usersWithReferrer = await db.execute(sql`
        SELECT COUNT(*) AS count FROM users
        WHERE referred_by IS NOT NULL AND referred_by != ''
      `);
      res.json({
        success: true,
        referrals: result.rows[0],
        usersWithReferrer: usersWithReferrer.rows[0],
      });
    } catch (error) {
      console.error('Error in admin referral stats:', error);
      res.status(500).json({ success: false, message: 'Failed to get referral stats' });
    }
  });

  // Admin unban user endpoint
  app.post('/api/admin/users/:id/unban', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const adminUserId = req.user?.telegramUser?.id?.toString() || 'admin';
      
      const { unbanUser } = await import('./deviceTracking');
      const success = await unbanUser(id, adminUserId);
      
      if (success) {
        res.json({ 
          success: true,
          message: 'User unbanned successfully'
        });
      } else {
        res.status(400).json({ success: false, message: "Failed to unban user" });
      }
    } catch (error) {
      console.error("Error unbanning user:", error);
      res.status(500).json({ success: false, message: "Failed to unban user" });
    }
  });

  // Admin self-unban endpoint (for emergency recovery when admin is accidentally banned)
  app.post('/api/admin/self-unban', async (req: any, res) => {
    try {
      const { initData } = req.body;
      
      if (!initData) {
        return res.status(400).json({ success: false, message: "Missing Telegram initData" });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const adminTelegramId = process.env.TELEGRAM_ADMIN_ID;
      
      if (!botToken || !adminTelegramId) {
        console.error('❌ Self-unban failed: Missing bot token or admin ID config');
        return res.status(500).json({ success: false, message: "Server configuration error" });
      }
      
      // Verify Telegram initData signature
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(initData, botToken);
      
      if (!isValid || !telegramUser) {
        console.log('❌ Self-unban failed: Invalid Telegram data signature');
        return res.status(401).json({ success: false, message: "Invalid authentication" });
      }
      
      // Verify the user is the admin
      if (!isAdmin(telegramUser.id.toString())) {
        console.log(`❌ Self-unban denied: User ${telegramUser.id} is not admin`);
        return res.status(403).json({ success: false, message: "Only admin can use this feature" });
      }
      
      // Find admin user by telegram_id
      const [adminUser] = await db
        .select({ id: users.id, banned: users.banned })
        .from(users)
        .where(eq(users.telegram_id, adminTelegramId));
      
      if (!adminUser) {
        return res.status(404).json({ success: false, message: "Admin user not found" });
      }
      
      if (!adminUser.banned) {
        return res.json({ success: true, message: "Admin is not banned" });
      }
      
      // Unban the admin
      const { unbanUser } = await import('./deviceTracking');
      const success = await unbanUser(adminUser.id, 'self-unban');
      
      if (success) {
        console.log(`✅ Admin ${adminTelegramId} successfully self-unbanned`);
        res.json({ 
          success: true,
          message: 'Admin successfully unbanned'
        });
      } else {
        res.status(400).json({ success: false, message: "Failed to unban admin" });
      }
    } catch (error) {
      console.error("Error in admin self-unban:", error);
      res.status(500).json({ success: false, message: "Failed to process self-unban" });
    }
  });

  // ============ Admin Task Management Endpoints ============

  app.get('/api/admin/pending-tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const pendingTasks = await storage.getPendingTasks();
      
      const tasksWithUserInfo = await Promise.all(
        pendingTasks.map(async (task) => {
          const advertiser = await storage.getUser(task.advertiserId);
          return {
            ...task,
            advertiserUid: advertiser?.uid || 'Unknown',
            advertiserName: advertiser?.firstName || advertiser?.username || 'Unknown',
            advertiserTelegramUsername: advertiser?.username || '',
          };
        })
      );
      
      res.json({ success: true, tasks: tasksWithUserInfo });
    } catch (error) {
      console.error("Error fetching pending tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch pending tasks" });
    }
  });

  app.get('/api/admin/all-tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const allTasks = await storage.getAllTasks();
      
      const tasksWithUserInfo = await Promise.all(
        allTasks.map(async (task) => {
          const advertiser = await storage.getUser(task.advertiserId);
          return {
            ...task,
            advertiserUid: advertiser?.uid || 'Unknown',
            advertiserName: advertiser?.firstName || advertiser?.username || 'Unknown',
            advertiserTelegramUsername: advertiser?.username || '',
          };
        })
      );
      
      res.json({ success: true, tasks: tasksWithUserInfo });
    } catch (error) {
      console.error("Error fetching all tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch tasks" });
    }
  });

  app.post('/api/admin/tasks/:taskId/approve', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      
      if (task.status !== "under_review") {
        return res.status(400).json({ success: false, message: "Task is not under review" });
      }
      
      const updatedTask = await storage.approveTask(taskId);
      console.log(`✅ Task ${taskId} approved by admin`);
      
      res.json({ success: true, task: updatedTask, message: "Task approved successfully" });
    } catch (error) {
      console.error("Error approving task:", error);
      res.status(500).json({ success: false, message: "Failed to approve task" });
    }
  });

  app.post('/api/admin/tasks/:taskId/reject', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      
      if (task.status !== "under_review") {
        return res.status(400).json({ success: false, message: "Task is not under review" });
      }
      
      const updatedTask = await storage.rejectTask(taskId);
      console.log(`❌ Task ${taskId} rejected by admin`);
      
      res.json({ success: true, task: updatedTask, message: "Task rejected" });
    } catch (error) {
      console.error("Error rejecting task:", error);
      res.status(500).json({ success: false, message: "Failed to reject task" });
    }
  });

  app.post('/api/admin/tasks/:taskId/pause', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      
      if (task.status !== "running") {
        return res.status(400).json({ success: false, message: "Only running tasks can be paused" });
      }
      
      const updatedTask = await storage.pauseTask(taskId);
      console.log(`⏸️ Task ${taskId} paused by admin`);
      
      res.json({ success: true, task: updatedTask, message: "Task paused" });
    } catch (error) {
      console.error("Error pausing task:", error);
      res.status(500).json({ success: false, message: "Failed to pause task" });
    }
  });

  app.post('/api/admin/tasks/:taskId/resume', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      
      if (task.status !== "paused") {
        return res.status(400).json({ success: false, message: "Only paused tasks can be resumed" });
      }
      
      const updatedTask = await storage.resumeTask(taskId);
      console.log(`▶️ Task ${taskId} resumed by admin`);
      
      res.json({ success: true, task: updatedTask, message: "Task resumed" });
    } catch (error) {
      console.error("Error resuming task:", error);
      res.status(500).json({ success: false, message: "Failed to resume task" });
    }
  });

  app.delete('/api/admin/tasks/:taskId', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      
      const success = await storage.deleteTask(taskId);
      
      if (success) {
        console.log(`🗑️ Task ${taskId} deleted by admin`);
        res.json({ success: true, message: "Task deleted successfully" });
      } else {
        res.status(500).json({ success: false, message: "Failed to delete task" });
      }
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ success: false, message: "Failed to delete task" });
    }
  });

  // ============ End Admin Task Management ============

  // Database setup endpoint for free plan deployments (call once after deployment)
  app.post('/api/setup-database', async (req: any, res) => {
    try {
      // Only allow this in production and with a setup key for security
      const { setupKey } = req.body;
      
      if (setupKey !== 'setup-database-schema-2024') {
        return res.status(403).json({ message: "Invalid setup key" });
      }

      console.log('🔧 Setting up database schema...');
      
      // Use drizzle-kit to push schema
      const { execSync } = await import('child_process');
      
      try {
        execSync('npx drizzle-kit push --force', { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
        
        
        console.log('✅ Database setup completed successfully');
        
        res.json({
          success: true,
          message: 'Database schema setup completed successfully'
        });
      } catch (dbError) {
        console.error('Database setup error:', dbError);
        res.status(500).json({ 
          success: false, 
          message: 'Database setup failed',
          error: String(dbError)
        });
      }
    } catch (error) {
      console.error("Error setting up database:", error);
      res.status(500).json({ message: "Failed to setup database" });
    }
  });

  // Task/Promotion API routes
  
  // Get all active promotions/tasks for current user
  app.get('/api/tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const result = await storage.getAvailablePromotionsForUser(userId);
      res.json(result);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // Complete a task
  app.post('/api/tasks/:promotionId/complete', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramUserId = req.user.telegramUser.id.toString();
      const { promotionId } = req.params;
      const { taskType, channelUsername, botUsername } = req.body;
      
      // Validate required parameters
      if (!taskType) {
        console.log(`❌ Task completion blocked: Missing taskType for user ${userId}`);
        return res.status(400).json({ 
          success: false, 
          message: '❌ Task cannot be completed: Missing task type parameter.' 
        });
      }
      
      // Validate taskType is one of the allowed values
      const allowedTaskTypes = [
        'channel', 'bot', 'daily', 'fix',
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ];
      if (!allowedTaskTypes.includes(taskType)) {
        console.log(`❌ Task completion blocked: Invalid taskType '${taskType}' for user ${userId}`);
        return res.status(400).json({ 
          success: false, 
          message: '❌ Task cannot be completed: Invalid task type.' 
        });
      }
      
      console.log(`📋 Task completion attempt:`, {
        userId,
        telegramUserId,
        promotionId,
        taskType,
        channelUsername,
        botUsername
      });
      
      // Perform Telegram verification based on task type
      let isVerified = false;
      let verificationMessage = '';
      
      if (taskType === 'channel' && channelUsername) {
        // Verify channel membership using Telegram Bot API
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
          isVerified = false;
        } else {
          const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelUsername}`, process.env.BOT_TOKEN || botToken);
          isVerified = isMember;
        }
        verificationMessage = isVerified 
          ? 'Channel membership verified successfully' 
          : `Please join the channel @${channelUsername} first to complete this task`;
      } else if (taskType === 'bot' && botUsername) {
        // For bot tasks, we'll consider them verified if the user is in the WebApp
        // (since they would need to interact with the bot to access the WebApp)
        isVerified = true;
        verificationMessage = 'Bot interaction verified';
      } else if (taskType === 'daily') {
        // Daily tasks require channel membership if channelUsername is provided
        if (channelUsername) {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (!botToken) {
            console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
            isVerified = false;
          } else {
            const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelUsername}`, process.env.BOT_TOKEN || botToken);
            isVerified = isMember;
          }
          verificationMessage = isVerified 
            ? 'Daily task verification successful' 
            : `Please join the channel @${channelUsername} first to complete this task`;
        } else {
          isVerified = true;
          verificationMessage = 'Daily task completed';
        }
      } else if (taskType === 'fix') {
        // Fix tasks are verified by default (user opening link is verification)
        isVerified = true;
        verificationMessage = 'Fix task completed';
      } else if (taskType === 'channel_visit') {
        // Channel visit task requires channel membership verification
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
          isVerified = false;
          verificationMessage = 'Channel verification failed - bot token not configured';
        } else {
          // Extract channel username from promotion URL
          const promotion = await storage.getPromotion(promotionId);
          const channelMatch = promotion?.url?.match(/t\.me\/([^/?]+)/);
          const channelName = channelMatch ? channelMatch[1] : 'PaidAdsNews';
          
          const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelName}`, botToken);
          isVerified = isMember;
          verificationMessage = isVerified 
            ? 'Channel membership verified successfully' 
            : `Please join the channel @${channelName} first to complete this task`;
        }
      } else if (taskType === 'share_link') {
        // Share link task requires user to have shared their affiliate link  
        const hasSharedToday = await storage.hasSharedLinkToday(userId);
        isVerified = hasSharedToday;
        verificationMessage = isVerified
          ? 'App link sharing verified successfully'
          : 'Not completed yet. Please share your affiliate link first.';
      } else if (taskType === 'invite_friend') {
        // Invite friend task requires exactly 1 valid referral today
        const hasValidReferralToday = await storage.hasValidReferralToday(userId);
        isVerified = hasValidReferralToday;
        verificationMessage = isVerified 
          ? 'Valid friend invitation verified for today' 
          : 'Not completed yet. Please invite a friend using your referral link first.';
      } else if (taskType.startsWith('ads_goal_')) {
        // Ads goal tasks require checking user's daily ad count
        const hasMetGoal = await storage.checkAdsGoalCompletion(userId, taskType);
        const user = await storage.getUser(userId);
        const adsWatchedToday = user?.adsWatchedToday || 0;
        
        // Get required ads for this task type
        const adsGoalThresholds = {
          'ads_goal_mini': 15,
          'ads_goal_light': 25,
          'ads_goal_medium': 45,
          'ads_goal_hard': 75
        };
        const requiredAds = adsGoalThresholds[taskType as keyof typeof adsGoalThresholds] || 0;
        
        isVerified = hasMetGoal;
        verificationMessage = isVerified 
          ? 'Ads goal achieved successfully!' 
          : `Not eligible yet. Watch ${requiredAds - adsWatchedToday} more ads (${adsWatchedToday}/${requiredAds} watched).`;
      } else {
        console.log(`❌ Task validation failed: Invalid task type '${taskType}' or missing parameters`, {
          taskType,
          channelUsername,
          botUsername,
          promotionId,
          userId
        });
        return res.status(400).json({ 
          success: false, 
          message: '❌ Task cannot be completed: Invalid task type or missing parameters.' 
        });
      }
      
      if (!isVerified) {
        console.log(`❌ Task verification failed for user ${userId}:`, verificationMessage);
        let friendlyMessage = '❌ Verification failed. Please complete the required action first.';
        if (taskType === 'channel' && channelUsername) {
          friendlyMessage = `❌ Verification failed. Please make sure you joined the required channel @${channelUsername}.`;
        } else if (taskType === 'bot' && botUsername) {
          friendlyMessage = `❌ Verification failed. Please make sure you started the bot @${botUsername}.`;
        }
        return res.status(400).json({ 
          success: false, 
          message: verificationMessage,
          friendlyMessage
        });
      }
      
      console.log(`✅ Task verification successful for user ${userId}:`, verificationMessage);
      
      // Get promotion to fetch actual reward amount
      const promotion = await storage.getPromotion(promotionId);
      if (!promotion) {
        return res.status(404).json({ 
          success: false, 
          message: 'Task not found' 
        });
      }
      
      const rewardAmount = promotion.rewardPerUser || '0.00025';
      console.log(`🔍 Promotion details:`, { rewardPerUser: promotion.rewardPerUser, type: promotion.type, id: promotion.id });
      
      // Determine if this is a daily task (new task types that reset daily)
      const isDailyTask = [
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ].includes(taskType);
      
      if (isDailyTask) {
        console.log(`💰 Using dynamic reward amount: ${rewardAmount} TON`);
      } else {
        console.log(`💰 Using dynamic reward amount: $${rewardAmount}`);
      }
      
      // Complete the task using appropriate method
      const result = isDailyTask 
        ? await storage.completeDailyTask(promotionId, userId, rewardAmount)
        : await storage.completeTask(promotionId, userId, rewardAmount);
      
      if (result.success) {
        // Get updated balance for real-time sync
        let updatedBalance;
        try {
          updatedBalance = await storage.getUserBalance(userId);
          console.log(`💰 Balance updated for user ${userId}: $${updatedBalance?.balance || '0'}`);
          
          // Send real-time balance update to WebSocket clients
          const currencySymbol = isDailyTask ? 'TON' : '$';
          const balanceUpdate = {
            type: 'balance_update',
            balance: updatedBalance?.balance || '0',
            delta: rewardAmount,
            message: `🎉 Task completed! +${currencySymbol}${parseFloat(rewardAmount).toFixed(5)}`
          };
          sendRealtimeUpdate(userId, balanceUpdate);
          console.log(`📡 Real-time balance update sent to user ${userId}`);
          
        } catch (balanceError) {
          console.error('⚠️ Failed to fetch updated balance for real-time sync:', balanceError);
        }
        
        res.json({ 
          ...result, 
          verificationMessage,
          rewardAmount,
          newBalance: updatedBalance?.balance || '0'
        });
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error completing task:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });

  // Promotional system endpoints removed - using daily tasks system only
  
  // Wallet management endpoints
  
  // Get user's saved wallet details - auth removed to prevent popup spam
  app.get('/api/wallet/details', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet details requested without session - sending empty response");
        return res.json({ success: true, skipAuth: true, wallet: null });
      }
      
      const [user] = await db
        .select({
          tonWalletAddress: users.tonWalletAddress,
          tonWalletComment: users.tonWalletComment,
          telegramUsername: users.telegramUsername,
          cwalletId: users.cwalletId,
          walletUpdatedAt: users.walletUpdatedAt
        })
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      res.json({
        success: true,
        walletDetails: {
          tonWalletAddress: user.tonWalletAddress || '',
          tonWalletComment: user.tonWalletComment || '',
          telegramUsername: user.telegramUsername || '',
          cwalletId: user.cwalletId || '',
          cwallet_id: user.cwalletId || '', // Support both formats
          canWithdraw: true
        }
      });
      
    } catch (error) {
      console.error('❌ Error fetching wallet details:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch wallet details' 
      });
    }
  });
  
  // Save user's wallet details - auth removed to prevent popup spam
  app.post('/api/wallet/save', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet save requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      const { tonWalletAddress, tonWalletComment, telegramUsername } = req.body;
      
      console.log('💾 Saving wallet details for user:', userId);
      
      // Update user's wallet details
      await db
        .update(users)
        .set({
          tonWalletAddress: tonWalletAddress || null,
          tonWalletComment: tonWalletComment || null,
          telegramUsername: telegramUsername || null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log('✅ Wallet details saved successfully');
      
      res.json({
        success: true,
        message: 'Wallet details saved successfully.'
      });
      
    } catch (error) {
      console.error('❌ Error saving wallet details:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to save wallet details' 
      });
    }
  });

  // Save Cwallet ID endpoint - auth removed to prevent popup spam
  app.post('/api/wallet/cwallet', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Cwallet save requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      const { cwalletId } = req.body;
      
      console.log('💾 Saving Cwallet ID for user:', userId);
      
      if (!cwalletId || !cwalletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID'
        });
      }
      
      // Validate Cwallet ID (numeric only)
      if (!/^\d+$/.test(cwalletId.trim())) {
        console.log('🚫 Invalid Cwallet ID format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID (numeric only)'
        });
      }
      
      // 🔒 WALLET LOCK: Check if wallet is already set - only allow one-time setup
      const [existingUser] = await db
        .select({ cwalletId: users.cwalletId })
        .from(users)
        .where(eq(users.id, userId));
      
      if (existingUser?.cwalletId) {
        console.log('🚫 Wallet already set - only one time setup allowed');
        return res.status(400).json({
          success: false,
          message: 'Wallet already set — only one time setup allowed'
        });
      }
      
      // 🔐 UNIQUENESS CHECK: Ensure wallet ID is not already used by another account
      const walletToCheck = cwalletId?.trim();
      if (walletToCheck) {
        const [walletInUse] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, walletToCheck),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);
        
        if (walletInUse) {
          console.log('🚫 Cwallet ID already linked to another account');
          return res.status(400).json({
            success: false,
            message: 'This Cwallet ID is already linked to another account.'
          });
        }
      }
      
      // Update user's Cwallet ID
      await db
        .update(users)
        .set({
          cwalletId: cwalletId.trim(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log('✅ TON wallet address saved successfully');
      
      res.json({
        success: true,
        message: 'TON wallet address saved successfully.'
      });
      
    } catch (error) {
      console.error('❌ Error saving TON wallet address:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to save TON wallet address' 
      });
    }
  });

  // Alternative Cwallet save endpoint for compatibility - /api/set-wallet
  app.post('/api/set-wallet', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet save (set-wallet) requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      
      const { cwallet_id, cwalletId } = req.body;
      const walletId = cwallet_id || cwalletId; // Support both formats
      
      console.log('💾 Saving Cwallet ID via /api/set-wallet for user:', userId);
      
      if (!walletId || !walletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Missing TON wallet address'
        });
      }
      
      // Validate TON wallet address (must start with UQ or EQ)
      if (!/^(UQ|EQ)[A-Za-z0-9_-]{46}$/.test(walletId.trim())) {
        console.log('🚫 Invalid TON wallet address format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid TON wallet address'
        });
      }
      
      // 🔒 WALLET LOCK: Check if wallet is already set - only allow one-time setup
      const [existingUser] = await db
        .select({ cwalletId: users.cwalletId })
        .from(users)
        .where(eq(users.id, userId));
      
      if (existingUser?.cwalletId) {
        console.log('🚫 Wallet already set - only one time setup allowed');
        return res.status(400).json({
          success: false,
          message: 'Wallet already set — only one time setup allowed'
        });
      }
      
      // 🔐 UNIQUENESS CHECK: Ensure wallet ID is not already used by another account
      const walletToCheck = cwalletId?.trim();
      if (walletToCheck) {
        const [walletInUse] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, walletToCheck),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);
        
        if (walletInUse) {
          console.log('🚫 Cwallet ID already linked to another account');
          return res.status(400).json({
            success: false,
            message: 'This Cwallet ID is already linked to another account.'
          });
        }
      }
      
      // Update user's Cwallet ID in database - permanent storage
      await db
        .update(users)
        .set({
          cwalletId: cwalletId.trim(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log('✅ Cwallet ID saved permanently via /api/set-wallet');
      
      res.json({
        success: true,
        message: 'Cwallet ID saved successfully'
      });
      
    } catch (error) {
      console.error('❌ Error saving Cwallet ID via /api/set-wallet:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to save wallet'
      });
    }
  });
  
  // Change wallet endpoint - requires dynamic PAD fee from admin settings
  app.post('/api/wallet/change', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet change requested without session - skipping");
        return res.status(401).json({
          success: false,
          message: 'Please log in to change wallet'
        });
      }
      
      const { newWalletId } = req.body;
      
      console.log('🔄 Wallet change request for user:', userId);
      
      if (!newWalletId || !newWalletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID'
        });
      }
      
      // Validate Cwallet ID (numeric only)
      if (!/^\d+$/.test(newWalletId.trim())) {
        console.log('🚫 Invalid Cwallet ID format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID (numeric only)'
        });
      }
      
      // Get wallet change fee from admin settings (stored in PAD)
      const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
      const feeInPow = parseInt(walletChangeFee);
      const feeInTon = feeInPow / 10000000;
      
      console.log(`💰 Wallet change fee: ${feeInPow} POW (${feeInTon} TON)`);
      
      // Use database transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        // Get current user with balance
        const [user] = await tx
          .select({
            id: users.id,
            balance: users.balance,
            cwalletId: users.cwalletId,
            telegramId: users.telegram_id
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        // Validation check: ensure it's a different wallet
        if (user.cwalletId === newWalletId.trim()) {
          throw new Error('New Cwallet ID must be different from the current one');
        }

        // Check wallet uniqueness
        const [uniqueWalletCheck] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, newWalletId.trim()),
            sql`${users.id} != ${userId}`
          ))
          .limit(1)
          .for('update');
        
        if (uniqueWalletCheck) {
          throw new Error('This Cwallet ID is already linked to another account');
        }

        const currentBalance = parseFloat(user.balance || '0');
        const currentBalancePow = Math.floor(currentBalance * 10000000);
        
        if (currentBalancePow < feeInPow) {
          throw new Error(`Insufficient balance. You need ${feeInPow} PAD to change wallet. Current balance: ${currentBalancePow} PAD`);
        }
        
        // Deduct fee from balance
        const newBalance = currentBalance - feeInTon;
        
        // Update wallet and balance atomically
        await tx
          .update(users)
          .set({
            cwalletId: newWalletId.trim(),
            balance: newBalance.toFixed(8),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Record transaction
        await tx.insert(transactions).values({
          userId: userId,
          amount: feeInTon.toFixed(8),
          type: 'deduction',
          source: 'wallet_change_fee',
          description: `Fee for changing Cwallet ID (${feeInPow} PAD)`,
          metadata: { oldWallet: user.cwalletId, newWallet: newWalletId.trim(), feePad: feeInPow }
        });
        
        return {
          newBalance: newBalance.toFixed(8),
          newWallet: newWalletId.trim(),
          feeCharged: feeInTon.toFixed(8),
          feePad: feeInPow,
          telegramId: user.telegramId
        };
      });
      
      console.log('✅ Wallet changed successfully with fee deduction');
      
      // Send notification via WebSocket
      if (result.telegramId && wss) {
        wss.clients.forEach((client: WebSocket) => {
          if ((client as any).userId === userId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'wallet_changed',
              message: `Wallet updated successfully! ${result.feePad} PAD fee deducted.`,
              data: {
                newWalletId: result.newWallet,
                newBalance: result.newBalance,
                feeCharged: result.feePad
              }
            }));
          }
        });
      }
      
      res.json({
        success: true,
        message: 'Wallet updated successfully',
        data: {
          newWalletId: result.newWallet,
          newBalance: result.newBalance,
          feeCharged: result.feeCharged,
          feePad: result.feePad
        }
      });
      
    } catch (error) {
      console.error('❌ Error changing wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to change wallet'
      });
    }
  });
  

  // PAD conversion endpoint (supports USD, TON, BUG)
  app.post('/api/convert-to-usd', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { powAmount, convertTo = 'USD' } = req.body;
      
      console.log('💵 POW conversion request:', { userId, powAmount, convertTo });
      
      const convertAmount = parseFloat(powAmount);
      if (!powAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid POW amount'
        });
      }
      
      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        // Lock user row and get current balances
        const [user] = await tx
          .select({ 
            balance: users.balance,
            usdBalance: users.usdBalance,
            tonBalance: users.tonBalance,
            starBalance: users.starBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        const currentPowBalance = parseFloat(user.balance || '0');
        
        if (currentPowBalance < convertAmount) {
          throw new Error('Insufficient POW balance');
        }
        
        const newPowBalance = currentPowBalance - convertAmount;
        let updateData: any = {
          balance: String(Math.round(newPowBalance)),
          updatedAt: new Date()
        };
        
        let convertedAmount = 0;
        let convertedCurrency = convertTo;
        
        if (convertTo === 'USD') {
          const conversionRateSetting = await storage.getAppSetting('pad_to_usd_rate', '10000000');
          const POW_TO_USD_RATE = parseFloat(conversionRateSetting);
          convertedAmount = convertAmount / POW_TO_USD_RATE;
          const currentUsdBalance = parseFloat(user.usdBalance || '0');
          updateData.usdBalance = (currentUsdBalance + convertedAmount).toFixed(10);
          console.log(`✅ POW to USD: ${convertAmount} POW → $${convertedAmount.toFixed(4)} USD`);
        } else if (convertTo === 'TON') {
          const padToTonRateSetting = await storage.getAppSetting('pad_to_ton_rate', '10000000');
          const POW_TO_TON_RATE = parseFloat(padToTonRateSetting);
          convertedAmount = convertAmount / POW_TO_TON_RATE;
          const currentTonBalance = parseFloat(user.tonBalance || '0');
          updateData.tonBalance = (currentTonBalance + convertedAmount).toFixed(10);
          console.log(`✅ POW to TON: ${convertAmount} POW → ${convertedAmount.toFixed(6)} TON`);
        } else if (convertTo === 'STAR') {
          const powToStarRateSetting = await storage.getAppSetting('pow_to_star_rate', '1');
          const POW_TO_STAR_RATE = parseFloat(powToStarRateSetting);
          convertedAmount = convertAmount * POW_TO_STAR_RATE;
          const currentStarBalance = parseFloat(user.starBalance || '0');
          updateData.starBalance = (currentStarBalance + convertedAmount).toFixed(10);
          console.log(`✅ POW to STAR: ${convertAmount} POW → ${convertedAmount.toFixed(0)} STAR`);
        }
        
        await tx.update(users).set(updateData).where(eq(users.id, userId));

        // Log the conversion as a transaction record
        await tx.insert(transactions).values({
          userId,
          amount: String(-convertAmount),
          type: 'debit',
          source: 'convert',
          description: `Converted ${convertAmount.toLocaleString()} POW to ${convertedCurrency}`,
        });
        
        return {
          powAmount: convertAmount,
          convertedAmount,
          convertedCurrency,
          newPowBalance,
          newUsdBalance: updateData.usdBalance ?? user.usdBalance,
          newTonBalance: updateData.tonBalance ?? user.tonBalance,
          newStarBalance: updateData.starBalance ?? user.starBalance,
        };
      });
      
      // Send actual new balance values so frontend updates INSTANTLY without waiting for refetch
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPowBalance),
        usdBalance: result.newUsdBalance,
        tonBalance: result.newTonBalance,
        starBalance: result.newStarBalance,
      });
      
      res.json({
        success: true,
        message: `Converted to ${result.convertedCurrency} successfully!`,
        ...result
      });
      
    } catch (error) {
      console.error('❌ Error converting POW:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      res.status(errorMessage === 'Insufficient POW balance' ? 400 : 500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // PAD to TON conversion endpoint
  app.post('/api/convert-to-ton', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ TON conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { powAmount } = req.body;
      
      console.log('💎 POW to TON conversion request:', { userId, powAmount });
      
      const convertAmount = parseFloat(powAmount);
      if (!powAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid POW amount'
        });
      }

      // Get minimum conversion from admin settings
      const minConvertSetting = await storage.getAppSetting('minimum_convert_pad_to_ton', '10000');
      const minimumConvertPOW = parseFloat(minConvertSetting);

      if (convertAmount < minimumConvertPOW) {
        return res.status(400).json({
          success: false,
          message: `Minimum POW required for TON conversion`
        });
      }
      
      // Get conversion rate from admin settings (default: 10,000,000 PAD = 1 TON)
      const conversionRateSetting = await storage.getAppSetting('pad_to_ton_rate', '10000000');
      const POW_TO_TON_RATE = parseFloat(conversionRateSetting);
      const tonAmount = convertAmount / POW_TO_TON_RATE;
      
      console.log(`📊 Using conversion rate: ${POW_TO_TON_RATE} POW = 1 TON`);
      
      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ 
            balance: users.balance,
            tonBalance: users.tonBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        const currentPowBalance = parseFloat(user.balance || '0');
        const currentTonBalance = parseFloat(user.tonBalance || '0');
        
        if (currentPowBalance < convertAmount) {
          throw new Error('Insufficient POW balance');
        }
        
        const newPowBalance = currentPowBalance - convertAmount;
        const newTonBalance = currentTonBalance + tonAmount;
        
        await tx
          .update(users)
          .set({
            balance: String(Math.round(newPowBalance)),
            tonBalance: newTonBalance.toFixed(10),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        // Log the conversion as a transaction record
        await tx.insert(transactions).values({
          userId,
          amount: String(-convertAmount),
          type: 'debit',
          source: 'convert',
          description: `Converted ${convertAmount.toLocaleString()} POW to TON`,
        });
        
        console.log(`✅ POW to TON conversion successful: ${convertAmount} POW → ${tonAmount.toFixed(6)} TON`);
        
        return {
          powAmount: convertAmount,
          tonAmount,
          newPowBalance,
          newTonBalance
        };
      });
      
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPowBalance),
        tonBalance: result.newTonBalance.toFixed(10)
      });
      
      res.json({
        success: true,
        message: 'Conversion to TON successful!',
        ...result
      });
      
    } catch (error) {
      console.error('❌ Error converting POW to TON:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      
      res.status(errorMessage === 'Insufficient POW balance' ? 400 : 500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // PAD to BUG conversion endpoint
  app.post('/api/convert-to-bug', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ STAR conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { powAmount } = req.body;
      
      console.log('🌟 POW to STAR conversion request:', { userId, powAmount });
      
      const convertAmount = parseFloat(powAmount);
      if (!powAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid POW amount'
        });
      }

      // Get minimum conversion from admin settings
      const minConvertSetting = await storage.getAppSetting('minimum_convert_pow_to_star', '1000');
      const minimumConvertPOW = parseFloat(minConvertSetting);

      if (convertAmount < minimumConvertPOW) {
        return res.status(400).json({
          success: false,
          message: `Minimum POW required for BUG conversion`
        });
      }
      
      // Get conversion rate from admin settings (default: 1 POW = 1 STAR)
      const conversionRateSetting = await storage.getAppSetting('pow_to_star_rate', '1');
      const POW_TO_STAR_RATE = parseFloat(conversionRateSetting);
      const starAmount = convertAmount / POW_TO_STAR_RATE;
      
      console.log(`📊 Using conversion rate: ${POW_TO_STAR_RATE} POW = 1 STAR`);
      
      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ 
            balance: users.balance,
            starBalance: users.starBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        const currentPowBalance = parseFloat(user.balance || '0');
        const currentStarBalance = parseFloat(user.starBalance || '0');
        
        if (currentPowBalance < convertAmount) {
          throw new Error('Insufficient POW balance');
        }
        
        const newPowBalance = currentPowBalance - convertAmount;
        const newStarBalance = currentStarBalance + starAmount;
        
        await tx
          .update(users)
          .set({
            balance: String(Math.round(newPowBalance)),
            starBalance: newStarBalance.toFixed(10),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ POW to STAR conversion successful: ${convertAmount} POW → ${starAmount.toFixed(0)} STAR`);
        
        return {
          powAmount: convertAmount,
          starAmount,
          newPowBalance,
          newStarBalance
        };
      });
      
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPowBalance),
        starBalance: result.newStarBalance.toFixed(10)
      });
      
      res.json({
        success: true,
        message: 'Conversion to STAR successful!',
        ...result
      });
      
    } catch (error) {
      console.error('❌ Error converting POW to STAR:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      
      res.status(errorMessage === 'Insufficient POW balance' ? 400 : 500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // Setup USDT wallet (Optimism network only)
  app.post('/api/wallet/usdt', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Please log in to set up wallet'
        });
      }
      
      const { usdtAddress } = req.body;
      
      if (!usdtAddress || !usdtAddress.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your USDT wallet address'
        });
      }
      
      // Validate Optimism USDT address (0x... format, 42 characters)
      if (!/^0x[a-fA-F0-9]{40}$/.test(usdtAddress.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Optimism USDT address'
        });
      }
      
      // Check if address is already in use
      const [existingWallet] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.usdtWalletAddress, usdtAddress.trim()),
          sql`${users.id} != ${userId}`
        ))
        .limit(1);
      
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'This USDT address is already linked to another account'
        });
      }
      
      // Check if user already has a USDT wallet - if yes, charge fee for change
      const [currentUser] = await db
        .select({ 
          usdtWalletAddress: users.usdtWalletAddress,
          balance: users.balance
        })
        .from(users)
        .where(eq(users.id, userId));
      
      const isChangingWallet = currentUser?.usdtWalletAddress && currentUser.usdtWalletAddress.trim() !== '';
      
      if (isChangingWallet) {
        // Get wallet change fee from admin settings
        const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
        const feeInPow = parseInt(walletChangeFee);
        
        const currentBalance = parseFloat(currentUser.balance || '0');
        const currentBalancePow = currentBalance < 1 ? Math.floor(currentBalance * 10000000) : Math.floor(currentBalance);
        
        if (currentBalancePow < feeInPow) {
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. You need ${feeInPow} PAD to change wallet. Current balance: ${currentBalancePow} PAD`
          });
        }
        
        // Deduct fee from balance (stored as PAD integer)
        const newBalancePad = currentBalancePow - feeInPow;
        
        // Update wallet and deduct fee
        await db
          .update(users)
          .set({
            usdtWalletAddress: usdtAddress.trim(),
            balance: newBalancePad.toString(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Record transaction
        await db.insert(transactions).values({
          userId: userId,
          amount: feeInPow.toString(),
          type: 'deduction',
          description: `USDT wallet change fee`,
          createdAt: new Date()
        });
        
        console.log(`✅ USDT wallet changed for user ${userId} - Fee: ${feeInPow} POW deducted`);
        
        // Send real-time update
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: newBalancePad.toString()
        });
      } else {
        // First time setup - no fee
        await db
          .update(users)
          .set({
            usdtWalletAddress: usdtAddress.trim(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ USDT wallet set for user ${userId} (first time - no fee)`);
      }
      
      res.json({
        success: true,
        message: 'USDT wallet saved successfully'
      });
      
    } catch (error) {
      console.error('❌ Error setting USDT wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save USDT wallet'
      });
    }
  });

  // Setup Telegram Stars username
  app.post('/api/wallet/telegram-stars', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Please log in to set up username'
        });
      }
      
      let { telegramUsername } = req.body;
      
      if (!telegramUsername || !telegramUsername.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your Telegram username'
        });
      }
      
      // Auto-add @ if not present
      telegramUsername = telegramUsername.trim();
      if (!telegramUsername.startsWith('@')) {
        telegramUsername = '@' + telegramUsername;
      }
      
      // Validate username format: @username (letters, numbers, underscores only, no spaces or special chars)
      if (!/^@[a-zA-Z0-9_]{1,32}$/.test(telegramUsername)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid username format. Use only letters, numbers, and underscores (e.g., @szxzyz)'
        });
      }
      
      // Check if user already has a Telegram username - if yes, charge fee for change
      const [currentUser] = await db
        .select({ 
          telegramStarsUsername: users.telegramStarsUsername,
          balance: users.balance
        })
        .from(users)
        .where(eq(users.id, userId));
      
      const isChangingUsername = currentUser?.telegramStarsUsername && currentUser.telegramStarsUsername.trim() !== '';
      
      if (isChangingUsername) {
        // Get wallet change fee from admin settings
        const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
        const feeInPow = parseInt(walletChangeFee);
        
        const currentBalance = parseFloat(currentUser.balance || '0');
        const currentBalancePow = currentBalance < 1 ? Math.floor(currentBalance * 10000000) : Math.floor(currentBalance);
        
        if (currentBalancePow < feeInPow) {
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. You need ${feeInPow} PAD to change username. Current balance: ${currentBalancePow} PAD`
          });
        }
        
        // Deduct fee from balance (stored as PAD integer)
        const newBalancePad = currentBalancePow - feeInPow;
        
        // Update username and deduct fee
        await db
          .update(users)
          .set({
            telegramStarsUsername: telegramUsername,
            balance: newBalancePad.toString(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Record transaction
        await db.insert(transactions).values({
          userId: userId,
          amount: feeInPow.toString(),
          type: 'deduction',
          description: `Telegram Stars username change fee`,
          createdAt: new Date()
        });
        
        console.log(`✅ Telegram Stars username changed for user ${userId} - Fee: ${feeInPow} POW deducted`);
        
        // Send real-time update
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: newBalancePad.toString()
        });
      } else {
        // First time setup - no fee
        await db
          .update(users)
          .set({
            telegramStarsUsername: telegramUsername,
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ Telegram Stars username set for user ${userId}: ${telegramUsername} (first time - no fee)`);
      }
      
      res.json({
        success: true,
        message: 'Telegram username saved successfully',
        username: telegramUsername
      });
      
    } catch (error) {
      console.error('❌ Error setting Telegram Stars username:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save username'
      });
    }
  });

  // Advertiser Task System API routes
  
  // Get all active advertiser tasks (public task feed) - excludes tasks already completed by user
  app.get('/api/advertiser-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const tasks = await storage.getActiveTasksForUser(userId);
      res.json({ success: true, tasks });
    } catch (error) {
      console.error("Error fetching advertiser tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch tasks" });
    }
  });

  // Get my created tasks
  app.get('/api/advertiser-tasks/my-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const myTasks = await storage.getMyTasks(userId);
      res.json({ success: true, tasks: myTasks });
    } catch (error) {
      console.error("Error fetching my tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch your tasks" });
    }
  });

  // Create new advertiser task
  app.post('/api/advertiser-tasks/create', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskType, title, link, totalClicksRequired } = req.body;

      console.log('📝 Task creation request:', { userId, taskType, title, link, totalClicksRequired });

      // Validation
      if (!taskType || !title || !link || !totalClicksRequired) {
        return res.status(400).json({
          success: false,
          message: "Task type, title, link, and total clicks required are mandatory"
        });
      }

      // Validate task type
      if (taskType !== "channel" && taskType !== "bot" && taskType !== "partner") {
        return res.status(400).json({
          success: false,
          message: "Task type must be 'channel', 'bot', or 'partner'"
        });
      }

      // Get user data to check if admin early for partner task validation
      const [userData] = await db
        .select({ 
          usdBalance: users.usdBalance, 
          tonBalance: users.tonBalance, 
          telegram_id: users.telegram_id 
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const userIsAdmin = isAdmin(userData.telegram_id || '') ||
                          (process.env.NODE_ENV === 'development' && userData.telegram_id === '123456789');

      // Partner tasks can only be created by admin
      if (taskType === "partner" && !userIsAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only admins can create partner tasks"
        });
      }

      // Minimum clicks: 1 for partner tasks, use admin settings for others
      const minClicksSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'minimum_clicks')).limit(1);
      const minClicksFromSettings = parseInt(minClicksSetting[0]?.settingValue || '500');
      const minClicks = taskType === "partner" ? 1 : minClicksFromSettings;
      if (totalClicksRequired < minClicks) {
        return res.status(400).json({
          success: false,
          message: `Minimum ${minClicks} clicks required`
        });
      }

      // Partner tasks are free and always reward 5 PAD
      if (taskType === "partner") {
        const task = await storage.createTask({
          advertiserId: userId,
          taskType,
          title,
          link,
          totalClicksRequired,
          costPerClick: "0",
          totalCost: "0",
          status: "running",
        });

        console.log('✅ Partner task created:', task);

        broadcastUpdate({
          type: 'task:created',
          task: task
        });

        return res.json({ 
          success: true, 
          message: "Partner task created successfully",
          task 
        });
      }

      // Use the userData already fetched for partner task validation
      const user = userData;

      // Admin users: free task creation
      // Regular users: use TON tokens
      if (userIsAdmin) {
        console.log('🔑 Admin task creation - FREE (no charge)');

        // Create task for free (admin always gets 0 cost)
        const task = await storage.createTask({
          advertiserId: userId,
          taskType,
          title,
          link,
          totalClicksRequired,
          costPerClick: "0",
          totalCost: "0",
          status: "running",
        });

        console.log('✅ Admin task saved to database:', task);

        broadcastUpdate({
          type: 'task:created',
          task: task
        });

        return res.json({ 
          success: true, 
          message: "Task created successfully",
          task 
        });
      } else {
        // Regular users: TON-based costs from admin settings
        console.log('👤 Regular user task creation - using TON balance');
        
        // Get TON cost per click from admin settings
        const channelTonCostSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'channel_task_cost_ton')).limit(1);
        const botTonCostSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'bot_task_cost_ton')).limit(1);
        
        const channelCostPerClickTON = parseFloat(channelTonCostSetting[0]?.settingValue || "0.0003");
        const botCostPerClickTON = parseFloat(botTonCostSetting[0]?.settingValue || "0.0003");
        
        const costPerClickTON = taskType === "channel" ? channelCostPerClickTON : botCostPerClickTON;
        const totalCostTON = costPerClickTON * totalClicksRequired;
        
        // Fetch TON balance
        const [userTonData] = await db
          .select({ tonBalance: users.tonBalance })
          .from(users)
          .where(eq(users.id, userId));
        
        const currentTONBalance = parseFloat(userTonData?.tonBalance || '0');

        console.log('💰 Payment check (TON):', { currentTONBalance, totalCostTON, sufficient: currentTONBalance >= totalCostTON });

        if (currentTONBalance < totalCostTON) {
          return res.status(400).json({
            success: false,
            message: `Insufficient TON. You need ${totalCostTON.toFixed(4)} TON to create this task.`
          });
        }

        // Deduct TON balance
        const newTONBalance = (currentTONBalance - totalCostTON).toFixed(10);
        await db
          .update(users)
          .set({ tonBalance: newTONBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));

        console.log('✅ Payment deducted (TON):', { oldBalance: currentTONBalance, newBalance: newTONBalance, deducted: totalCostTON });

        await storage.logTransaction({
          userId,
          amount: totalCostTON.toFixed(10),
          type: "deduction",
          source: "task_creation",
          description: `Created ${taskType} task: ${title}`,
          metadata: { taskId: null, taskType, totalClicksRequired, paymentMethod: 'TON' }
        });

        // Create task with TON cost
        const task = await storage.createTask({
          advertiserId: userId,
          taskType,
          title,
          link,
          totalClicksRequired,
          costPerClick: costPerClickTON.toFixed(10),
          totalCost: totalCostTON.toFixed(10),
          status: "under_review",
        });

        console.log('✅ Task saved to database:', task);

        broadcastUpdate({
          type: 'task:created',
          task: task
        });

        // Send notification to admin about new task submission
        try {
          const adminNotification = `📝 <b>New Task Submitted</b>\n\nType: ${taskType}\nTitle: ${title}\nClicks: ${totalClicksRequired}\nCost: ${totalCostTON.toFixed(4)} TON\n\nPlease review.`;
          await sendTelegramMessage(adminNotification);
          console.log('📩 Admin notification sent for new task');
        } catch (notifyError) {
          console.error('Failed to send admin notification:', notifyError);
        }

        return res.json({ 
          success: true, 
          message: "Task created successfully",
          task 
        });
      }
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to create task" 
      });
    }
  });

  // Record task click (when publisher clicks on a task)
  app.post('/api/advertiser-tasks/:taskId/click', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const result = await storage.recordTaskClick(taskId, userId);
      
      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      console.error("Error recording task click:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to record task click" 
      });
    }
  });

  // Claim task reward (after user clicks on a task)
  app.post('/api/advertiser-tasks/:taskId/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      // Get the task click record
      const taskClick = await db
        .select()
        .from(taskClicks)
        .where(and(
          eq(taskClicks.taskId, taskId),
          eq(taskClicks.publisherId, userId)
        ))
        .limit(1);

      if (taskClick.length === 0) {
        return res.status(400).json({
          success: false,
          message: "You haven't clicked this task yet"
        });
      }

      // Check if already claimed
      if (taskClick[0].claimedAt) {
        return res.status(400).json({
          success: false,
          message: "You have already claimed the reward for this task"
        });
      }

      const rewardPOW = parseInt(taskClick[0].rewardAmount || '0');

      // Mark as claimed — reward was already added to balance when user clicked (recordTaskClick)
      await db
        .update(taskClicks)
        .set({ claimedAt: new Date() })
        .where(and(
          eq(taskClicks.taskId, taskId),
          eq(taskClicks.publisherId, userId)
        ));

      console.log(`✅ Task reward claimed: ${taskId} by ${userId} - Reward: ${rewardPOW} POW`);

      res.json({
        success: true,
        message: `Reward claimed! +${rewardPOW} POW`,
        reward: rewardPOW,
      });
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to claim task reward" 
      });
    }
  });

  // Increase task click limit
  app.post('/api/advertiser-tasks/:taskId/increase-limit', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;
      const { additionalClicks } = req.body;

      // Validation - minimum additional clicks from admin settings
      const addMinClicksSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'minimum_clicks')).limit(1);
      const minAddClicks = parseInt(addMinClicksSetting[0]?.settingValue || '500');
      if (!additionalClicks || additionalClicks < minAddClicks) {
        return res.status(400).json({
          success: false,
          message: `Minimum ${minAddClicks} additional clicks required`
        });
      }

      // Verify task ownership
      const task = await storage.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }

      if (task.advertiserId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You don't own this task"
        });
      }

      // Fetch dynamic task cost per click from admin settings
      const taskCostSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'task_creation_cost')).limit(1);
      const costPerClick = taskCostSetting[0]?.settingValue || "0.0003";
      const additionalCost = (parseFloat(costPerClick) * additionalClicks).toFixed(8);

      // Get user data to check if admin
      const [user] = await db
        .select({ 
          tonBalance: users.tonBalance, 
          telegram_id: users.telegram_id 
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const userIsAdminFlag = isAdmin(user.telegram_id || '');
      const requiredAmount = parseFloat(additionalCost);

      // Admin users: use USD balance
      // Regular users: use TON balance
      if (userIsAdminFlag) {
        console.log('🔑 Admin adding clicks - using USD balance');
        const [adminUserData] = await db
          .select({ usdBalance: users.usdBalance })
          .from(users)
          .where(eq(users.id, userId));
        
        const currentUSDBalance = parseFloat(adminUserData?.usdBalance || '0');

        // Check if admin has sufficient USD balance
        if (currentUSDBalance < requiredAmount) {
          return res.status(400).json({
            success: false,
            message: "Insufficient USD balance. Please top up your USD balance."
          });
        }

        // Deduct USD balance
        const newUSDBalance = (currentUSDBalance - requiredAmount).toFixed(10);
        await db
          .update(users)
          .set({ usdBalance: newUSDBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));

        console.log('✅ Payment deducted (USD):', { oldBalance: currentUSDBalance, newBalance: newUSDBalance, deducted: additionalCost });
      } else {
        console.log('👤 Regular user adding clicks - using TON balance');
        const currentTonBalance = parseFloat(user.tonBalance || '0');

        // Check if user has sufficient TON balance
        if (currentTonBalance < requiredAmount) {
          return res.status(400).json({
            success: false,
            message: "Insufficient TON. You need TON to add more clicks."
          });
        }

        // Deduct TON balance
        const newTonBalance = (currentTonBalance - requiredAmount).toFixed(8);
        await db
          .update(users)
          .set({ tonBalance: newTonBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));

        console.log('✅ Payment deducted (TON):', { oldBalance: currentTonBalance, newBalance: newTonBalance, deducted: additionalCost });
      }

      // Increase task limit
      const updatedTask = await storage.increaseTaskLimit(taskId, additionalClicks, additionalCost);

      // Log transaction
      await storage.logTransaction({
        userId,
        amount: additionalCost,
        type: "deduction",
        source: "task_limit_increase",
        description: `Increased limit for task: ${task.title}`,
        metadata: { taskId, additionalClicks }
      });

      res.json({ 
        success: true, 
        message: "Task limit increased successfully",
        task: updatedTask 
      });
    } catch (error) {
      console.error("Error increasing task limit:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to increase task limit" 
      });
    }
  });

  // Check if user has clicked a task
  app.get('/api/advertiser-tasks/:taskId/has-clicked', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const hasClicked = await storage.hasUserClickedTask(taskId, userId);
      
      res.json({ success: true, hasClicked });
    } catch (error) {
      console.error("Error checking task click:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to check task click status" 
      });
    }
  });

  // User pause their own task
  app.post('/api/advertiser-tasks/:taskId/pause', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.advertiserId !== userId) {
        return res.status(403).json({ success: false, message: "You can only pause your own tasks" });
      }

      if (task.status !== "running") {
        return res.status(400).json({ success: false, message: "Only running tasks can be paused" });
      }

      const updatedTask = await storage.pauseTask(taskId);
      console.log(`⏸️ Task ${taskId} paused by owner ${userId}`);

      res.json({ success: true, task: updatedTask, message: "Task paused" });
    } catch (error) {
      console.error("Error pausing task:", error);
      res.status(500).json({ success: false, message: "Failed to pause task" });
    }
  });

  // User resume their own task
  app.post('/api/advertiser-tasks/:taskId/resume', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const task = await storage.getTaskById(taskId);
      
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.advertiserId !== userId) {
        return res.status(403).json({ success: false, message: "You can only resume your own tasks" });
      }

      if (task.status !== "paused") {
        return res.status(400).json({ success: false, message: "Only paused tasks can be resumed" });
      }

      const updatedTask = await storage.resumeTask(taskId);
      console.log(`▶️ Task ${taskId} resumed by owner ${userId}`);

      res.json({ success: true, task: updatedTask, message: "Task resumed" });
    } catch (error) {
      console.error("Error resuming task:", error);
      res.status(500).json({ success: false, message: "Failed to resume task" });
    }
  });

  // Delete advertiser task
  app.delete('/api/advertiser-tasks/:taskId', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      console.log('🗑️ Delete task request:', { userId, taskId });

      // Get task details
      const [task] = await db
        .select()
        .from(advertiserTasks)
        .where(eq(advertiserTasks.id, taskId));

      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }

      // Verify ownership
      if (task.advertiserId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only delete your own tasks"
        });
      }

      // Calculate refund amount for remaining clicks
      const remainingClicks = task.totalClicksRequired - task.currentClicks;
      const refundAmount = (parseFloat(task.costPerClick) * remainingClicks).toFixed(8);

      console.log('💰 Refund calculation:', { 
        totalClicks: task.totalClicksRequired, 
        currentClicks: task.currentClicks, 
        remainingClicks,
        costPerClick: task.costPerClick,
        refundAmount 
      });

      // Delete task and refund user in a transaction
      await db.transaction(async (tx) => {
        // Delete associated clicks first to avoid foreign key constraint issues
        await tx
          .delete(taskClicks)
          .where(eq(taskClicks.taskId, taskId));

        // Delete the task
        await tx
          .delete(advertiserTasks)
          .where(eq(advertiserTasks.id, taskId));

        // Refund remaining balance if any
        if (parseFloat(refundAmount) > 0) {
          const [user] = await tx
            .select({ 
              tonBalance: users.tonBalance, 
              telegram_id: users.telegram_id 
            })
            .from(users)
            .where(eq(users.id, userId));

          if (user) {
            const userIsAdminFlag = isAdmin(user.telegram_id || '');

            if (userIsAdminFlag) {
              // Admin: Refund to USD balance
              const [adminUser] = await tx
                .select({ usdBalance: users.usdBalance })
                .from(users)
                .where(eq(users.id, userId));
              
              const newUSDBalance = (parseFloat(adminUser?.usdBalance || '0') + parseFloat(refundAmount)).toFixed(10);
              await tx
                .update(users)
                .set({ usdBalance: newUSDBalance, updatedAt: new Date() })
                .where(eq(users.id, userId));

              console.log('✅ Admin refund processed (USD):', { oldBalance: adminUser?.usdBalance, refundAmount, newBalance: newUSDBalance });
            } else {
              // Non-admin: Refund to TON balance
              const newTONBalance = (parseFloat(user.tonBalance || '0') + parseFloat(refundAmount)).toFixed(8);
              await tx
                .update(users)
                .set({ tonBalance: newTONBalance, updatedAt: new Date() })
                .where(eq(users.id, userId));

              console.log('✅ User refund processed (TON):', { oldBalance: user.tonBalance, refundAmount, newBalance: newTONBalance });
            }

            // Log transaction
            await storage.logTransaction({
              userId,
              amount: refundAmount,
              type: "credit",
              source: "task_deletion_refund",
              description: `Refund for deleting task: ${task.title} (${userIsAdminFlag ? 'USD' : 'TON'})`,
              metadata: { taskId, remainingClicks, currency: userIsAdminFlag ? 'USD' : 'TON' }
            });
          }
        }
      });

      console.log('✅ Task deleted successfully:', taskId);

      res.json({ 
        success: true, 
        message: "Task deleted successfully",
        refundAmount 
      });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to delete task" 
      });
    }
  });

  // Verify channel for bot admin
  app.post('/api/advertiser-tasks/verify-channel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { channelLink } = req.body;

      console.log('🔍 Channel verification request:', { userId, channelLink });

      // Validate channel link
      if (!channelLink || !channelLink.includes('t.me/')) {
        return res.status(400).json({
          success: false,
          message: "Invalid channel link"
        });
      }

      // Extract channel username
      const match = channelLink.match(/t\.me\/([^/?]+)/);
      if (!match || !match[1]) {
        return res.status(400).json({
          success: false,
          message: "Could not extract channel username from link"
        });
      }

      const channelUsername = match[1];

      // Check if bot token is configured
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN not configured - skipping actual verification');
        return res.json({
          success: true,
          message: "Channel verification successful (dev mode)",
          verified: true
        });
      }

      try {
        // Try to get chat administrators
        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/getChatAdministrators`;
        const chatId = channelUsername.startsWith('@') ? channelUsername : `@${channelUsername}`;
        
        const response = await fetch(`${telegramApiUrl}?chat_id=${encodeURIComponent(chatId)}`);
        const data = await response.json();

        if (!data.ok) {
          console.error('❌ Telegram API error:', data);
          return res.status(400).json({
            success: false,
            message: "Could not access channel. Make sure the bot is added as admin."
          });
        }

        // Get bot username dynamically from Telegram API
        let botUsername = process.env.BOT_USERNAME || '';
        if (!botUsername) {
          try {
            const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
            const meData = await meResponse.json();
            if (meData.ok && meData.result?.username) {
              botUsername = meData.result.username;
            }
          } catch (e) {
            console.warn('⚠️ Could not fetch bot username from Telegram API');
          }
        }

        // Check if our bot is in the admin list (only if we know the bot username)
        if (botUsername) {
          const isBotAdmin = data.result.some((admin: any) => 
            admin.user?.username?.toLowerCase() === botUsername.toLowerCase()
          );

          if (!isBotAdmin) {
            return res.status(400).json({
              success: false,
              message: `@${botUsername} is not an administrator in this channel. Please add the bot as admin first.`
            });
          }
        }

        console.log('✅ Channel verified:', channelUsername);

        res.json({ 
          success: true, 
          message: "Channel verified successfully",
          verified: true 
        });
      } catch (error) {
        console.error('❌ Error verifying channel:', error);
        res.status(500).json({ 
          success: false, 
          message: "Failed to verify channel" 
        });
      }
    } catch (error) {
      console.error("Error in channel verification:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to verify channel" 
      });
    }
  });
  
  // ── TON Deposit Verification (with on-chain check via TON Center API) ───────
  const DEPOSIT_WALLET = 'UQCW9LwFkPRsLOVsGfl-65t9AJsfPXs8fTpDDEJL_RQhwPvJ';

  // Verify transaction actually landed on-chain at the deposit wallet
  async function verifyTonTransaction(expectedNano: bigint, windowMs = 15 * 60 * 1000): Promise<{ verified: boolean; txHash?: string; actualNano?: bigint }> {
    try {
      const url = `https://toncenter.com/api/v2/getTransactions?address=${DEPOSIT_WALLET}&limit=20&archival=false`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        console.warn(`⚠️ TON Center API returned ${resp.status} — skipping on-chain check`);
        return { verified: false };
      }
      const data = await resp.json() as any;
      if (!data.ok || !Array.isArray(data.result)) return { verified: false };

      const nowSec = Math.floor(Date.now() / 1000);
      const windowSec = Math.floor(windowMs / 1000);

      for (const tx of data.result) {
        const txTime: number = tx.utime ?? 0;
        if (nowSec - txTime > windowSec) continue; // outside window

        // in_msg.value is the amount in nanotons
        const incoming = tx.in_msg;
        if (!incoming || !incoming.value) continue;

        const inNano = BigInt(incoming.value);
        // Allow ±1 nanoton tolerance for rounding
        if (inNano >= expectedNano - 1n) {
          const txHash: string = tx.transaction_id?.hash ?? tx.hash ?? '';
          console.log(`✅ On-chain TX verified: hash=${txHash} nano=${inNano} time=${txTime}`);
          return { verified: true, txHash, actualNano: inNano };
        }
      }

      return { verified: false };
    } catch (err) {
      console.warn('⚠️ TON on-chain verification error (proceeding with BOC trust):', err);
      return { verified: false };
    }
  }

  app.post('/api/ton/deposit/verify', requireAuth, async (req: any, res) => {
    try {
      const userId: string = req.user.user.id;

      const { boc, amount } = req.body;
      if (!boc || !amount) {
        return res.status(400).json({ success: false, message: 'Missing boc or amount' });
      }

      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount < 0.1) {
        return res.status(400).json({ success: false, message: 'Invalid deposit amount' });
      }

      const { tonDeposits } = await import('../shared/schema');

      // Duplicate-prevention: check if this BOC was already processed
      const existing = await db.select().from(tonDeposits).where(eq(tonDeposits.boc, boc)).limit(1);
      if (existing.length > 0 && existing[0].status === 'confirmed') {
        return res.status(409).json({ success: false, message: 'This transaction has already been processed.' });
      }

      // ── On-chain verification via TON Center API ──────────────────────────
      const expectedNano = BigInt(Math.round(depositAmount * 1_000_000_000));
      const { verified, txHash, actualNano } = await verifyTonTransaction(expectedNano);

      if (!verified) {
        // Record as pending — do NOT credit yet
        await db.insert(tonDeposits).values({
          userId,
          amount: depositAmount.toString(),
          boc,
          status: 'pending',
        }).onConflictDoNothing();

        console.warn(`⚠️ TON deposit NOT verified on-chain: userId=${userId} amount=${depositAmount}`);
        return res.status(202).json({
          success: false,
          pending: true,
          message: 'Transaction not yet visible on blockchain. Your balance will be credited within 5 minutes once confirmed.',
        });
      }

      // If txHash exists, use it as secondary dedup key
      if (txHash) {
        const hashExists = await db.select().from(tonDeposits).where(eq(tonDeposits.boc, txHash)).limit(1);
        if (hashExists.length > 0 && hashExists[0].status === 'confirmed') {
          return res.status(409).json({ success: false, message: 'This transaction has already been credited.' });
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Read current balance then compute new value (Drizzle pattern used throughout codebase)
      const [currentUser] = await db.select({ tonBalance: users.tonBalance }).from(users).where(eq(users.id, userId)).limit(1);
      if (!currentUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Use actual on-chain amount (converted from nanotons) for accuracy
      const actualAmount = actualNano ? Number(actualNano) / 1_000_000_000 : depositAmount;
      const newTonBalance = (parseFloat(currentUser.tonBalance || '0') + actualAmount).toFixed(10);

      // Insert confirmed deposit record
      await db.insert(tonDeposits).values({
        userId,
        amount: actualAmount.toString(),
        boc: txHash || boc,
        status: 'confirmed',
        confirmedAt: new Date(),
      }).onConflictDoNothing();

      // Credit TON balance via Drizzle ORM
      await db.update(users)
        .set({ tonBalance: newTonBalance, updatedAt: new Date() })
        .where(eq(users.id, userId));

      // Record transaction history
      await db.insert(transactions).values({
        userId,
        amount: actualAmount.toString(),
        type: 'addition',
        source: 'ton_deposit',
        description: `TON deposit verified on-chain: ${actualAmount} TON`,
        metadata: { boc: (txHash || boc).slice(0, 64), txHash },
      });

      console.log(`✅ TON deposit credited: userId=${userId} amount=${actualAmount} TON newBalance=${newTonBalance} txHash=${txHash}`);

      return res.json({
        success: true,
        message: `${actualAmount.toFixed(2)} TON credited to your account.`,
        amount: actualAmount,
        newBalance: newTonBalance,
      });
    } catch (err: any) {
      console.error('❌ TON deposit error:', err);
      return res.status(500).json({ success: false, message: 'Deposit processing failed. Your funds will be credited within 5 minutes.' });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // User withdrawal endpoints
  
  // Get user's withdrawal history - auth removed to prevent popup spam
  app.get('/api/withdrawals', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Withdrawal history requested without session - sending empty");
        return res.json({ success: true, skipAuth: true, withdrawals: [] });
      }
      
      // Get all user's withdrawals (show all statuses: pending, Approved, paid, rejected, etc.)
      const userWithdrawals = await db
        .select({
          id: withdrawals.id,
          amount: withdrawals.amount,
          method: withdrawals.method,
          status: withdrawals.status,
          details: withdrawals.details,
          comment: withdrawals.comment,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt
        })
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt));
      
      res.json({ 
        success: true,
        withdrawals: userWithdrawals 
      });
      
    } catch (error) {
      console.error('❌ Error fetching user withdrawals:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch withdrawals' 
      });
    }
  });

  // Get user's deposit history (PDZ top-ups)
  app.get('/api/deposits/history', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, deposits: [] });
      }
      
      // Get PDZ top-up transactions from transactions table
      const depositHistory = await db
        .select({
          id: transactions.id,
          amount: transactions.amount,
          type: transactions.type,
          source: transactions.source,
          createdAt: transactions.createdAt
        })
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          eq(transactions.source, 'pdz_topup')
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(10);
      
      res.json({ 
        success: true,
        deposits: depositHistory.map(d => ({
          id: d.id,
          amount: d.amount,
          status: 'completed',
          createdAt: d.createdAt
        }))
      });
      
    } catch (error) {
      console.error('❌ Error fetching deposit history:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch deposits' 
      });
    }
  });

  // Create new withdrawal request - auth removed to prevent popup spam
  app.post('/api/withdrawals', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Withdrawal requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      
      const { method, starPackage, amount: requestedAmount, withdrawalPackage, tonWalletAddress } = req.body;

      console.log('📝 Withdrawal request received:', { userId, method, starPackage, withdrawalPackage });

      // Validate withdrawal method
      const validMethods = ['TON', 'USDT', 'STARS'];
      if (!method || !validMethods.includes(method)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid withdrawal method'
        });
      }

      // Check for pending withdrawals
      const pendingWithdrawals = await db
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          eq(withdrawals.status, 'pending')
        ))
        .limit(1);

      if (pendingWithdrawals.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create new request until current one is processed'
        });
      }

      // Use transaction to ensure atomicity and prevent race conditions
      const newWithdrawal = await db.transaction(async (tx) => {
        // Lock user row and get balances, wallet addresses, and device info
        const [user] = await tx
          .select({ 
            balance: users.balance,
            usdBalance: users.usdBalance,
            starBalance: users.starBalance,
            cwalletId: users.cwalletId,
            usdtWalletAddress: users.usdtWalletAddress,
            telegramStarsUsername: users.telegramStarsUsername,
            friendsInvited: users.friendsInvited,
            telegram_id: users.telegram_id,
            username: users.username,
            banned: users.banned,
            bannedReason: users.bannedReason,
            deviceId: users.deviceId,
            adsWatched: users.adsWatched
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }

        // CRITICAL: Check if user is banned - prevent banned accounts from withdrawing
        if (user.banned) {
          throw new Error(`Account is banned: ${user.bannedReason || 'Multi-account violation'}`);
        }

        // CRITICAL: Check for duplicate accounts on same device trying to withdraw
        if (user.deviceId) {
          const duplicateAccounts = await tx
            .select({ id: users.id, banned: users.banned, isPrimaryAccount: users.isPrimaryAccount })
            .from(users)
            .where(and(
              eq(users.deviceId, user.deviceId),
              sql`${users.id} != ${userId}`
            ));

          if (duplicateAccounts.length > 0) {
            // Determine if current user is the primary account
            const [currentUserFull] = await tx
              .select({ isPrimaryAccount: users.isPrimaryAccount })
              .from(users)
              .where(eq(users.id, userId));
            
            const isPrimary = currentUserFull?.isPrimaryAccount === true;
            
            if (!isPrimary) {
              // Ban this duplicate account only
              const { banUserForMultipleAccounts, sendWarningToMainAccount } = await import('./deviceTracking');
              await banUserForMultipleAccounts(
                userId,
                'Duplicate account attempted withdrawal - only one account per device is allowed'
              );
              
              // Send warning to primary account
              const primaryAccount = duplicateAccounts.find(u => u.isPrimaryAccount === true) || duplicateAccounts[0];
              if (primaryAccount) {
                await sendWarningToMainAccount(primaryAccount.id);
              }
              
              throw new Error('Withdrawal blocked - multiple accounts detected on this device. This account has been banned.');
            }
          }
        }

        // ✅ Check if user has invited enough friends (based on admin settings)
        // First, get admin settings for invite requirement
        const [inviteRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_invite_requirement_enabled'))
          .limit(1);
        const withdrawalInviteRequirementEnabled = (inviteRequirementEnabledSetting?.settingValue || 'true') === 'true';
        
        const [minimumInvitesSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_invites_for_withdrawal'))
          .limit(1);
        const minimumInvitesForWithdrawal = parseInt(minimumInvitesSetting?.settingValue || '3');
        
        // Only check invite requirement if it's enabled in admin settings
        if (withdrawalInviteRequirementEnabled) {
          const friendsInvited = user.friendsInvited || 0;
          if (friendsInvited < minimumInvitesForWithdrawal) {
            const remaining = minimumInvitesForWithdrawal - friendsInvited;
            throw new Error(`Invite ${remaining} more friend${remaining !== 1 ? 's' : ''} to unlock withdrawals.`);
          }
        }
        
        // ✅ Check if user has watched enough ads (based on admin settings)
        const [adRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_ad_requirement_enabled'))
          .limit(1);
        const withdrawalAdRequirementEnabled = (adRequirementEnabledSetting?.settingValue || 'true') === 'true';
        
        const [minimumAdsSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_ads_for_withdrawal'))
          .limit(1);
        const minimumAdsForWithdrawal = parseInt(minimumAdsSetting?.settingValue || '100');
        
        // Only check ad requirement if it's enabled in admin settings
        if (withdrawalAdRequirementEnabled) {
          // Get ads watched since last withdrawal
          const lastApprovedWithdrawal = await tx
            .select({ createdAt: withdrawals.createdAt })
            .from(withdrawals)
            .where(and(
              eq(withdrawals.userId, String(userId)),
              sql`${withdrawals.status} IN ('completed', 'approved')`
            ))
            .orderBy(desc(withdrawals.createdAt))
            .limit(1);
          
          let adsWatchedSinceLastWithdrawal = user.adsWatched || 0;
          
          if (lastApprovedWithdrawal.length > 0) {
            const lastWithdrawalDate = lastApprovedWithdrawal[0].createdAt;
            const adsCountResult = await tx
              .select({ count: sql<number>`count(*)` })
              .from(earnings)
              .where(and(
                eq(earnings.userId, String(userId)),
                eq(earnings.source, 'ad_watch'),
                gte(earnings.createdAt, lastWithdrawalDate)
              ));
            adsWatchedSinceLastWithdrawal = adsCountResult[0]?.count || 0;
          }
          
          if (adsWatchedSinceLastWithdrawal < minimumAdsForWithdrawal) {
            const remaining = minimumAdsForWithdrawal - adsWatchedSinceLastWithdrawal;
            throw new Error(`Watch ${remaining} more ad${remaining !== 1 ? 's' : ''} to unlock withdrawals.`);
          }
        }

        // ✅ Get withdrawal packages from admin settings
        const [withdrawalPackagesSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_packages'))
          .limit(1);
        const withdrawalPackagesConfig = JSON.parse(withdrawalPackagesSetting?.settingValue || '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]');
        
        // Get BUG requirement settings from admin
        // STAR is only used for weekly contest — no withdrawal gate
        let packageUsdAmount: number | null = null;
        
        if (withdrawalPackage && withdrawalPackage !== 'FULL') {
          const selectedPkg = withdrawalPackagesConfig.find((p: any) => p.usd === withdrawalPackage);
          if (!selectedPkg) {
            throw new Error('Invalid withdrawal package selected');
          }
          packageUsdAmount = selectedPkg.usd;
          const currentUsdBalanceForPkg = parseFloat(user.usdBalance || '0');
          if (currentUsdBalanceForPkg < packageUsdAmount) {
            throw new Error(`Insufficient balance. You need $${packageUsdAmount.toFixed(2)} for this package.`);
          }
        }

        // Check if user has appropriate wallet address based on method
        let walletAddress: string;
        if (method === 'TON') {
          if (!tonWalletAddress) {
            throw new Error('Please connect your TON wallet before withdrawing.');
          }
          walletAddress = tonWalletAddress;
        } else if (method === 'USD' || method === 'USDT') {
          if (!user.usdtWalletAddress) {
            throw new Error('USD address not set');
          }
          walletAddress = user.usdtWalletAddress;
        } else if (method === 'STARS') {
          if (!user.telegramStarsUsername) {
            throw new Error('Telegram username not set');
          }
          walletAddress = user.telegramStarsUsername;
        } else {
          throw new Error('Invalid withdrawal method');
        }

        const currentUsdBalance = parseFloat(user.usdBalance || '0');
        
        // Get minimum withdrawal and fee settings from admin settings
        const [minWithdrawalSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_withdrawal_usd'))
          .limit(1);
        const minimumWithdrawalUSD = parseFloat(minWithdrawalSetting?.settingValue || '1.00');
        
        const [minWithdrawalTONSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_withdrawal_ton'))
          .limit(1);
        const minimumWithdrawalTON = parseFloat(minWithdrawalTONSetting?.settingValue || '0.5');
        
        const [feePercentTONSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_fee_ton'))
          .limit(1);
        const feePercentTON = parseFloat(feePercentTONSetting?.settingValue || '5') / 100;
        
        const [feePercentUSDSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_fee_usd'))
          .limit(1);
        const feePercentUSD = parseFloat(feePercentUSDSetting?.settingValue || '3') / 100;
        
        // Calculate withdrawal amount and fee (ALL IN USD ONLY)
        let withdrawalAmount: number; // Always in USD
        let fee: number;
        let usdToDeduct: number;
        let withdrawalDetails: any = {
          paymentDetails: walletAddress,
          walletAddress: walletAddress,
          method: method
        };

        if (method === 'STARS') {
          if (!starPackage) {
            throw new Error('Star package selection is required for Telegram Stars withdrawal');
          }
          
          const starPackages = [
            { stars: 15, usdCost: 0.30 },
            { stars: 25, usdCost: 0.50 },
            { stars: 50, usdCost: 1.00 },
            { stars: 100, usdCost: 2.00 }
          ];
          
          const selectedPkg = starPackages.find(p => p.stars === starPackage);
          if (!selectedPkg) {
            throw new Error('Invalid star package selected');
          }
          
          const totalCost = selectedPkg.usdCost * 1.05;
          if (currentUsdBalance < totalCost) {
            throw new Error(`Insufficient balance. You need $${totalCost.toFixed(2)} (including 5% fee)`);
          }
          
          withdrawalAmount = selectedPkg.usdCost; // USD amount
          fee = selectedPkg.usdCost * 0.05;
          usdToDeduct = totalCost;
          withdrawalDetails.starPackage = starPackage;
          withdrawalDetails.stars = starPackage;
          withdrawalDetails.telegramUsername = walletAddress;
        } else {
          // TON or USD withdrawal - package-based or FULL balance
          if (currentUsdBalance <= 0) {
            throw new Error('Insufficient balance for withdrawal');
          }
          
          // Determine the USD amount to withdraw based on package selection
          let baseAmount: number;
          if (packageUsdAmount !== null) {
            // Package-based withdrawal: use exact package amount
            baseAmount = packageUsdAmount;
          } else {
            // FULL withdrawal: use full balance
            baseAmount = currentUsdBalance;
            
            // Check minimum withdrawal requirement only for FULL withdrawals
            const requiredMinimum = method === 'TON' ? minimumWithdrawalTON : minimumWithdrawalUSD;
            if (baseAmount < requiredMinimum) {
              throw new Error(`Minimum ${requiredMinimum.toFixed(2)}`);
            }
          }
          
          // Use admin-configured fees: TON and USD have different fees
          const feePercent = method === 'TON' ? feePercentTON : feePercentUSD;
          fee = baseAmount * feePercent;
          withdrawalAmount = baseAmount - fee; // USD amount after fee
          usdToDeduct = baseAmount;
          
          // Store package info if applicable
          if (packageUsdAmount !== null) {
            withdrawalDetails.withdrawalPackage = packageUsdAmount;
          }
          // STAR is not deducted on withdrawal — it's only for weekly contest
          withdrawalDetails.starDeducted = 0;
          
          // Store wallet address based on method
          if (method === 'TON') {
            withdrawalDetails.tonWalletAddress = walletAddress;
          } else if (method === 'USD' || method === 'USDT') {
            withdrawalDetails.usdtWalletAddress = walletAddress;
          }
        }

        console.log(`📝 Creating withdrawal request for $${withdrawalAmount.toFixed(2)} USD via ${method} (balance will be deducted on approval)`);

        // Store the fee percentage from admin settings for consistent display
        const feePercentForDetails = method === 'TON' ? feePercentTON : (method === 'STARS' ? 0.05 : feePercentUSD);
        withdrawalDetails.totalDeducted = usdToDeduct.toFixed(10);
        withdrawalDetails.fee = fee.toFixed(10);
        withdrawalDetails.feePercent = (feePercentForDetails * 100).toString(); // Store exact percentage (e.g., "5" or "2.5")
        withdrawalDetails.requestedAmount = usdToDeduct.toFixed(10); // Total amount before fee
        withdrawalDetails.netAmount = withdrawalAmount.toFixed(10); // Amount after fee

        const withdrawalData: any = {
          userId,
          amount: withdrawalAmount.toFixed(10),
          method: method,
          status: 'pending',
          deducted: false,
          refunded: false,
          details: withdrawalDetails
        };

        const [withdrawal] = await tx.insert(withdrawals).values(withdrawalData).returning();
        
        // NOTE: Balance is NOT deducted here - it will be deducted ONLY when admin approves the withdrawal
        // This prevents "insufficient balance" errors during approval when balance was already deducted at request time
        console.log(`📋 Withdrawal request created for $${usdToDeduct.toFixed(2)} USD (balance will be deducted on admin approval)`);
        
        return { 
          withdrawal, 
          withdrawnAmount: withdrawalAmount, // USD amount
          fee: fee,
          feePercent: (feePercentForDetails * 100).toString(), // Fee percentage as string (exact value)
          method: method,
          starPackage: method === 'STARS' ? starPackage : undefined,
          userTelegramId: user.telegram_id,
          username: user.username,
          firstName: user.firstName || user.username || 'Unknown',
          walletAddress: walletAddress
        };
      });

      console.log(`✅ Withdrawal request created: ${newWithdrawal.withdrawal.id} for user ${userId}, amount: $${newWithdrawal.withdrawnAmount.toFixed(2)} via ${newWithdrawal.method}`);

      // Send withdrawal_requested notification via WebSocket
      sendRealtimeUpdate(userId, {
        type: 'withdrawal_requested',
        amount: newWithdrawal.withdrawnAmount.toFixed(2),
        method: newWithdrawal.method,
        message: 'You have sent a withdrawal request.'
      });

      // Send withdrawal notification — (1) to the group chat, (2) to individual admins
      const userName = newWithdrawal.firstName;
      const userTelegramId = newWithdrawal.userTelegramId || '';
      const userTelegramUsername = newWithdrawal.username ? `@${newWithdrawal.username}` : 'N/A';
      const walletAddress = newWithdrawal.walletAddress || 'N/A';
      const feeAmount = newWithdrawal.fee;
      const feePercent = newWithdrawal.feePercent;

      // (1) Post to the withdrawal group chat with Approve / Reject buttons
      const { sendWithdrawalRequestToGroup } = await import('./telegram');
      sendWithdrawalRequestToGroup({
        withdrawalId: newWithdrawal.withdrawal.id,
        userTelegramId,
        userName,
        userTelegramUsername,
        walletAddress,
        amount: newWithdrawal.withdrawnAmount,
        fee: feeAmount,
        feePercent
      }).catch(err => console.error('❌ Group withdrawal request post failed:', err));

      // (2) Also DM each individual admin with the same message + buttons
      if (process.env.TELEGRAM_BOT_TOKEN) {
        const { getBotUsername: getBotUsernameForWithdrawal } = await import('./telegram');
        const botUsernameForWithdrawal = await getBotUsernameForWithdrawal();
        const currentDate = new Date().toUTCString();

        const adminMessage = `💰 Withdrawal Request

🗣 User: <a href="tg://user?id=${userTelegramId}">${userName}</a>
🆔 User ID: ${userTelegramId}
💳 Username: ${userTelegramUsername}
🌐 Address:
${walletAddress}
💸 Amount: ${newWithdrawal.withdrawnAmount.toFixed(5)} USD
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${currentDate}
🤖 Bot: @${botUsernameForWithdrawal}`;

        const inlineKeyboard = {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `withdraw_paid_${newWithdrawal.withdrawal.id}` },
            { text: "❌ Reject",  callback_data: `withdraw_reject_${newWithdrawal.withdrawal.id}` }
          ]]
        };

        getAllAdminTelegramIds().then(allAdminIds => {
          const withdrawalId = newWithdrawal.withdrawal.id;
          allAdminIds.forEach(adminId => {
            fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: adminId,
                text: adminMessage,
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard
              })
            }).then(r => r.json()).then((data: any) => {
              if (data.ok && data.result?.message_id) {
                const existing = withdrawalAdminMessages.get(withdrawalId) || [];
                existing.push({ chatId: adminId, messageId: data.result.message_id });
                withdrawalAdminMessages.set(withdrawalId, existing);
              }
            }).catch(err => {
              console.error(`❌ Failed to send withdrawal notification to admin ${adminId}:`, err);
            });
          });
        }).catch(err => {
          console.error('❌ Failed to fetch admin list for withdrawal notification:', err);
        });
      }
      

      res.json({
        success: true,
        message: 'You have sent a withdrawal request',
        withdrawal: {
          id: newWithdrawal.withdrawal.id,
          amount: newWithdrawal.withdrawal.amount,
          status: newWithdrawal.withdrawal.status,
          method: newWithdrawal.withdrawal.method,
          createdAt: newWithdrawal.withdrawal.createdAt
        }
      });

    } catch (error) {
      console.error('❌ Error creating withdrawal request:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to create withdrawal request';
      
      // Return 400 for validation errors (user-facing errors), 500 for system errors
      // Use substring matching to catch all variations of user-facing errors
      const isValidationError = 
        errorMessage.includes('Insufficient') || 
        errorMessage.includes('balance') ||
        errorMessage.includes('Minimum withdrawal') ||
        errorMessage.includes('User not found') ||
        errorMessage.includes('wallet address') ||
        errorMessage.includes('invite') ||
        errorMessage.includes('friends') ||
        errorMessage.includes('already in use') ||
        errorMessage.includes('Cannot create new request') ||
        errorMessage.includes('Star package') ||
        errorMessage.includes('Invalid') ||
        errorMessage.includes('banned');
      
      if (isValidationError) {
        return res.status(400).json({ 
          success: false, 
          message: errorMessage
        });
      }
      
      res.status(500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // Alternative withdrawal endpoint for compatibility - /api/withdraw
  app.post('/api/withdraw', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Withdrawal (/api/withdraw) requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      
      const { walletAddress, comment } = req.body;

      console.log('📝 Withdrawal via /api/withdraw (withdrawing all TON balance):', { userId });

      // Check for pending withdrawals
      const pendingWithdrawals = await db
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          eq(withdrawals.status, 'pending')
        ))
        .limit(1);

      if (pendingWithdrawals.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create new request until current one is processed'
        });
      }

      // Use transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Lock user row and get TON balance, ban status, and device info
        const [user] = await tx
          .select({ 
            tonBalance: users.tonBalance,
            banned: users.banned,
            bannedReason: users.bannedReason,
            deviceId: users.deviceId
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }

        // CRITICAL: Check if user is banned
        if (user.banned) {
          throw new Error(`Account is banned: ${user.bannedReason || 'Multi-account violation'}`);
        }

        // CRITICAL: Check for duplicate accounts on same device
        if (user.deviceId) {
          const duplicateAccounts = await tx
            .select({ id: users.id, isPrimaryAccount: users.isPrimaryAccount })
            .from(users)
            .where(and(
              eq(users.deviceId, user.deviceId),
              sql`${users.id} != ${userId}`
            ));

          if (duplicateAccounts.length > 0) {
            // Determine if current user is the primary account
            const [currentUserFull] = await tx
              .select({ isPrimaryAccount: users.isPrimaryAccount })
              .from(users)
              .where(eq(users.id, userId));
            
            const isPrimary = currentUserFull?.isPrimaryAccount === true;
            
            if (!isPrimary) {
              // Ban this duplicate account only
              const { banUserForMultipleAccounts, sendWarningToMainAccount } = await import('./deviceTracking');
              await banUserForMultipleAccounts(
                userId,
                'Duplicate account attempted withdrawal - only one account per device is allowed'
              );
              
              // Send warning to primary account
              const primaryAccount = duplicateAccounts.find(u => u.isPrimaryAccount === true) || duplicateAccounts[0];
              if (primaryAccount) {
                await sendWarningToMainAccount(primaryAccount.id);
              }
              
              throw new Error('Withdrawal blocked - multiple accounts detected on this device. This account has been banned.');
            }
          }
        }

        const currentTonBalance = parseFloat(user.tonBalance || '0');
        
        if (currentTonBalance < 0.001) {
          throw new Error('You need at least 0.001 TON');
        }

        // Deduct balance instantly
        await tx
          .update(users)
          .set({ tonBalance: '0', updatedAt: new Date() })
          .where(eq(users.id, userId));

        // Create withdrawal with deducted flag
        const [withdrawal] = await tx.insert(withdrawals).values({
          userId,
          amount: currentTonBalance.toFixed(8),
          method: 'ton_coin',
          status: 'pending',
          deducted: true,
          refunded: false,
          details: { walletAddress: walletAddress || '', comment: comment || '' }
        }).returning();
        
        return { withdrawal, withdrawnAmount: currentTonBalance };
      });

      console.log(`✅ Withdrawal via /api/withdraw: ${result.withdrawnAmount} TON`);

      // Send real-time update
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        tonBalance: '0'
      });

      res.json({
        success: true,
        message: 'You have sent a withdrawal request'
      });

    } catch (error) {
      console.error('❌ Error in /api/withdraw:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process withdrawal';
      res.status(500).json({ success: false, message: errorMessage });
    }
  });

  // Alternative withdrawal history endpoint - /api/withdraw/history
  app.get('/api/withdraw/history', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, skipAuth: true, history: [] });
      }
      
      const history = await db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt));
      
      res.json({ 
        success: true, 
        history 
      });
      
    } catch (error) {
      console.error('❌ Error fetching withdrawal history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch history' });
    }
  });
  
  // Admin withdrawal management endpoints
  
  // Get pending withdrawals (admin only)
  app.get('/api/admin/withdrawals/pending', authenticateAdmin, async (req: any, res) => {
    try {
      
      // Get pending withdrawals only
      const pendingWithdrawals = await db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            telegram_id: users.telegram_id
          }
        })
        .from(withdrawals)
        .leftJoin(users, eq(withdrawals.userId, users.id))
        .where(eq(withdrawals.status, 'pending'))
        .orderBy(desc(withdrawals.createdAt));
      
      res.json({
        success: true,
        withdrawals: pendingWithdrawals,
        total: pendingWithdrawals.length
      });
      
    } catch (error) {
      console.error('❌ Error fetching pending withdrawals:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch pending withdrawals' 
      });
    }
  });

  // Get processed withdrawals (approved/rejected) - admin only
  app.get('/api/admin/withdrawals/processed', authenticateAdmin, async (req: any, res) => {
    try {
      
      // Get all processed withdrawals (approved and rejected)
      const processedWithdrawals = await db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            telegram_id: users.telegram_id
          }
        })
        .from(withdrawals)
        .leftJoin(users, eq(withdrawals.userId, users.id))
        .where(sql`${withdrawals.status} IN ('paid', 'success', 'rejected', 'Successfull', 'Approved')`)
        .orderBy(desc(withdrawals.updatedAt));
      
      res.json({
        success: true,
        withdrawals: processedWithdrawals,
        total: processedWithdrawals.length
      });
      
    } catch (error) {
      console.error('❌ Error fetching processed withdrawals:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch processed withdrawals' 
      });
    }
  });
  
  // Approve withdrawal (admin only)
  app.post('/api/admin/withdrawals/:withdrawalId/approve', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { adminNotes } = req.body;
      
      // Approve the withdrawal using existing storage method (no transaction hash required)
      const result = await storage.approveWithdrawal(withdrawalId, adminNotes, 'N/A');
      
      if (result.success) {
        console.log(`✅ Withdrawal ${withdrawalId} approved by admin ${req.user.telegramUser.id}`);
        
        // Send Telegram notification to the withdrawal channel
        const { sendWithdrawalApprovedNotification } = await import('./telegram');
        await sendWithdrawalApprovedNotification(result.withdrawal);

        // Send real-time update to user
        if (result.withdrawal) {
          sendRealtimeUpdate(result.withdrawal.userId, {
            type: 'withdrawal_approved',
            amount: result.withdrawal.amount,
            method: result.withdrawal.method,
            message: `Your withdrawal of ${result.withdrawal.amount} TON has been approved and processed`
          });

          // Also send a balance_update so the frontend refreshes balance AND stars correctly
          // This prevents the "stars disappeared after withdrawal" display bug
          try {
            const freshUser = await storage.getUser(result.withdrawal.userId);
            if (freshUser) {
              sendRealtimeUpdate(result.withdrawal.userId, {
                type: 'balance_update',
                balance: freshUser.balance,
                usdBalance: freshUser.usdBalance,
                starBalance: Number(freshUser.starBalance || 0),
                weeklyStars: Number((freshUser as any).weeklyStars || 0),
              });
            }
          } catch (_) {}
          
          // Broadcast to all admins for instant UI update
          broadcastUpdate({
            type: 'withdrawal_approved',
            withdrawalId: result.withdrawal.id,
            amount: result.withdrawal.amount,
            userId: result.withdrawal.userId
          });
        }
        
        res.json({
          success: true,
          message: '✅ Withdrawal approved and processed',
          withdrawal: result.withdrawal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }
      
    } catch (error) {
      console.error('❌ Error approving withdrawal:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to approve withdrawal' 
      });
    }
  });
  
  // Reject withdrawal (admin only)
  app.post('/api/admin/withdrawals/:withdrawalId/reject', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { adminNotes, reason } = req.body;
      
      // Reject the withdrawal using existing storage method
      const result = await storage.rejectWithdrawal(withdrawalId, adminNotes || reason);
      
      if (result.success) {
        console.log(`❌ Withdrawal ${withdrawalId} rejected by admin ${req.user.telegramUser.id}`);
        
        // Send Telegram notification to the withdrawal channel
        const { sendWithdrawalRejectedNotification } = await import('./telegram');
        await sendWithdrawalRejectedNotification(result.withdrawal, adminNotes || reason);

        // Send real-time update to user
        if (result.withdrawal) {
          sendRealtimeUpdate(result.withdrawal.userId, {
            type: 'withdrawal_rejected',
            amount: result.withdrawal.amount,
            method: result.withdrawal.method,
            message: `Your withdrawal of ${result.withdrawal.amount} TON has been rejected`
          });
          
          // Broadcast to all admins for instant UI update
          broadcastUpdate({
            type: 'withdrawal_rejected',
            withdrawalId: result.withdrawal.id,
            amount: result.withdrawal.amount,
            userId: result.withdrawal.userId
          });
        }
        
        res.json({
          success: true,
          message: '❌ Withdrawal rejected',
          withdrawal: result.withdrawal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }
      
    } catch (error) {
      console.error('❌ Error rejecting withdrawal:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to reject withdrawal' 
      });
    }
  });

  // Test withdrawal group notification (admin only)
  // Admin: manually trigger weekly contest reset (send winner notification + reset all stars)
  app.post('/api/admin/contest/reset', authenticateAdmin, async (req: any, res) => {
    try {
      const { weekLabel } = req.body;
      const { resetWeeklyContest } = await import('./telegram');
      const result = await resetWeeklyContest(weekLabel || undefined);
      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          usersReset: result.usersReset,
          winnersNotified: result.winnersNotified,
        });
      } else {
        res.status(500).json({ success: false, message: result.message });
      }
    } catch (error: any) {
      console.error('❌ Error triggering contest reset:', error);
      res.status(500).json({ success: false, message: `Error: ${error.message}` });
    }
  });

  app.post('/api/admin/withdrawals/test-group-notification', authenticateAdmin, async (req: any, res) => {
    try {
      const { sendWithdrawalApprovedNotification } = await import('./telegram');
      const fakeWithdrawal = {
        id: 'test-000',
        userId: req.user.user.id,
        amount: '0.50',
        method: 'TON',
        details: {
          netAmount: '0.50',
          paymentDetails: 'TEST_WALLET_ADDRESS',
          walletAddress: 'TEST_WALLET_ADDRESS'
        }
      };
      const success = await sendWithdrawalApprovedNotification(fakeWithdrawal);
      if (success) {
        res.json({ success: true, message: '✅ Test message sent to withdrawal group successfully' });
      } else {
        res.status(500).json({ success: false, message: '❌ Failed to send test message — check server logs for the Telegram API error' });
      }
    } catch (error: any) {
      console.error('❌ Error sending test group notification:', error);
      res.status(500).json({ success: false, message: `Error: ${error.message}` });
    }
  });

  // Check if user has completed a task
  app.get('/api/tasks/:promotionId/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      
      const hasCompleted = await storage.hasUserCompletedTask(promotionId, userId);
      res.json({ completed: hasCompleted });
    } catch (error) {
      console.error("Error checking task status:", error);
      res.status(500).json({ message: "Failed to check task status" });
    }
  });

  // NEW TASK STATUS SYSTEM ENDPOINTS

  // Verify task (makes it claimable if requirements are met)
  app.post('/api/tasks/:promotionId/verify', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      const { taskType } = req.body;
      
      if (!taskType) {
        return res.status(400).json({ 
          success: false, 
          message: 'Task type is required' 
        });
      }
      
      console.log(`🔍 Task verification attempt: UserID=${userId}, TaskID=${promotionId}, TaskType=${taskType}`);
      
      const result = await storage.verifyTask(userId, promotionId, taskType);
      
      if (result.success) {
        console.log(`✅ Task verification result: ${result.message}, Status: ${result.status}`);
        res.json(result);
      } else {
        console.log(`❌ Task verification failed: ${result.message}`);
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error verifying task:", error);
      res.status(500).json({ success: false, message: "Failed to verify task" });
    }
  });

  // Claim task reward (credits balance and marks as claimed)
  app.post('/api/tasks/:promotionId/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      
      console.log(`🎁 Task claim attempt: UserID=${userId}, TaskID=${promotionId}`);
      
      const result = await storage.claimPromotionReward(userId, promotionId);
      
      if (result.success) {
        console.log(`✅ Task claimed successfully: ${result.message}, Reward: ${result.rewardAmount}`);
        
        // Send real-time balance update via WebSocket
        try {
          const connection = connectedUsers.get(req.sessionID);
          if (connection && connection.ws.readyState === 1) {
            connection.ws.send(JSON.stringify({
              type: 'balance_update',
              balance: result.newBalance,
              rewardAmount: result.rewardAmount,
              source: 'task_claim'
            }));
          }
        } catch (wsError) {
          console.error('Failed to send WebSocket balance update:', wsError);
        }
        
        res.json(result);
      } else {
        console.log(`❌ Task claim failed: ${result.message}`);
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({ success: false, message: "Failed to claim task reward" });
    }
  });

  // Create promotion (via Telegram bot only - internal endpoint)
  app.post('/api/internal/promotions', authenticateTelegram, async (req: any, res) => {
    try {
      const promotionData = insertPromotionSchema.parse(req.body);
      const promotion = await storage.createPromotion(promotionData);
      res.json(promotion);
    } catch (error) {
      console.error("Error creating promotion:", error);
      res.status(500).json({ message: "Failed to create promotion" });
    }
  });

  // Get user balance
  app.get('/api/user/balance', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const balance = await storage.getUserBalance(userId);
      
      if (!balance) {
        // Create initial balance if doesn't exist
        const newBalance = await storage.createOrUpdateUserBalance(userId, '0');
        res.json(newBalance);
      } else {
        res.json(balance);
      }
    } catch (error) {
      console.error("Error fetching user balance:", error);
      res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  // Add funds to main balance (via bot only - internal endpoint)
  app.post('/api/internal/add-funds', authenticateTelegram, async (req: any, res) => {
    try {
      const { userId, amount } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({ message: "userId and amount are required" });
      }

      const balance = await storage.createOrUpdateUserBalance(userId, amount);
      res.json({ success: true, balance });
    } catch (error) {
      console.error("Error adding funds:", error);
      res.status(500).json({ message: "Failed to add funds" });
    }
  });

  // Deduct main balance for promotion creation (internal endpoint)
  app.post('/api/internal/deduct-balance', async (req: any, res) => {
    try {
      const { userId, amount } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({ message: "userId and amount are required" });
      }

      const result = await storage.deductBalance(userId, amount);
      res.json(result);
    } catch (error) {
      console.error("Error deducting balance:", error);
      res.status(500).json({ message: "Failed to deduct balance" });
    }
  });

  // ================================
  // NEW TASK SYSTEM ENDPOINTS
  // ================================

  // Get all task statuses for user
  app.get('/api/tasks/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Get daily task completion records for today
      const dailyTasks = await db.select()
        .from(dailyTasks)
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.completionDate, currentDate)
        ));
      
      // Get current user data for ads progress
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Format task statuses
      const taskStatuses = dailyTasks.map(task => ({
        taskType: task.taskType,
        progress: task.progress,
        required: task.required,
        completed: task.completed,
        claimed: task.claimed,
        rewardAmount: parseFloat(task.rewardAmount).toFixed(7),
        status: task.claimed ? 'completed' : (task.completed ? 'claimable' : 'in_progress')
      }));
      
      // Add ads progress from user data
      const adsToday = user.adsWatchedToday || 0;
      taskStatuses.forEach(task => {
        if (task.taskType.startsWith('ads_')) {
          task.progress = adsToday;
          task.completed = adsToday >= task.required;
          task.status = task.claimed ? 'completed' : (task.completed ? 'claimable' : 'in_progress');
        }
      });
      
      res.json({ tasks: taskStatuses, adsWatchedToday: adsToday });
    } catch (error) {
      console.error("Error fetching task status:", error);
      res.status(500).json({ message: "Failed to fetch task status" });
    }
  });



  // Increment ads counter
  app.post('/api/tasks/ads/increment', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Get current user data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const currentAds = (user.adsWatchedToday || 0) + 1;
      
      // Update user's ads watched count
      await db.update(users)
        .set({ 
          adsWatchedToday: currentAds,
          adsWatched: (user.adsWatched || 0) + 1,
          lastAdWatch: new Date()
        })
        .where(eq(users.id, userId));
      
      // Update all ads goal tasks progress
      const adsGoals = ['ads_mini', 'ads_light', 'ads_medium', 'ads_hard'];
      for (const goalType of adsGoals) {
        const taskData = await db.select()
          .from(dailyTasks)
          .where(and(
            eq(dailyTasks.userId, userId),
            eq(dailyTasks.taskType, goalType),
            eq(dailyTasks.completionDate, currentDate)
          ))
          .limit(1);
        
        if (taskData.length > 0) {
          const task = taskData[0];
          const completed = currentAds >= task.required;
          
          await db.update(dailyTasks)
            .set({ 
              progress: currentAds,
              completed: completed
            })
            .where(and(
              eq(dailyTasks.userId, userId),
              eq(dailyTasks.taskType, goalType),
              eq(dailyTasks.completionDate, currentDate)
            ));
        }
      }
      
      res.json({ 
        success: true, 
        adsWatchedToday: currentAds,
        message: `Ads watched today: ${currentAds}`
      });
    } catch (error) {
      console.error("Error incrementing ads counter:", error);
      res.status(500).json({ message: "Failed to increment ads counter" });
    }
  });

  // Complete invite friend task
  app.post('/api/tasks/invite-friend/complete', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Update user's friend invited flag
      await db.update(users)
        .set({ friendInvited: true })
        .where(eq(users.id, userId));
      
      // Update daily task completion
      await db.update(dailyTasks)
        .set({ completed: true, progress: 1 })
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.taskType, 'invite_friend'),
          eq(dailyTasks.completionDate, currentDate)
        ));
      
      res.json({ success: true, message: 'Friend invite completed' });
    } catch (error) {
      console.error("Error completing friend invite:", error);
      res.status(500).json({ message: "Failed to complete friend invite" });
    }
  });

  // Claim completed task reward
  app.post('/api/tasks/:taskType/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskType } = req.params;
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Get task completion record
      const taskData = await db.select()
        .from(dailyTasks)
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.taskType, taskType),
          eq(dailyTasks.completionDate, currentDate)
        ))
        .limit(1);
      
      if (taskData.length === 0) {
        return res.status(404).json({ message: 'Task not found' });
      }
      
      const task = taskData[0];
      
      if (task.claimed) {
        return res.status(400).json({ message: 'Task already claimed' });
      }
      
      if (!task.completed) {
        return res.status(400).json({ message: 'Task not completed yet' });
      }
      
      // Claim the reward in a transaction
      await db.transaction(async (tx) => {
        // Mark task as claimed
        await tx.update(dailyTasks)
          .set({ claimed: true })
          .where(and(
            eq(dailyTasks.userId, userId),
            eq(dailyTasks.taskType, taskType),
            eq(dailyTasks.completionDate, currentDate)
          ));
        
        // Add balance
        await storage.addBalance(userId, task.rewardAmount);
        
        // Add earning record
        await storage.addEarning({
          userId,
          amount: task.rewardAmount,
          source: 'daily_task_completion',
          description: `Daily task completed: ${taskType}`,
        });
      });
      
      // Get updated balance
      const user = await storage.getUser(userId);
      
      res.json({ 
        success: true, 
        message: 'Task reward claimed successfully',
        rewardAmount: parseFloat(task.rewardAmount).toFixed(7),
        newBalance: user?.balance || '0'
      });
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({ message: "Failed to claim task reward" });
    }
  });

  // Promo code endpoints
  // Redeem promo code
  app.post('/api/promo-codes/redeem', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { code } = req.body;

      if (!code || !code.trim()) {
        return res.status(400).json({ success: false, message: 'Please enter a promo code' });
      }

      const cleanCode = code.trim().toUpperCase();

      // STEP 1: Validate only — does NOT record usage yet
      const result = await storage.usePromoCode(cleanCode, userId);
      if (!result.success) {
        return res.status(400).json({ success: false, message: result.message });
      }

      // Pull validated values from result (no second DB fetch needed)
      const rewardAmount  = result.reward || '0';
      const promoCodeId   = result.promoCodeId!;
      let   rewardType    = (result.rewardType || 'PAD').toUpperCase();
      // Normalize aliases
      if (rewardType === 'PDZ')  rewardType = 'TON';
      if (rewardType === 'POW')  rewardType = 'PAD';
      if (rewardType === 'STAR') rewardType = 'BUG';

      // STEP 2: Give the reward — if this throws, usage is NOT recorded
      if (rewardType === 'PAD') {
        const rewardPow = parseInt(rewardAmount);
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'promo_code',
          description: `Redeemed promo code: ${cleanCode}`,
        });

        // STEP 3: Only record usage after reward is successfully given
        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        return res.json({
          success: true,
          message: `${rewardPow.toLocaleString()} POW added to your balance!`,
          reward: rewardAmount,
          rewardType: 'POW',
        });

      } else if (rewardType === 'TON') {
        const [currentUser] = await db.select({ tonBalance: users.tonBalance }).from(users).where(eq(users.id, userId));
        const newTonBalance = (parseFloat(currentUser?.tonBalance || '0') + parseFloat(rewardAmount)).toFixed(8);
        await db.update(users).set({ tonBalance: newTonBalance, updatedAt: new Date() }).where(eq(users.id, userId));
        await storage.logTransaction({ userId, amount: rewardAmount, type: 'credit', source: 'promo_code', description: `Redeemed promo code: ${cleanCode}`, metadata: { code: cleanCode, rewardType: 'TON' } });

        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        return res.json({
          success: true,
          message: `${rewardAmount} TON added to your balance!`,
          reward: rewardAmount,
          rewardType: 'TON',
        });

      } else if (rewardType === 'USD') {
        await storage.addUSDBalance(userId, rewardAmount, 'promo_code', `Redeemed promo code: ${cleanCode}`);

        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        return res.json({
          success: true,
          message: `$${rewardAmount} USD added to your balance!`,
          reward: rewardAmount,
          rewardType: 'USD',
        });

      } else if (rewardType === 'BUG') {
        const [currentUser] = await db.select({ starBalance: users.starBalance }).from(users).where(eq(users.id, userId));
        const newStarBalance = (parseFloat(currentUser?.starBalance || '0') + parseFloat(rewardAmount)).toFixed(2);
        await db.update(users).set({ starBalance: newStarBalance, updatedAt: new Date() }).where(eq(users.id, userId));
        await storage.logTransaction({ userId, amount: rewardAmount, type: 'credit', source: 'promo_code', description: `Redeemed promo code: ${cleanCode}`, metadata: { code: cleanCode, rewardType: 'STAR' } });

        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        return res.json({
          success: true,
          message: `${rewardAmount} STAR added to your balance!`,
          reward: rewardAmount,
          rewardType: 'STAR',
        });

      } else {
        // Default fallback: PAD
        const rewardPow = parseInt(rewardAmount);
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'promo_code',
          description: `Redeemed promo code: ${cleanCode}`,
        });

        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        return res.json({
          success: true,
          message: `${rewardPow.toLocaleString()} POW added to your balance!`,
          reward: rewardAmount,
          rewardType: 'POW',
        });
      }

    } catch (error) {
      console.error("Error redeeming promo code:", error);
      res.status(500).json({ success: false, message: "Failed to redeem promo code. Please try again." });
    }
  });

  // Create promo code (admin only)
  app.post('/api/promo-codes/create', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      
      // Check if user is admin
      const userIsAdminFlag = isAdmin(user?.telegram_id || '') || (user?.telegram_id === "123456789" && process.env.NODE_ENV === 'development');
      if (!userIsAdminFlag) {
        return res.status(403).json({ message: 'Unauthorized: Admin access required' });
      }
      
      const { code, rewardAmount, rewardType, usageLimit, perUserLimit, expiresAt } = req.body;
      
      if (!rewardAmount) {
        return res.status(400).json({ message: 'Reward amount is required' });
      }
      
      // Auto-generate code if not provided or if "GENERATE" is passed
      let finalCode = code?.trim();
      if (!finalCode || finalCode === 'GENERATE') {
        // Generate random 8-character code
        finalCode = 'PROMO' + Math.random().toString(36).substring(2, 10).toUpperCase();
        console.log('🎲 Auto-generated promo code:', finalCode);
      }
      
      // Validate reward type - PAD/POW, TON, USD, BUG/STAR supported (PDZ is deprecated)
      let finalRewardType = rewardType || 'TON';
      // Normalize aliases
      if (finalRewardType === 'PDZ') finalRewardType = 'TON';
      if (finalRewardType === 'POW') finalRewardType = 'PAD';   // POW = PAD internally
      if (finalRewardType === 'STAR') finalRewardType = 'BUG';  // STAR = BUG internally
      if (finalRewardType !== 'PAD' && finalRewardType !== 'TON' && finalRewardType !== 'USD' && finalRewardType !== 'BUG') {
        return res.status(400).json({ message: 'Reward type must be POW, TON, USD, or STAR' });
      }
      
      const promoCode = await storage.createPromoCode({
        code: finalCode.toUpperCase(),
        rewardAmount: rewardAmount.toString(),
        rewardType: finalRewardType,
        rewardCurrency: finalRewardType,
        usageLimit: usageLimit || null,
        perUserLimit: perUserLimit || 1,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      });
      
      res.json({ 
        success: true, 
        message: `Promo code created successfully (${finalRewardType})`,
        promoCode 
      });
    } catch (error) {
      console.error("Error creating promo code:", error);
      res.status(500).json({ message: "Failed to create promo code" });
    }
  });

  // Get all promo codes (admin only)
  app.get('/api/admin/promo-codes', authenticateAdmin, async (req: any, res) => {
    try {
      const promoCodes = await storage.getAllPromoCodes();
      
      // Calculate stats for each promo code
      const promoCodesWithStats = promoCodes.map(promo => {
        const usageCount = promo.usageCount || 0;
        const usageLimit = promo.usageLimit || 0;
        const remainingCount = usageLimit > 0 ? Math.max(0, usageLimit - usageCount) : Infinity;
        const totalDistributed = parseFloat(promo.rewardAmount) * usageCount;
        const rewardType = promo.rewardType || 'PAD';
        
        return {
          ...promo,
          rewardType,
          usageCount,
          remainingCount: remainingCount === Infinity ? 'Unlimited' : remainingCount,
          totalDistributed: totalDistributed.toFixed(8)
        };
      });
      
      res.json({ 
        success: true, 
        promoCodes: promoCodesWithStats 
      });
    } catch (error) {
      console.error("Error fetching promo codes:", error);
      res.status(500).json({ message: "Failed to fetch promo codes" });
    }
  });

  // ArcPay Integration Routes
  const { createArcPayCheckout, verifyArcPayWebhookSignature, parseArcPayWebhook } = await import('./arcpay');

  // Create ArcPay payment checkout
  app.post('/api/arcpay/create-payment', authenticateTelegram, async (req: any, res) => {
    try {
      // Get user ID from the authenticated user object
      // authenticateTelegram sets req.user as { telegramUser: {...}, user: {...} }
      const userId = req.user?.user?.id;
      const userEmail = req.user?.user?.email;

      // Accept both tonAmount (new) and pdzAmount (legacy) for backward compatibility
      const tonAmount = req.body.tonAmount ?? req.body.pdzAmount;

      if (!userId) {
        console.error('❌ ArcPay: No user ID found in authenticated request:', {
          hasUser: !!req.user,
          userKeys: req.user ? Object.keys(req.user) : null,
          hasUserObject: !!req.user?.user
        });
        return res.status(401).json({ error: 'Unauthorized - user not found' });
      }

      // Validate amount - differentiate between empty/invalid vs too small
      console.log(`💳 Payment request - amount: ${tonAmount}, type: ${typeof tonAmount}`);

      // Check if amount is missing or not a number
      if (tonAmount === undefined || tonAmount === null || typeof tonAmount !== 'number') {
        console.error(`❌ Invalid amount type: ${typeof tonAmount}, value: ${tonAmount}`);
        return res.status(400).json({ error: 'Enter valid amount' });
      }

      // Check if amount is 0 or negative
      if (isNaN(tonAmount) || tonAmount <= 0) {
        console.error(`❌ Invalid amount value: ${tonAmount}`);
        return res.status(400).json({ error: 'Enter valid amount' });
      }

      // Check if amount is below minimum
      if (tonAmount < 0.1) {
        console.error(`❌ Amount below minimum: ${tonAmount} < 0.1`);
        return res.status(400).json({ error: 'Minimum top-up is 0.1 TON' });
      }

      console.log(`✅ Amount validated: ${tonAmount} TON - creating ArcPay payment for user ${userId}`);

      // Create checkout
      const result = await createArcPayCheckout(tonAmount, userId, userEmail);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        paymentUrl: result.paymentUrl,
      });
    } catch (error: any) {
      console.error('❌ Error creating ArcPay payment:', error);
      res.status(500).json({ error: 'Failed to create payment request' });
    }
  });

  // ArcPay Webhook Handler
  app.post('/arcpay/webhook', async (req: any, res) => {
    try {
      const rawBody = JSON.stringify(req.body);
      const signature = req.headers['x-arcpay-signature'] || '';

      console.log('🔔 ArcPay webhook received:', {
        eventType: req.body.event,
        orderId: req.body.order_id,
      });

      // Verify webhook signature (disable for testing, enable in production)
      // const isValid = verifyArcPayWebhookSignature(rawBody, signature);
      // if (!isValid) {
      //   console.error('❌ Invalid webhook signature');
      //   return res.status(401).json({ error: 'Invalid signature' });
      // }

      // Parse webhook payload
      const webhook = parseArcPayWebhook(rawBody);
      if (!webhook) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      const { event, order_id, status, amount, metadata } = webhook;
      const userId = metadata?.userId;
      // Accept both tonAmount (new) and pdzAmount (legacy) for backward compatibility
      const tonAmount = metadata?.tonAmount || metadata?.pdzAmount || amount;

      if (!userId) {
        console.error('❌ No userId in webhook metadata');
        return res.status(400).json({ error: 'Missing user information' });
      }

      // Handle payment success
      if (event === 'payment.success' && status === 'completed') {
        console.log(`✅ Payment successful for user ${userId}, crediting ${tonAmount} TON`);

        try {
          // Get user
          const user = await storage.getUser(userId);
          if (!user) {
            console.error(`❌ User not found: ${userId}`);
            return res.status(404).json({ error: 'User not found' });
          }

          // Credit TON to user
          const currentTon = parseFloat(user.tonBalance?.toString() || '0');
          const newTon = currentTon + tonAmount;

          // Update user's TON balance
          await db.update(users).set({
            tonBalance: newTon.toString(),
            updatedAt: new Date(),
          }).where(eq(users.id, userId));

          // Record transaction
          await db.insert(transactions).values({
            userId,
            amount: tonAmount.toString(),
            type: 'addition',
            source: 'arcpay_ton_topup',
            description: `Top-up ${tonAmount} TON via ArcPay (Order: ${order_id})`,
            metadata: {
              orderId: order_id,
              arcpayAmount: amount,
              arcpayCurrency: webhook.currency,
              transactionHash: webhook.transaction_hash,
            },
          });

          console.log(`💚 TON balance updated for user ${userId}: +${tonAmount} (Total: ${newTon})`);

          // CRITICAL: Send real-time update via WebSocket to the user's frontend
          sendRealtimeUpdate(userId, {
            type: 'balance_update',
            tonBalance: newTon.toString(),
            message: `🎉 Top-up successful! +${tonAmount} TON credited.`
          });

          // Send notification to user via Telegram
          try {
            const message = `🎉 Top-up successful!\n\n✅ You received ${tonAmount} TON\n💎 New balance: ${newTon} TON`;
            await sendUserTelegramNotification(userId, message);
          } catch (notifError) {
            console.warn('⚠️ Failed to send Telegram notification:', notifError);
          }

          return res.json({
            success: true,
            message: 'TON credited successfully',
            newBalance: newTon,
          });
        } catch (dbError) {
          console.error('❌ Error crediting TON:', dbError);
          return res.status(500).json({ error: 'Failed to credit TON' });
        }
      }

      // Handle payment failure
      if (event === 'payment.failed' && status === 'failed') {
        console.log(`❌ Payment failed for user ${userId}`);

        try {
          await sendUserTelegramNotification(
            userId,
            `❌ Payment failed for order ${order_id}. Please try again.`
          );
        } catch (notifError) {
          console.warn('⚠️ Failed to send Telegram notification:', notifError);
        }

        return res.json({
          success: true,
          message: 'Payment failure recorded',
        });
      }

      // Handle pending payments
      if (event === 'payment.pending' && status === 'pending') {
        console.log(`⏳ Payment pending for user ${userId}, order ${order_id}`);
        return res.json({
          success: true,
          message: 'Payment pending',
        });
      }

      return res.json({
        success: true,
        message: 'Webhook processed',
      });
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // ==================== FREE SPIN SYSTEM (DISABLED) ====================
  // Middleware to block all spin-related API endpoints
  app.use('/api/spin', (req, res, next) => {
    res.status(403).json({
      success: false,
      message: 'Spin feature has been disabled'
    });
  });

  // Helper function to get today's date as YYYY-MM-DD
  const getTodayDate = () => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  };

  // Spin reward configuration - heavily biased toward low rewards (DISABLED)
  const SPIN_REWARDS = [
    { type: 'PAD', amount: 1, rarity: 'common', weight: 400 },      // VERY HIGH CHANCE
    { type: 'PAD', amount: 20, rarity: 'common', weight: 350 },     // VERY HIGH CHANCE
    { type: 'PAD', amount: 200, rarity: 'rare', weight: 15 },       // VERY LOW CHANCE
    { type: 'PAD', amount: 800, rarity: 'rare', weight: 8 },        // VERY LOW CHANCE
    { type: 'PAD', amount: 1000, rarity: 'rare', weight: 3 },       // EXTREMELY LOW CHANCE
    { type: 'PAD', amount: 10000, rarity: 'ultra_rare', weight: 1 }, // EXTREMELY LOW CHANCE
    { type: 'TON', amount: 0.01, rarity: 'rare', weight: 5 },       // VERY LOW CHANCE
    { type: 'TON', amount: 0.10, rarity: 'ultra_rare', weight: 1 }, // EXTREMELY LOW CHANCE
  ];

  // Weighted random selection
  const selectSpinReward = () => {
    const totalWeight = SPIN_REWARDS.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const reward of SPIN_REWARDS) {
      random -= reward.weight;
      if (random <= 0) {
        return reward;
      }
    }
    return SPIN_REWARDS[0]; // Fallback to lowest reward
  };

  // GET /api/spin/status - Returns spin availability and counters
  app.get('/api/spin/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get or create spin data for user
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      // Check if we need to reset for new day
      if (spinDataResult && spinDataResult.lastSpinDate !== today) {
        // Reset daily values
        await db.update(spinData).set({
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        
        spinDataResult = {
          ...spinDataResult,
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
        };
      }

      if (!spinDataResult) {
        // Create new spin data
        await db.insert(spinData).values({
          userId,
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        });
        spinDataResult = {
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        };
      }

      // Calculate total available spins
      const freeSpinAvailable = !spinDataResult.freeSpinUsed;
      const extraSpins = spinDataResult.extraSpins || 0;
      const totalSpins = (freeSpinAvailable ? 1 : 0) + extraSpins;

      res.json({
        success: true,
        freeSpinAvailable,
        extraSpins,
        totalSpins,
        spinAdsWatched: spinDataResult.spinAdsWatched || 0,
        maxDailyAds: 50,
        adsPerSpin: 10,
        inviteSpinsEarned: spinDataResult.inviteSpinsEarned || 0,
      });
    } catch (error) {
      console.error('❌ Error getting spin status:', error);
      res.status(500).json({ error: 'Failed to get spin status' });
    }
  });

  // POST /api/spin/use - Spin the wheel
  app.post('/api/spin/use', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get spin data
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      // Check daily reset
      if (spinDataResult && spinDataResult.lastSpinDate !== today) {
        await db.update(spinData).set({
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        
        spinDataResult = {
          ...spinDataResult,
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
        };
      }

      if (!spinDataResult) {
        return res.status(400).json({ error: 'No spin data found' });
      }

      const freeSpinAvailable = !spinDataResult.freeSpinUsed;
      const extraSpins = spinDataResult.extraSpins || 0;

      // Check if user has any spins available
      if (!freeSpinAvailable && extraSpins <= 0) {
        return res.status(400).json({ error: 'No spins available' });
      }

      // Select reward
      const reward = selectSpinReward();
      let spinType = 'free';

      // Deduct spin
      if (freeSpinAvailable) {
        await db.update(spinData).set({
          freeSpinUsed: true,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        spinType = 'free';
      } else {
        await db.update(spinData).set({
          extraSpins: extraSpins - 1,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        spinType = 'extra';
      }

      // Credit reward to user
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (reward.type === 'POW') {
        const currentBalance = parseFloat(user.balance?.toString() || '0');
        const newBalance = currentBalance + reward.amount;
        await db.update(users).set({
          balance: newBalance.toString(),
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      } else if (reward.type === 'TON') {
        const currentTon = parseFloat(user.tonBalance?.toString() || '0');
        const newTon = currentTon + reward.amount;
        await db.update(users).set({
          tonBalance: newTon.toString(),
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      }

      // Record spin history
      await db.insert(spinHistory).values({
        userId,
        rewardType: reward.type,
        rewardAmount: reward.amount.toString(),
        spinType,
      });

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.amount.toString(),
        type: 'addition',
        source: 'spin_reward',
        description: `Free Spin Reward: ${reward.amount} ${reward.type}`,
        metadata: { spinType, rarity: reward.rarity },
      });

      res.json({
        success: true,
        reward: {
          type: reward.type,
          amount: reward.amount,
          rarity: reward.rarity,
        },
      });
    } catch (error) {
      console.error('❌ Error using spin:', error);
      res.status(500).json({ error: 'Failed to use spin' });
    }
  });

  // POST /api/spin/adwatch - Watch ad to earn spins
  app.post('/api/spin/adwatch', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get or create spin data
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      // Check daily reset
      if (spinDataResult && spinDataResult.lastSpinDate !== today) {
        await db.update(spinData).set({
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        
        spinDataResult = {
          ...spinDataResult,
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
        };
      }

      if (!spinDataResult) {
        await db.insert(spinData).values({
          userId,
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        });
        spinDataResult = {
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        };
      }

      const currentAdsWatched = spinDataResult.spinAdsWatched || 0;
      const maxAds = 50;

      // Check if max ads reached
      if (currentAdsWatched >= maxAds) {
        return res.status(400).json({ 
          error: 'Maximum daily ads reached',
          adsWatched: currentAdsWatched,
          maxAds,
        });
      }

      // Increment ad counter
      const newAdsWatched = currentAdsWatched + 1;
      let newExtraSpins = spinDataResult.extraSpins || 0;
      let spinEarned = false;

      // Check if 10 ads reached - grant extra spin
      if (newAdsWatched % 10 === 0) {
        newExtraSpins += 1;
        spinEarned = true;
      }

      await db.update(spinData).set({
        spinAdsWatched: newAdsWatched,
        extraSpins: newExtraSpins,
        updatedAt: new Date(),
      }).where(eq(spinData.userId, userId));

      res.json({
        success: true,
        adsWatched: newAdsWatched,
        maxAds,
        spinEarned,
        extraSpins: newExtraSpins,
        adsUntilNextSpin: 10 - (newAdsWatched % 10),
      });
    } catch (error) {
      console.error('❌ Error recording spin ad watch:', error);
      res.status(500).json({ error: 'Failed to record ad watch' });
    }
  });

  // POST /api/spin/invite - Grant spin for verified invite (called when referral is verified)
  app.post('/api/spin/invite', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get or create spin data
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      if (!spinDataResult) {
        await db.insert(spinData).values({
          userId,
          freeSpinUsed: false,
          extraSpins: 1, // Start with the bonus spin
          spinAdsWatched: 0,
          inviteSpinsEarned: 1,
          lastSpinDate: today,
        });
      } else {
        await db.update(spinData).set({
          extraSpins: (spinDataResult.extraSpins || 0) + 1,
          inviteSpinsEarned: (spinDataResult.inviteSpinsEarned || 0) + 1,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
      }

      res.json({
        success: true,
        message: 'Spin earned from verified invite!',
      });
    } catch (error) {
      console.error('❌ Error granting invite spin:', error);
      res.status(500).json({ error: 'Failed to grant invite spin' });
    }
  });

  // ==================== DAILY MISSIONS ====================

  // GET /api/missions/status - Get daily mission completion status
  app.get('/api/missions/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get mission completion status
      const missions = await db.query.dailyMissions.findMany({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.resetDate, today)
        ),
      });

      const shareStoryMission = missions.find(m => m.missionType === 'share_story');
      const dailyCheckinMission = missions.find(m => m.missionType === 'daily_checkin');
      const checkForUpdatesMission = missions.find(m => m.missionType === 'check_for_updates');
      const shareReferralMission = missions.find(m => m.missionType === 'share_referral');
      const checkAnnouncementMission = missions.find(m => m.missionType === 'check_announcement');
      const adsgramCheckinMission = missions.find(m => m.missionType === 'adsgram_checkin');

      // first_active_referral is permanent (not daily) — check all-time
      const firstActiveReferralMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'first_active_referral')
        ),
      });

      // Fetch mission reward settings
      const settingsRows = await db.select().from(adminSettings);
      const getS = (key: string, def: string) => settingsRows.find((s: any) => s.settingKey === key)?.settingValue || def;

      res.json({
        success: true,
        shareStory: {
          completed: shareStoryMission?.completed || false,
          claimed: !!shareStoryMission?.claimedAt,
        },
        dailyCheckin: {
          completed: dailyCheckinMission?.completed || false,
          claimed: !!dailyCheckinMission?.claimedAt,
        },
        checkForUpdates: {
          completed: checkForUpdatesMission?.completed || false,
          claimed: !!checkForUpdatesMission?.claimedAt,
        },
        shareReferral: {
          completed: shareReferralMission?.completed || false,
          claimed: !!shareReferralMission?.claimedAt,
          reward: parseInt(getS('share_referral_reward', '1000')),
        },
        checkAnnouncement: {
          completed: checkAnnouncementMission?.completed || false,
          claimed: !!checkAnnouncementMission?.claimedAt,
          reward: parseInt(getS('check_announcement_reward', '1000')),
        },
        adsgramCheckin: {
          completed: adsgramCheckinMission?.completed || false,
          claimed: !!adsgramCheckinMission?.claimedAt,
          reward: parseInt(getS('adsgram_checkin_reward', '1000')),
        },
        firstActiveReferral: {
          completed: firstActiveReferralMission?.completed || false,
          claimed: !!firstActiveReferralMission?.claimedAt,
          reward: parseInt(getS('first_active_referral_reward', '2500')),
        },
      });
    } catch (error) {
      console.error('❌ Error getting mission status:', error);
      res.status(500).json({ error: 'Failed to get mission status' });
    }
  });

  // POST /api/missions/share-story/claim - Claim share story reward
  app.post('/api/missions/share-story/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();
      const reward = 5; // 5 PAD

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'share_story'),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: 'share_story',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward to user balance
      const user = await storage.getUser(userId);
      if (user) {
        const currentBalance = parseFloat(user.balance?.toString() || '0');
        await db.update(users).set({
          balance: (currentBalance + reward).toString(),
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      }

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: 'mission_share_story',
        description: 'Share Story Mission Reward',
      });

      res.json({
        success: true,
        reward,
        message: `You earned ${reward} PAD!`,
      });
    } catch (error) {
      console.error('❌ Error claiming share story reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/missions/daily-checkin/claim - Claim daily check-in reward
  app.post('/api/missions/daily-checkin/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();
      const reward = 5; // 5 PAD

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'daily_checkin'),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already checked in today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: 'daily_checkin',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward to user balance
      const user = await storage.getUser(userId);
      if (user) {
        const currentBalance = parseFloat(user.balance?.toString() || '0');
        await db.update(users).set({
          balance: (currentBalance + reward).toString(),
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      }

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: 'mission_daily_checkin',
        description: 'Daily Check-in Mission Reward',
      });

      res.json({
        success: true,
        reward,
        message: `You earned ${reward} PAD!`,
      });
    } catch (error) {
      console.error('❌ Error claiming daily check-in reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/missions/check-for-updates/claim - Claim check for updates reward
  app.post('/api/missions/check-for-updates/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();
      const reward = 5; // 5 PAD

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'check_for_updates'),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: 'check_for_updates',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward to user balance
      const user = await storage.getUser(userId);
      if (user) {
        const currentBalance = parseFloat(user.balance?.toString() || '0');
        await db.update(users).set({
          balance: (currentBalance + reward).toString(),
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      }

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: 'mission_check_for_updates',
        description: 'Check for Updates Mission Reward',
      });

      res.json({
        success: true,
        reward,
        message: `You earned ${reward} PAD!`,
      });
    } catch (error) {
      console.error('❌ Error claiming check for updates reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/share/prepare-message - Prepare a share message for Telegram WebApp shareMessage()
  // Uses Bot API 8.0 savePreparedInlineMessage for native Telegram share dialog
  app.post('/api/share/prepare-message', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.telegram_id) {
        return res.status(400).json({ error: 'Telegram ID not found' });
      }

      if (!user.referralCode) {
        return res.status(400).json({ error: 'Referral code not found' });
      }

      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      if (!TELEGRAM_BOT_TOKEN) {
        return res.status(500).json({ error: 'Bot not configured' });
      }

      const { getBotUsername: getBotUsernameForMission } = await import('./telegram');
      const botUsername = await getBotUsernameForMission();
      const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
      
      const appUrl = process.env.RENDER_EXTERNAL_URL || 
                    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                    'https://vuuug.onrender.com';

      const shareImageUrl = `${appUrl}/images/share_v5.jpg`;
      const webAppUrl = referralLink;

      console.log(`📤 Preparing share message for user ${userId}`);
      console.log(`   Image URL: ${shareImageUrl}`);
      console.log(`   WebApp URL: ${webAppUrl}`);
      console.log(`   Referral Link: ${referralLink}`);

      // Use savePreparedInlineMessage (Bot API 8.0+) to prepare the message
      // This creates a prepared message that can be shared via WebApp.shareMessage()
      // Use regular URL button to trigger /start command for reliable referral tracking
      const inlineResult = {
        type: 'photo',
        id: `share_${user.referralCode}_${Date.now()}`,
        photo_url: shareImageUrl,
        thumbnail_url: shareImageUrl,
        title: '💵 Get Paid with Money Adz!',
        description: 'Join Money Adz and earn $PAD tokens by watching ads or completing simple tasks!',
        caption: '💵 Get paid for completing tasks and watching ads.',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Start Earning',
                url: referralLink
              }
            ]
          ]
        }
      };

      try {
        const prepareResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/savePreparedInlineMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: parseInt(user.telegram_id),
            result: inlineResult,
            allow_user_chats: true,
            allow_bot_chats: true,
            allow_group_chats: true,
            allow_channel_chats: true
          })
        });

        const prepareResult = await prepareResponse.json() as { 
          ok?: boolean; 
          result?: { id: string }; 
          description?: string;
          error_code?: number;
        };

        if (prepareResult.ok && prepareResult.result?.id) {
          console.log(`✅ Prepared share message with ID: ${prepareResult.result.id}`);
          return res.json({
            success: true,
            messageId: prepareResult.result.id,
            referralLink
          });
        } else {
          console.error('❌ Failed to prepare share message:', prepareResult.description);
          // Return a fallback with just the referral link for URL-based sharing
          return res.json({
            success: false,
            error: prepareResult.description || 'Failed to prepare message',
            referralLink,
            fallbackUrl: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('💵 Get paid for completing tasks and watching ads.')}`
          });
        }
      } catch (telegramError: any) {
        console.error('❌ Telegram API error:', telegramError);
        return res.json({
          success: false,
          error: telegramError.message || 'Telegram API error',
          referralLink,
          fallbackUrl: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('💸 Start earning money just by completing tasks & watching ads!')}`
        });
      }

    } catch (error: any) {
      console.error('❌ Error preparing share message:', error);
      res.status(500).json({ error: 'Failed to prepare share message' });
    }
  });

  // POST /api/share/invite - Legacy endpoint (kept for backward compatibility)
  app.post('/api/share/invite', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.referralCode) {
        return res.status(400).json({ error: 'Referral code not found' });
      }

      const { getBotUsername: getBotUsernameForReferral } = await import('./telegram');
      const botUsername = await getBotUsernameForReferral();
      const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;

      // Return just the referral link for the new share flow
      return res.json({ 
        success: true, 
        message: 'Share link ready',
        referralLink 
      });

    } catch (error) {
      console.error('❌ Error sending invite:', error);
      res.status(500).json({ error: 'Failed to send invite' });
    }
  });

  // ============ COUNTRY BLOCKING API ============
  
  // GET /api/check-country - Check if user's country is blocked (for frontend blocking)
  app.get('/api/check-country', async (req: any, res) => {
    try {
      const { getClientIP, getCountryFromIP, getBlockedCountries, isVPNOrProxy } = await import('./countryBlocking');
      
      // Prevent caching so blocks take effect immediately
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      // Check if user is admin - admins are never blocked
      // SECURITY: Verify Telegram initData signature before trusting admin status
      const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
      if (telegramData && botToken) {
        try {
          const { verifyTelegramWebAppData } = await import('./auth');
          const { isValid, user: verifiedUser } = verifyTelegramWebAppData(telegramData, botToken);
          
          if (isValid && verifiedUser && isAdmin(verifiedUser.id.toString())) {
            console.log(`✅ Admin user verified (${verifiedUser.id}), bypassing country check`);
            return res.json({ blocked: false, country: null, isAdmin: true });
          }
        } catch (e) {
          console.log('⚠️ Admin verification failed, continuing with country check');
        }
      }
      
      // In development mode, allow admin bypass via parsed (unverified) initData
      if (process.env.NODE_ENV === 'development' && telegramData) {
        try {
          const urlParams = new URLSearchParams(telegramData);
          const userString = urlParams.get('user');
          if (userString) {
            const telegramUser = JSON.parse(userString);
            if (isAdmin(telegramUser.id.toString())) {
              console.log('🔧 Dev mode: Admin bypass via parsed data');
              return res.json({ blocked: false, country: null, isAdmin: true });
            }
          }
        } catch (e) {
          // Continue with normal check
        }
      }
      
      const clientIP = getClientIP(req);
      const result = await getCountryFromIP(clientIP);
      
      if (!result.countryCode) {
        return res.json({ blocked: false, country: null });
      }
      
      const blockedCodes = await getBlockedCountries();
      const countryIsBlocked = blockedCodes.includes(result.countryCode.toUpperCase());
      
      // VPN BYPASS LOGIC: If user is from blocked country BUT using VPN/proxy/hosting, ALLOW access
      const usingVPN = isVPNOrProxy(result);
      const vpnBypass = countryIsBlocked && usingVPN;
      
      // Final blocked status: blocked only if country is blocked AND NOT using VPN
      const finalBlocked = countryIsBlocked && !usingVPN;
      
      if (vpnBypass) {
        console.log(`🔐 VPN bypass granted for ${result.countryCode} (IP: ${clientIP}, VPN: ${result.isVPN}, Hosting: ${result.isHosting})`);
      }
      
      res.json({
        blocked: finalBlocked,
        country: result.countryCode,
        countryName: result.countryName,
        isVPN: result.isVPN,
        isProxy: result.isProxy,
        isHosting: result.isHosting,
        vpnBypass
      });
    } catch (error) {
      console.error('❌ Error checking country:', error);
      res.json({ blocked: false, country: null });
    }
  });

  // GET /api/user-info - Get user's IP and detected country (for admin panel display)
  app.get('/api/user-info', async (req: any, res) => {
    try {
      const { getClientIP, getAllCountries, getCountryFromIP } = await import('./countryBlocking');
      
      const clientIP = getClientIP(req);
      const result = await getCountryFromIP(clientIP);
      
      let countryName = result.countryName || 'Unknown';
      let countryCode = result.countryCode || 'XX';
      
      // If we only got country code but no name, try to find it in our list
      if (countryCode !== 'XX' && countryName === 'Unknown') {
        const allCountries = getAllCountries();
        const found = allCountries.find(c => c.code === countryCode);
        if (found) {
          countryName = found.name;
        }
      }
      
      res.json({
        ip: clientIP || 'Unknown',
        country: countryName,
        countryCode: countryCode
      });
    } catch (error) {
      console.error('❌ Error fetching user info:', error);
      res.status(500).json({ 
        ip: 'Unknown',
        country: 'Unknown',
        countryCode: 'XX'
      });
    }
  });

  // GET /api/countries - Get all countries (public)
  app.get('/api/countries', async (req: any, res) => {
    try {
      const { getAllCountries } = await import('./countryBlocking');
      const allCountries = getAllCountries();
      res.json({ success: true, countries: allCountries });
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // GET /api/blocked - Get list of blocked country codes (public)
  app.get('/api/blocked', async (req: any, res) => {
    try {
      const { getBlockedCountries } = await import('./countryBlocking');
      const blockedCodes = await getBlockedCountries();
      res.json({ success: true, blocked: blockedCodes });
    } catch (error) {
      console.error('❌ Error fetching blocked countries:', error);
      res.status(500).json({ error: 'Failed to fetch blocked countries' });
    }
  });

  // POST /api/block-country - Block a country (requires admin)
  app.post('/api/block-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid country code' });
      }
      
      const { blockCountry } = await import('./countryBlocking');
      const success = await blockCountry(country_code);
      
      if (success) {
        console.log(`🚫 Country blocked: ${country_code}`);
        
        // Broadcast to all clients so they recheck their country status immediately
        broadcastToAll({
          type: 'country_blocked',
          countryCode: country_code.toUpperCase(),
          message: `Country ${country_code} has been blocked`
        });
        
        res.json({ success: true, message: `Country ${country_code} blocked` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to block country' });
      }
    } catch (error) {
      console.error('❌ Error blocking country:', error);
      res.status(500).json({ success: false, error: 'Failed to block country' });
    }
  });

  // POST /api/unblock-country - Unblock a country (requires admin)
  app.post('/api/unblock-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid country code' });
      }
      
      const { unblockCountry } = await import('./countryBlocking');
      const success = await unblockCountry(country_code);
      
      if (success) {
        console.log(`✅ Country unblocked: ${country_code}`);
        
        // Broadcast to all clients so they recheck their country status immediately
        broadcastToAll({
          type: 'country_unblocked',
          countryCode: country_code.toUpperCase(),
          message: `Country ${country_code} has been unblocked`
        });
        
        res.json({ success: true, message: `Country ${country_code} unblocked` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to unblock country' });
      }
    } catch (error) {
      console.error('❌ Error unblocking country:', error);
      res.status(500).json({ success: false, error: 'Failed to unblock country' });
    }
  });

  // GET /api/admin/countries - Get all countries with block status
  app.get('/api/admin/countries', authenticateAdmin, async (req: any, res) => {
    try {
      const { getAllCountries, getBlockedCountries } = await import('./countryBlocking');
      
      const allCountries = getAllCountries();
      const blockedCodes = await getBlockedCountries();
      const blockedSet = new Set(blockedCodes);
      
      const countriesWithStatus = allCountries.map(country => ({
        ...country,
        blocked: blockedSet.has(country.code)
      }));
      
      res.json({ success: true, countries: countriesWithStatus });
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });
  
  // POST /api/admin/block-country - Block a country
  app.post('/api/admin/block-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ error: 'Invalid country code' });
      }
      
      const { blockCountry } = await import('./countryBlocking');
      const success = await blockCountry(country_code);
      
      if (success) {
        console.log(`🚫 Country blocked: ${country_code}`);
        res.json({ success: true, message: `Country ${country_code} blocked` });
      } else {
        res.status(500).json({ error: 'Failed to block country' });
      }
    } catch (error) {
      console.error('❌ Error blocking country:', error);
      res.status(500).json({ error: 'Failed to block country' });
    }
  });
  
  // POST /api/admin/unblock-country - Unblock a country
  app.post('/api/admin/unblock-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ error: 'Invalid country code' });
      }
      
      const { unblockCountry } = await import('./countryBlocking');
      const success = await unblockCountry(country_code);
      
      if (success) {
        console.log(`✅ Country unblocked: ${country_code}`);
        res.json({ success: true, message: `Country ${country_code} unblocked` });
      } else {
        res.status(500).json({ error: 'Failed to unblock country' });
      }
    } catch (error) {
      console.error('❌ Error unblocking country:', error);
      res.status(500).json({ error: 'Failed to unblock country' });
    }
  });

  // ─── FEATURE 1: Admin Balance Adjustment ────────────────────────────────────
  app.post('/api/admin/users/:id/adjust-balance', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { action, currency, amount, reason } = req.body;

      if (!['add', 'deduct', 'set'].includes(action)) return res.status(400).json({ error: 'Invalid action. Use add|deduct|set' });
      if (!['pow', 'star', 'usd'].includes(currency)) return res.status(400).json({ error: 'Invalid currency. Use pow|star|usd' });
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Invalid amount' });

      const targetUser = await storage.getUser(id);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      let fieldKey = currency === 'pow' ? 'balance' : currency === 'star' ? 'starBalance' : 'usdBalance';
      const current = parseFloat((targetUser as any)[fieldKey]?.toString() || '0');

      let newVal: number;
      if (action === 'add') newVal = current + amt;
      else if (action === 'deduct') newVal = Math.max(0, current - amt);
      else newVal = amt;

      const updateData: any = { updatedAt: new Date() };
      updateData[fieldKey] = newVal.toString();
      await db.update(users).set(updateData).where(eq(users.id, id));

      const txSource = `admin_${action}_${currency}`;
      const txType = action === 'deduct' ? 'deduction' : 'addition';
      await db.insert(transactions).values({
        userId: id,
        amount: amt.toString(),
        type: txType,
        source: txSource,
        description: reason ? `Admin adjustment: ${reason}` : `Admin ${action} ${currency.toUpperCase()}`,
      });

      res.json({ success: true, previous: current, newBalance: newVal, currency, action, amount: amt });
    } catch (error) {
      console.error('❌ Error adjusting balance:', error);
      res.status(500).json({ error: 'Failed to adjust balance' });
    }
  });

  // GET audit log for a user (balance transactions)
  app.get('/api/admin/users/:id/balance-log', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const logs = await db.select().from(transactions)
        .where(and(eq(transactions.userId, id), sql`source LIKE 'admin_%'`))
        .orderBy(desc(transactions.createdAt))
        .limit(50);
      res.json({ success: true, logs });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch balance log' });
    }
  });

  // ─── FEATURE 2: Promo Code Toggle / Edit ─────────────────────────────────────
  app.put('/api/admin/promo-codes/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { isActive, rewardAmount } = req.body;

      const updateData: any = {};
      if (typeof isActive === 'boolean') updateData.isActive = isActive;
      if (rewardAmount !== undefined) {
        const ra = parseFloat(rewardAmount);
        if (!isNaN(ra) && ra >= 0) updateData.rewardAmount = ra.toString();
      }

      if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'Nothing to update' });

      await db.update(promoCodes).set(updateData).where(eq(promoCodes.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Error updating promo code:', error);
      res.status(500).json({ error: 'Failed to update promo code' });
    }
  });

  // ─── FEATURE 3: 4 New Daily Missions ─────────────────────────────────────────

  // Helper to claim a daily mission with configurable reward setting key
  async function claimDailyMission(userId: string, missionType: string, rewardSettingKey: string, defaultReward: number, description: string) {
    const today = getTodayDate();
    const settings = await db.select().from(adminSettings);
    const getSetting = (key: string, def: string) => settings.find((s: any) => s.settingKey === key)?.settingValue || def;
    const reward = parseInt(getSetting(rewardSettingKey, String(defaultReward)));

    const existing = await db.query.dailyMissions.findFirst({
      where: and(
        eq(dailyMissions.userId, userId),
        eq(dailyMissions.missionType, missionType),
        eq(dailyMissions.resetDate, today)
      ),
    });
    if (existing?.claimedAt) throw new Error('Already claimed today');

    if (existing) {
      await db.update(dailyMissions).set({ completed: true, claimedAt: new Date() }).where(eq(dailyMissions.id, existing.id));
    } else {
      await db.insert(dailyMissions).values({ userId, missionType, completed: true, claimedAt: new Date(), resetDate: today });
    }

    const user = await storage.getUser(userId);
    if (user) {
      const current = parseFloat(user.balance?.toString() || '0');
      await db.update(users).set({ balance: (current + reward).toString(), updatedAt: new Date() }).where(eq(users.id, userId));
    }
    await db.insert(transactions).values({ userId, amount: reward.toString(), type: 'addition', source: `mission_${missionType}`, description });
    return reward;
  }

  app.get('/api/missions/referral-status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const activeReferrals = await db.query.referrals.findMany({
        where: and(eq(referrals.referrerId, userId), eq(referrals.status, 'active')),
        limit: 1,
      });
      res.json({ success: true, hasActiveReferral: activeReferrals.length > 0, count: activeReferrals.length });
    } catch (error) {
      console.error('❌ referral-status error:', error);
      res.status(500).json({ error: 'Failed to check referral status' });
    }
  });

  app.post('/api/missions/share-referral/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const reward = await claimDailyMission(userId, 'share_referral', 'share_referral_reward', 1000, 'Share Referral Mission Reward');
      res.json({ success: true, reward });
    } catch (error: any) {
      if (error.message === 'Already claimed today') return res.status(400).json({ error: error.message });
      console.error('❌ share-referral claim error:', error);
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  app.post('/api/missions/check-announcement/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const reward = await claimDailyMission(userId, 'check_announcement', 'check_announcement_reward', 1000, 'Check Announcement Mission Reward');
      res.json({ success: true, reward });
    } catch (error: any) {
      if (error.message === 'Already claimed today') return res.status(400).json({ error: error.message });
      console.error('❌ check-announcement claim error:', error);
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  app.post('/api/missions/adsgram-checkin/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const reward = await claimDailyMission(userId, 'adsgram_checkin', 'adsgram_checkin_reward', 1000, 'Adsgram Check-in Mission Reward');
      res.json({ success: true, reward });
    } catch (error: any) {
      if (error.message === 'Already claimed today') return res.status(400).json({ error: error.message });
      console.error('❌ adsgram-checkin claim error:', error);
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  app.post('/api/missions/first-active-referral/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      // For first active referral — not daily resettable, check all-time
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const settings = await db.select().from(adminSettings);
      const getSetting = (key: string, def: string) => settings.find((s: any) => s.settingKey === key)?.settingValue || def;
      const reward = parseInt(getSetting('first_active_referral_reward', '2500'));

      // Check if ever claimed (use a special non-resetting date)
      const existing = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'first_active_referral')
        ),
      });
      if (existing?.claimedAt) return res.status(400).json({ error: 'Already claimed' });

      // Check user has at least 1 active referral
      const activeReferrals = await db.query.referrals.findMany({
        where: and(eq(referrals.referrerId, userId), eq(referrals.status, 'active')),
        limit: 1,
      });
      if (activeReferrals.length === 0) return res.status(400).json({ error: 'No active referrals yet' });

      if (existing) {
        await db.update(dailyMissions).set({ completed: true, claimedAt: new Date() }).where(eq(dailyMissions.id, existing.id));
      } else {
        await db.insert(dailyMissions).values({ userId, missionType: 'first_active_referral', completed: true, claimedAt: new Date(), resetDate: 'permanent' });
      }
      const current = parseFloat(user.balance?.toString() || '0');
      await db.update(users).set({ balance: (current + reward).toString(), updatedAt: new Date() }).where(eq(users.id, userId));
      await db.insert(transactions).values({ userId, amount: reward.toString(), type: 'addition', source: 'mission_first_active_referral', description: 'First Active Referral Mission Reward' });
      res.json({ success: true, reward });
    } catch (error) {
      console.error('❌ first-active-referral claim error:', error);
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // ─── FEATURE 4: Task Edit ─────────────────────────────────────────────────────
  app.put('/api/admin/tasks/:id/edit', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { title, description, totalClicksRequired, costPerClick, status } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (totalClicksRequired !== undefined) {
        const n = parseInt(totalClicksRequired);
        if (!isNaN(n) && n > 0) updateData.totalClicksRequired = n;
      }
      if (costPerClick !== undefined) {
        const c = parseFloat(costPerClick);
        if (!isNaN(c) && c > 0) updateData.costPerClick = c.toString();
      }
      if (status !== undefined && ['under_review', 'running', 'paused', 'completed', 'rejected'].includes(status)) {
        updateData.status = status;
      }

      await db.update(advertiserTasks).set(updateData).where(eq(advertiserTasks.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Error editing task:', error);
      res.status(500).json({ error: 'Failed to edit task' });
    }
  });

  // ─── FEATURE 6: Advanced User Search (update existing route) — see below ──────
  // (Existing GET /api/admin/users route updated via in-place edit)

  // ─── FEATURE 7: Withdrawal Analytics ─────────────────────────────────────────
  app.get('/api/admin/users/:id/analytics', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Count friends
      const allReferrals = await db.query.referrals.findMany({ where: eq(referrals.referrerId, id) });
      const activeReferralsCount = allReferrals.filter((r: any) => r.status === 'active').length;

      // Count completed tasks
      const completedTasksCount = await db.query.taskClicks.findMany({ where: eq(taskClicks.userId, id) });

      // Recent transactions
      const recentTx = await db.select().from(transactions)
        .where(eq(transactions.userId, id))
        .orderBy(desc(transactions.createdAt))
        .limit(5);

      const ageMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : 0;
      const ageDays = Math.floor(ageMs / 86400000);

      res.json({
        success: true,
        analytics: {
          uid: user.referralCode || user.personalCode,
          joinDate: user.createdAt,
          ageDays,
          totalFriends: allReferrals.length,
          activeFriends: activeReferralsCount,
          adsWatched: user.adsWatched || 0,
          tasksCompleted: completedTasksCount.length,
          totalEarned: user.totalEarned?.toString() || '0',
          balance: user.balance?.toString() || '0',
          usdBalance: user.usdBalance?.toString() || '0',
          recentTransactions: recentTx,
          banned: user.banned || false,
        }
      });
    } catch (error) {
      console.error('❌ Error fetching user analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  return httpServer;
}
