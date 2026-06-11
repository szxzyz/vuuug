import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency values - converts TON to PAD (multiply by 100000)
 * Examples: 0.00033 → "33 PAD", 0.0002 → "20 PAD"
 */
export function formatCurrency(value: string | number, includeSymbol: boolean = true): string {
  const numValue = parseFloat(typeof value === 'string' ? value : value.toString());
  
  if (isNaN(numValue)) {
    return includeSymbol ? '0 PAD' : '0';
  }
  
  // Convert TON to PAD (multiply by 100000)
  const padValue = Math.round(numValue * 100000);
  
  const symbol = includeSymbol ? ' PAD' : '';
  return `${padValue.toLocaleString()}${symbol}`;
}
