import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { POW_TO_USD, powToUSD } from "@shared/constants"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Round a balance to a clean, user-friendly value for display.
 * Internal precision is preserved; only the displayed value is simplified.
 * Examples: 19371 → 19000, 467191 → 467000, 18739101 → 18740000
 */
export function roundBalanceForDisplay(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1_000_000) return Math.round(n / 10_000) * 10_000;
  if (n >= 10_000)    return Math.round(n / 1_000)  * 1_000;
  if (n >= 1_000)     return Math.round(n / 100)    * 100;
  if (n >= 100)       return Math.round(n / 10)     * 10;
  return Math.round(n);
}

/**
 * Format currency values - displays PAD amount in pure numeric format
 * No TON-style formatting - PAD is always an integer value
 * Values are rounded to clean display numbers (e.g. 19371 → 19,000)
 * Examples: 1000 → "1,000 POW", 500000 → "500,000 POW"
 */
export function formatCurrency(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue) || !isFinite(numValue)) {
    return includeSymbol ? '0 POW' : '0';
  }
  
  const powValue = roundBalanceForDisplay(Math.round(numValue));
  
  const symbol = includeSymbol ? ' POW' : '';
  return `${powValue.toLocaleString()}${symbol}`;
}

/**
 * Format large PAD numbers with compact notation (K, M, B, T)
 * Handles overflow and prevents NaN/Infinity display
 * Examples: 1000 → "1K", 1000000 → "1M", 1000000000 → "1B"
 */
export function formatLargePAD(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue) || !isFinite(numValue)) {
    return includeSymbol ? '0 POW' : '0';
  }
  
  const absValue = Math.abs(numValue);
  const symbol = includeSymbol ? ' POW' : '';
  const sign = numValue < 0 ? '-' : '';
  
  if (absValue >= 1000000000000) {
    return `${sign}${(absValue / 1000000000000).toFixed(1)}T${symbol}`;
  }
  if (absValue >= 1000000000) {
    return `${sign}${(absValue / 1000000000).toFixed(1)}B${symbol}`;
  }
  if (absValue >= 1000000) {
    return `${sign}${(absValue / 1000000).toFixed(1)}M${symbol}`;
  }
  if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(1)}K${symbol}`;
  }
  
  return `${sign}${Math.round(absValue).toLocaleString()}${symbol}`;
}

/**
 * Format task rewards - displays PAD amount in pure numeric format
 * No TON-style formatting - PAD is always an integer value
 * Examples: 1000 → "1,000 PAD", 500 → "500 PAD"
 */
export function formatTaskReward(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue) || !isFinite(numValue)) {
    return includeSymbol ? '0 POW' : '0';
  }
  
  const powValue = Math.round(numValue);
  
  const symbol = includeSymbol ? ' POW' : '';
  return `${powValue.toLocaleString()}${symbol}`;
}

/**
 * Convert PAD to USD
 * 100,000 PAD = $1.00
 */
export function formatPADtoUSD(powAmount: number | string): string {
  const usd = powToUSD(powAmount);
  return usd.toFixed(2);
}

/**
 * Format TON values without converting to PAD
 * For admin panel and withdrawal displays
 * Examples: 0.0003 → "0.0003 TON", 1.5 → "1.5 TON"
 */
export function formatTON(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue)) {
    return includeSymbol ? '0 TON' : '0';
  }
  
  const symbol = includeSymbol ? ' TON' : '';
  return `${numValue.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}${symbol}`;
}

/**
 * Shorten wallet address for display
 * Examples: 
 * - UQCW9LwFkPRsL...PvJ (TON addresses)
 * - 0x1234...5678 (USDT addresses)
 */
export function shortenAddress(address: string, startChars: number = 13, endChars: number = 3): string {
  if (!address || typeof address !== 'string') {
    return '';
  }
  if (address.length <= startChars + endChars) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Canonicalize Telegram username - strips all leading @ symbols and whitespace
 * Returns clean username for storage and API submission
 * Examples: "@@username" -> "username", "@user" -> "user", "user" -> "user"
 */
export function canonicalizeTelegramUsername(value: string): string {
  return value?.trim().replace(/^@+/, '').replace(/\s+/g, '') ?? '';
}

/**
 * Format Telegram username for display - adds single @ prefix
 * Examples: "username" -> "@username", "" -> ""
 */
export function formatTelegramUsername(value: string): string {
  return value ? `@${value}` : '';
}
