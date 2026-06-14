// Application configuration
// Use environment variables for channel settings

export const config = {
  // Telegram channel settings - use numeric ID for more reliable verification
  telegram: {
    // Channel settings (environment variables required)
    channelId: process.env.TELEGRAM_CHANNEL_ID || '-1002307369718',
    channelUrl: process.env.TELEGRAM_CHANNEL_LINK || process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/PaidAdzNews',
    channelName: process.env.TELEGRAM_CHANNEL_NAME || 'PaidAdzNews',
    // Group settings (environment variables required)
    groupId: process.env.TELEGRAM_GROUP_ID || '-1002402950172',
    groupUrl: process.env.TELEGRAM_GROUP_LINK || process.env.TELEGRAM_GROUP_URL || 'https://t.me/PaidAdzChat',
    groupName: process.env.TELEGRAM_GROUP_NAME || 'PaidAdzChat',
  },
  
  // Bot configuration
  bot: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminId: process.env.TELEGRAM_ADMIN_ID || '',
    username: process.env.BOT_USERNAME || 'PaidAdzbot',
    botUrl: process.env.TELEGRAM_BOT_URL || 'https://t.me/PaidAdzbot',
  },
};

// Helper function to get channel config for API responses
export function getChannelConfig() {
  return {
    channelId: config.telegram.channelId,
    channelUrl: config.telegram.channelUrl,
    channelName: config.telegram.channelName,
    groupId: config.telegram.groupId,
    groupUrl: config.telegram.groupUrl,
    groupName: config.telegram.groupName,
    botUsername: config.bot.username,
    botUrl: config.bot.botUrl,
  };
}
