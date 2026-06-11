import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { PAD_TO_USD, padToUSD } from "@shared/constants"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency values - displays PAD directly
 * Examples: 3300 → "3,300 PAD", 2000 → "2,000 PAD"
 */
export function formatCurrency(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue)) {
    return includeSymbol ? '0 PAD' : '0';
  }
  
  const symbol = includeSymbol ? ' PAD' : '';
  return `${Math.round(numValue).toLocaleString()}${symbol}`;
}

/**
 * Format task rewards - displays PAD directly
 * Examples: 3300 → "3,300 PAD", 2000 → "2,000 PAD"
 */
export function formatTaskReward(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue)) {
    return includeSymbol ? '0 PAD' : '0';
  }
  
  const symbol = includeSymbol ? ' PAD' : '';
  return `${Math.round(numValue).toLocaleString()}${symbol}`;
}

/**
 * Convert PAD to USD
 * 100,000 PAD = $1.00
 */
export function formatPADtoUSD(padAmount: number | string): string {
  const usd = padToUSD(padAmount);
  return usd.toFixed(2);
}

/**
 * Format USD values for display
 * Examples: 0.35 → "$0.35", 1.5 → "$1.50"
 */
export function formatUSD(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue)) {
    return includeSymbol ? '$0.00' : '0.00';
  }
  
  const formatted = numValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return includeSymbol ? `$${formatted}` : formatted;
}
