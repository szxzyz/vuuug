/**
 * Client-side TON price service.
 *
 * Fetches the live TON/USD price from the backend (/api/ton-price) which
 * aggregates CoinGecko → Binance → OKX with a 60-second server-side cache.
 * The client also keeps a 30-second local cache to avoid redundant requests.
 *
 * Fixed constants (must match server/tonPriceService.ts):
 *   10,000,000 POW = $1 USD  (POW_PER_USD)
 *   POW/TON        = POW_PER_USD × liveTonUsdPrice  (dynamic)
 */

export const POW_PER_USD = 10_000_000; // 10M POW = $1 USD — the only fixed rate

interface CachedPrice {
  price: number;
  source: string;
  fetchedAt: number;
}

let clientCache: CachedPrice | null = null;
const CLIENT_CACHE_MS = 30_000; // 30-second local cache

/**
 * Returns live TON/USD price.
 * Fetches from /api/ton-price (server aggregates multiple exchanges + caches).
 * Falls back to local cache, then to a conservative default (5.5) if offline.
 */
export async function getTONPrice(): Promise<number> {
  const now = Date.now();

  // Serve local cache if still fresh
  if (clientCache && now - clientCache.fetchedAt < CLIENT_CACHE_MS) {
    return clientCache.price;
  }

  try {
    const res = await fetch('/api/ton-price', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`/api/ton-price returned ${res.status}`);
    const data: { price: number; source: string; fetchedAt: number } = await res.json();
    if (typeof data.price !== 'number' || data.price <= 0) throw new Error('Invalid price in response');

    clientCache = { price: data.price, source: data.source, fetchedAt: now };
    return data.price;
  } catch (err) {
    console.warn('[TON price client] Fetch failed:', err);

    // Use local cache even if stale
    if (clientCache) return clientCache.price;

    // Last-resort default — will self-correct on next successful fetch
    return 5.5;
  }
}

/**
 * Returns a complete rate snapshot for display purposes.
 * All values are calculated from the live TON/USD price.
 */
export function calculateConversions(tonPriceUSD: number) {
  const powPerTon = POW_PER_USD * tonPriceUSD; // e.g. $3.25 → 32,500,000 POW/TON

  return {
    tonPriceUSD:   Number(tonPriceUSD.toFixed(4)),
    powPerUsd:     POW_PER_USD,
    powPerTon:     Math.round(powPerTon),
    tonPerPow:     Number((1 / powPerTon).toFixed(12)),
    usdPerTon:     Number(tonPriceUSD.toFixed(4)),
    tonPerUsd:     Number((1 / tonPriceUSD).toFixed(8)),
  };
}
