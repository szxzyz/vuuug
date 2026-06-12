export const APP_VERSION = "1.0.0";
export const POW_TO_USD = 10000000; // 10,000,000 POW = $1 USD
export const APP_COLORS = {
  primary: "#4aa8ff", // light blue
  background: "#000000", // pure black
  text: "#d9e6ff", // light white/blue
};

/**
 * Convert POW to USD
 * @param powAmount - Amount in POW
 * @returns Amount in USD (PAD / 10,000,000)
 */
export function powToUSD(powAmount: number | string): number {
  const numValue = typeof powAmount === 'string' ? parseFloat(powAmount) : powAmount;
  return numValue / POW_TO_USD;
}

/**
 * Convert USD to POW
 * @param usdAmount - Amount in USD
 * @returns Amount in POW (USD * 10,000,000)
 */
export function usdToPOW(usdAmount: number | string): number {
  const numValue = typeof usdAmount === 'string' ? parseFloat(usdAmount) : usdAmount;
  return Math.round(numValue * POW_TO_USD);
}

/**
 * Format large numbers into compact format (1k, 1.2M, 1B, 1T)
 * @param num - Number to format
 * @returns Formatted string (e.g., "1.2M", "154k", "24B", "1.5T")
 */
export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000_000_000) {
    return (num / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '') + 'T';
  }
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}
