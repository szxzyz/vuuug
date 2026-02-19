// Telegram Bot API integration for sending notifications
import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';
import { db } from './db';
import { earnings } from '../shared/schema';
import { eq, sql, and } from 'drizzle-orm';

const isAdmin = (telegramId: string): boolean => {
  const adminId = process.env.TELEGRAM_ADMIN_ID;
  return adminId === telegramId;
};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// State management for admin rejection flow
const pendingRejections = new Map<string, {
  withdrawalId: string;
  messageId: number;
  timestamp: number;
}>();

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

export async function verifyChannelMembership(userId: number, channelIdOrUsername: string, botToken: string): Promise<boolean> {
  try {
    const bot = new TelegramBot(botToken);
    
    // Support both numeric channel IDs (e.g., -1001234567890) and @username formats
    let channelIdentifier = channelIdOrUsername;
    
    // Normalize channel identifier
    if (channelIdentifier.startsWith('@')) {
      // Already in @username format, use as-is
    } else if (channelIdentifier.startsWith('-100')) {
      // Numeric channel ID format, use as-is
    } else if (!channelIdentifier.startsWith('@') && !channelIdentifier.startsWith('-')) {
      // Plain username without @, add it
      channelIdentifier = `@${channelIdentifier}`;
    }
    
    console.log(`🔍 Checking membership for user ${userId} in channel ${channelIdentifier}...`);
    
    // First, verify bot has admin access to the channel
    try {
      const botInfo = await bot.getMe();
      const botMember = await bot.getChatMember(channelIdentifier, botInfo.id);
      
      if (!['creator', 'administrator'].includes(botMember.status)) {
        console.error(`❌ CRITICAL: Bot @${botInfo.username} is NOT an admin in ${channelIdentifier}!`);
        console.error(`   Current bot status: ${botMember.status}`);
        console.error(`   ⚠️ Please make the bot an ADMINISTRATOR in the channel to enable membership verification.`);
        return false;
      }
      
      console.log(`✅ Bot @${botInfo.username} has admin access to ${channelIdentifier}`);
    } catch (botCheckError: any) {
      console.error(`❌ Could not verify bot permissions in ${channelIdentifier}:`, botCheckError?.message);
      console.error(`   Make sure the bot is added as an ADMINISTRATOR to the channel.`);
      return false;
    }
    
    // Now check user membership with retry logic
    let lastError: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const member = await bot.getChatMember(channelIdentifier, userId);
        
        // Valid membership statuses: 'creator', 'administrator', 'member'
        // Invalid statuses: 'left', 'kicked', 'restricted'
        const validStatuses = ['creator', 'administrator', 'member'];
        const isValid = validStatuses.includes(member.status);
        
        console.log(`🔍 User ${userId} status in ${channelIdentifier}: ${member.status} (valid: ${isValid})`);
        return isValid;
      } catch (retryError: any) {
        lastError = retryError;
        if (attempt < 2) {
          console.log(`⚠️ Attempt ${attempt} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    throw lastError;
    
  } catch (error: any) {
    console.error(`❌ Telegram verification error for user ${userId} in ${channelIdOrUsername}:`, error?.message || error);
    
    // Handle common Telegram API errors gracefully with specific guidance
    if (error?.code === 'ETELEGRAM') {
      const errorCode = error.response?.body?.error_code;
      const errorDescription = error.response?.body?.description;
      
      if (errorCode === 400) {
        if (errorDescription?.includes('PARTICIPANT_ID_INVALID')) {
          console.log(`⚠️ User ${userId} has never interacted with the channel ${channelIdOrUsername}`);
          console.log(`   This is normal for new users - they need to join the channel first.`);
        } else if (errorDescription?.includes('CHAT_ADMIN_REQUIRED')) {
          console.error(`❌ Bot needs ADMIN privileges in ${channelIdOrUsername} to check membership!`);
        } else {
          console.log(`⚠️ Channel not found or user not accessible: ${channelIdOrUsername}`);
          console.log(`   Error: ${errorDescription}`);
        }
        return false;
      }
      
      if (errorCode === 403) {
        console.error(`❌ Bot doesn't have access to channel: ${channelIdOrUsername}`);
        console.error(`   Please add the bot as an ADMINISTRATOR to the channel.`);
        return false;
      }
      
      if (errorCode === 401) {
        console.error(`❌ Invalid bot token or bot was blocked`);
        return false;
      }
    }
    
    // Default to false for any verification errors
    console.error(`   Use numeric channel ID (e.g., -1001234567890) for more reliable verification.`);
    return false;
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

export async function sendWithdrawalApprovedNotification(withdrawal: any): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ Telegram bot token not configured for withdrawal approval notification');
    return false;
  }

  try {
    const WITHDRAWAL_CHANNEL_ID = '-1002480439556';
    const user = await storage.getUser(withdrawal.userId);
    
    const withdrawalDetails = withdrawal.details as any;
    const netAmount = parseFloat(withdrawalDetails?.netAmount || withdrawal.amount);
    const walletAddress = withdrawalDetails?.paymentDetails || withdrawalDetails?.walletAddress || 'N/A';
    
    const userName = user?.firstName || user?.username || 'Unknown';
    const userTelegramId = user?.telegram_id || '';
    const userTelegramUsername = user?.username ? `@${user.username}` : 'N/A';
    const currentDate = new Date().toUTCString();

    const groupMessage = `✅ <b>Withdrawal Approved</b>

🗣 User: <a href="tg://user?id=${userTelegramId}">${escapeHtml(userName)}</a>
🆔 User ID: <code>${userTelegramId}</code>
💳 Username: ${userTelegramUsername}
💰 Wallet: <code>${walletAddress}</code>
💸 Amount: <b>${netAmount.toFixed(2)} USD</b>
📅 Date: ${currentDate}
🤖 Bot: @MoneyAdzbot`;

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: WITHDRAWAL_CHANNEL_ID,
        text: groupMessage,
        parse_mode: 'HTML'
      })
    });

    if (response.ok) {
      console.log('✅ Group notification for withdrawal approval sent successfully');
      return true;
    } else {
      const errorData = await response.text();
      console.error('❌ Failed to send group notification for withdrawal approval:', errorData);
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending withdrawal approval group notification:', error);
    return false;
  }
}

export async function sendWithdrawalRejectedNotification(withdrawal: any, reason: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;
  
  try {
    const WITHDRAWAL_CHANNEL_ID = '-1002480439556';
    const user = await storage.getUser(withdrawal.userId);
    const userTelegramId = user?.telegram_id || '';
    const userName = user?.firstName || user?.username || 'Unknown';
    
    const message = `❌ <b>Withdrawal Rejected</b>

🗣 User: <a href="tg://user?id=${userTelegramId}">${escapeHtml(userName)}</a>
🆔 User ID: <code>${userTelegramId}</code>
💸 Amount: <b>${parseFloat(withdrawal.amount).toFixed(2)} USD</b>
⚠️ Reason: ${escapeHtml(reason)}
📅 Date: ${new Date().toUTCString()}
🤖 Bot: @MoneyAdzbot`;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: WITHDRAWAL_CHANNEL_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    return true;
  } catch (error) {
    console.error('Error sending rejection notification:', error);
    return false;
  }
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

export async function formatWelcomeMessage(userId: string): Promise<{ message: string; inlineKeyboard: any }> {
  const botUsername = process.env.VITE_BOT_USERNAME || process.env.BOT_USERNAME || 'MoneyAdzbot';
  const channelUrl = 'https://t.me/MoneyAdz';
  
  const user = await storage.getUserByTelegramId(userId);
  const name = user?.firstName || 'User';
  
  const message = `👋 Hey ${name}!

Welcome to MONEY ADZ — where every click turns into rewards.

👇Tap below to open the app.`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: "🚀 Open App",
          url: `https://t.me/${botUsername}/MyWAdz`
        }
      ],
      [
        {
          text: "📢 Official Channel",
          url: channelUrl
        }
      ]
    ]
  };

  return { message, inlineKeyboard };
}

export async function sendWelcomeMessage(userId: string): Promise<boolean> {
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

  const { message, inlineKeyboard } = await formatWelcomeMessage(userId);
  const domain = process.env.REPLIT_DOMAIN || (process.env.REPL_SLUG ? `${process.env.REPL_SLUG}.replit.app` : null);
  const imageUrl = domain ? `https://${domain}/images/welcome-image.jpg` : null;
  
  try {
    if (imageUrl) {
      const payload = {
        chat_id: userId,
        photo: imageUrl,
        caption: message,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      };

      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) return true;
    }
    
    // Fallback to text if photo fails or imageUrl is null
    return await sendUserTelegramNotification(userId, message, inlineKeyboard);
  } catch (error) {
    return await sendUserTelegramNotification(userId, message, inlineKeyboard);
  }
}

// Admin broadcast functionality
export async function sendBroadcastMessage(message: string, adminTelegramId: string): Promise<{ success: number; failed: number }> {
  if (!isAdmin(adminTelegramId)) {
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
    const botUsername = process.env.VITE_BOT_USERNAME || process.env.BOT_USERNAME || 'MoneyAdzbot';
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
          const banMessage = `Your account has been banned for violating our multi-account policy.\n\nReason: Self-referral attempt detected.\n\nPlease contact support if you believe this is a mistake.`;
          const replyMarkup = {
            inline_keyboard: [
              [{ text: "Contact support", url: "https://t.me/szxzyz" }]
            ]
          };
          await sendUserTelegramNotification(chatId, banMessage, replyMarkup);
          return true;
        }

        // Handle /start command
        if (text.startsWith('/start')) {
          await sendWelcomeMessage(telegramId);
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
            const botUsername = process.env.VITE_BOT_USERNAME || 'PaidAdzbot';
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
      
      if (data === 'refresh_stats' && isAdmin(chatId)) {
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
      if (data === 'admin_refresh' && isAdmin(chatId)) {
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
      if (data === 'admin_advertise' && isAdmin(chatId)) {
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
      if (data && (data === 'admin_pending_withdrawals' || data.startsWith('admin_pending_withdrawals_page_')) && isAdmin(chatId)) {
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
      if (data === 'admin_announce' && isAdmin(chatId)) {
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
      if (data === 'cancel_broadcast' && isAdmin(chatId)) {
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
        
        if (!isAdmin(chatId)) {
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
            
            const adminSuccessMessage = `✅ Withdrawal Successful

🗣 User: <a href="tg://user?id=${userTelegramId}">${userName}</a>
🆔 User ID: ${userTelegramId}
💳 Username: ${userTelegramUsername}
🌐 Address:
${walletAddress}
💸 Amount: ${netAmount.toFixed(5)} USD
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${currentDate}
🤖 Bot: @MoneyAdzbot`;
            
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
            
            if (userTelegramId) {
              // User confirmation message with Amount (net after fee) and Fee with percentage
              const userConfirmationMessage = `🚀 Your payout has been successfully processed.

💵 Amount: ${netAmount.toFixed(3)} USD
🛂 Fee: ${feeAmount.toFixed(3)} (${feePercent}%)`;
              
              // Always show "Share in Group" button instead of transaction button
              const shareInGroupButton = {
                inline_keyboard: [[
                  { text: '📢 Share in Group', url: 'https://t.me/szxzyz' }
                ]]
              };
              
              await sendUserTelegramNotification(userTelegramId, userConfirmationMessage, shareInGroupButton);
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
        
        if (!isAdmin(chatId)) {
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
    if (isAdmin(chatId) && pendingRejections.has(chatId)) {
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
    if (isAdmin(chatId) && pendingBroadcasts.delete(chatId)) {
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
        
        // Get app URL from environment variables
        const appUrl = process.env.RENDER_EXTERNAL_URL || 
                      (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : 'https://vuuug.onrender.com');
        
        // Create inline buttons for broadcast message - webapp link only
        const broadcastButtons = {
          inline_keyboard: [
            [
              {
                text: "🚀 Open App",
                web_app: { url: appUrl }
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
    if (isAdmin(chatId) && pendingBroadcasts.delete(`advertise_${chatId}`)) {
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
      if (!isAdmin(chatId)) {
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
    
    // Handle /start command with referral processing and promotion claims
    if (text.startsWith('/start')) {
      console.log('🚀 Processing /start command...');
      // Extract parameter if present (e.g., /start REF123 or /start claim_promotionId)
      const parameter = text.split(' ')[1];
      
      // Handle promotion task claim (DISABLED - no promotion system)
      if (parameter && parameter.startsWith('task_')) {
        console.log('⚠️ Promotion system disabled');
        return true;
      }
      
      // Extract referral code if present (e.g., /start REF123)
      const referralCode = parameter;
      
      // CRITICAL FIX: Process referral for BOTH new users AND existing users without a referrer
      // This fixes the bug where users who visited before and then clicked a referral link weren't tracked
      if (referralCode && referralCode !== chatId) {
        console.log(`🔄 Processing referral: referralCode=${referralCode}, user=${chatId}, isNewUser=${isNewUser}`);
        try {
          // Find the referrer by referral_code (NOT telegram_id or user_id)
          const referrer = await storage.getUserByReferralCode(referralCode);
          
          if (referrer) {
            console.log(`👤 Found referrer: ${referrer.id} (${referrer.firstName || 'No name'}) via referral code: ${referralCode}`);
            console.log(`🔍 Referrer details: ID=${referrer.id}, TelegramID=${referrer.telegram_id}, RefCode=${referrer.referralCode}`);
            console.log(`🔍 New user details: ID=${dbUser.id}, TelegramID=${dbUser.telegram_id}, RefCode=${dbUser.referralCode}`);
            
            // Verify both users have valid IDs before creating referral
            if (!referrer.id || !dbUser.id) {
              console.error(`❌ Invalid user IDs: referrer.id=${referrer.id}, dbUser.id=${dbUser.id}`);
              throw new Error('Invalid user IDs for referral creation');
            }
            
            // Prevent self-referral by comparing user IDs
            if (referrer.id === dbUser.id) {
              console.log(`⚠️  Self-referral prevented: referrer.id=${referrer.id} === dbUser.id=${dbUser.id}`);
            } else {
              const { detectSelfReferral, banUserForMultipleAccounts, sendWarningToMainAccount } = await import('./deviceTracking');
              const selfReferralCheck = await detectSelfReferral(dbUser.id, referralCode);
              
              if (selfReferralCheck.isSelfReferral && selfReferralCheck.shouldBan) {
                console.log(`⚠️ Device-based self-referral detected! User ${dbUser.id} tried to refer themselves using device matching.`);
                
                await banUserForMultipleAccounts(
                  dbUser.id,
                  "Self-referral attempt detected - multiple accounts on same device"
                );
                
                if (selfReferralCheck.referrerId) {
                  await sendWarningToMainAccount(selfReferralCheck.referrerId);
                }
                
                // Ban message with inline button for support (no text links)
                const banMessage = `Your account has been banned for violating our multi-account policy.

Reason: Self-referral attempt detected.

Please contact support if you believe this is a mistake.`;
                
                const supportButton = {
                  inline_keyboard: [[
                    { text: '👉🏻 Contact Support', url: 'https://t.me/szxzyz' }
                  ]]
                };
                
                await sendUserTelegramNotification(chatId, banMessage, supportButton, 'HTML');
                
                return true;
              }
              
              // CANONICAL CHECK: Use referrals table as source of truth to check if referral exists
              const existingReferral = await storage.getReferralByUsers(referrer.id, dbUser.id);
              
              if (existingReferral) {
                console.log(`ℹ️ Referral already exists in referrals table: ${referrer.id} -> ${dbUser.id}`);
              } else {
                console.log(`💾 Creating referral relationship: ${referrer.id} -> ${dbUser.id}`);
                const createdReferral = await storage.createReferral(referrer.id, dbUser.id);
                console.log(`✅ Referral created successfully in database:`, {
                  referralId: createdReferral.id,
                  referrerId: createdReferral.referrerId,
                  refereeId: createdReferral.refereeId,
                  status: createdReferral.status,
                  rewardAmount: createdReferral.rewardAmount
                });
              }
            }
          } else {
            console.log(`❌ Invalid referral code: ${referralCode} - no user found with this referral code`);
          }
        } catch (error) {
          console.error('❌ Referral processing failed:', error);
          console.error('Error details:', {
            referralCode: referralCode,
            newUserTelegramId: chatId,
            newUserDbId: dbUser.id,
            newUserRefCode: dbUser.referralCode,
            isNewUser,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
          });
        }
      } else {
        if (!referralCode) {
          console.log(`ℹ️  No referral code provided in /start command`);
        }
        if (referralCode === chatId) {
          console.log(`⚠️  Self-referral attempted: ${chatId}`);
        }
      }

      // Send welcome message to user
      console.log('📤 Sending welcome message to:', chatId);
      const welcomeSent = await sendWelcomeMessage(chatId);
      console.log('📧 Welcome message sent successfully:', welcomeSent);
      return true;
    }

    // All keyboard navigation removed - bot uses inline buttons only for withdrawal management

    // Admin command to list pending withdrawal requests
    if (text === '/payouts' || text === '/withdrawals') {
      if (!isAdmin(chatId)) {
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

    // All other messages ignored - bot only responds to /start and callback queries
    console.log('ℹ️ Message ignored (bot uses inline buttons only):', text);
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
