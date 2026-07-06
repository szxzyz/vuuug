// Telegram Bot API integration for sending notifications
import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';
import { db } from './db';
import { earnings } from '../shared/schema';
import { eq, sql, and } from 'drizzle-orm';

const isAdmin = (telegramId: string): boolean => {
  const tid = telegramId.toString();
  // Check SUPER_ADMIN_ID / TELEGRAM_ADMIN_ID (master admin)
  const superAdmin = (process.env.SUPER_ADMIN_ID || process.env.TELEGRAM_ADMIN_ID || '').trim();
  if (superAdmin && tid === superAdmin) return true;
  // Check comma-separated sub-admins
  const adminIdsEnv = (process.env.TELEGRAM_ADMIN_IDS || '').trim();
  if (!adminIdsEnv) return false;
  return adminIdsEnv.split(',').map(id => id.trim()).filter(Boolean).includes(tid);
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


export async function sendUserTelegramNotification(userId: string, message: string, replyMarkup?: any, parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured');
    return false;
  }

  try {
    console.log(`📞 Sending message to Telegram API for user ${userId}...`);
    
    const telegramMessage: TelegramMessage = {
      chat_id: userId,
      text: message,
      parse_mode: parseMode,
      protect_content: false
    };

    if (replyMarkup) {
      // Handle ReplyKeyboardMarkup properly
      if (replyMarkup.keyboard) {
        // This is a reply keyboard - format correctly
        telegramMessage.reply_markup = {
          keyboard: replyMarkup.keyboard,
          resize_keyboard: replyMarkup.resize_keyboard || true,
          one_time_keyboard: replyMarkup.one_time_keyboard || false
        } as any;
      } else {
        // This is an inline keyboard or other markup
        telegramMessage.reply_markup = replyMarkup;
      }
    }

    console.log('📡 Request payload:', JSON.stringify(telegramMessage, null, 2));
    console.log(`🔒 Forward protection: DISABLED for user ${userId} (all users can forward messages)`);

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telegramMessage),
    });

    console.log('📊 Telegram API response status:', response.status);

    if (response.ok) {
      const responseData = await response.json();
      console.log('✅ User notification sent successfully to', userId, responseData);
      return true;
    } else {
      const errorData = await response.text();
      console.error('❌ Failed to send user notification:', errorData);
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending user notification:', error);
    return false;
  }
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
    const groupSetting = await storage.getAppSetting('withdrawal_group_chat_id', '-1003881171760');
    const groupChatId = groupSetting || '-1003881171760';

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
    const groupSetting = await storage.getAppSetting('withdrawal_group_chat_id', '-1003881171760');
    const WITHDRAWAL_CHANNEL_ID = groupSetting || '-1003881171760';
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

    // Get top referrers within contest period
    // NOTE: Referrals in this system go from 'pending' → 'completed'.
    //       'active' is never set, so querying only 'active' always returns 0 rows.
    //       We count both 'pending' (friend joined) and 'completed' (friend watched ads).
    const topQuery = await dbConn.execute(sqlFn`
      SELECT u.id, u.username, u.first_name, COUNT(r.id) AS referral_count
      FROM users u
      INNER JOIN referrals r ON r.referrer_id = u.id
      WHERE r.status IN ('pending', 'completed')
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

    const adminIds = [
      (process.env.SUPER_ADMIN_ID || process.env.TELEGRAM_ADMIN_ID || '').trim(),
      ...(process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((id: string) => id.trim()),
    ].filter(Boolean);

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
          WHERE r.status IN ('pending', 'completed')
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
🤖 Bot: @MoneyAdzbot`;
            
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
    // CRITICAL: Use delete() in condition for atomic check-and-clear
    // Map.delete() returns true if key existed, false otherwise
    // This ensures ONLY the first webhook event proceeds, preventing duplicates
    if (await isAdminAsync(chatId) && pendingBroadcasts.delete(chatId)) {
      const broadcastMessage = text;
      
      console.log(`📢 [BROADCAST START] Admin ${chatId} initiating broadcast: "${broadcastMessage.substring(0, 50)}..."`);
      
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
        
        // Get bot username for Mini App link (same as welcome message "Let's GOOO!!" button)
        const broadcastBotUsername = await getBotUsername();
        const miniAppUrl = `https://t.me/${broadcastBotUsername}/MyWAdz`;
        
        // Create inline buttons for broadcast message - same Mini App link as welcome message
        const broadcastButtons = {
          inline_keyboard: [
            [
              {
                text: "🚀 Let's GOOO!!",
                url: miniAppUrl
              }
            ]
          ]
        };
        
        await sendUserTelegramNotification(chatId, 
          `📢 Broadcasting message to ${dedupedUsers.length} unique users...\n\nPlease wait...`
        );
        
        // Send message to each unique user with faster batching
        // Telegram allows ~30 messages per second, so we batch in chunks of 30
        const BATCH_SIZE = 30;
        const BATCH_DELAY_MS = 500; // 0.5 second between batches for faster sending
        
        for (let i = 0; i < dedupedUsers.length; i++) {
          const user = dedupedUsers[i];
          
          // Skip if no telegram ID (already filtered, but TypeScript needs this)
          if (!user.telegramId) {
            skippedCount++;
            continue;
          }
          
          // Skip admin to avoid self-messaging
          if (user.telegramId === chatId) {
            skippedCount++;
            continue;
          }
          
          try {
            const sent = await sendUserTelegramNotification(
              user.telegramId, 
              broadcastMessage, 
              broadcastButtons
            );
            if (sent) {
              successCount++;
            } else {
              failCount++;
            }
            
            // Apply batch delay every BATCH_SIZE messages
            if ((i + 1) % BATCH_SIZE === 0 && i < dedupedUsers.length - 1) {
              console.log(`📦 Batch ${Math.floor((i + 1) / BATCH_SIZE)} sent, pausing for rate limit...`);
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            } else {
              // Small delay between individual messages within a batch - faster
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          } catch (error) {
            console.error(`Failed to send to ${user.telegramId}:`, error);
            failCount++;
          }
        }
        
        // Send detailed summary to admin
        console.log(`📢 [BROADCAST COMPLETE] Success: ${successCount}, Failed: ${failCount}, Skipped: ${skippedCount}`);
        await sendUserTelegramNotification(chatId, 
          `✅ <b>Broadcast sent successfully to ${successCount} users.</b>\n\n` +
          `📊 <b>Statistics:</b>\n` +
          `✅ Successfully sent: ${successCount}\n` +
          `❌ Failed/Inactive: ${failCount}\n` +
          `⚙️ Skipped: ${skippedCount} (admin)\n` +
          `📈 Total unique users: ${dedupedUsers.length}`
        );
      } catch (error) {
        console.error('❌ [BROADCAST ERROR]:', error);
        await sendUserTelegramNotification(chatId, 
          '❌ Error broadcasting message. Please try again.'
        );
      }
      
      // State already cleared at the start to prevent duplicates
      return true;
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
      if (referralCode && referralCode !== chatId) {
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
                    AND r.status IN ('pending', 'completed')
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
 * Generate a unique promo code for an ambassador (prefix + random suffix).
 * Returns the created code string.
 */
export async function generateUniqueAmbassadorCode(prefix: string): Promise<string> {
  const { db: dbConn } = await import('./db');
  const { promoCodes } = await import('../shared/schema');
  const { eq } = await import('drizzle-orm');

  let attempts = 0;
  while (attempts < 20) {
    const candidate = `${prefix.toUpperCase()}${randomSuffix()}`;
    const [existing] = await dbConn.select({ id: promoCodes.id }).from(promoCodes)
      .where(eq(promoCodes.code, candidate)).limit(1);
    if (!existing) return candidate;
    attempts++;
  }
  // Fallback: longer suffix
  return `${prefix.toUpperCase()}${randomSuffix(6)}`;
}

/**
 * Create the promo code in DB and post to channel + DM ambassador.
 * Returns the generated code string.
 */
export async function sendAmbassadorPromo(ambId: string): Promise<string | null> {
  const { db: dbConn } = await import('./db');
  const { ambassadors, promoCodes, adminSettings } = await import('../shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { storage: stor } = await import('./storage');

  const [amb] = await dbConn.select().from(ambassadors).where(eq(ambassadors.id, ambId)).limit(1);
  if (!amb || amb.status !== 'active') return null;

  // Check program enabled
  const [programSetting] = await dbConn.select({ v: adminSettings.settingValue })
    .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_program_enabled')).limit(1);
  if (programSetting?.v === 'false') return null;

  const [rewardSetting] = await dbConn.select({ v: adminSettings.settingValue })
    .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_promo_reward')).limit(1);
  const rewardAmount = rewardSetting?.v || '10000';

  const prefix = (amb.promoPrefix || amb.promoCodeName).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const uniqueCode = await generateUniqueAmbassadorCode(prefix);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Create new promo code
  await dbConn.insert(promoCodes).values({
    code: uniqueCode,
    rewardAmount,
    rewardType: 'PAD',
    usageLimit: null,
    perUserLimit: 1,
    isActive: true,
    expiresAt,
  });

  // Fixed 4-hour interval between posts
  const intervalMs = 4 * 60 * 60 * 1000;
  const nextPromoAt = new Date(Date.now() + intervalMs);

  // Update ambassador record
  await dbConn.update(ambassadors).set({
    lastPromoSentAt: new Date(),
    nextPromoAt,
    updatedAt: new Date(),
  }).where(eq(ambassadors.id, amb.id));

  // Get ambassador user info
  const user = await stor.getUser(amb.userId);
  const referralLink = user?.referralCode
    ? `https://t.me/${process.env.BOT_USERNAME || 'PaidAdzbot'}?start=${user.referralCode}`
    : `https://t.me/${process.env.BOT_USERNAME || 'PaidAdzbot'}`;

  const postText =
    `🎉 <b>Paid Adz Giveaway</b>\n\n` +
    `⚡ All Withdrawals are Instantly Paid Out\n\n` +
    `👤 Only for the First 100 Active Users\n\n` +
    `🤩 Promo Code: <code>${uniqueCode}</code>\n\n` +
    `👀 Open Paid Adz & Claim Now!`;

  const inlineKeyboard = {
    inline_keyboard: [[
      { text: '🚀 Claim Now', url: referralLink },
    ]],
  };

  // Post to channel if verified
  if (amb.channelVerified && amb.channelId) {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: amb.channelId,
            text: postText,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard,
          }),
        });
      }
    } catch (err) {
      console.error(`Failed to post to channel for ambassador ${amb.id}:`, err);
    }
  }

  // DM the ambassador
  if (user?.telegram_id) {
    await sendTelegramMessage(user.telegram_id,
      `🎯 <b>Your Promo Post is Live!</b>\n\n` +
      `📛 Code: <code>${uniqueCode}</code>\n` +
      `⏰ Expires in 24 hours\n\n` +
      `${amb.channelVerified && amb.channelId ? '✅ Posted to your channel\n' : '📤 Share with your followers:\n\n' + postText + '\n\n'}` +
      `You earn <b>$0.0001</b> for every successful claim. 🚀`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  console.log(`✅ Ambassador promo sent: ${uniqueCode} for user ${amb.userId}`);
  return uniqueCode;
}

export async function runAmbassadorDailyPromos(): Promise<void> {
  try {
    const { db: dbConn } = await import('./db');
    const { ambassadors, adminSettings } = await import('../shared/schema');
    const { eq } = await import('drizzle-orm');

    // Check if program is enabled
    const [programSetting] = await dbConn.select({ v: adminSettings.settingValue })
      .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_program_enabled')).limit(1);
    if (programSetting?.v === 'false') return;

    const now = new Date();
    // Find all active ambassadors, then filter by nextPromoAt in JS
    const dueAmbassadors = await dbConn.select({ id: ambassadors.id }).from(ambassadors)
      .where(eq(ambassadors.status, 'active'));

    for (const amb of dueAmbassadors) {
      try {
        const [full] = await dbConn.select().from(ambassadors).where(eq(ambassadors.id, amb.id)).limit(1);
        if (!full) continue;

        // Check if nextPromoAt is due
        const due = !full.nextPromoAt || new Date(full.nextPromoAt) <= now;
        if (!due) continue;

        await sendAmbassadorPromo(full.id);
      } catch (err) {
        console.error(`Failed to process ambassador ${amb.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Ambassador promo scheduler error:', err);
  }
}

// Start ambassador promo scheduler — runs every 15 minutes
export function startAmbassadorScheduler(): void {
  // Run after 15 minutes of approval delay on server start
  setTimeout(() => runAmbassadorDailyPromos().catch(console.error), 15 * 60 * 1000);

  // Then run every 15 minutes
  setInterval(() => runAmbassadorDailyPromos().catch(console.error), 15 * 60 * 1000);
  console.log('🎖️ Ambassador promo scheduler started (15-min interval)');
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
