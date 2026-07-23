// Telegram Bot API integration for sending notifications
import TelegramBot from 'node-telegram-bot-api';
import { readFileSync } from 'fs';
import { join } from 'path';
import { storage } from './storage';
import { db } from './db';
import { earnings } from '../shared/schema';
import { eq, sql, and } from 'drizzle-orm';

/** Parse all admin Telegram IDs from environment variables.
 *  Supports: ADMIN_IDS, TELEGRAM_ADMIN_IDS, SUPER_ADMIN_ID, TELEGRAM_ADMIN_ID
 *  No hardcoded fallback IDs — env vars are the sole source of truth.
 */
function getAdminIds(): Set<string> {
  const ids = new Set<string>();
  const sources = [
    process.env.ADMIN_IDS,
    process.env.TELEGRAM_ADMIN_IDS,
    process.env.SUPER_ADMIN_ID,
    process.env.TELEGRAM_ADMIN_ID,
  ];
  for (const src of sources) {
    if (!src) continue;
    for (const id of src.split(',')) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  return ids;
}

const isAdmin = (telegramId: string): boolean => {
  const tid = telegramId.toString().trim();
  return getAdminIds().has(tid);
};

// Async version — also checks DB-added admins (added via the admin panel)
const isAdminAsync = async (telegramId: string): Promise<boolean> => {
  if (isAdmin(telegramId)) return true;
  try {
    const { db: dbConn } = await import('./db');
    const { adminRoles } = await import('../shared/schema');
    const { eq } = await import('drizzle-orm');
    const [record] = await dbConn.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId.toString())).limit(1);
    return !!record;
  } catch { return false; }
};

// Cached bot username fetched from Telegram API on startup
let cachedBotUsername: string | null = null;

/**
 * Returns the live HTTPS URL of the webapp (used for web_app buttons).
 * Priority: RENDER_EXTERNAL_URL → REPLIT_DOMAINS → REPL_SLUG → REPLIT_DEV_DOMAIN → WEBAPP_URL env.
 * The web_app button type requires a direct HTTPS domain, NOT a t.me link.
 */
export function getWebappUrl(): string {
  return (
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}` : '') ||
    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : '') ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '') ||
    process.env.WEBAPP_URL ||
    ''
  );
}

export async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return process.env.BOT_USERNAME || process.env.VITE_BOT_USERNAME || 'MoneyAdzbot';
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (res.ok) {
      const data = await res.json();
      if (data.result?.username) {
        cachedBotUsername = data.result.username;
        console.log(`✅ Bot username fetched from API: @${cachedBotUsername}`);
        return cachedBotUsername;
      }
    }
  } catch (e) {
    console.error('⚠️ Failed to fetch bot username from API:', e);
  }
  return process.env.BOT_USERNAME || process.env.VITE_BOT_USERNAME || 'MoneyAdzbot';
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// State management for admin rejection flow
const pendingRejections = new Map<string, {
  withdrawalId: string;
  messageId: number;
  timestamp: number;
}>();

// Tracks which admin chats received the withdrawal notification, keyed by withdrawalId
// Used to remove Approve/Reject buttons from all admins once any one acts on it
export const withdrawalAdminMessages = new Map<string, Array<{ chatId: string; messageId: number }>>();

// Removes Approve/Reject buttons from all admin copies of a withdrawal notification
async function clearWithdrawalAdminButtons(withdrawalId: string): Promise<void> {
  const entries = withdrawalAdminMessages.get(withdrawalId);
  if (!entries || entries.length === 0) return;
  await Promise.allSettled(
    entries.map(({ chatId, messageId }) =>
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
      })
    )
  );
  withdrawalAdminMessages.delete(withdrawalId);
}

// State management for admin broadcast flow
const pendingBroadcasts = new Map<string, { timestamp: number }>();

// Buffer for media-group (album) broadcast messages
const mediaGroupBuffers = new Map<string, { messages: any[]; timer: any; adminChatId: string }>();

// Utility function to format USD amounts
function formatUSD(value: string | number): string {
  const num = parseFloat(String(value));
  return num.toFixed(2);
}

// Escape special characters for Telegram MarkdownV2
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  protect_content?: boolean;
  reply_markup?: {
    inline_keyboard: Array<Array<{
      text: string;
      url?: string;
      callback_data?: string;
    }>>;
  };
}


// Promotion features removed - focusing on core bot functionality only

// All claim state functions removed

// Cache bot ID to avoid repeated getMe() calls per membership check
let cachedBotId: number | null = null;
// Cache bot admin status per channel: channelId -> { isAdmin: boolean, expiresAt: number }
const botAdminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();

async function getCachedBotId(botToken: string): Promise<number | null> {
  if (cachedBotId !== null) return cachedBotId;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.result?.id) {
        cachedBotId = data.result.id;
        return cachedBotId;
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function isBotAdminInChannel(botToken: string, channelIdentifier: string): Promise<boolean> {
  const cached = botAdminCache.get(channelIdentifier);
  if (cached && Date.now() < cached.expiresAt) return cached.isAdmin;

  try {
    const botId = await getCachedBotId(botToken);
    if (!botId) {
      botAdminCache.set(channelIdentifier, { isAdmin: true, expiresAt: Date.now() + 5 * 60_000 });
      return true; // fail open
    }
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelIdentifier)}&user_id=${botId}`
    );
    if (res.ok) {
      const data = await res.json();
      const isAdmin = data.ok && ['creator', 'administrator'].includes(data.result?.status);
      botAdminCache.set(channelIdentifier, { isAdmin, expiresAt: Date.now() + 5 * 60_000 });
      return isAdmin;
    }
  } catch { /* ignore */ }
  botAdminCache.set(channelIdentifier, { isAdmin: true, expiresAt: Date.now() + 5 * 60_000 });
  return true; // fail open
}

/**
 * Check whether the bot is an admin with Post Messages permission in the given channel.
 * Also resolves and returns the numeric chat ID.
 * Returns detail on WHY permission fails (not admin vs admin-but-no-post-permission).
 */
export async function checkBotCanPostToChannel(
  botToken: string,
  channelIdentifier: string
): Promise<{
  canPost: boolean;
  isAdmin: boolean;
  hasPostPermission: boolean;
  chatId?: string;
  chatType?: string;
  error?: string;
}> {
  try {
    const botId = await getCachedBotId(botToken);
    if (!botId) return { canPost: false, isAdmin: false, hasPostPermission: false, error: 'Could not resolve bot ID' };

    // Resolve numeric chat ID and type via getChat
    let chatId: string | undefined;
    let chatType: string | undefined;
    const chatRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(channelIdentifier)}`
    );
    if (chatRes.ok) {
      const chatData = await chatRes.json();
      if (chatData.ok && chatData.result?.id) {
        chatId   = String(chatData.result.id);
        chatType = chatData.result.type; // 'channel' | 'supergroup' | 'group' | 'private'
      }
    }

    // Check bot membership / permissions
    const memberRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelIdentifier)}&user_id=${botId}`
    );
    if (!memberRes.ok) return { canPost: false, isAdmin: false, hasPostPermission: false, chatId, chatType, error: 'Telegram API error fetching membership' };
    const memberData = await memberRes.json();
    if (!memberData.ok) return { canPost: false, isAdmin: false, hasPostPermission: false, chatId, chatType, error: memberData.description || 'Membership check failed' };

    const member    = memberData.result;
    const isCreator = member.status === 'creator';
    const isAdmin   = isCreator || member.status === 'administrator';

    if (!isAdmin) {
      return { canPost: false, isAdmin: false, hasPostPermission: false, chatId, chatType, error: 'Bot is not an administrator' };
    }

    // For channels: can_post_messages must be explicitly true (Telegram omits it if not granted).
    // For groups/supergroups: admins can always post — field is not applicable.
    let hasPostPermission: boolean;
    if (chatType === 'channel') {
      hasPostPermission = isCreator || member.can_post_messages === true;
    } else {
      hasPostPermission = true; // groups/supergroups — posting is implied by admin
    }

    const errorMsg = hasPostPermission ? undefined : 'Bot is admin but does not have "Post Messages" permission';
    return { canPost: hasPostPermission, isAdmin: true, hasPostPermission, chatId, chatType, error: errorMsg };
  } catch (err) {
    return { canPost: false, isAdmin: false, hasPostPermission: false, error: String(err) };
  }
}

export async function verifyChannelMembership(userId: number, channelIdOrUsername: string, botToken: string): Promise<boolean> {
  // Normalize channel identifier
  let channelIdentifier = channelIdOrUsername;
  if (!channelIdentifier.startsWith('@') && !channelIdentifier.startsWith('-')) {
    channelIdentifier = `@${channelIdentifier}`;
  }

  console.log(`🔍 Checking membership for user ${userId} in channel ${channelIdentifier}...`);

  try {
    // Check bot admin status (cached for 5 min — zero extra latency on hot path)
    const botIsAdmin = await isBotAdminInChannel(botToken, channelIdentifier);
    if (!botIsAdmin) {
      console.warn(`⚠️ Bot is NOT an admin in ${channelIdentifier} — failing OPEN so users aren't blocked.`);
      return true;
    }

    // Single direct getChatMember call — Telegram ALWAYS returns HTTP 200; check data.ok for errors
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(channelIdentifier)}&user_id=${userId}`
    );
    const data = await res.json().catch(() => null);

    if (!data) {
      console.warn(`⚠️ getChatMember returned non-JSON for ${channelIdentifier} — failing OPEN`);
      return true;
    }

    if (!data.ok) {
      const errorCode = data?.error_code;
      const description: string = data?.description || '';
      // Only fail closed on definitive "user is not a member" errors
      if (
        errorCode === 400 &&
        (description.includes('PARTICIPANT_ID_INVALID') ||
          description.includes('user not found') ||
          description.includes('USER_NOT_PARTICIPANT'))
      ) {
        console.log(`⚠️ User ${userId} not in ${channelIdentifier}: ${description}`);
        return false;
      }
      // Any other API error (chat not found, bot kicked, etc.) → fail open
      console.warn(`⚠️ getChatMember error for ${channelIdentifier}: ${description} (code ${errorCode}) — failing OPEN`);
      return true;
    }

    const status: string = data.result?.status ?? '';
    // 'restricted' means the user IS a member but with limited permissions — still valid
    const validStatuses = ['creator', 'administrator', 'member', 'restricted', 'subscriber'];
    const isValid = validStatuses.includes(status);
    console.log(`🔍 User ${userId} status in ${channelIdentifier}: "${status}" → ${isValid ? '✅ valid' : '❌ not a member'}`);
    return isValid;
  } catch (error: any) {
    console.error(`❌ Telegram verification error for user ${userId} in ${channelIdOrUsername}:`, error?.message || error);
    return true; // fail open on unexpected errors
  }
}

// Extract bot username from URL
function extractBotUsernameFromUrl(url: string): string | null {
  try {
    // Handle various URL formats:
    // https://t.me/botname
    // https://t.me/botname?start=xxx
    // @botname
    
    let username = url;
    
    // Remove https://t.me/ prefix if present
    if (username.startsWith('https://t.me/')) {
      username = username.replace('https://t.me/', '');
    }
    
    // Remove @ prefix if present
    if (username.startsWith('@')) {
      username = username.substring(1);
    }
    
    // Remove query parameters (everything after ?)
    if (username.includes('?')) {
      username = username.split('?')[0];
    }
    
    return username || null;
  } catch (error) {
    console.error('❌ Error extracting bot username from URL:', error);
    return null;
  }
}

// All old Telegram notifications removed - bot uses inline buttons only

export async function sendTelegramMessage(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.error('Telegram bot token or admin ID not configured');
    return false;
  }

  try {
    const telegramMessage: TelegramMessage = {
      chat_id: TELEGRAM_ADMIN_ID,
      text: message,
      parse_mode: 'HTML',
      protect_content: false
    };

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telegramMessage),
    });

    if (response.ok) {
      console.log('Telegram notification sent successfully');
      return true;
    } else {
      const errorData = await response.text();
      console.error('Failed to send Telegram notification:', errorData);
      return false;
    }
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
    return false;
  }
}


// Permanent Telegram error codes — no retry, just count as skipped/failed
const TELEGRAM_PERMANENT_ERRORS = new Set([
  'bot was blocked by the user',
  'user is deactivated',
  'chat not found',
  'have no rights to send a message',
  'bot was kicked from the group chat',
  'bot was kicked from the supergroup chat',
  'the group chat was deleted',
  'chat_id is empty',
  'PEER_ID_INVALID',
]);

function isTelegramPermanentError(description: string): boolean {
  const lower = description.toLowerCase();
  for (const msg of TELEGRAM_PERMANENT_ERRORS) {
    if (lower.includes(msg)) return true;
  }
  return false;
}

export async function sendUserTelegramNotification(userId: string, message: string, replyMarkup?: any, parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured');
    return false;
  }

  const telegramMessage: TelegramMessage = {
    chat_id: userId,
    text: message,
    parse_mode: parseMode,
    protect_content: false
  };

  if (replyMarkup) {
    if (replyMarkup.keyboard) {
      telegramMessage.reply_markup = {
        keyboard: replyMarkup.keyboard,
        resize_keyboard: replyMarkup.resize_keyboard ?? true,
        one_time_keyboard: replyMarkup.one_time_keyboard ?? false
      } as any;
    } else {
      telegramMessage.reply_markup = replyMarkup;
    }
  }

  const body = JSON.stringify(telegramMessage);

  // Retry up to 3 times for rate-limit (429) and transient server errors (5xx)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.ok) return true;

      const errorText = await response.text();
      let errorDescription = errorText;
      try {
        const errJson = JSON.parse(errorText);
        errorDescription = errJson.description || errorText;
      } catch { /* raw text fallback */ }

      if (response.status === 429) {
        // Rate limited — parse retry_after if present
        let retryAfter = 2;
        try { retryAfter = JSON.parse(errorText)?.parameters?.retry_after ?? 2; } catch { /* ignore */ }
        console.warn(`⏳ Telegram rate limit for ${userId}, retrying in ${retryAfter}s (attempt ${attempt})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (response.status >= 500) {
        // Transient server error — short backoff
        await new Promise(r => setTimeout(r, attempt * 1000));
        continue;
      }

      // 4xx that isn't 429 — permanent error, no retry
      if (isTelegramPermanentError(errorDescription)) {
        // Silently skip — user blocked bot, deactivated, etc.
        return false;
      }

      console.error(`❌ Telegram sendMessage failed for ${userId}: [${response.status}] ${errorDescription}`);
      return false;
    } catch (error) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 500));
        continue;
      }
      console.error(`❌ Network error sending to ${userId}:`, error instanceof Error ? error.message : error);
      return false;
    }
  }

  return false;
}

// Escape HTML special characters to prevent Telegram parsing errors
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Withdrawal notification channel — hardcoded to prevent DB misconfiguration ──
// This is the ONLY channel where withdrawal requests and approvals are posted.
// Do NOT change this without updating admin_settings.withdrawal_group_chat_id too.
const WITHDRAWAL_GROUP_CHAT_ID = '-1003881171760';

// Post a new withdrawal REQUEST to the group chat with Approve / Reject buttons
export async function sendWithdrawalRequestToGroup(withdrawalData: {
  withdrawalId: string;
  userTelegramId: string;
  userName: string;
  userTelegramUsername: string;
  walletAddress: string;
  amount: number;
  fee: number;
  feePercent: string | number;
}): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('⚠️ Telegram bot token not set — skipping group withdrawal request notification');
    return false;
  }

  try {
    const groupChatId = WITHDRAWAL_GROUP_CHAT_ID;

    const botUsername = await getBotUsername();
    const currentDate = new Date().toUTCString();

    const text = `💰 <b>Withdrawal Request</b>

🗣 User: <a href="tg://user?id=${withdrawalData.userTelegramId}">${escapeHtml(withdrawalData.userName)}</a>
🆔 User ID: <code>${withdrawalData.userTelegramId}</code>
💳 Username: ${escapeHtml(withdrawalData.userTelegramUsername)}
🌐 Address:
<code>${escapeHtml(withdrawalData.walletAddress)}</code>
💸 Amount: <b>${withdrawalData.amount.toFixed(5)} USD</b>
🛂 Fee: ${withdrawalData.fee.toFixed(5)} (${withdrawalData.feePercent}%)
📅 Date: ${currentDate}
🤖 Bot: @${botUsername}`;

    const replyMarkup = {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `withdraw_paid_${withdrawalData.withdrawalId}` },
        { text: '❌ Reject',  callback_data: `withdraw_reject_${withdrawalData.withdrawalId}` }
      ]]
    };

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: groupChatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });

    const data = await response.json() as any;
    if (response.ok && data.ok) {
      console.log(`✅ Withdrawal request posted to group ${groupChatId} for withdrawal ${withdrawalData.withdrawalId}`);
      return true;
    } else {
      console.error(`❌ Failed to post withdrawal request to group ${groupChatId}:`, JSON.stringify(data));
      return false;
    }
  } catch (error) {
    console.error('❌ Error posting withdrawal request to group:', error);
    return false;
  }
}

export async function sendWithdrawalApprovedNotification(withdrawal: any): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured for withdrawal approval notification');
    return false;
  }

  try {
    const WITHDRAWAL_CHANNEL_ID = WITHDRAWAL_GROUP_CHAT_ID;
    console.log(`📤 Sending withdrawal approval notification to group: ${WITHDRAWAL_CHANNEL_ID}`);

    const user = await storage.getUser(withdrawal.userId);
    
    const withdrawalDetails = withdrawal.details as any;
    const netAmount = parseFloat(withdrawalDetails?.netAmount || withdrawal.amount);
    const feeAmount = parseFloat(withdrawalDetails?.fee || '0');
    const feePercent = withdrawalDetails?.feePercent || '0';
    const walletAddress = withdrawalDetails?.paymentDetails || withdrawalDetails?.walletAddress || 'N/A';
    
    const userName = user?.firstName || user?.username || 'Unknown';
    const userTelegramId = user?.telegram_id || '';
    const userTelegramUsername = user?.username ? `@${user.username}` : 'N/A';
    const currentDate = new Date().toUTCString();

    const botUsername = await getBotUsername();
    const botLink = `https://t.me/${botUsername}`;

    const groupMessage = `✅ <b>Withdrawal Approved</b>

🗣 User: <a href="tg://user?id=${userTelegramId}">${escapeHtml(userName)}</a>
🆔 User ID: <code>${userTelegramId}</code>
💳 Username: ${userTelegramUsername}
🌐 Wallet: <code>${walletAddress}</code>
💸 Amount: <b>${netAmount.toFixed(5)} USD</b>
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${currentDate}`;

    // Inline keyboard: "Paid Ads" button linking to the bot
    const replyMarkup = {
      inline_keyboard: [[
        { text: '💰 Paid Ads', url: botLink }
      ]]
    };

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: WITHDRAWAL_CHANNEL_ID,
        text: groupMessage,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });

    const responseData = await response.json() as any;
    if (response.ok && responseData.ok) {
      console.log('✅ Group notification for withdrawal approval sent successfully');
      return true;
    } else {
      console.error('❌ Failed to send group notification for withdrawal approval:', JSON.stringify(responseData));
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending withdrawal approval group notification:', error);
    return false;
  }
}

export async function sendWithdrawalRejectedNotification(withdrawal: any, reason: string): Promise<boolean> {
  // Rejection does NOT post to group — only the user is notified privately
  return true;
}

// Send notification to referrer when referred user watches their first ad
// Uses USD reward from Admin Settings (referral_reward_usd)
export async function sendReferralRewardNotification(
  referrerTelegramId: string,
  referredUserName: string,
  usdRewardAmount: string
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured for referral reward notification');
    return false;
  }

  try {
    const safeName = escapeHtml(referredUserName);
    const formattedUSD = parseFloat(usdRewardAmount).toFixed(2);
    
    const message = `🎉 <b>New Referral Activity!</b>
Your friend <b>${safeName}</b> watched their first ad.
💰 You earned <b>$ ${formattedUSD}</b>
Keep inviting more friends to earn more!`;

    const result = await sendUserTelegramNotification(referrerTelegramId, message);
    if (!result) {
      console.error(`❌ Failed to send referral reward notification to ${referrerTelegramId}`);
    }
    return result;
  } catch (error) {
    console.error('❌ Error sending referral reward notification:', error);
    return false;
  }
}

// DEPRECATED: Referral commission notification removed to prevent spam
// Only the first-ad referral notification is sent (sendReferralRewardNotification)
// This function is kept for backwards compatibility but does nothing
export async function sendReferralCommissionNotification(
  referrerTelegramId: string,
  referredUserName: string,
  commissionAmount: string
): Promise<boolean> {
  // Commission notifications disabled to prevent spam on every ad watch
  // Only first-ad referral notifications are sent via sendReferralRewardNotification
  console.log(`📭 Commission notification skipped (disabled) for ${referrerTelegramId}`);
  return true;
}

export async function sendSharePhotoToChat(
  chatId: string,
  imageUrl: string,
  caption: string,
  referralUrl: string,
  buttonText: string = 'Start Earning'
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured for sendPhoto');
    return { success: false, error: 'Bot token not configured' };
  }

  try {
    console.log(`📷 Sending share photo to chat ${chatId}...`);
    console.log(`   Image URL: ${imageUrl}`);
    console.log(`   Referral URL: ${referralUrl}`);

    const payload = {
      chat_id: chatId,
      photo: imageUrl,
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: buttonText,
              url: referralUrl
            }
          ]
        ]
      }
    };

    console.log('📡 sendPhoto payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (response.ok && responseData.ok) {
      console.log('✅ Share photo sent successfully to', chatId);
      return { success: true, messageId: responseData.result?.message_id };
    } else {
      console.error('❌ Failed to send share photo:', responseData);
      return { success: false, error: responseData.description || 'Failed to send photo' };
    }
  } catch (error: any) {
    console.error('❌ Error sending share photo:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Helper: calculate UTF-16 length Telegram uses for entity offsets
function utf16Len(str: string): number {
  let len = 0;
  for (const ch of str) {
    len += (ch.codePointAt(0)! > 0xffff) ? 2 : 1;
  }
  return len;
}

// ── Ambassador promo multilingual strings ─────────────────────────────────

type AmbPromoLang = 'en' | 'ru' | 'ar' | 'uk' | 'de' | 'zh' | 'pt' | 'es' | 'vi' | 'bn';

interface AmbPromoStrings {
  title: string;
  subtitle: string;
  rewardLabel: string;
  codeLabel: string;
  cta: string;
  button: string;
}

const AMB_PROMO_STRINGS: Record<AmbPromoLang, AmbPromoStrings> = {
  en: {
    title: 'Paid Adz Promo Code is LIVE!',
    subtitle: 'First 100 Active Users Only',
    rewardLabel: 'Reward:',
    codeLabel: 'Code:',
    cta: "Open Paid Adz and claim your reward now before it's gone!",
    button: '👉🏻 Click here to claim 👈🏻',
  },
  ru: {
    title: 'Промокод Paid Adz уже АКТИВЕН!',
    subtitle: 'Только первые 100 активных пользователей',
    rewardLabel: 'Награда:',
    codeLabel: 'Код:',
    cta: 'Откройте Paid Adz и заберите награду, пока не поздно!',
    button: '👉🏻 Нажмите, чтобы получить 👈🏻',
  },
  ar: {
    title: 'رمز ترويجي Paid Adz متاح الآن!',
    subtitle: 'أول 100 مستخدم نشط فقط',
    rewardLabel: 'المكافأة:',
    codeLabel: 'الرمز:',
    cta: 'افتح Paid Adz واحصل على مكافأتك قبل أن تنتهي!',
    button: '👉🏻 اضغط هنا للمطالبة 👈🏻',
  },
  uk: {
    title: 'Промокод Paid Adz вже АКТИВНИЙ!',
    subtitle: 'Лише перші 100 активних користувачів',
    rewardLabel: 'Нагорода:',
    codeLabel: 'Код:',
    cta: 'Відкрийте Paid Adz та отримайте нагороду, поки не сплив час!',
    button: '👉🏻 Натисніть, щоб отримати 👈🏻',
  },
  de: {
    title: 'Paid Adz Promo-Code ist LIVE!',
    subtitle: 'Nur die ersten 100 aktiven Nutzer',
    rewardLabel: 'Belohnung:',
    codeLabel: 'Code:',
    cta: 'Öffne Paid Adz und sichere dir deine Belohnung, bevor sie weg ist!',
    button: '👉🏻 Hier klicken zum Einlösen 👈🏻',
  },
  zh: {
    title: 'Paid Adz 促销码现已上线！',
    subtitle: '仅限前 100 位活跃用户',
    rewardLabel: '奖励：',
    codeLabel: '码：',
    cta: '立即打开 Paid Adz 领取奖励，先到先得！',
    button: '👉🏻 点击领取 👈🏻',
  },
  pt: {
    title: 'Código Promo Paid Adz está LIVE!',
    subtitle: 'Apenas os primeiros 100 usuários ativos',
    rewardLabel: 'Recompensa:',
    codeLabel: 'Código:',
    cta: 'Abra o Paid Adz e resgate sua recompensa antes que acabe!',
    button: '👉🏻 Clique aqui para resgatar 👈🏻',
  },
  es: {
    title: '¡El código promo de Paid Adz está EN VIVO!',
    subtitle: 'Solo los primeros 100 usuarios activos',
    rewardLabel: 'Recompensa:',
    codeLabel: 'Código:',
    cta: '¡Abre Paid Adz y reclama tu recompensa antes de que se acabe!',
    button: '👉🏻 Haz clic aquí para reclamar 👈🏻',
  },
  vi: {
    title: 'Mã khuyến mãi Paid Adz đã ra mắt!',
    subtitle: 'Chỉ 100 người dùng hoạt động đầu tiên',
    rewardLabel: 'Phần thưởng:',
    codeLabel: 'Mã:',
    cta: 'Mở Paid Adz và nhận phần thưởng của bạn ngay trước khi hết!',
    button: '👉🏻 Nhấp vào đây để nhận 👈🏻',
  },
  bn: {
    title: 'Paid Adz প্রোমো কোড লাইভ!',
    subtitle: 'শুধুমাত্র প্রথম ১০০ জন সক্রিয় ব্যবহারকারী',
    rewardLabel: 'পুরস্কার:',
    codeLabel: 'কোড:',
    cta: 'Paid Adz খুলুন এবং এখনই আপনার পুরস্কার দাবি করুন!',
    button: '👉🏻 এখানে ক্লিক করুন 👈🏻',
  },
};

/**
 * Return the absolute path to the promo banner image for a given language.
 * ru → Russian banner, uk → Ukrainian banner, ar → Arabic banner,
 * everything else → English banner.
 *
 * Uses process.cwd() (ESM-safe — __dirname is unavailable with "type":"module").
 * Normalises lang to lowercase base code (e.g. "ru-RU" → "ru") before lookup.
 */
function getPromoImagePath(lang: string): string {
  const normLang = lang.toLowerCase().split(/[-_]/)[0];
  const dir = join(process.cwd(), 'server', 'assets', 'promo');
  // Languages with dedicated promo images. All others fall back to English.
  // To add a new language image: drop promo_<lang>.png in server/assets/promo/
  // and add the mapping below.
  const map: Record<string, string> = {
    ru: join(dir, 'promo_ru.png'),
    uk: join(dir, 'promo_uk.png'),
    ar: join(dir, 'promo_ar.png'),
    // de / zh / pt / es / vi / bn → English image (no dedicated banner yet)
    de: join(dir, 'promo_en.png'),
    zh: join(dir, 'promo_en.png'),
    pt: join(dir, 'promo_en.png'),
    es: join(dir, 'promo_en.png'),
    vi: join(dir, 'promo_en.png'),
    bn: join(dir, 'promo_en.png'),
  };
  return map[normLang] ?? join(dir, 'promo_en.png');
}

/**
 * Build a promo message using Telegram entities (Premium Custom Emojis) in
 * the ambassador's chosen language. Returns text + entities + inlineKeyboard
 * — use without parse_mode so entities are applied correctly.
 */
// Escape a string for use inside Telegram HTML parse_mode captions.
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a promo caption using Telegram HTML parse_mode.
 * Returns an HTML string + inlineKeyboard — set parse_mode='HTML' when posting.
 *
 * HTML parse_mode is used here instead of raw entities because Telegram rejects
 * caption_entities containing custom_emoji for bot-posted channel messages
 * (ENTITY_TEXT_INVALID / "entity begins in a middle of a UTF-16 symbol"), and
 * manual UTF-16 offset arithmetic is fragile across multilingual strings.
 * HTML mode is fully reliable for bold and code formatting.
 */
function buildAmbassadorPromoPayload(
  lang: string,
  code1: string,
  code2: string,
  rewardAmount: string,
  referralLink: string,
  maxClaims: number = 100,
): { html: string; inlineKeyboard: any } {
  const s = AMB_PROMO_STRINGS[(lang as AmbPromoLang)] ?? AMB_PROMO_STRINGS.en;
  const rewardInt = parseInt(rewardAmount || '10000');
  const rewardPow = rewardInt.toLocaleString('en-US');
  const usdValue = (rewardInt / 10000000).toFixed(7).replace(/\.?0+$/, '');

  const lines: string[] = [
    `👤 <b>First ${maxClaims} Active Users Only!</b>`,
    `🎁 <b>Reward: ${escHtml(rewardPow)} POW | $${usdValue}</b>`,
    '',
    `🎟 <b>Claim Code 1:</b> <code>${escHtml(code1)}</code>`,
    `🎟 <b>Claim Code 2:</b> <code>${escHtml(code2)}</code>`,
    '',
    `🔥 <b>Redeem your code and claim your FREE ${escHtml(rewardPow)} POW before all rewards are claimed!</b>`,
  ];

  const html = lines.join('\n');

  const inlineKeyboard = {
    inline_keyboard: [[
      { text: s.button, url: referralLink },
    ]],
  };

  return { html, inlineKeyboard };
}

// Helper: build plain text + entities array for custom emoji
function buildCustomEmojiMessage(parts: Array<{ text: string; emojiId?: string }>): { text: string; entities: any[] } {
  let text = '';
  const entities: any[] = [];
  for (const part of parts) {
    if (part.emojiId) {
      const offset = utf16Len(text);
      const length = utf16Len(part.text);
      entities.push({ type: 'custom_emoji', offset, length, custom_emoji_id: part.emojiId });
    }
    text += part.text;
  }
  return { text, entities };
}

export async function formatWelcomeMessage(userId: string, referralCode?: string): Promise<{ message: string; entities: any[]; inlineKeyboard: any }> {
  const botUsername = await getBotUsername();

  const entities: any[] = [];
  let text = '';

  const addSegment = (seg: string, options?: { emojiId?: string; bold?: boolean }) => {
    const offset = utf16Len(text);
    const length = utf16Len(seg);
    if (options?.emojiId) {
      entities.push({ type: 'custom_emoji', offset, length, custom_emoji_id: options.emojiId });
    }
    if (options?.bold) {
      entities.push({ type: 'bold', offset, length });
    }
    text += seg;
  };

  addSegment('👋🏻', { emojiId: '5319007286004299794' });
  addSegment(' ');
  addSegment('Welcome to Paid Adz', { bold: true });
  addSegment('\n\n');
  addSegment('💎', { emojiId: '5359719332542718652' });
  addSegment(' Earn ');
  addSegment('POW Tokens', { bold: true });
  addSegment(' by watching ');
  addSegment('ads', { bold: true });
  addSegment(' and completing ');
  addSegment('tasks', { bold: true });
  addSegment(' — your gateway to ');
  addSegment('real rewards', { bold: true });
  addSegment('.\n\n');
  addSegment('💲', { emojiId: '5316711376876485361' });
  addSegment(' Convert your ');
  addSegment('earnings', { bold: true });
  addSegment(' into ');
  addSegment('USDT', { bold: true });
  addSegment(' and enjoy a simple, rewarding experience.\n\n');
  addSegment('⚡', { emojiId: '5323404142809467476' });
  addSegment(' The ');
  addSegment('more active', { bold: true });
  addSegment(' you are, the more you can ');
  addSegment('earn', { bold: true });
  addSegment('.\n\n');
  addSegment('👛', { emojiId: '5316979275461573049' });
  addSegment(' Start ');
  addSegment('earning', { bold: true });
  addSegment(', grow your ');
  addSegment('balance', { bold: true });
  addSegment(' and unlock more ');
  addSegment('opportunities', { bold: true });
  addSegment(' today!');

  // Include the referral code in the Open App button so start_param is set in initDataUnsafe
  const appUrl = referralCode
    ? `https://t.me/${botUsername}/MyWAdz?startapp=${referralCode}`
    : `https://t.me/${botUsername}/MyWAdz`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: "Let's GOOO!!",
          url: appUrl
        }
      ]
    ]
  };

  return { message: text, entities, inlineKeyboard };
}

export async function sendWelcomeMessage(userId: string, referralCode?: string): Promise<boolean> {
  // Check if user is banned before sending welcome message
  try {
    const user = await storage.getUserByTelegramId(userId);
    if (user?.banned) {
      console.log(`🚫 Skipping welcome message for banned user ${userId}`);
      return false;
    }
  } catch (err) {
    console.error('Error checking ban status for welcome message:', err);
  }

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured');
    return false;
  }

  const { message, entities, inlineKeyboard } = await formatWelcomeMessage(userId, referralCode);

  try {
    const payload = {
      chat_id: userId,
      text: message,
      entities: entities,
      reply_markup: inlineKeyboard,
    };

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json() as any;
    if (response.ok && result.ok) {
      console.log(`✅ Welcome message sent to ${userId} with premium custom emojis`);
      return true;
    }

    console.error('❌ Failed to send welcome message:', result.description);
    return false;
  } catch (error) {
    console.error('❌ Error sending welcome message:', error);
    return false;
  }
}

// Admin broadcast functionality
export async function sendBroadcastMessage(message: string, adminTelegramId: string): Promise<{ success: number; failed: number }> {
  if (!await isAdminAsync(adminTelegramId)) {
    console.error('❌ Unauthorized attempt to send broadcast message');
    return { success: 0, failed: 0 };
  }

  try {
    // Get all users from database
    const allUsers = await storage.getAllUsers();
    console.log(`📢 Broadcasting message to ${allUsers.length} users...`);
    
    let successCount = 0;
    let failedCount = 0;
    
    // Send message to each user (in batches to avoid rate limiting)
    for (const user of allUsers) {
      if (user.telegram_id) {
        try {
          const sent = await sendUserTelegramNotification(user.telegram_id, message);
          if (sent) {
            successCount++;
          } else {
            failedCount++;
          }
          // Small delay to avoid hitting Telegram rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`❌ Failed to send broadcast to user ${user.telegram_id}:`, error);
          failedCount++;
        }
      } else {
        failedCount++;
      }
    }
    
    console.log(`✅ Broadcast completed: ${successCount} successful, ${failedCount} failed`);
    
    // Send summary to admin
    const summaryMessage = `📢 Broadcast Summary:\n\n✅ Successfully sent: ${successCount}\n❌ Failed: ${failedCount}\n📊 Total users: ${allUsers.length}`;
    await sendUserTelegramNotification(adminTelegramId, summaryMessage);
    
    return { success: successCount, failed: failedCount };
  } catch (error) {
    console.error('❌ Error sending broadcast message:', error);
    return { success: 0, failed: 0 };
  }
}

// Handle inline query for rich media sharing with image + WebApp button
export async function handleInlineQuery(inlineQuery: any): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured for inline query');
    return false;
  }

  try {
    const queryId = inlineQuery.id;
    const fromUserId = inlineQuery.from.id.toString();
    const query = inlineQuery.query || '';

    console.log(`📝 Inline query received from ${fromUserId}: "${query}"`);

    // Get user's referral code from the database
    const user = await storage.getUserByTelegramId(fromUserId);
    
    if (!user || !user.referralCode) {
      console.log(`⚠️ User ${fromUserId} not found or has no referral code`);
      // Return empty results
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerInlineQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inline_query_id: queryId,
          results: [],
          cache_time: 0
        })
      });
      return true;
    }

    // Build the referral link - use /start flow for reliable referral tracking
    const botUsername = await getBotUsername();
    const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
    
    // Get the app URL for the share banner image
    const appUrl = process.env.RENDER_EXTERNAL_URL || 
                  (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                  'https://vuuug.onrender.com';

    // Safety check for appUrl
    if (!appUrl) {
      console.error('❌ No app URL configured for share banner');
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerInlineQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inline_query_id: queryId,
          results: [],
          cache_time: 0
        })
      });
      return true;
    }

    // Get the share banner image URL - use public URL
    const shareImageUrl = `${appUrl}/images/share_v5.jpg`;
    
    console.log(`📷 Share image URL: ${shareImageUrl}`);
    console.log(`🔗 Referral Link: ${referralLink}`);

    // Create inline query result with photo + URL button (triggers /start for referral tracking)
    const results = [
      {
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
      },
      // Also add an article result as fallback with URL button (for cases where web_app isn't supported)
      {
        type: 'article',
        id: `article_${user.referralCode}_${Date.now()}`,
        title: '💸 Share with friends',
        description: 'Share and earn bonus PAD for every friend who joins!',
        thumbnail_url: shareImageUrl,
        input_message_content: {
          message_text: '💵 <b>Get paid for completing tasks and watching ads.</b>\n\n🎯 Join Money Adz and get rewarded for simple tasks!\n\n👇 Click the button below to start earning:',
          parse_mode: 'HTML'
        },
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
      }
    ];

    // Answer the inline query
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerInlineQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_query_id: queryId,
        results: results,
        cache_time: 10, // Cache for 10 seconds
        is_personal: true // Results are specific to this user
      })
    });

    if (response.ok) {
      console.log(`✅ Inline query answered successfully for user ${fromUserId}`);
      return true;
    } else {
      const errorData = await response.text();
      console.error('❌ Failed to answer inline query:', errorData);
      return false;
    }
  } catch (error) {
    console.error('❌ Error handling inline query:', error);
    return false;
  }
}

// ── Returning user dashboard message ──────────────────────────────────────────
async function sendReturningUserMessage(chatId: string, referralCode?: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    // Always fetch a fresh record directly from the DB to avoid stale cached values
    const { db: dbConn } = await import('./db');
    const { users: usersTable } = await import('../shared/schema');
    const { eq: eqOp } = await import('drizzle-orm');
    const [freshUser] = await dbConn
      .select({ usdBalance: usersTable.usdBalance })
      .from(usersTable)
      .where(eqOp(usersTable.telegram_id, chatId))
      .limit(1);
    const rawUsd = freshUser?.usdBalance;
    const usdBal = (rawUsd !== null && rawUsd !== undefined && rawUsd !== '')
      ? parseFloat(String(rawUsd)).toFixed(2)
      : '0.00';
    const user = await storage.getUserByTelegramId(chatId);

    const botUsername = await getBotUsername();
    const baseAppUrl = `https://t.me/${botUsername}/MyWAdz`;
    const openAppUrl = referralCode ? `${baseAppUrl}?startapp=${referralCode}` : baseAppUrl;
    const withdrawUrl = `${baseAppUrl}?startapp=page_withdraw`;
    const referralUrl = `${baseAppUrl}?startapp=page_referral`;

    const message = `👋 <b>Welcome to Paid Adz</b>\n\nEarn POW Tokens by watching ads or completing tasks.\n\n💲 Your Balance: <b>$${usdBal}</b>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '🚀 Open App', url: openAppUrl }],
        [
          { text: '💸 Withdraw', url: withdrawUrl },
          { text: '👥 Referral', url: referralUrl },
        ],
        [
          { text: '🏆 Contest', callback_data: 'show_ref_contest' },
          { text: '📊 Leaderboard', callback_data: 'show_monthly_leader' },
        ],
      ],
    };

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', reply_markup: inlineKeyboard }),
    });
  } catch (err) {
    console.error('❌ Error sending returning user message:', err);
  }
}

// ── Edit an existing message back to the main dashboard (used by Back button) ──
async function editMessageToDashboard(chatId: string, messageId: number): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const { db: dbConn } = await import('./db');
    const { users: usersTable } = await import('../shared/schema');
    const { eq: eqOp } = await import('drizzle-orm');
    const [freshUser] = await dbConn
      .select({ usdBalance: usersTable.usdBalance })
      .from(usersTable)
      .where(eqOp(usersTable.telegram_id, chatId))
      .limit(1);
    const rawUsd = freshUser?.usdBalance;
    const usdBal = (rawUsd !== null && rawUsd !== undefined && rawUsd !== '')
      ? parseFloat(String(rawUsd)).toFixed(2)
      : '0.00';

    const botUsername = await getBotUsername();
    const baseAppUrl = `https://t.me/${botUsername}/MyWAdz`;
    const openAppUrl = baseAppUrl;
    const withdrawUrl = `${baseAppUrl}?startapp=page_withdraw`;
    const referralUrl = `${baseAppUrl}?startapp=page_referral`;

    const text = `👋 <b>Welcome to Paid Adz</b>\n\nEarn POW Tokens by watching ads or completing tasks.\n\n💲 Your Balance: <b>$${usdBal}</b>`;
    const reply_markup = {
      inline_keyboard: [
        [{ text: '🚀 Open App', url: openAppUrl }],
        [
          { text: '💸 Withdraw', url: withdrawUrl },
          { text: '👥 Referral', url: referralUrl },
        ],
        [
          { text: '🏆 Contest', callback_data: 'show_ref_contest' },
          { text: '📊 Leaderboard', callback_data: 'show_monthly_leader' },
        ],
      ],
    };

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup }),
    });
  } catch (err) {
    console.error('❌ Error editing message to dashboard:', err);
  }
}

// ── Helper: get ISO week label ─────────────────────────────────────────────────
function getCurrentISOWeekLabel(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const week = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getMonthLabel(): string {
  const now = new Date();
  return now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const MEDALS = ['🥇', '🥈', '🥉'];
function positionEmoji(rank: number): string {
  if (rank <= 3) return MEDALS[rank - 1];
  return `${rank}.`;
}

/** Mirrors parsePrizesSetting in routes.ts — handles both JSON array and newline-separated text */
function parsePrizes(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
    return [String(parsed)];
  } catch {
    return raw.split('\n').map((p: string) => p.trim()).filter(Boolean);
  }
}

// ── Weekly Referral Contest message ───────────────────────────────────────────
export async function sendWeeklyReferralContest(chatId: string, messageId?: number): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const { db: dbConn } = await import('./db');
    const { adminSettings: adminSettingsTable } = await import('../shared/schema');
    const { sql: sqlFn } = await import('drizzle-orm');

    const allSettings = await dbConn.select().from(adminSettingsTable);
    const getSetting = (key: string, def: string) =>
      allSettings.find((s: any) => s.settingKey === key)?.settingValue || def;

    const contestEnabled = getSetting('weekly_referral_contest_enabled', 'false') === 'true';
    const topN = Math.max(1, Math.min(1000, parseInt(getSetting('weekly_referral_top_users', '10')) || 10));
    const startDate = getSetting('weekly_referral_start_date', '');
    const endDate = getSetting('weekly_referral_end_date', '');
    const prizesRaw = getSetting('weekly_referral_prizes', '');

    const weekLabel = getCurrentISOWeekLabel();
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC';

    if (!contestEnabled) {
      const msg = `🏆 <b>Referral Contest (Weekly)</b>\n\n⛔ Contest is not active at this time.`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
      });
      return;
    }

    // Debug: log contest parameters before querying
    console.log(`\n🔍 [Contest Debug] sendWeeklyReferralContest called`);
    console.log(`   Contest Enabled : ${contestEnabled}`);
    console.log(`   Start Date      : ${startDate || '(none — no start filter)'}`);
    console.log(`   End Date        : ${endDate || '(none — no end filter)'}`);
    console.log(`   Top N           : ${topN}`);
    console.log(`   Week Label      : ${weekLabel}`);

    // Get top referrers within contest period.
    // Only count VERIFIED (completed) referrals — a referral is verified when the
    // referee watches the required number of ads and the status becomes 'completed'.
    const topQuery = await dbConn.execute(sqlFn`
      SELECT u.id, u.username, u.first_name, COUNT(r.id) AS referral_count
      FROM users u
      INNER JOIN referrals r ON r.referrer_id = u.id
      WHERE r.status = 'completed'
        AND u.banned = false
        ${startDate ? sqlFn`AND r.created_at >= ${new Date(startDate)}` : sqlFn``}
        ${endDate ? sqlFn`AND r.created_at <= ${new Date(endDate)}` : sqlFn``}
      GROUP BY u.id, u.username, u.first_name
      HAVING COUNT(r.id) > 0
      ORDER BY referral_count DESC, u.id ASC
      LIMIT ${topN}
    `);

    console.log(`   Query returned  : ${(topQuery.rows as any[]).length} participant(s)`);

    const rows = (topQuery.rows as any[]);

    // Get calling user's rank (chatId is telegram_id)
    const callingUser = await storage.getUserByTelegramId(chatId);
    let callerRank: number | null = null;
    if (callingUser) {
      const callerIdx = rows.findIndex((r: any) => r.id === callingUser.id);
      if (callerIdx !== -1) callerRank = callerIdx + 1;
    }

    // Build message
    let lines = [`🏆 <b>Referral Contest (Weekly)</b>\n`];
    lines.push(`${escapeHtml(weekLabel)}\n`);
    lines.push(`<code>Position │ Friends │ Prize</code>\n`);

    const prizes = parsePrizes(prizesRaw);

    for (let i = 0; i < topN; i++) {
      const row = rows[i];
      const pos = positionEmoji(i + 1);
      const name = row ? escapeHtml(row.first_name || row.username || `User ${i + 1}`) : '—';
      const friends = row ? parseInt(row.referral_count) : 0;
      const prize = prizes[i] ? ` │ ${escapeHtml(prizes[i])}` : '';
      lines.push(`${pos} ${name}${row ? ` │ ${friends}${prize}` : ''}`);
    }

    lines.push(`\n🕐 ${nowStr}`);

    if (callerRank === null) {
      lines.push(`\n📌 You're not ranked this week yet.`);
    }

    const text = lines.join('\n');
    const replyMarkup = {
      inline_keyboard: [[
        { text: '🔄 Refresh', callback_data: 'ref_contest_refresh' },
        { text: '↩️ Back', callback_data: 'ref_contest_back' },
      ]],
    };

    if (messageId) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
      });
    } else {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
      });
    }
  } catch (err) {
    console.error('❌ Error sending weekly referral contest:', err);
  }
}

// ── Monthly Leaderboard message ────────────────────────────────────────────────
export async function sendMonthlyLeaderboard(chatId: string, messageId?: number): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const { db: dbConn } = await import('./db');
    const { adminSettings: adminSettingsTable } = await import('../shared/schema');
    const { sql: sqlFn } = await import('drizzle-orm');

    const allSettings = await dbConn.select().from(adminSettingsTable);
    const getSetting = (key: string, def: string) =>
      allSettings.find((s: any) => s.settingKey === key)?.settingValue || def;

    const contestEnabled = getSetting('monthly_contest_enabled', 'false') === 'true';
    const topN = Math.max(1, Math.min(1000, parseInt(getSetting('monthly_contest_top_users', '10')) || 10));
    const prizesRaw = getSetting('monthly_contest_prizes', '');

    const monthLabel = getMonthLabel();
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC';

    if (!contestEnabled) {
      const msg = `🏆 <b>Monthly Leaderboard</b>\n\n⛔ Contest is not active at this time.`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
      });
      return;
    }

    const topQuery = await dbConn.execute(sqlFn`
      SELECT id, username, first_name, weekly_stars
      FROM users
      WHERE weekly_stars > 0 AND banned = false
      ORDER BY weekly_stars DESC, id ASC
      LIMIT ${topN}
    `);

    const rows = (topQuery.rows as any[]);

    const callingUser = await storage.getUserByTelegramId(chatId);
    let callerRank: number | null = null;
    if (callingUser) {
      const callerIdx = rows.findIndex((r: any) => r.id === callingUser.id);
      if (callerIdx !== -1) callerRank = callerIdx + 1;
    }

    const prizes = parsePrizes(prizesRaw);

    let lines = [`🏆 <b>Monthly Leaderboard</b>\n`];
    lines.push(`${escapeHtml(monthLabel)}\n`);
    lines.push(`<code>Position │ Stars │ Prize</code>\n`);

    for (let i = 0; i < topN; i++) {
      const row = rows[i];
      const pos = positionEmoji(i + 1);
      const name = row ? escapeHtml(row.first_name || row.username || `User ${i + 1}`) : '—';
      const stars = row ? parseInt(row.weekly_stars) : 0;
      const prize = prizes[i] ? ` │ ${escapeHtml(prizes[i])}` : '';
      lines.push(`${pos} ${name}${row ? ` │ ⭐${stars}${prize}` : ''}`);
    }

    lines.push(`\n🕐 ${nowStr}`);

    if (callerRank === null) {
      lines.push(`\n📌 You're not ranked this month yet.`);
    }

    const text = lines.join('\n');
    const replyMarkup = {
      inline_keyboard: [[
        { text: '🔄 Refresh', callback_data: 'monthly_leader_refresh' },
        { text: '↩️ Back', callback_data: 'monthly_leader_back' },
      ]],
    };

    if (messageId) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
      });
    } else {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup }),
      });
    }
  } catch (err) {
    console.error('❌ Error sending monthly leaderboard:', err);
  }
}

// ── Auto-snapshot: send contest final results to all admins when period ends ───
let lastSnapshotCheckTs = 0;
export async function checkAndSendContestSnapshots(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  const now = Date.now();
  // Throttle: run at most once per 5 minutes
  if (now - lastSnapshotCheckTs < 5 * 60_000) return;
  lastSnapshotCheckTs = now;

  try {
    const { db: dbConn } = await import('./db');
    const { adminSettings: adminSettingsTable } = await import('../shared/schema');
    const { sql: sqlFn } = await import('drizzle-orm');

    const allSettings = await dbConn.select().from(adminSettingsTable);
    const getSetting = (key: string, def: string) =>
      allSettings.find((s: any) => s.settingKey === key)?.settingValue || def;
    const setSetting = async (key: string, value: string) => {
      try {
        await dbConn.execute(sqlFn`
          INSERT INTO admin_settings (setting_key, setting_value, updated_at)
          VALUES (${key}, ${value}, NOW())
          ON CONFLICT (setting_key) DO UPDATE SET setting_value = ${value}, updated_at = NOW()
        `);
      } catch { /* ignore */ }
    };

    const adminIds = [...getAdminIds()];

    const nowDate = new Date();

    // ── Weekly Referral Contest snapshot ─────────────────────────────────────
    const weeklyEnabled = getSetting('weekly_referral_contest_enabled', 'false') === 'true';
    const weeklyEndDate = getSetting('weekly_referral_end_date', '');
    const weekLabel = getCurrentISOWeekLabel();
    const weeklySnapshotKey = `weekly_contest_snapshot_sent_${weekLabel}`;
    const weeklySnapshotSent = getSetting(weeklySnapshotKey, 'false') === 'true';

    if (weeklyEnabled && weeklyEndDate && !weeklySnapshotSent) {
      const endDate = new Date(weeklyEndDate);
      if (nowDate > endDate) {
        const topN = parseInt(getSetting('weekly_referral_top_users', '10'));
        const startDate = getSetting('weekly_referral_start_date', '');
        const prizesRaw = getSetting('weekly_referral_prizes', '');
        const prizes = parsePrizes(prizesRaw);

        const topQuery = await dbConn.execute(sqlFn`
          SELECT u.id, u.username, u.first_name, COUNT(r.id) AS referral_count
          FROM users u
          INNER JOIN referrals r ON r.referrer_id = u.id
          WHERE r.status = 'completed'
            AND u.banned = false
            ${startDate ? sqlFn`AND r.created_at >= ${new Date(startDate)}` : sqlFn``}
            AND r.created_at <= ${endDate}
          GROUP BY u.id, u.username, u.first_name
          HAVING COUNT(r.id) > 0
          ORDER BY referral_count DESC, u.id ASC
          LIMIT ${topN}
        `);
        const rows = topQuery.rows as any[];

        let lines = [
          `🏆 <b>Referral Contest — Final Results</b>`,
          ``,
          `📅 Period: ${startDate ? new Date(startDate).toDateString() : '—'} → ${endDate.toDateString()}`,
          `🏷 Contest: ${escapeHtml(weekLabel)}`,
          ``,
          `<code>Pos │ Name │ Active Referrals │ Prize</code>`,
        ];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const pos = positionEmoji(i + 1);
          const name = escapeHtml(row.username ? `@${row.username}` : (row.first_name || `User ${i + 1}`));
          const count = parseInt(row.referral_count);
          const prize = prizes[i] ? ` │ ${escapeHtml(prizes[i])}` : '';
          lines.push(`${pos} ${name} │ ${count}${prize}`);
        }
        if (rows.length === 0) lines.push('No participants this week.');
        lines.push(``, `🕐 Snapshot taken: ${nowDate.toUTCString()}`);

        const snapshotText = lines.join('\n');
        for (const adminId of adminIds) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminId, text: snapshotText, parse_mode: 'HTML' }),
          }).catch(() => {});
        }
        await setSetting(weeklySnapshotKey, 'true');
        console.log(`✅ Weekly contest snapshot sent for ${weekLabel}`);
      }
    }

    // ── Monthly Leaderboard snapshot ──────────────────────────────────────────
    const monthlyEnabled = getSetting('monthly_contest_enabled', 'false') === 'true';
    const monthlyEndDate = getSetting('monthly_contest_end_date', '');
    const monthLabel = getMonthLabel();
    const monthlySnapshotKey = `monthly_contest_snapshot_sent_${monthLabel.replace(/\s+/g, '_')}`;
    const monthlySnapshotSent = getSetting(monthlySnapshotKey, 'false') === 'true';

    if (monthlyEnabled && monthlyEndDate && !monthlySnapshotSent) {
      const endDate = new Date(monthlyEndDate);
      if (nowDate > endDate) {
        const topN = parseInt(getSetting('monthly_contest_top_users', '10'));
        const prizesRaw = getSetting('monthly_contest_prizes', '');
        const prizes = parsePrizes(prizesRaw);

        const topQuery = await dbConn.execute(sqlFn`
          SELECT id, username, first_name, weekly_stars
          FROM users
          WHERE weekly_stars > 0 AND banned = false
          ORDER BY weekly_stars DESC, id ASC
          LIMIT ${topN}
        `);
        const rows = topQuery.rows as any[];

        let lines = [
          `🏆 <b>Monthly Leaderboard — Final Results</b>`,
          ``,
          `📅 Period ends: ${endDate.toDateString()}`,
          `🏷 Month: ${escapeHtml(monthLabel)}`,
          ``,
          `<code>Pos │ Name │ Stars │ Prize</code>`,
        ];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const pos = positionEmoji(i + 1);
          const name = escapeHtml(row.username ? `@${row.username}` : (row.first_name || `User ${i + 1}`));
          const stars = parseInt(row.weekly_stars);
          const prize = prizes[i] ? ` │ ${escapeHtml(prizes[i])}` : '';
          lines.push(`${pos} ${name} │ ⭐${stars}${prize}`);
        }
        if (rows.length === 0) lines.push('No participants this month.');
        lines.push(``, `🕐 Snapshot taken: ${nowDate.toUTCString()}`);

        const snapshotText = lines.join('\n');
        for (const adminId of adminIds) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: adminId, text: snapshotText, parse_mode: 'HTML' }),
          }).catch(() => {});
        }
        await setSetting(monthlySnapshotKey, 'true');
        console.log(`✅ Monthly leaderboard snapshot sent for ${monthLabel}`);
      }
    }
  } catch (err) {
    console.error('❌ Error in checkAndSendContestSnapshots:', err);
  }
}

// Handle incoming Telegram messages - simplified to only show welcome messages
export async function handleTelegramMessage(update: any): Promise<boolean> {
  try {
    console.log('🔄 Processing Telegram update...');
    
    // Handle message for ban check
    const message = update.message || update.edited_message;
    if (message) {
      const chatId = message.chat.id.toString();
      const telegramId = message.from?.id?.toString();
      const text = message.text || '';

      if (telegramId) {
        const user = await storage.getUserByTelegramId(telegramId);
        if (user?.banned) {
          return true;
        }

        // Handle /start command — handled in main message section below (after upsertTelegramUser)
        // Do NOT short-circuit here so we can check first-time vs returning user status

        // Handle /promo command (admin only)
        // Usage: /promo AMOUNT  →  auto-generate code
        //        /promo CODE AMOUNT  →  custom code
        //        /promo CODE AMOUNT TYPE  →  custom code + type (PAD/TON/USD/BUG)
        if (text.startsWith('/promo')) {
          const adminCheck = await isAdminAsync(telegramId);
          if (!adminCheck) {
            await sendUserTelegramNotification(chatId, '⛔ Admin only command.');
            return true;
          }
          const parts = text.trim().split(/\s+/).slice(1); // remove "/promo"
          let code: string | null = null;
          let amount: string | null = null;
          let type = 'PAD';

          if (parts.length === 1) {
            // /promo AMOUNT
            amount = parts[0];
          } else if (parts.length === 2) {
            // /promo CODE AMOUNT  OR  /promo AMOUNT TYPE
            if (isNaN(Number(parts[0]))) {
              code = parts[0].toUpperCase();
              amount = parts[1];
            } else {
              amount = parts[0];
              type = parts[1].toUpperCase();
            }
          } else if (parts.length >= 3) {
            // /promo CODE AMOUNT TYPE
            code = parts[0].toUpperCase();
            amount = parts[1];
            type = parts[2].toUpperCase();
          }

          if (!amount || isNaN(Number(amount))) {
            await sendUserTelegramNotification(chatId,
              '❌ Wrong format.\n\nUsage:\n<code>/promo 5000</code> — auto code, 5000 PAD\n<code>/promo SAVE10 5000</code> — custom code\n<code>/promo SAVE10 5000 PAD</code> — with type (PAD/TON/USD/BUG)',
            );
            return true;
          }

          const validTypes = ['PAD', 'TON', 'USD', 'BUG'];
          if (!validTypes.includes(type)) type = 'PAD';

          const finalCode = code || ('PROMO' + Math.random().toString(36).substring(2, 9).toUpperCase());

          try {
            const promo = await storage.createPromoCode({
              code: finalCode,
              rewardAmount: amount,
              rewardType: type,
              rewardCurrency: type,
              usageLimit: null,
              perUserLimit: 1,
              isActive: true,
              expiresAt: null,
            });

            await sendUserTelegramNotification(chatId,
              `✅ <b>Promo Code Created!</b>\n\n🎟 Code: <code>${finalCode}</code>\n💰 Reward: <b>${amount} ${type}</b>\n👤 Per user: 1 time\n♾ Usage limit: Unlimited\n\nShare this code with users!`,
            );
          } catch (err: any) {
            await sendUserTelegramNotification(chatId, `❌ Failed to create promo code: ${err.message}`);
          }
          return true;
        }
      }
    }

    // Handle inline queries for rich media sharing
    if (update.inline_query) {
      return await handleInlineQuery(update.inline_query);
    }
    
    // Handle callback queries (button presses)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.from.id.toString();
      const data = callbackQuery.data;
      
      if (data === 'invite_friend') {
        try {
          const user = await storage.getUserByTelegramId(chatId);
          
          if (user && user.referralCode) {
            const botUsername = await getBotUsername();
            const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
            
            const inviteMessage = `👫🏼 <b>Invite Your Friends!</b>

Share your unique referral link and earn PAD when your friends join:

🔗 <code>${referralLink}</code>

📋 Just tap the link above to copy it, then share it with your friends!

💰 You'll earn bonus PAD for every friend who joins using your link.`;

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callback_query_id: callbackQuery.id })
            });
            
            await sendUserTelegramNotification(chatId, inviteMessage);
          } else {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                callback_query_id: callbackQuery.id,
                text: 'Please start the bot first with /start',
                show_alert: true
              })
            });
          }
        } catch (error) {
          console.error('❌ Error handling invite_friend callback:', error);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Error getting referral link. Please try again.',
              show_alert: true
            })
          });
        }
        return true;
      }
      
      if (data === 'refresh_stats' && await isAdminAsync(chatId)) {
        try {
          const stats = await storage.getAppStats();
          
          const statsMessage = `📊 Application Stats\n\n👥 Total Registered Users: ${stats.totalUsers.toLocaleString()}\n👤 Active Users Today: ${stats.activeUsersToday}\n🔗 Total Friends Invited: ${stats.totalInvites.toLocaleString()}\n\n💰 Total Earnings (All Users): $${parseFloat(stats.totalEarnings).toFixed(2)}\n💎 Total Referral Earnings: $${parseFloat(stats.totalReferralEarnings).toFixed(2)}\n🏦 Total Payouts: $${parseFloat(stats.totalPayouts).toFixed(2)}\n\n🚀 Growth (Last 24h): +${stats.newUsersLast24h} new users`;
          
          const refreshButton = {
            inline_keyboard: [[
              { text: "🔃 Refresh 🔄", callback_data: "refresh_stats" }
            ]]
          };
          
          // Answer callback query and edit message
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id })
          });
          
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              text: statsMessage,
              parse_mode: 'HTML',
              reply_markup: refreshButton
            })
          });
        } catch (error) {
          console.error('❌ Error refreshing stats:', error);
        }
      }
      
      // Handle admin panel refresh button
      if (data === 'admin_refresh' && await isAdminAsync(chatId)) {
        try {
          const { db } = await import('./db');
          const { sql } = await import('drizzle-orm');
          const { users, earnings, withdrawals, advertiserTasks } = await import('../shared/schema');
          
          const totalUsersCount = await db.select({ count: sql<number>`count(*)` }).from(users);
          const dailyActiveCount = await db.select({ count: sql<number>`count(distinct ${earnings.userId})` }).from(earnings).where(sql`DATE(${earnings.createdAt}) = CURRENT_DATE`);
          const totalAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatched}), 0)` }).from(users);
          const todayAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatchedToday}), 0)` }).from(users);
          const yesterdayAdsQuery = await db.execute(sql`SELECT COALESCE(SUM(ads_watched_today), 0) as total FROM users WHERE last_ad_date::date = CURRENT_DATE - INTERVAL '1 day'`);
          const totalPADSum = await db.select({ total: sql<string>`COALESCE(SUM(${users.totalEarned}), '0')` }).from(users);
          const todayPADQuery = await db.execute(sql`SELECT COALESCE(SUM(total_earned), '0') as total FROM users WHERE DATE(updated_at) = CURRENT_DATE`);
          const yesterdayPADQuery = await db.execute(sql`SELECT COALESCE(SUM(total_earned), '0') as total FROM users WHERE DATE(updated_at) = CURRENT_DATE - INTERVAL '1 day'`);
          const totalPayoutsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
          const todayPayoutsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved') AND DATE(${withdrawals.updatedAt}) = CURRENT_DATE`);
          const yesterdayPayoutsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved') AND DATE(${withdrawals.updatedAt}) = CURRENT_DATE - INTERVAL '1 day'`);
          const totalTasksCount = await db.select({ count: sql<number>`count(*)` }).from(advertiserTasks);
          const todayTasksCount = await db.select({ count: sql<number>`count(*)` }).from(advertiserTasks).where(sql`DATE(${advertiserTasks.createdAt}) = CURRENT_DATE`);
          const yesterdayTasksCount = await db.select({ count: sql<number>`count(*)` }).from(advertiserTasks).where(sql`DATE(${advertiserTasks.createdAt}) = CURRENT_DATE - INTERVAL '1 day'`);
          const pendingWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} = 'pending'`);
          const approvedWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
          const rejectedWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} = 'rejected'`);
          
          const totalUsers = totalUsersCount[0]?.count || 0;
          const activeUsers = dailyActiveCount[0]?.count || 0;
          const totalAds = totalAdsSum[0]?.total || 0;
          const todayAds = todayAdsSum[0]?.total || 0;
          const yesterdayAds = (yesterdayAdsQuery.rows[0] as any)?.total || 0;
          const totalPAD = Math.round(parseFloat(totalPADSum[0]?.total || '0') * 100000);
          const todayPAD = Math.round(parseFloat((todayPADQuery.rows[0] as any)?.total || '0') * 100000);
          const yesterdayPAD = Math.round(parseFloat((yesterdayPADQuery.rows[0] as any)?.total || '0') * 100000);
          const totalPayouts = formatUSD(totalPayoutsSum[0]?.total || '0');
          const todayPayouts = formatUSD(todayPayoutsSum[0]?.total || '0');
          const yesterdayPayouts = formatUSD(yesterdayPayoutsSum[0]?.total || '0');
          const totalTasks = totalTasksCount[0]?.count || 0;
          const todayTasks = todayTasksCount[0]?.count || 0;
          const yesterdayTasks = yesterdayTasksCount[0]?.count || 0;
          const pendingRequests = pendingWithdrawalsCount[0]?.count || 0;
          const approvedRequests = approvedWithdrawalsCount[0]?.count || 0;
          const rejectedRequests = rejectedWithdrawalsCount[0]?.count || 0;
          
          const adminPanelMessage = 
            `🎛 <b>CASHWATCH ADMIN PANEL</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            
            `👥 <b>USERS</b>\n` +
            `┌ Total  ∙ <code>${totalUsers.toLocaleString()}</code>\n` +
            `└ Active ∙ <code>${activeUsers.toLocaleString()}</code>\n\n` +
            
            `🎬 <b>AD VIEWS</b>\n` +
            `┌ Total     ∙ <code>${totalAds.toLocaleString()}</code>\n` +
            `├ Today     ∙ <code>${todayAds.toLocaleString()}</code>\n` +
            `└ Yesterday ∙ <code>${yesterdayAds.toLocaleString()}</code>\n\n` +
            
            `💰 <b>PAD DISTRIBUTED</b>\n` +
            `┌ Total     ∙ <code>${totalPAD.toLocaleString()}</code>\n` +
            `├ Today     ∙ <code>${todayPAD.toLocaleString()}</code>\n` +
            `└ Yesterday ∙ <code>${yesterdayPAD.toLocaleString()}</code>\n\n` +
            
            `💸 <b>PAYOUTS (TON)</b>\n` +
            `┌ Total     ∙ <code>${totalPayouts}</code>\n` +
            `├ Today     ∙ <code>${todayPayouts}</code>\n` +
            `└ Yesterday ∙ <code>${yesterdayPayouts}</code>\n\n` +
            
            `📋 <b>TASKS</b>\n` +
            `┌ Total     ∙ <code>${totalTasks}</code>\n` +
            `├ Today     ∙ <code>${todayTasks}</code>\n` +
            `└ Yesterday ∙ <code>${yesterdayTasks}</code>\n\n` +
            
            `📊 <b>WITHDRAWALS</b>\n` +
            `┌ ✅ Approved ∙ <code>${approvedRequests}</code>\n` +
            `├ ❌ Rejected ∙ <code>${rejectedRequests}</code>\n` +
            `└ ⏳ Pending  ∙ <code>${pendingRequests}</code>\n\n` +
            
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })} UTC`;
          
          // Answer callback query and edit message
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '🔄 Refreshed' })
          });
          
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              text: adminPanelMessage,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '💰 Pending Withdrawals', callback_data: 'admin_pending_withdrawals' }],
                  [{ text: '🔔 Announcement', callback_data: 'admin_announce' }],
                  [{ text: '📣 Task Notification', callback_data: 'admin_task_notify' }],
                  [{ text: '📊 Advertise', callback_data: 'admin_advertise' }],
                  [{ text: '🔄 Refresh', callback_data: 'admin_refresh' }]
                ]
              }
            })
          });
        } catch (error) {
          console.error('❌ Error refreshing admin panel:', error);
        }
        return true;
      }

      // Handle admin advertise button - sends plain promotional messages without inline buttons
      if (data === 'admin_advertise' && await isAdminAsync(chatId)) {
        // Set pending advertise state (using pendingBroadcasts Map with advertise prefix)
        pendingBroadcasts.set(`advertise_${chatId}`, { timestamp: Date.now() });
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
        
        await sendUserTelegramNotification(chatId, 
          '📊 <b>Advertise Mode</b>\n\n' +
          'Send your promotional message now. It will be sent to all users as a plain message without buttons.\n\n' +
          'To cancel, send /cancel'
        );
        
        return true;
      }
      
      // Handle pending withdrawals button - show all pending withdrawal requests
      if (data && (data === 'admin_pending_withdrawals' || data.startsWith('admin_pending_withdrawals_page_')) && await isAdminAsync(chatId)) {
        try {
          const { db } = await import('./db');
          const { eq } = await import('drizzle-orm');
          const { withdrawals, users } = await import('../shared/schema');
          
          // Extract page number from callback data (default to page 0)
          const pageMatch = data.match(/admin_pending_withdrawals_page_(\d+)/);
          const currentPage = pageMatch ? parseInt(pageMatch[1]) : 0;
          const itemsPerPage = 10;
          const offset = currentPage * itemsPerPage;
          
          // Fetch pending withdrawals with user information
          const pendingWithdrawals = await db
            .select({
              withdrawal: withdrawals,
              user: users
            })
            .from(withdrawals)
            .leftJoin(users, eq(withdrawals.userId, users.id))
            .where(eq(withdrawals.status, 'pending'))
            .orderBy(withdrawals.createdAt)
            .limit(itemsPerPage + 1) // Fetch one extra to check if there are more pages
            .offset(offset);
          
          // Answer callback query
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id })
          });
          
          // Check if there are no pending withdrawals
          if (pendingWithdrawals.length === 0) {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '✅ <b>No pending withdrawal requests found.</b>',
                parse_mode: 'HTML'
              })
            });
            return true;
          }
          
          // Determine if there are more pages
          const hasNextPage = pendingWithdrawals.length > itemsPerPage;
          const displayWithdrawals = hasNextPage ? pendingWithdrawals.slice(0, itemsPerPage) : pendingWithdrawals;
          
          // Send each withdrawal as a separate message with approve/reject buttons
          for (const { withdrawal, user } of displayWithdrawals) {
            const withdrawalDetails = withdrawal.details as any;
            const netAmount = parseFloat(withdrawalDetails?.netAmount || withdrawal.amount);
            const feeAmount = parseFloat(withdrawalDetails?.fee || '0');
            const feePercent = withdrawalDetails?.feePercent || '0';
            const walletAddress = withdrawalDetails?.paymentDetails || withdrawalDetails?.walletAddress || 'N/A';
            const userName = user?.firstName || user?.username || 'Unknown';
            const userTelegramId = user?.telegram_id || '';
            const userTelegramUsername = user?.username ? `@${user.username}` : 'N/A';
            const createdAt = new Date(withdrawal.createdAt!).toUTCString();
            
            // Format matches approved message format exactly
            const message = `💰 Withdrawal Request

🗣 User: <a href="tg://user?id=${userTelegramId}">${userName}</a>
🆔 User ID: ${userTelegramId}
💳 Username: ${userTelegramUsername}
🌐 Address:
${walletAddress}
💸 Amount: ${netAmount.toFixed(5)} USD
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${createdAt}
🤖 Bot: @${await getBotUsername()}`;
            
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ Approve', callback_data: `withdraw_paid_${withdrawal.id}` },
                      { text: '❌ Reject', callback_data: `withdraw_reject_${withdrawal.id}` }
                    ]
                  ]
                }
              })
            });
            
            // Small delay to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Add pagination buttons if needed
          if (currentPage > 0 || hasNextPage) {
            const paginationButtons = [];
            
            if (currentPage > 0) {
              paginationButtons.push({ 
                text: '⬅️ Previous', 
                callback_data: `admin_pending_withdrawals_page_${currentPage - 1}` 
              });
            }
            
            if (hasNextPage) {
              paginationButtons.push({ 
                text: '➡️ Next', 
                callback_data: `admin_pending_withdrawals_page_${currentPage + 1}` 
              });
            }
            
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `📄 Page ${currentPage + 1} - Showing ${displayWithdrawals.length} requests`,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [paginationButtons]
                }
              })
            });
          }
          
        } catch (error) {
          console.error('❌ Error fetching pending withdrawals:', error);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Error loading withdrawals',
              show_alert: true
            })
          });
        }
        return true;
      }
      
      // Handle admin announce button - prompt for broadcast message
      if (data === 'admin_announce' && await isAdminAsync(chatId)) {
        // Store pending broadcast state
        pendingBroadcasts.set(chatId, { timestamp: Date.now() });
        
        // Clean up old pending broadcasts (older than 5 minutes)
        for (const [key, value] of pendingBroadcasts.entries()) {
          if (Date.now() - value.timestamp > 5 * 60 * 1000) {
            pendingBroadcasts.delete(key);
          }
        }
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            callback_query_id: callbackQuery.id,
            text: 'Send your broadcast message as a text'
          })
        });
        
        // Send message with cancel button
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '📢 <b>Broadcast Message</b>\n\n' +
              'Please type the message you want to send to all users.\n\n' +
              'The next message you send will be broadcast to all users.',
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '❌ Cancel Broadcast', callback_data: 'cancel_broadcast' }
              ]]
            }
          })
        });
        
        return true;
      }
      
      // ── Task Notification: one-click global notify for users with unfinished tasks ──
      if (data === 'admin_task_notify' && await isAdminAsync(chatId)) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Preparing notifications...' })
        });
        // Fire and forget — answer callback immediately, run broadcast in background
        (async () => {
          try {
            const { db: dbConn } = await import('./db');
            const { eq, sql: sqlFn } = await import('drizzle-orm');
            const { advertiserTasks: adTasks, users: usersT, taskClicks: tcT } = await import('../shared/schema');

            // Get all running task IDs
            const activeTasks = await dbConn
              .select({ id: adTasks.id })
              .from(adTasks)
              .where(eq(adTasks.status, 'running'));

            if (activeTasks.length === 0) {
              await sendUserTelegramNotification(chatId, '📋 No active tasks found. No notifications sent.');
              return;
            }

            const activeTaskIds = new Set(activeTasks.map(t => t.id));

            // Get all users with a Telegram ID
            const allWithTg = await dbConn
              .select({ id: usersT.id, tgId: usersT.telegram_id })
              .from(usersT)
              .where(sqlFn`${usersT.telegram_id} IS NOT NULL`);

            // Get all task completions for running tasks
            const completionRows = await dbConn
              .select({ pid: tcT.publisherId, taskId: tcT.taskId })
              .from(tcT);

            // Build a map: userId -> set of completed running task IDs
            const completedByUser = new Map<string, Set<string>>();
            for (const row of completionRows) {
              if (!activeTaskIds.has(row.taskId)) continue;
              if (!completedByUser.has(row.pid)) completedByUser.set(row.pid, new Set());
              completedByUser.get(row.pid)!.add(row.taskId);
            }

            // Eligible: has at least one unfinished running task
            const targets = allWithTg.filter(u => {
              if (!u.tgId || u.tgId === chatId) return false;
              const done = completedByUser.get(u.id);
              // Include if they haven't completed ALL active tasks
              return !done || done.size < activeTaskIds.size;
            });

            await sendUserTelegramNotification(chatId,
              `📣 Sending task notification to <b>${targets.length}</b> users with unfinished tasks...\n\nPlease wait...`);

            const botUsername = await getBotUsername();
            const miniAppUrl = `https://t.me/${botUsername}/MyWAdz`;
            const notifMsg =
              `<tg-emoji emoji-id="5472239203590888751">💌</tg-emoji> <b>New tasks available!</b>\n\n` +
              `<tg-emoji emoji-id="5361813743279821319">🤑</tg-emoji> Complete them now and claim your rewards!`;
            // Use url button (same as welcome message) — web_app requires a direct HTTPS webapp URL, not a t.me link
            const notifButtons = { inline_keyboard: [[{ text: '👉 Complete Tasks 👈', url: miniAppUrl }]] };

            let successCount = 0; let failCount = 0; let skippedCount = 0;
            for (let i = 0; i < targets.length; i++) {
              const u = targets[i];
              try {
                const sent = await sendUserTelegramNotification(u.tgId!, notifMsg, notifButtons);
                if (sent) successCount++; else skippedCount++;
              } catch { failCount++; }
              // ~25 msg/s — well within Telegram's 30 msg/s private chat limit
              if ((i + 1) % 25 === 0) await new Promise(r => setTimeout(r, 1_000));
              else await new Promise(r => setTimeout(r, 40));
            }
            await sendUserTelegramNotification(chatId,
              `✅ <b>Task notifications sent!</b>\n\n✅ Delivered: ${successCount}\n⚠️ Skipped (blocked/inactive): ${skippedCount}\n❌ Errors: ${failCount}\n👥 Total: ${targets.length}`);
          } catch (err) {
            console.error('❌ admin_task_notify error:', err);
            await sendUserTelegramNotification(chatId, '❌ Error sending task notifications.');
          }
        })();
        return true;
      }

      // ── return_pow_CASEID — user requests reward restoration ──────────────────
      if (data && data.startsWith('return_pow_') && data.length > 'return_pow_'.length) {
        const caseId = data.replace('return_pow_', '');
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: 'Checking membership...' })
        });
        try {
          const { db: dbConn } = await import('./db');
          const { eq, sql: sqlFn } = await import('drizzle-orm');
          const { channelPenaltyCases: cpcT } = await import('../shared/schema');
          const [penCase] = await dbConn.select().from(cpcT).where(eq(cpcT.id, caseId)).limit(1);
          if (!penCase) { await sendUserTelegramNotification(chatId, '❌ Penalty case not found.'); return true; }
          if (penCase.status === 'resolved') { await sendUserTelegramNotification(chatId, '✅ Your POW has already been restored!'); return true; }
          if (penCase.status === 'permanent') { await sendUserTelegramNotification(chatId, '❌ The 24-hour window has passed. This penalty is now permanent.'); return true; }
          if (penCase.status !== 'penalized') { await sendUserTelegramNotification(chatId, '❌ No active penalty for this case.'); return true; }
          if (penCase.deadlineAt && new Date() > new Date(penCase.deadlineAt)) {
            await dbConn.update(cpcT).set({ status: 'permanent', resolvedAt: new Date() }).where(eq(cpcT.id, caseId));
            await sendUserTelegramNotification(chatId, '❌ The 24-hour window has passed. This penalty is now permanent.');
            return true;
          }
          if (!TELEGRAM_BOT_TOKEN) return true;
          const isMember = await verifyChannelMembership(parseInt(chatId), penCase.channelId, TELEGRAM_BOT_TOKEN);
          if (!isMember) {
            const hoursLeft = penCase.deadlineAt ? Math.max(0, Math.ceil((new Date(penCase.deadlineAt).getTime() - Date.now()) / 3600000)) : 0;
            await sendUserTelegramNotification(chatId,
              `❌ <b>Not subscribed yet.</b>\n\nPlease subscribe to the channel first, then tap "Return POW".\n\n⏰ Time remaining: <b>${hoursLeft}h</b>`);
            return true;
          }
          // Restore original reward
          await dbConn.execute(sqlFn`UPDATE users SET balance = (GREATEST(CAST(balance AS BIGINT), 0) + ${penCase.originalReward})::text, updated_at = NOW() WHERE id = ${penCase.userId}`);
          await dbConn.update(cpcT).set({ status: 'resolved', resolvedAt: new Date() }).where(eq(cpcT.id, caseId));
          await sendUserTelegramNotification(chatId,
            `✅ <b>POW Restored!</b>\n\n<b>${penCase.originalReward.toLocaleString()} $POW</b> has been returned to your balance.\n\nThank you for staying subscribed! 🎉`);
        } catch (err) {
          console.error('❌ return_pow error:', err);
          await sendUserTelegramNotification(chatId, '❌ An error occurred. Please try again.');
        }
        return true;
      }

      // Handle cancel broadcast button
      if (data === 'cancel_broadcast' && await isAdminAsync(chatId)) {
        // Clear pending broadcast state
        pendingBroadcasts.delete(chatId);
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            callback_query_id: callbackQuery.id,
            text: 'Broadcast cancelled'
          })
        });
        
        await sendUserTelegramNotification(chatId, 
          '⚠️ Broadcast cancelled successfully.'
        );
        
        return true;
      }
      
      // Handle admin withdrawal approval
      if (data && data.startsWith('withdraw_paid_')) {
        const withdrawalId = data.replace('withdraw_paid_', '');
        
        if (!await isAdminAsync(chatId)) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Unauthorized access',
              show_alert: true
            })
          });
          return true;
        }
        
        try {
          const result = await storage.approveWithdrawal(withdrawalId, `Approved by admin ${chatId}`);
          
          if (result.success && result.withdrawal) {
            const user = await storage.getUser(result.withdrawal.userId);
            
            const withdrawalDetails = result.withdrawal.details as any;
            const netAmount = parseFloat(withdrawalDetails?.netAmount || result.withdrawal.amount);
            const feeAmount = parseFloat(withdrawalDetails?.fee || '0');
            // Use stored fee percentage from admin settings (already saved when withdrawal was created)
            const feePercent = withdrawalDetails?.feePercent || '0';
            const walletAddress = withdrawalDetails?.paymentDetails || withdrawalDetails?.walletAddress || 'N/A';
            const userName = user?.firstName || user?.username || 'Unknown';
            const userTelegramId = user?.telegram_id || '';
            const userTelegramUsername = user?.username ? `@${user.username}` : 'N/A';
            const currentDate = new Date().toUTCString();
            const method = result.withdrawal.method || 'USD';
            const paymentSystemId = withdrawalDetails?.paymentSystemId || '';
            
            const approvalBotUsername = await getBotUsername();
            const adminSuccessMessage = `✅ Withdrawal Successful

🗣 User: <a href="tg://user?id=${userTelegramId}">${userName}</a>
🆔 User ID: ${userTelegramId}
💳 Username: ${userTelegramUsername}
🌐 Address:
${walletAddress}
💸 Amount: ${netAmount.toFixed(5)} USD
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${currentDate}
🤖 Bot: @${approvalBotUsername}`;
            
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                text: adminSuccessMessage,
                parse_mode: 'HTML'
              })
            });

            // Remove Approve/Reject buttons from all other admins' copies
            await clearWithdrawalAdminButtons(withdrawalId);

            // Send group notification for approval
            await sendWithdrawalApprovedNotification(result.withdrawal);
            
            if (userTelegramId) {
              // User confirmation message with Amount (net after fee) and Fee with percentage
              const userConfirmationMessage = `🚀 Your payout has been successfully processed.

💵 Amount: ${netAmount.toFixed(3)} USD
🛂 Fee: ${feeAmount.toFixed(3)} (${feePercent}%)`;
              
              // Mini App button — same format as welcome message "Let's GOOO!!" button
              const miniAppBotUsername = await getBotUsername();
              const openAppButton = {
                inline_keyboard: [[
                  { text: "🚀 Let's GOOO!!", url: `https://t.me/${miniAppBotUsername}/MyWAdz` }
                ]]
              };
              
              await sendUserTelegramNotification(userTelegramId, userConfirmationMessage, openAppButton);
            }
            
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                callback_query_id: callbackQuery.id,
                text: '✅ Payout approved successfully'
              })
            });
          } else {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                callback_query_id: callbackQuery.id,
                text: result.message,
                show_alert: true
              })
            });
          }
        } catch (error) {
          console.error('Error approving withdrawal:', error);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Error processing approval',
              show_alert: true
            })
          });
        }
        return true;
      }
      
      // Handle admin withdrawal rejection - direct reject without requiring reason
      if (data && data.startsWith('withdraw_reject_')) {
        const withdrawalId = data.replace('withdraw_reject_', '');
        
        if (!await isAdminAsync(chatId)) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Unauthorized access',
              show_alert: true
            })
          });
          return true;
        }
        
        try {
          // Direct rejection - no reason required
          const result = await storage.rejectWithdrawal(withdrawalId);
          
          if (result.success && result.withdrawal) {
            // Update original admin message
            try {
              await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  message_id: callbackQuery.message.message_id,
                  text: `🚫 <b>REJECTED</b>\n\nWithdrawal ID: ${withdrawalId}\n\n<b>Status:</b> Request rejected\n<b>Time:</b> ${new Date().toUTCString()}`,
                  parse_mode: 'HTML'
                })
              });
            } catch (editError) {
              console.log('Could not edit original message:', editError);
            }

            // Remove Approve/Reject buttons from all other admins' copies
            await clearWithdrawalAdminButtons(withdrawalId);

            // Send group notification for rejection
            await sendWithdrawalRejectedNotification(result.withdrawal, 'Rejected by admin');

            // Send notification to user
            const rejectedUser = await storage.getUser(result.withdrawal.userId);
            if (rejectedUser?.telegram_id) {
              const rejectedAmount = parseFloat((result.withdrawal.details as any)?.netAmount || result.withdrawal.amount).toFixed(3);
              await sendUserTelegramNotification(
                rejectedUser.telegram_id,
                `❌ Your withdrawal request of <b>${rejectedAmount} USD</b> has been rejected.\n\nYour balance has been refunded. Please contact support if you have any questions.`,
                { inline_keyboard: [[{ text: '📩 Contact Support', url: 'https://t.me/szxzyz' }]] }
              );
            }
            
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                callback_query_id: callbackQuery.id,
                text: '🚫 Withdrawal rejected - balance refunded'
              })
            });
          } else {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                callback_query_id: callbackQuery.id,
                text: result.message || 'Error processing rejection',
                show_alert: true
              })
            });
          }
        } catch (error) {
          console.error('Error processing rejection:', error);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Error processing rejection',
              show_alert: true
            })
          });
        }
        return true;
      }
      
      // Handle contest/leaderboard callbacks — always edit the existing message
      if (data === 'show_ref_contest' || data === 'ref_contest_refresh') {
        await sendWeeklyReferralContest(chatId, callbackQuery.message?.message_id);
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: data === 'ref_contest_refresh' ? '🔄 Refreshed' : '' }),
        });
        return true;
      }

      if (data === 'show_monthly_leader' || data === 'monthly_leader_refresh') {
        await sendMonthlyLeaderboard(chatId, callbackQuery.message?.message_id);
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: data === 'monthly_leader_refresh' ? '🔄 Refreshed' : '' }),
        });
        return true;
      }

      // Back buttons — edit the message back to the main dashboard
      if (data === 'ref_contest_back' || data === 'monthly_leader_back') {
        const msgId = callbackQuery.message?.message_id;
        if (msgId) await editMessageToDashboard(chatId, msgId);
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id }),
        });
        return true;
      }

      // Handle transaction view callback - opens tonscan URL for the user's withdrawal address
      if (data && data.startsWith('tx_view_')) {
        const withdrawalId = data.replace('tx_view_', '');
        
        try {
          // Get the withdrawal to find the wallet address
          const { db } = await import('./db');
          const { eq } = await import('drizzle-orm');
          const { withdrawals } = await import('../shared/schema');
          
          const [withdrawal] = await db
            .select()
            .from(withdrawals)
            .where(eq(withdrawals.id, withdrawalId))
            .limit(1);
          
          if (withdrawal) {
            const withdrawalDetails = withdrawal.details as any;
            const walletAddress = withdrawalDetails?.paymentDetails || withdrawalDetails?.walletAddress || withdrawalDetails?.tonWalletAddress || '';
            
            if (walletAddress && walletAddress.length > 10) {
              // Fixed transaction URL as per requirements
              const transactionUrl = `https://tonscan.org/address/UQAiuvbhsGT8EEHl2koLD6vex4mWVFFun3fLfunLJ2y_Xj0-`;
              
              // Answer callback and open URL
              await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  callback_query_id: callbackQuery.id,
                  url: transactionUrl
                })
              });
            } else {
              await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  callback_query_id: callbackQuery.id,
                  text: 'Transaction details not available',
                  show_alert: true
                })
              });
            }
          } else {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                callback_query_id: callbackQuery.id,
                text: 'Withdrawal not found',
                show_alert: true
              })
            });
          }
        } catch (error) {
          console.error('Error handling transaction view:', error);
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              callback_query_id: callbackQuery.id,
              text: 'Error loading transaction',
              show_alert: true
            })
          });
        }
        return true;
      }
      
      return true;
    }
    
    const updateMessage = update.message;
    if (!updateMessage || !updateMessage.text) {
      console.log('❌ No message or text found in update');
      return false;
    }

    const chatId = updateMessage.chat.id.toString();
    const text = updateMessage.text.trim();
    const user = updateMessage.from;

    console.log(`📝 Received message: "${text}" from user ${chatId}`);

    // Create/update user for ANY message (not just /start)
    // This ensures users are automatically registered when they interact with the bot
    const { user: dbUser, isNewUser } = await storage.upsertTelegramUser(chatId, {
      email: user.username ? `${user.username}@telegram.user` : `${chatId}@telegram.user`,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      personalCode: user.username || chatId,
      withdrawBalance: '0',
      totalEarnings: '0',
      adsWatched: 0,
      dailyAdsWatched: 0,
      dailyEarnings: '0',
      level: 1,
      flagged: false,
      banned: false,
      referralCode: '', // This will be overridden by crypto generation in upsertTelegramUser
    });

    console.log(`📝 User upserted: ID=${dbUser.id}, TelegramID=${dbUser.telegram_id}, RefCode=${dbUser.referralCode}, IsNew=${isNewUser}`);

    // Check if admin has a pending rejection waiting for a reason
    if (await isAdminAsync(chatId) && pendingRejections.has(chatId)) {
      const rejectionState = pendingRejections.get(chatId)!;
      const rejectionReason = text;
      
      try {
        // Process the rejection with the admin's reason
        const result = await storage.rejectWithdrawal(rejectionState.withdrawalId, rejectionReason);
        
        if (result.success && result.withdrawal) {
          // Update original admin message
          try {
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: rejectionState.messageId,
                text: `🚫 <b>REJECTED</b>\n\nWithdrawal ID: ${rejectionState.withdrawalId}\n\n<b>Status:</b> Request rejected\n<b>Reason:</b> ${rejectionReason}\n<b>Time:</b> ${new Date().toUTCString()}`,
                parse_mode: 'HTML'
              })
            });
          } catch (editError) {
            console.log('Could not edit original message:', editError);
          }
          
          // Confirm rejection to admin
          await sendUserTelegramNotification(chatId, 
            `✅ Withdrawal rejected successfully.\n\nReason: "${rejectionReason}"`
          );
        } else {
          await sendUserTelegramNotification(chatId, 
            `❌ Error: ${result.message}`
          );
        }
      } catch (error) {
        console.error('Error processing rejection with reason:', error);
        await sendUserTelegramNotification(chatId, 
          '❌ Error processing rejection. Please try again.'
        );
      }
      
      // Clear the pending rejection state
      pendingRejections.delete(chatId);
      return true;
    }
    
    // Check if admin has a pending broadcast waiting for message
    // Uses has() first so media-group albums can be buffered across multiple webhook events.
    if (await isAdminAsync(chatId) && pendingBroadcasts.has(chatId)) {
      const incomingMsg = update.message;
      const mediaGroupId: string | undefined = incomingMsg?.media_group_id;

      // ── Media-group (album) buffering ─────────────────────────────────────────
      if (mediaGroupId) {
        if (!mediaGroupBuffers.has(mediaGroupId)) {
          mediaGroupBuffers.set(mediaGroupId, { messages: [], timer: null, adminChatId: chatId });
        }
        const buf = mediaGroupBuffers.get(mediaGroupId)!;
        buf.messages.push(incomingMsg);
        if (buf.timer) clearTimeout(buf.timer);
        buf.timer = setTimeout(async () => {
          mediaGroupBuffers.delete(mediaGroupId);
          pendingBroadcasts.delete(chatId); // final clear after all parts buffered
          await _broadcastAlbum(chatId, buf.messages);
        }, 2500);
        return true;
      }

      // ── Single-message broadcast — clear state atomically ────────────────────
      if (!pendingBroadcasts.delete(chatId)) return true; // race guard
      const srcMsgId: number = incomingMsg.message_id;

      console.log(`📢 [BROADCAST START] Admin ${chatId} using copyMessage (id=${srcMsgId})`);

      try {
        const { db: dbConn } = await import('./db');
        const { sql: sqlFn } = await import('drizzle-orm');
        const { users: usersT } = await import('../shared/schema');

        const allUsers = await dbConn
          .select({ telegramId: usersT.telegram_id })
          .from(usersT)
          .where(sqlFn`${usersT.telegram_id} IS NOT NULL`);

        const seen = new Set<string>();
        const targets = allUsers.filter(u => {
          if (!u.telegramId || u.telegramId === chatId || seen.has(u.telegramId)) return false;
          seen.add(u.telegramId);
          return true;
        });

        await sendUserTelegramNotification(chatId, `📢 Broadcasting to ${targets.length} users… please wait.`);

        let successCount = 0; let failCount = 0;
        const BATCH = 30; const DELAY = 500;

        for (let i = 0; i < targets.length; i++) {
          const tgId = targets[i].telegramId!;
          try {
            const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/copyMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: tgId, from_chat_id: chatId, message_id: srcMsgId }),
            });
            const rd = await resp.json().catch(() => ({})) as any;
            // Remove permanently unreachable users (bot blocked / user deactivated)
            if (!rd.ok) {
              const desc: string = rd.description || '';
              if (desc.includes('bot was blocked') || desc.includes('user is deactivated') || desc.includes('chat not found')) {
                console.log(`🗑 [BROADCAST] Permanent error for ${tgId}: ${desc}`);
              }
              failCount++;
            } else {
              successCount++;
            }
          } catch { failCount++; }

          if ((i + 1) % BATCH === 0) await new Promise(r => setTimeout(r, DELAY));
          else await new Promise(r => setTimeout(r, 20));
        }

        console.log(`📢 [BROADCAST COMPLETE] Success: ${successCount}, Failed: ${failCount}`);
        await sendUserTelegramNotification(chatId,
          `✅ <b>Broadcast complete!</b>\n\n✅ Delivered: ${successCount}\n❌ Failed: ${failCount}\n📈 Total: ${targets.length}`);
      } catch (error) {
        console.error('❌ [BROADCAST ERROR]:', error);
        await sendUserTelegramNotification(chatId, '❌ Error broadcasting. Please try again.');
      }
      return true;
    }

    // ── Helper: broadcast an album (media group) using sendMediaGroup ───────────
    async function _broadcastAlbum(adminChatId: string, messages: any[]): Promise<void> {
      try {
        const { db: dbConn } = await import('./db');
        const { sql: sqlFn } = await import('drizzle-orm');
        const { users: usersT } = await import('../shared/schema');

        const media: any[] = messages.map((msg, idx) => {
          const photo = msg.photo?.[msg.photo.length - 1];
          const video = msg.video;
          const doc   = msg.document;
          const entry: any = {
            type: photo ? 'photo' : video ? 'video' : 'document',
            media: (photo?.file_id) || (video?.file_id) || (doc?.file_id) || '',
          };
          if (idx === 0 && (msg.caption || msg.caption_entities)) {
            entry.caption          = msg.caption || '';
            entry.caption_entities = msg.caption_entities;
            entry.parse_mode       = msg.parse_mode || undefined;
          }
          return entry;
        }).filter(e => e.media);

        if (!media.length) return;

        const allUsers = await dbConn.select({ tgId: usersT.telegram_id }).from(usersT).where(sqlFn`${usersT.telegram_id} IS NOT NULL`);
        const seen = new Set<string>();
        const targets = allUsers.filter(u => { if (!u.tgId || u.tgId === adminChatId || seen.has(u.tgId)) return false; seen.add(u.tgId); return true; });

        await sendUserTelegramNotification(adminChatId, `📢 Broadcasting album (${media.length} items) to ${targets.length} users… please wait.`);

        let ok = 0; let fail = 0;
        for (let i = 0; i < targets.length; i++) {
          try {
            const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: targets[i].tgId!, media }),
            });
            const rd = await r.json().catch(() => ({})) as any;
            if (rd.ok) ok++; else fail++;
          } catch { fail++; }
          if ((i + 1) % 30 === 0) await new Promise(r => setTimeout(r, 500));
          else await new Promise(r => setTimeout(r, 20));
        }
        await sendUserTelegramNotification(adminChatId, `✅ Album broadcast done!\n✅ Delivered: ${ok}\n❌ Failed: ${fail}`);
      } catch (err) { console.error('❌ [ALBUM BROADCAST]:', err); }
    }
    
    // Check if admin has a pending advertise message waiting
    if (await isAdminAsync(chatId) && pendingBroadcasts.delete(`advertise_${chatId}`)) {
      const advertiseMessage = text;
      
      console.log(`📊 [ADVERTISE START] Admin ${chatId} initiating advertise: "${advertiseMessage.substring(0, 50)}..."`);
      
      try {
        // Get all users with Telegram IDs
        const { db } = await import('./db');
        const { sql } = await import('drizzle-orm');
        const { users } = await import('../shared/schema');
        
        const allUsers = await db.select({ 
          telegramId: users.telegram_id 
        }).from(users).where(sql`${users.telegram_id} IS NOT NULL`);
        
        // Use Set for deduplication - ensure one message per unique user ID
        const uniqueUserIds = new Set<string>();
        const dedupedUsers = allUsers.filter(user => {
          if (user.telegramId && !uniqueUserIds.has(user.telegramId)) {
            uniqueUserIds.add(user.telegramId);
            return true;
          }
          return false;
        });
        
        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;
        
        // Send plain message (no inline buttons) to all users
        const BATCH_SIZE = 20;
        const BATCH_DELAY_MS = 1000;
        
        for (let i = 0; i < dedupedUsers.length; i++) {
          const user = dedupedUsers[i];
          
          // Skip admin user
          if (user.telegramId === chatId) {
            skippedCount++;
            continue;
          }
          
          try {
            // Send plain message without any buttons (skip if no telegram_id)
            if (!user.telegramId) {
              failCount++;
              continue;
            }
            
            const sent = await sendUserTelegramNotification(user.telegramId, advertiseMessage);
            
            if (sent) {
              successCount++;
            } else {
              failCount++;
            }
            
            // Apply batch delay every BATCH_SIZE messages
            if ((i + 1) % BATCH_SIZE === 0 && i < dedupedUsers.length - 1) {
              console.log(`📦 Advertise batch ${Math.floor((i + 1) / BATCH_SIZE)} sent, pausing for rate limit...`);
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            } else {
              // Small delay between individual messages within a batch
              await new Promise(resolve => setTimeout(resolve, 40));
            }
          } catch (error) {
            console.error(`Failed to send advertise to ${user.telegramId}:`, error);
            failCount++;
          }
        }
        
        // Send detailed summary to admin
        console.log(`📊 [ADVERTISE COMPLETE] Success: ${successCount}, Failed: ${failCount}, Skipped: ${skippedCount}`);
        await sendUserTelegramNotification(chatId, 
          `✅ <b>Advertise message sent successfully to ${successCount} users.</b>\n\n` +
          `📊 <b>Statistics:</b>\n` +
          `✅ Successfully sent: ${successCount}\n` +
          `❌ Failed/Inactive: ${failCount}\n` +
          `⚙️ Skipped: ${skippedCount} (admin)\n` +
          `📈 Total unique users: ${dedupedUsers.length}`
        );
      } catch (error) {
        console.error('❌ [ADVERTISE ERROR]:', error);
        await sendUserTelegramNotification(chatId, 
          '❌ Error sending advertise message. Please try again.'
        );
      }
      
      return true;
    }
    
    // Handle /szxzyz command - Admin Control Panel
    if (text === '/szxzyz') {
      if (!await isAdminAsync(chatId)) {
        // Non-admin users get redirected to /start
        await sendUserTelegramNotification(chatId, 'Please use /start');
        return true;
      }
      
      // Fetch admin statistics from the database
      try {
        const { db } = await import('./db');
        const { sql } = await import('drizzle-orm');
        const { users, earnings, withdrawals, advertiserTasks } = await import('../shared/schema');
        
        const totalUsersCount = await db.select({ count: sql<number>`count(*)` }).from(users);
        const dailyActiveCount = await db.select({ count: sql<number>`count(distinct ${earnings.userId})` }).from(earnings).where(sql`DATE(${earnings.createdAt}) = CURRENT_DATE`);
        const totalAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatched}), 0)` }).from(users);
        const todayAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatchedToday}), 0)` }).from(users);
        const yesterdayAdsQuery = await db.execute(sql`SELECT COALESCE(SUM(ads_watched_today), 0) as total FROM users WHERE last_ad_date::date = CURRENT_DATE - INTERVAL '1 day'`);
        const totalPADSum = await db.select({ total: sql<string>`COALESCE(SUM(${users.totalEarned}), '0')` }).from(users);
        const todayPADQuery = await db.execute(sql`SELECT COALESCE(SUM(total_earned), '0') as total FROM users WHERE DATE(updated_at) = CURRENT_DATE`);
        const yesterdayPADQuery = await db.execute(sql`SELECT COALESCE(SUM(total_earned), '0') as total FROM users WHERE DATE(updated_at) = CURRENT_DATE - INTERVAL '1 day'`);
        const totalPayoutsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
        const todayPayoutsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved') AND DATE(${withdrawals.updatedAt}) = CURRENT_DATE`);
        const yesterdayPayoutsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved') AND DATE(${withdrawals.updatedAt}) = CURRENT_DATE - INTERVAL '1 day'`);
        const totalTasksCount = await db.select({ count: sql<number>`count(*)` }).from(advertiserTasks);
        const todayTasksCount = await db.select({ count: sql<number>`count(*)` }).from(advertiserTasks).where(sql`DATE(${advertiserTasks.createdAt}) = CURRENT_DATE`);
        const yesterdayTasksCount = await db.select({ count: sql<number>`count(*)` }).from(advertiserTasks).where(sql`DATE(${advertiserTasks.createdAt}) = CURRENT_DATE - INTERVAL '1 day'`);
        const pendingWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} = 'pending'`);
        const approvedWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
        const rejectedWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} = 'rejected'`);
        
        const totalUsers = totalUsersCount[0]?.count || 0;
        const activeUsers = dailyActiveCount[0]?.count || 0;
        const totalAds = totalAdsSum[0]?.total || 0;
        const todayAds = todayAdsSum[0]?.total || 0;
        const yesterdayAds = (yesterdayAdsQuery.rows[0] as any)?.total || 0;
        const totalPAD = Math.round(parseFloat(totalPADSum[0]?.total || '0') * 100000);
        const todayPAD = Math.round(parseFloat((todayPADQuery.rows[0] as any)?.total || '0') * 100000);
        const yesterdayPAD = Math.round(parseFloat((yesterdayPADQuery.rows[0] as any)?.total || '0') * 100000);
        const totalPayouts = formatUSD(totalPayoutsSum[0]?.total || '0');
        const todayPayouts = formatUSD(todayPayoutsSum[0]?.total || '0');
        const yesterdayPayouts = formatUSD(yesterdayPayoutsSum[0]?.total || '0');
        const totalTasks = totalTasksCount[0]?.count || 0;
        const todayTasks = todayTasksCount[0]?.count || 0;
        const yesterdayTasks = yesterdayTasksCount[0]?.count || 0;
        const pendingRequests = pendingWithdrawalsCount[0]?.count || 0;
        const approvedRequests = approvedWithdrawalsCount[0]?.count || 0;
        const rejectedRequests = rejectedWithdrawalsCount[0]?.count || 0;
        
        const adminPanelMessage = 
          `🎛 <b>CASHWATCH ADMIN PANEL</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          
          `👥 <b>USERS</b>\n` +
          `┌ Total  ∙ <code>${totalUsers.toLocaleString()}</code>\n` +
          `└ Active ∙ <code>${activeUsers.toLocaleString()}</code>\n\n` +
          
          `🎬 <b>AD VIEWS</b>\n` +
          `┌ Total     ∙ <code>${totalAds.toLocaleString()}</code>\n` +
          `├ Today     ∙ <code>${todayAds.toLocaleString()}</code>\n` +
          `└ Yesterday ∙ <code>${yesterdayAds.toLocaleString()}</code>\n\n` +
          
          `💰 <b>PAD DISTRIBUTED</b>\n` +
          `┌ Total     ∙ <code>${totalPAD.toLocaleString()}</code>\n` +
          `├ Today     ∙ <code>${todayPAD.toLocaleString()}</code>\n` +
          `└ Yesterday ∙ <code>${yesterdayPAD.toLocaleString()}</code>\n\n` +
          
          `💸 <b>PAYOUTS (TON)</b>\n` +
          `┌ Total     ∙ <code>${totalPayouts}</code>\n` +
          `├ Today     ∙ <code>${todayPayouts}</code>\n` +
          `└ Yesterday ∙ <code>${yesterdayPayouts}</code>\n\n` +
          
          `📋 <b>TASKS</b>\n` +
          `┌ Total     ∙ <code>${totalTasks}</code>\n` +
          `├ Today     ∙ <code>${todayTasks}</code>\n` +
          `└ Yesterday ∙ <code>${yesterdayTasks}</code>\n\n` +
          
          `📊 <b>WITHDRAWALS</b>\n` +
          `┌ ✅ Approved ∙ <code>${approvedRequests}</code>\n` +
          `├ ❌ Rejected ∙ <code>${rejectedRequests}</code>\n` +
          `└ ⏳ Pending  ∙ <code>${pendingRequests}</code>\n\n` +
          
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🕐 ${new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })} UTC`;
        
        // Send message with inline buttons (vertically arranged)
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: adminPanelMessage,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💰 Pending Withdrawals', callback_data: 'admin_pending_withdrawals' }],
                [{ text: '🔔 Announcement', callback_data: 'admin_announce' }],
                [{ text: '📣 Task Notification', callback_data: 'admin_task_notify' }],
                [{ text: '📊 Advertise', callback_data: 'admin_advertise' }],
                [{ text: '🔄 Refresh', callback_data: 'admin_refresh' }]
              ]
            }
          })
        });
        
        return true;
      } catch (error) {
        console.error('Error handling /szxzyz command:', error);
        await sendUserTelegramNotification(chatId, '❌ Error loading admin panel. Please try again.');
        return true;
      }
    }
    
    // Handle /start command with referral processing and first-time vs returning user logic
    if (text.startsWith('/start')) {
      console.log('🚀 Processing /start command...');
      const parameter = text.split(' ')[1]?.trim().toLowerCase();

      // Deep-link shortcuts: /start monthlyleader  /start refcontest
      if (parameter === 'monthlyleader') {
        await sendMonthlyLeaderboard(chatId);
        return true;
      }
      if (parameter === 'refcontest') {
        await sendWeeklyReferralContest(chatId);
        return true;
      }

      const referralCode = text.split(' ')[1]?.trim();

      // Process referral for BOTH new users AND existing users without a referrer
      // Only process referral if this user does not already have a referrer
      const userAlreadyReferred =
        (dbUser as any).referredBy || (dbUser as any).referred_by;

      if (referralCode && referralCode !== chatId && !userAlreadyReferred) {
        console.log(`🔄 Processing referral: referralCode=${referralCode}, user=${chatId}`);
        try {
          const referrer = await storage.getUserByReferralCode(referralCode);
          if (referrer && referrer.id !== dbUser.id) {
            const existingReferral = await storage.getReferralByUsers(referrer.id, dbUser.id);
            if (!existingReferral) {
              console.log(`💾 Creating referral relationship: ${referrer.id} -> ${dbUser.id}`);
              const newReferral = await storage.createReferral(referrer.id, dbUser.id);

              // ── Contest eligibility debug log ────────────────────────────────
              try {
                const { db: dbConn } = await import('./db');
                const { adminSettings: adminSettingsTable } = await import('../shared/schema');
                const allSettings = await dbConn.select().from(adminSettingsTable);
                const getSetting = (key: string, def: string) =>
                  allSettings.find((s: any) => s.settingKey === key)?.settingValue || def;

                const contestEnabled = getSetting('weekly_referral_contest_enabled', 'false') === 'true';
                const contestStart  = getSetting('weekly_referral_start_date', '');
                const contestEnd    = getSetting('weekly_referral_end_date', '');
                const referralTs    = newReferral.createdAt ?? new Date();
                const withinStart   = !contestStart || referralTs >= new Date(contestStart);
                const withinEnd     = !contestEnd   || referralTs <= new Date(contestEnd);
                const qualifies     = contestEnabled && withinStart && withinEnd;

                // Count current referrals for this referrer in the contest period
                const { sql: sqlFn } = await import('drizzle-orm');
                const countResult = await dbConn.execute(sqlFn`
                  SELECT COUNT(r.id) AS referral_count
                  FROM referrals r
                  WHERE r.referrer_id = ${referrer.id}
                    AND r.status = 'completed'
                    ${contestStart ? sqlFn`AND r.created_at >= ${new Date(contestStart)}` : sqlFn``}
                    ${contestEnd   ? sqlFn`AND r.created_at <= ${new Date(contestEnd)}`   : sqlFn``}
                `);
                const currentCount = parseInt((countResult.rows[0] as any)?.referral_count || '0');

                console.log(`\n📊 [Contest Referral Debug]`);
                console.log(`   Contest ID (key)     : weekly_referral_contest_enabled`);
                console.log(`   Contest Enabled      : ${contestEnabled}`);
                console.log(`   Contest Start        : ${contestStart || '(not set)'}`);
                console.log(`   Contest End          : ${contestEnd || '(not set)'}`);
                console.log(`   Referrer User ID     : ${referrer.id}`);
                console.log(`   Referred User ID     : ${dbUser.id}`);
                console.log(`   Referral Timestamp   : ${referralTs.toISOString()}`);
                console.log(`   Referral Status      : ${newReferral.status}`);
                console.log(`   Within Start         : ${withinStart}`);
                console.log(`   Within End           : ${withinEnd}`);
                console.log(`   Qualifies for Contest: ${qualifies}`);
                console.log(`   Current Contest Count: ${currentCount}`);

                if (!contestEnabled) {
                  console.log(`   ⚠️  Contest is DISABLED — referral will not appear on leaderboard until enabled.`);
                } else if (!withinStart) {
                  console.log(`   ⚠️  Referral timestamp ${referralTs.toISOString()} is BEFORE contest start ${contestStart}`);
                } else if (!withinEnd) {
                  console.log(`   ⚠️  Referral timestamp ${referralTs.toISOString()} is AFTER contest end ${contestEnd}`);
                } else {
                  console.log(`   ✅ Referral QUALIFIES — leaderboard count for referrer is now ${currentCount}`);
                }
              } catch (debugErr) {
                console.warn('⚠️ Contest debug log failed (non-critical):', debugErr);
              }
              // ── End contest eligibility debug log ────────────────────────────
            } else {
              console.log(`ℹ️ Referral already exists between ${referrer.id} and ${dbUser.id} — skipped.`);
            }
          }
        } catch (error) {
          console.error('❌ Referral processing failed:', error);
        }
      }

      // First-time vs returning user logic
      // upsertTelegramUser returns raw SQL rows (snake_case), so check both variants
      const welcomeAlreadySent =
        (dbUser as any).welcomeMessageSent === true ||
        (dbUser as any).welcome_message_sent === true;

      if (!welcomeAlreadySent) {
        // First-time user: send the full welcome message and mark as sent
        await sendWelcomeMessage(chatId, referralCode || undefined);
        try {
          await db.execute(sql`
            UPDATE users SET welcome_message_sent = true, updated_at = NOW()
            WHERE id = ${dbUser.id}
          `);
          console.log(`✅ Marked welcome_message_sent=true for user ${dbUser.id}`);
        } catch (markErr) {
          console.warn('⚠️ Could not mark welcome sent (non-critical):', markErr);
        }
      } else {
        // Returning user: send compact dashboard message with live balance
        await sendReturningUserMessage(chatId, referralCode || undefined);
      }

      return true;
    }

    // Handle /RefContest command — Weekly Referral Contest leaderboard
    if (text.toLowerCase() === '/refcontest') {
      await sendWeeklyReferralContest(chatId);
      return true;
    }

    // Handle /MonthlyLeader command — Monthly Leaderboard
    if (text.toLowerCase() === '/monthlyleader') {
      await sendMonthlyLeaderboard(chatId);
      return true;
    }

    // Admin command to list pending withdrawal requests
    if (text === '/payouts' || text === '/withdrawals') {
      if (!await isAdminAsync(chatId)) {
        return true; // Ignore command for non-admins
      }
      
      console.log('💰 Processing admin payouts list command');
      
      try {
        const pendingWithdrawals = await storage.getAllPendingWithdrawals();
        
        if (pendingWithdrawals.length === 0) {
          const noRequestsMessage = '📋 No pending withdrawal requests found.';
          await sendUserTelegramNotification(chatId, noRequestsMessage);
          return true;
        }
        
        let requestsList = '💵 Pending Withdrawal Requests:\n\n';
        
        for (const withdrawal of pendingWithdrawals) {
          const user = await storage.getUser(withdrawal.userId);
          const userName = user ? (user.firstName || user.username || 'Unknown User') : 'Unknown User';
          const details = withdrawal.details as any;
          
          requestsList += `👤 User: ${userName} (ID: ${user?.telegram_id || 'N/A'})\n`;
          requestsList += `💰 Amount: $${parseFloat(withdrawal.amount).toFixed(2)}\n`;
          requestsList += `💳 Method: ${withdrawal.method}\n`;
          requestsList += `📋 Details: ${details?.paymentDetails || 'N/A'}\n`;
          requestsList += `⏰ Requested: ${withdrawal.createdAt ? new Date(withdrawal.createdAt.toString()).toLocaleString() : 'Unknown'}\n`;
          requestsList += `📝 ID: ${withdrawal.id}\n\n`;
        }
        
        // Send admin notification with inline buttons for each withdrawal
        for (const withdrawal of pendingWithdrawals) {
          const user = await storage.getUser(withdrawal.userId);
          const userName = user ? (user.firstName || user.username || 'Unknown User') : 'Unknown User';
          const details = withdrawal.details as any;
          
          const adminMessage = `💵 Withdraw request from user ${userName} (ID: ${user?.telegram_id || 'N/A'})\nAmount: $${parseFloat(withdrawal.amount).toFixed(2)}\nPayment System: ${withdrawal.method}\nPayment Details: ${details?.paymentDetails || 'N/A'}\nTime: ${withdrawal.createdAt ? new Date(withdrawal.createdAt.toString()).toLocaleString() : 'Unknown'}`;
          
          const adminKeyboard = {
            inline_keyboard: [
              [
                { text: "✅ Paid", callback_data: `withdraw_paid_${withdrawal.id}` },
                { text: "❌ Reject", callback_data: `withdraw_reject_${withdrawal.id}` }
              ]
            ]
          };
          
          await sendUserTelegramNotification(chatId, adminMessage, adminKeyboard);
        }
        
        return true;
      } catch (error) {
        console.error('❌ Error fetching pending withdrawals:', error);
        const errorMessage = '❌ Error fetching withdrawal requests.';
        await sendUserTelegramNotification(chatId, errorMessage);
        return true;
      }
    }

    // Custom emoji ID finder - like the Python telebot script
    // If message has custom_emoji entities, reply with their IDs
    const entities = update.message?.entities || [];
    const customEmojiEntities = entities.filter((e: any) => e.type === 'custom_emoji');

    if (customEmojiEntities.length > 0) {
      const ids = customEmojiEntities.map((e: any) => `🔥 custom_emoji_id:\n${e.custom_emoji_id}`).join('\n\n');
      await sendUserTelegramNotification(chatId, ids);
      return true;
    }

    // No custom emoji found - silently ignore normal text messages
    return true;
  } catch (error) {
    console.error('Error handling Telegram message:', error);
    return false;
  }
}

// Keyboard navigation removed - bot uses inline buttons only for withdrawal management

export async function checkBotStatus(): Promise<{ ok: boolean; username?: string; error?: string }> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'Bot token not configured' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json();
      return { ok: true, username: data.result?.username };
    } else {
      const errorData = await response.text();
      return { ok: false, error: errorData };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Ambassador Promo Scheduler ────────────────────────────────────────────────
// Runs every 15 minutes, checks nextPromoAt for each ambassador

const SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generate a random 4-char alphanumeric suffix (no O/I/0/1 for clarity) */
function randomSuffix(len = 4): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)];
  }
  return result;
}

/**
 * Calculate the next UTC posting time from the ambassador's posting schedule.
 * Falls back to 12 h if no schedule is configured.
 */
// Exported alias so routes.ts can import without duplicating logic
export function getNextScheduledTimeExport(scheduleJson: string | null | undefined): Date {
  return getNextScheduledTime(scheduleJson);
}

function getNextScheduledTime(scheduleJson: string | null | undefined): Date {
  let schedule: string[] = [];
  if (scheduleJson) {
    try { schedule = JSON.parse(scheduleJson as string); } catch {}
  }

  if (!Array.isArray(schedule) || schedule.length === 0) {
    return new Date(Date.now() + 12 * 60 * 60 * 1000);
  }

  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const times = schedule
    .map((t: string) => {
      const parts = t.split(':');
      const h = parseInt(parts[0] ?? '0', 10);
      const m = parseInt(parts[1] ?? '0', 10);
      return isNaN(h) || isNaN(m) ? NaN : h * 60 + m;
    })
    .filter((m): m is number => !isNaN(m))
    .sort((a, b) => a - b);

  if (times.length === 0) {
    return new Date(Date.now() + 12 * 60 * 60 * 1000);
  }

  const nextMinutes = times.find(t => t > nowMinutes);
  const next = new Date();

  if (nextMinutes !== undefined) {
    next.setUTCHours(Math.floor(nextMinutes / 60), nextMinutes % 60, 0, 0);
  } else {
    // Wrap to tomorrow — first slot in schedule
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(Math.floor(times[0] / 60), times[0] % 60, 0, 0);
  }

  return next;
}

/** 
 * Generate a unique promo code for an ambassador (prefix + random suffix).
 * Returns the created code string.
 */
export async function generateUniqueAmbassadorCode(prefix: string, exclude: Set<string> = new Set()): Promise<string> {
  const { db: dbConn } = await import('./db');
  const { promoCodes } = await import('../shared/schema');
  const { eq } = await import('drizzle-orm');

  let attempts = 0;
  while (attempts < 20) {
    const candidate = `${prefix.toUpperCase()}${randomSuffix()}`;
    if (exclude.has(candidate)) { attempts++; continue; }
    const [existing] = await dbConn.select({ id: promoCodes.id }).from(promoCodes)
      .where(eq(promoCodes.code, candidate)).limit(1);
    if (!existing) return candidate;
    attempts++;
  }
  // Fallback: longer suffix with exclusion check
  let fallback = `${prefix.toUpperCase()}${randomSuffix(6)}`;
  while (exclude.has(fallback)) fallback = `${prefix.toUpperCase()}${randomSuffix(6)}`;
  return fallback;
}

/**
 * Create the promo code in DB and post to channel + DM ambassador.
 * Verifies bot posting permissions before every post.
 * Returns the generated code string, or null if posting was skipped.
 */
export async function sendAmbassadorPromo(ambId: string): Promise<string | null> {
  const { db: dbConn } = await import('./db');
  const { ambassadors, promoCodes, adminSettings } = await import('../shared/schema');
  const { eq, inArray } = await import('drizzle-orm');
  const { storage: stor } = await import('./storage');

  const [amb] = await dbConn.select().from(ambassadors).where(eq(ambassadors.id, ambId)).limit(1);
  if (!amb || amb.status !== 'active') return null;

  // Check program enabled
  const [programSetting] = await dbConn.select({ v: adminSettings.settingValue })
    .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_program_enabled')).limit(1);
  if (programSetting?.v === 'false') return null;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const user = await stor.getUser(amb.userId);

  // ── Verify bot permissions before doing anything else ─────────────────────
  if (botToken && amb.channelId) {
    console.log(`🔍 [Ambassador ${amb.id}] Checking bot permissions on channel: ${amb.channelId}`);
    const permCheck = await checkBotCanPostToChannel(botToken, amb.channelId);
    console.log(`🔍 [Ambassador ${amb.id}] Permission check result:`, {
      channelId: amb.channelId,
      isAdmin: permCheck.isAdmin,
      hasPostPermission: permCheck.hasPostPermission,
      canPost: permCheck.canPost,
      chatType: permCheck.chatType,
      error: permCheck.error,
    });

    if (!permCheck.canPost) {
      // Determine the exact reason for clearer DM notification
      let dmMessage: string;
      if (!permCheck.isAdmin) {
        dmMessage =
          `<b>⚠️ Posting Paused</b>\n\n` +
          `The bot is no longer an administrator in your channel.\n\n` +
          `Please re-add <b>@${await getBotUsername()}</b> as administrator with <b>Post Messages</b> permission.`;
      } else {
        dmMessage =
          `<b>⚠️ Posting Paused</b>\n\n` +
          `The bot is an administrator in your channel, but it does not have permission to post messages.\n\n` +
          `Please enable the <b>"Post Messages"</b> permission for <b>@${await getBotUsername()}</b> and verify again to continue.`;
      }

      console.warn(`⚠️ [Ambassador ${amb.id}] Cannot post — isAdmin=${permCheck.isAdmin} hasPostPerm=${permCheck.hasPostPermission} error="${permCheck.error}"`);

      await dbConn.update(ambassadors).set({
        channelVerified: false,
        nextPromoAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        updatedAt: new Date(),
      }).where(eq(ambassadors.id, amb.id));

      if (user?.telegram_id) {
        await sendUserTelegramNotification(user.telegram_id, dmMessage, undefined, 'HTML').catch(() => {});
      }
      return null;
    }

    // Restore verified flag if it was cleared
    if (!amb.channelVerified) {
      await dbConn.update(ambassadors).set({ channelVerified: true, updatedAt: new Date() })
        .where(eq(ambassadors.id, amb.id));
    }
    console.log(`✅ [Ambassador ${amb.id}] Bot permissions confirmed — posting to channel ${amb.channelId}`);
  } else {
    console.warn(`⚠️ [Ambassador ${amb.id}] channelId${!botToken ? ' and botToken' : ''} missing — skipping and backing off 24 h`);
    // Advance nextPromoAt so the scheduler doesn't hammer this ambassador every minute
    await dbConn.update(ambassadors).set({
      nextPromoAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(ambassadors.id, amb.id));
    return null;
  }

  // ── Generate 2 promo codes ────────────────────────────────────────────────
  // ── Load global ambassador settings from DB ───────────────────────────────
  const settingKeys = ['ambassador_promo_reward', 'ambassador_max_claims', 'ambassador_promo_expiry_hours'];
  const settingRows = await dbConn.select({ k: adminSettings.settingKey, v: adminSettings.settingValue })
    .from(adminSettings)
    .where(sql`${adminSettings.settingKey} IN (${sql.join(settingKeys.map(k => sql`${k}`), sql`, `)})`);
  const getSetting = (key: string, def: string) => settingRows.find(r => r.k === key)?.v ?? def;

  const rewardAmount  = getSetting('ambassador_promo_reward',       '10000');
  const maxClaims     = parseInt(getSetting('ambassador_max_claims', '100'));
  const expiryHours   = parseInt(getSetting('ambassador_promo_expiry_hours', '24'));

  const prefix = (amb.promoPrefix || amb.promoCodeName).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const uniqueCode1 = await generateUniqueAmbassadorCode(prefix);
  // Generate second code with in-memory exclusion of the first to prevent collisions
  const uniqueCode2 = await generateUniqueAmbassadorCode(prefix, new Set([uniqueCode1]));
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  console.log(`🎟 [Ambassador ${amb.id}] Generated promo codes: ${uniqueCode1}, ${uniqueCode2} | reward: ${rewardAmount} PAD | maxClaims: ${maxClaims} | expires: ${expiresAt.toISOString()} (${expiryHours}h)`);

  // Insert both codes — they will be deactivated below if the channel post fails
  await dbConn.insert(promoCodes).values([
    { code: uniqueCode1, rewardAmount, rewardType: 'PAD', usageLimit: maxClaims, perUserLimit: 1, isActive: true, expiresAt },
    { code: uniqueCode2, rewardAmount, rewardType: 'PAD', usageLimit: maxClaims, perUserLimit: 1, isActive: true, expiresAt },
  ]);

  // ── Build message in ambassador's language ────────────────────────────────
  const botUsername = await getBotUsername();
  const referralLink = user?.referralCode
    ? `https://t.me/${botUsername}/MyWAdz?startapp=${user.referralCode}`
    : `https://t.me/${botUsername}/MyWAdz`;

  const ambLang = (user?.language as string) || 'en';
  const { html: postHtml, inlineKeyboard } =
    buildAmbassadorPromoPayload(ambLang, uniqueCode1, uniqueCode2, rewardAmount, referralLink, maxClaims);

  // ── Post to channel ───────────────────────────────────────────────────────
  let postedToChannel = false;
  let postFailureReason = '';

  if (botToken && amb.channelId) {
    try {
      const imagePath = getPromoImagePath(ambLang);
      const imageBuffer = readFileSync(imagePath);

      // Telegram caption limit is 1024 chars; truncate safely if ever exceeded
      const safeCaption = postHtml.length <= 1024 ? postHtml : postHtml.slice(0, 1021) + '…';

      const form = new FormData();
      form.append('chat_id', amb.channelId);
      form.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'promo.png');
      form.append('caption', safeCaption);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', JSON.stringify(inlineKeyboard));

      console.log(`📤 [Ambassador ${amb.id}] Posting to channel — summary:`, {
        ambassadorId: amb.id,
        channelId: amb.channelId,
        channelVerified: amb.channelVerified,
        lang: ambLang,
        codes: [uniqueCode1, uniqueCode2],
        captionLength: safeCaption.length,
        parseMode: 'HTML',
        imagePath,
        imageBytes: imageBuffer.length,
        inlineKeyboard,
      });

      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      const respData = await resp.json() as any;
      postedToChannel = respData.ok === true;

      if (postedToChannel) {
        console.log(`✅ [Ambassador ${amb.id}] Photo posted successfully — channel: ${amb.channelId} | message_id: ${respData.result?.message_id}`);
      } else {
        postFailureReason = `Telegram error ${respData.error_code}: ${respData.description}`;
        console.error(`❌ [Ambassador ${amb.id}] sendPhoto FAILED — full Telegram response:`, {
          ambassadorId: amb.id,
          channelId: amb.channelId,
          httpStatus: resp.status,
          ok: respData.ok,
          errorCode: respData.error_code,
          description: respData.description,
          parameters: respData.parameters,
          fullResponse: JSON.stringify(respData),
        });
      }
    } catch (err: any) {
      postFailureReason = `Exception: ${err?.message || err}`;
      console.error(`❌ [Ambassador ${amb.id}] sendPhoto threw an exception:`, err);
    }
  } else {
    postFailureReason = `Missing botToken=${!!botToken} or channelId=${amb.channelId}`;
    console.error(`❌ [Ambassador ${amb.id}] Cannot post — ${postFailureReason}`);
  }

  // ── Handle failure: deactivate codes, back off schedule, notify ambassador ─
  if (!postedToChannel) {
    // Deactivate the codes we just created so they aren't wasted
    await dbConn.update(promoCodes)
      .set({ isActive: false })
      .where(inArray(promoCodes.code, [uniqueCode1, uniqueCode2]));
    console.warn(`⚠️ [Ambassador ${amb.id}] Deactivated codes [${uniqueCode1}, ${uniqueCode2}] — channel post failed: ${postFailureReason}`);

    // Advance nextPromoAt so the scheduler does not retry every cycle and hammer a broken channel.
    // Retry in 2 hours instead of the normal 12-hour interval.
    await dbConn.update(ambassadors).set({
      nextPromoAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(ambassadors.id, amb.id));
    console.warn(`⚠️ [Ambassador ${amb.id}] Scheduled retry in 2 h due to post failure`);

    if (user?.telegram_id) {
      await sendUserTelegramNotification(
        user.telegram_id,
        `<b>Promo Post Failed</b>\n\n` +
        `The bot was unable to post to your channel (<code>${amb.channelId}</code>).\n\n` +
        `Reason: <code>${postFailureReason}</code>\n\n` +
        `Please ensure <b>@${await getBotUsername()}</b> is an administrator with <b>Post Messages</b> permission enabled.`,
        undefined,
        'HTML'
      ).catch(() => {});
    }

    // Return null so callers know the channel post did NOT succeed
    return null;
  }

  // ── Advance schedule: use posting schedule if set, else default 12 h ────
  const nextPromoAt = getNextScheduledTime((amb as any).postingSchedule ?? null);
  await dbConn.update(ambassadors).set({
    lastPromoSentAt: new Date(),
    nextPromoAt,
    updatedAt: new Date(),
  }).where(eq(ambassadors.id, amb.id));

  console.log(`✅ [Ambassador ${amb.id}] Promo cycle complete — codes: ${uniqueCode1}, ${uniqueCode2} | channel: ${amb.channelId}`);
  return uniqueCode1;
}

export async function runAmbassadorDailyPromos(): Promise<void> {
  try {
    const { db: dbConn } = await import('./db');
    const { ambassadors, adminSettings } = await import('../shared/schema');
    const { eq } = await import('drizzle-orm');

    // Check if program and auto-posting are enabled
    const globalSettingRows = await dbConn.select({ k: adminSettings.settingKey, v: adminSettings.settingValue })
      .from(adminSettings)
      .where(sql`${adminSettings.settingKey} IN ('ambassador_program_enabled', 'ambassador_auto_posting')`);
    const getGlobal = (k: string, def: string) => globalSettingRows.find(r => r.k === k)?.v ?? def;
    if (getGlobal('ambassador_program_enabled', 'true') === 'false') return;
    if (getGlobal('ambassador_auto_posting', 'true') === 'false') return;

    const now = new Date();
    // Find all active ambassadors, then filter by nextPromoAt in JS
    const dueAmbassadors = await dbConn.select({ id: ambassadors.id }).from(ambassadors)
      .where(eq(ambassadors.status, 'active'));

    for (const amb of dueAmbassadors) {
      try {
        const [full] = await dbConn.select().from(ambassadors).where(eq(ambassadors.id, amb.id)).limit(1);
        if (!full) continue;

        // Skip ambassadors in manual posting mode — they post on demand only
        if ((full as any).postingMode === 'manual') continue;

        // Check if nextPromoAt is due
        if (!full.nextPromoAt) {
          // Never scheduled — set initial nextPromoAt from schedule
          const next = getNextScheduledTime(full.postingSchedule ?? null);
          await dbConn.update(ambassadors).set({ nextPromoAt: next, updatedAt: new Date() }).where(eq(ambassadors.id, amb.id));
          continue;
        }

        const dueAt = new Date(full.nextPromoAt);
        // Guard: if nextPromoAt is stale by more than 2 hours (e.g. server was down),
        // reschedule to next valid slot instead of firing immediately for old missed posts.
        const staleCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        if (dueAt < staleCutoff) {
          const next = getNextScheduledTime(full.postingSchedule ?? null);
          await dbConn.update(ambassadors).set({ nextPromoAt: next, updatedAt: new Date() }).where(eq(ambassadors.id, amb.id));
          console.log(`⏩ [Ambassador ${amb.id}] Stale nextPromoAt rescheduled to ${next.toISOString()}`);
          continue;
        }

        if (dueAt > now) continue;

        await sendAmbassadorPromo(full.id);
      } catch (err) {
        console.error(`Failed to process ambassador ${amb.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Ambassador promo scheduler error:', err);
  }
}

// Start ambassador promo scheduler — checks every minute for due posts
export function startAmbassadorScheduler(): void {
  // Run 10 seconds after server start to catch any posts missed during restart
  setTimeout(() => runAmbassadorDailyPromos().catch(console.error), 10_000);
  // Then run every minute
  setInterval(() => runAmbassadorDailyPromos().catch(console.error), 60_000);
  console.log('🎖️ Ambassador promo scheduler started (1-min check interval)');
}

// ── TON Pending Deposit Retry Poller ─────────────────────────────────────────
// Runs every 2 minutes. Picks up deposits that were pending when the user first
// called /api/ton/deposit/verify (blockchain not yet visible) and credits them
// once they appear on-chain.

const TON_DEPOSIT_WALLET = 'UQC4E8orjioFZB3ePOKzlhjMWLLpTDjIk7ZRY2YS6K_fEdxL';

export async function retryPendingTonDeposits(): Promise<void> {
  try {
    const { db: dbConn } = await import('./db');
    const { tonDeposits, users, transactions } = await import('../shared/schema');
    const { eq, and, sql } = await import('drizzle-orm');

    // Only process deposits created in the last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await dbConn
      .select()
      .from(tonDeposits)
      .where(and(eq(tonDeposits.status, 'pending'), sql`${tonDeposits.createdAt} > ${cutoff}`));

    // Also expire deposits older than 24 h that still haven't confirmed
    const expiryCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await dbConn
      .update(tonDeposits)
      .set({ status: 'expired' } as any)
      .where(and(eq(tonDeposits.status, 'pending'), sql`${tonDeposits.createdAt} < ${expiryCutoff}`));

    if (pending.length === 0) return;

    console.log(`💎 [TON Poller] Checking ${pending.length} pending deposit(s)...`);

    // Fetch up to 100 recent transactions from the deposit wallet
    // Using TonCenter v3 API — v2 returns LITE_SERVER_UNKNOWN errors
    const url = `https://toncenter.com/api/v3/transactions?account=${TON_DEPOSIT_WALLET}&limit=100&sort=desc`;
    let chainTxs: any[] = [];
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        // v3 returns { transactions: [...] }
        if (Array.isArray(data.transactions)) chainTxs = data.transactions;
      }
    } catch (err) {
      console.warn('💎 [TON Poller] TON Center API unreachable, will retry next cycle');
      return;
    }

    if (chainTxs.length === 0) return;

    // Track which on-chain tx hashes have been claimed this pass (prevents double-credit)
    const usedHashes = new Set<string>();

    for (const dep of pending) {
      const expectedNano = BigInt(Math.round(parseFloat(dep.amount) * 1_000_000_000));
      // Deposit must have landed on-chain within 5 min before the record was created (clock skew)
      // or any time after — up to 24 h
      const depCreatedSec = Math.floor(new Date(dep.createdAt!).getTime() / 1000);
      const windowStartSec = depCreatedSec - 300; // 5-min before tolerance

      const match = chainTxs.find((tx: any) => {
        // v3: tx.hash directly, tx.now for timestamp
        const txHash: string = tx.hash ?? '';
        if (usedHashes.has(txHash)) return false;
        const inNano = tx.in_msg?.value ? BigInt(tx.in_msg.value) : 0n;
        // Amount must match exactly ±1 nanoton (gas rounding), allow up to 0.001 TON fee tolerance
        if (inNano < expectedNano - 1n || inNano > expectedNano + 1_000_000n) return false;
        const txTime: number = tx.now ?? 0;
        if (txTime < windowStartSec) return false; // tx too old relative to deposit record
        return true;
      });

      if (!match) {
        console.log(`💎 [TON Poller] Deposit ${dep.id} (${dep.amount} TON) not yet on-chain`);
        continue;
      }

      const txHash: string = match.hash ?? '';
      const actualNano = BigInt(match.in_msg.value);
      const actualAmount = Number(actualNano) / 1_000_000_000;
      usedHashes.add(txHash);

      // Atomic claim + credit — all inside ONE transaction so confirm & balance update never split
      let newBalance: string;
      let telegramIdForNotify: string | null = null;

      const credited = await dbConn.transaction(async (tx) => {
        const claimed = await tx.update(tonDeposits)
          .set({ status: 'confirmed', confirmedAt: new Date() } as any)
          .where(and(eq(tonDeposits.id, dep.id), eq(tonDeposits.status as any, 'pending')))
          .returning({ id: tonDeposits.id });

        if (claimed.length === 0) {
          return false; // already claimed by verify endpoint
        }

        const [currentUser] = await tx
          .select({ tonBalance: users.tonBalance, telegramId: users.telegram_id })
          .from(users)
          .where(eq(users.id, dep.userId))
          .limit(1);
        if (!currentUser) return false;

        newBalance = (parseFloat(currentUser.tonBalance || '0') + actualAmount).toFixed(10);
        telegramIdForNotify = currentUser.telegramId ?? null;

        await tx.update(users)
          .set({ tonBalance: newBalance, updatedAt: new Date() } as any)
          .where(eq(users.id, dep.userId));

        await tx.insert(transactions).values({
          userId: dep.userId,
          amount: actualAmount.toString(),
          type: 'addition',
          source: 'ton_deposit',
          description: `TON deposit confirmed (auto-retry): ${actualAmount} TON`,
          metadata: { depositId: dep.id, txHash, autoRetry: true },
        } as any);

        return true;
      });

      if (!credited) {
        console.log(`💎 [TON Poller] Deposit ${dep.id} already claimed or user missing — skipping`);
        continue;
      }

      console.log(`✅ [TON Poller] Credited deposit ${dep.id}: userId=${dep.userId} amount=${actualAmount} TON newBalance=${newBalance!}`);

      // Notify user via Telegram DM
      if (telegramIdForNotify) {
        await sendUserTelegramNotification(
          telegramIdForNotify,
          `<b>💎 TON Deposit Confirmed!</b>\n\n` +
          `<b>${actualAmount.toFixed(4)} TON</b> has been credited to your account.\n\n` +
          `Your new TON balance: <b>${newBalance!} TON</b>`,
          undefined,
          'HTML',
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('💎 [TON Poller] Error:', err);
  }
}

// ── Channel Penalty Poller ────────────────────────────────────────────────────
// 1. Creates "watching" cases for recent verified channel task completions
// 2. If user left channel: deduct 2× reward, set 24-h rejoin window, send warning
// 3. If penalized user rejoined: restore original reward, mark resolved
// 4. If 24-h deadline passed without rejoin: mark permanent
export async function checkChannelPenalties(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const { db: dbConn } = await import('./db');
    const { and, eq, sql: sqlFn } = await import('drizzle-orm');
    const { users: usersT, taskClicks: tcT, advertiserTasks: adT, channelPenaltyCases: cpcT } = await import('../shared/schema');
    const botToken = TELEGRAM_BOT_TOKEN;
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // ── Step 1: seed watching cases for recent verified channel completions ──
    const recent = await dbConn
      .select({ taskId: tcT.taskId, publisherId: tcT.publisherId, rewardAmount: tcT.rewardAmount, clickedAt: tcT.clickedAt, link: adT.link })
      .from(tcT)
      .innerJoin(adT, eq(tcT.taskId, adT.id))
      .where(and(eq(adT.taskType, 'channel'), eq(adT.verificationRequired, true), sqlFn`${tcT.clickedAt} > ${cutoff24h}`));

    for (const c of recent) {
      const exists = await dbConn.select({ id: cpcT.id }).from(cpcT)
        .where(and(eq(cpcT.userId, c.publisherId), eq(cpcT.taskId, c.taskId))).limit(1);
      if (exists.length) continue;
      const [u] = await dbConn.select({ tgId: usersT.telegram_id }).from(usersT).where(eq(usersT.id, c.publisherId)).limit(1);
      if (!u?.tgId) continue;
      let channelId = c.link?.trim() || '';
      const m = channelId.match(/t\.me\/([^/?]+)/);
      if (m) channelId = `@${m[1]}`;
      await dbConn.insert(cpcT).values({
        userId: c.publisherId, telegramId: u.tgId, taskId: c.taskId,
        channelId, channelLink: c.link || '', originalReward: parseInt(c.rewardAmount || '0'),
        penaltyDeducted: 0, claimedAt: c.clickedAt || now, status: 'watching',
      }).onConflictDoNothing();
    }

    // ── Step 2: check watching cases — detect channel leaves ──
    const watching = await dbConn.select().from(cpcT).where(eq(cpcT.status, 'watching'));
    for (const p of watching) {
      if (!p.telegramId) continue;
      const isMember = await verifyChannelMembership(parseInt(p.telegramId), p.channelId, botToken);
      if (!isMember) {
        const penalty = p.originalReward * 2;
        const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await dbConn.execute(sqlFn`UPDATE users SET balance = GREATEST(CAST(balance AS BIGINT) - ${penalty}, 0)::text, updated_at = NOW() WHERE id = ${p.userId}`);
        await dbConn.update(cpcT).set({ status: 'penalized', leftAt: now, deadlineAt: deadline, penaltyDeducted: penalty }).where(eq(cpcT.id, p.id));
        // Send Telegram warning with inline buttons
        const warnMsg =
          `<tg-emoji emoji-id="4956611513369494230">⚠️</tg-emoji> <b>Unsubscribed Too Early</b>\n\n` +
          `<tg-emoji emoji-id="5883997563639567521">😡</tg-emoji> <b>${penalty.toLocaleString()} $POW has been deducted.</b>\n\n` +
          `<tg-emoji emoji-id="4956371914323920049">🔄</tg-emoji> Re-subscribe within <b>24 hours</b> to get your coins back.`;
        await sendUserTelegramNotification(p.telegramId, warnMsg, {
          inline_keyboard: [
            [{ text: '👉 Subscribe 👈', url: p.channelLink }],
            [{ text: '💰 Return POW', callback_data: `return_pow_${p.id}` }],
          ]
        });
        console.log(`⚠️ [PenaltyPoller] ${p.userId} left ${p.channelId} — deducted ${penalty} POW`);
      }
    }

    // ── Step 3: check penalized cases — resolve or make permanent ──
    const penalized = await dbConn.select().from(cpcT).where(eq(cpcT.status, 'penalized'));
    for (const p of penalized) {
      if (!p.telegramId) continue;
      if (p.deadlineAt && now > new Date(p.deadlineAt)) {
        await dbConn.update(cpcT).set({ status: 'permanent', resolvedAt: now }).where(eq(cpcT.id, p.id));
        console.log(`🔒 [PenaltyPoller] Penalty permanent for ${p.userId}`);
        continue;
      }
      const isMember = await verifyChannelMembership(parseInt(p.telegramId), p.channelId, botToken);
      if (isMember) {
        await dbConn.execute(sqlFn`UPDATE users SET balance = (GREATEST(CAST(balance AS BIGINT), 0) + ${p.originalReward})::text, updated_at = NOW() WHERE id = ${p.userId}`);
        await dbConn.update(cpcT).set({ status: 'resolved', resolvedAt: now }).where(eq(cpcT.id, p.id));
        await sendUserTelegramNotification(p.telegramId,
          `✅ <b>POW Restored!</b>\n\n<b>${p.originalReward.toLocaleString()} $POW</b> has been returned to your balance.\n\nThank you for staying subscribed! 🎉`);
        console.log(`✅ [PenaltyPoller] Restored ${p.originalReward} POW for ${p.userId}`);
      }
    }
  } catch (err) {
    console.error('⚠️ [PenaltyPoller] Error:', err);
  }
}

export function startChannelPenaltyPoller(): void {
  setTimeout(() => checkChannelPenalties().catch(console.error), 90_000); // 1.5 min after start
  setInterval(() => checkChannelPenalties().catch(console.error), 5 * 60 * 1000); // every 5 min
  console.log('🔒 Channel penalty poller started (5-min interval)');
}

export function startTonDepositPoller(): void {
  // First check 30 s after start (catches any deposits missed during a restart)
  setTimeout(() => retryPendingTonDeposits().catch(console.error), 30_000);
  // Then every 2 minutes
  setInterval(() => retryPendingTonDeposits().catch(console.error), 2 * 60 * 1000);
  console.log('💎 TON deposit retry poller started (2-min interval)');
}

// ── Automatic task reminder scheduler ─────────────────────────────────────────
// Runs every hour. For each user that has at least one unfinished running task
// and has NOT already been notified today, sends one Telegram notification and
// records today's date so no second notification is sent until the next day.
async function runTaskReminderPass(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const { db: dbConn } = await import('./db');
    const { eq, sql: sqlFn } = await import('drizzle-orm');
    const { advertiserTasks: adTasks, users: usersT, taskClicks: tcT } = await import('../shared/schema');

    // Today's date in UTC (YYYY-MM-DD) — the deduplication key
    const todayUTC = new Date().toISOString().slice(0, 10);

    // Get all running task IDs
    const activeTasks = await dbConn
      .select({ id: adTasks.id })
      .from(adTasks)
      .where(eq(adTasks.status, 'running'));

    if (activeTasks.length === 0) return; // Nothing to notify about

    const activeTaskIds = new Set(activeTasks.map(t => t.id));

    // Get all users with a Telegram ID who haven't been reminded today
    const candidates = await dbConn
      .select({ id: usersT.id, tgId: usersT.telegram_id, lastReminderDate: usersT.lastTaskReminderDate })
      .from(usersT)
      .where(sqlFn`${usersT.telegram_id} IS NOT NULL`);

    const eligibleCandidates = candidates.filter(u => u.lastReminderDate !== todayUTC);
    if (eligibleCandidates.length === 0) return;

    // Get all task completions for running tasks, grouped by user
    const completionRows = await dbConn
      .select({ pid: tcT.publisherId, taskId: tcT.taskId })
      .from(tcT);

    const completedByUser = new Map<string, Set<string>>();
    for (const row of completionRows) {
      if (!activeTaskIds.has(row.taskId)) continue;
      if (!completedByUser.has(row.pid)) completedByUser.set(row.pid, new Set());
      completedByUser.get(row.pid)!.add(row.taskId);
    }

    // Eligible: has at least one unfinished running task
    const targets = eligibleCandidates.filter(u => {
      const done = completedByUser.get(u.id);
      return !done || done.size < activeTaskIds.size;
    });

    if (targets.length === 0) return;

    const botUsername = await getBotUsername();
    // Same URL format as the welcome message button
    const miniAppUrl = `https://t.me/${botUsername}/MyWAdz`;
    const notifText =
      `<tg-emoji emoji-id="5472239203590888751">💌</tg-emoji> <b>New tasks available!</b>\n\n` +
      `<tg-emoji emoji-id="5361813743279821319">🤑</tg-emoji> Complete them now and claim your rewards!`;
    // Build button exactly like sendWelcomeMessage — url button pointing to the Mini App t.me link
    const replyMarkup = {
      inline_keyboard: [[{ text: '👉 Complete Tasks 👈', url: miniAppUrl }]]
    };

    let sent = 0; let skipped = 0;
    for (let i = 0; i < targets.length; i++) {
      const u = targets[i];
      try {
        // Mark as reminded BEFORE sending so a crash mid-batch doesn't re-spam
        await dbConn
          .update(usersT)
          .set({ lastTaskReminderDate: todayUTC })
          .where(eq(usersT.id, u.id));

        // Send directly — same raw fetch pattern as sendWelcomeMessage so the
        // button is serialised and delivered identically to the working welcome button
        const payload = {
          chat_id: u.tgId,
          text: notifText,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        };

        let ok = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (resp.ok) { ok = true; break; }
          const errText = await resp.text();
          if (resp.status === 429) {
            let wait = 2;
            try { wait = JSON.parse(errText)?.parameters?.retry_after ?? 2; } catch { /* ignore */ }
            await new Promise(r => setTimeout(r, wait * 1000));
            continue;
          }
          // Permanent user-side error (blocked, deactivated, etc.) — skip silently
          break;
        }
        if (ok) sent++; else skipped++;
      } catch { skipped++; }

      // Stay well under Telegram's 30 msg/s private chat limit
      if ((i + 1) % 25 === 0) await new Promise(r => setTimeout(r, 1_000));
      else await new Promise(r => setTimeout(r, 40));
    }
    console.log(`📣 [TaskReminder] Daily reminders — sent: ${sent}, skipped: ${skipped}, total: ${targets.length}`);
  } catch (err) {
    console.error('❌ [TaskReminder] Error in reminder pass:', err);
  }
}

export function startTaskReminderScheduler(): void {
  // First pass 5 minutes after startup (avoids collision with other heavy boot tasks)
  setTimeout(() => runTaskReminderPass().catch(console.error), 5 * 60 * 1000);
  // Then every hour
  setInterval(() => runTaskReminderPass().catch(console.error), 60 * 60 * 1000);
  console.log('📣 Task reminder scheduler started (hourly interval)');
}

export async function getWebhookInfo(): Promise<any> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: 'Bot token not configured' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json();
      return data.result;
    } else {
      const errorData = await response.text();
      return { error: errorData };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setupTelegramWebhook(webhookUrl: string, retries = 3): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured');
    return false;
  }

  console.log(`🔧 Setting up Telegram webhook: ${webhookUrl}`);
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const botStatus = await checkBotStatus();
      if (!botStatus.ok) {
        console.error(`❌ Bot token is invalid: ${botStatus.error}`);
        return false;
      }
      
      console.log(`✅ Bot token valid: @${botStatus.username}`);
      
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query'],
          drop_pending_updates: true,
        }),
      });

      const data = await response.json();
      
      if (response.ok && data.ok) {
        console.log('✅ Telegram webhook configured successfully');
        
        const webhookInfo = await getWebhookInfo();
        if (webhookInfo && webhookInfo.url === webhookUrl) {
          console.log(`✅ Webhook verified: ${webhookInfo.url}`);
          console.log(`📊 Pending updates: ${webhookInfo.pending_update_count || 0}`);
          console.log('🤖 Bot Active ✅');
          return true;
        } else {
          console.warn('⚠️ Webhook set but verification failed');
          return true;
        }
      } else {
        const errorMsg = data.description || JSON.stringify(data);
        console.error(`❌ Failed to set webhook (attempt ${attempt}/${retries}):`, errorMsg);
        
        if (attempt < retries) {
          const delay = attempt * 2000;
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (error) {
      console.error(`❌ Error setting webhook (attempt ${attempt}/${retries}):`, error);
      
      if (attempt < retries) {
        const delay = attempt * 2000;
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('❌ Failed to set up webhook after all retries');
  return false;
}
