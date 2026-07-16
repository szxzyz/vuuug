/**
 * SERVER-SIDE TON price service.
 *
 * Aggregates live TON/USD price from CoinGecko → Binance → OKX with a
 * 60-second server-side cache to avoid hammering external APIs.
 *
 * Exports used by routes.ts:
 *   getLiveTonPriceUSD() → { price, source }
 *   convertPowToTon(powAmount, tonUsdPrice) → tonAmount
 *   powPerTon(tonUsdPrice) → number of POW per 1 TON
 *
 * Fixed constants:
 *   10,000,000 POW = $1 USD  (POW_PER_USD)
 *   POW/TON = POW_PER_USD × liveTonUsdPrice  (dynamic)
 */

export const POW_PER_USD = 10_000_000; // 10M POW = $1 USD — the only fixed rate

interface PriceResult {
  price: number;
  source: string;
  fetchedAt: number;
}

let priceCache: PriceResult | null = null;
const CACHE_MS = 60_000; // 60-second server-side cache

/** Fetch TON/USD from CoinGecko. */
async function fetchCoinGecko(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data: any = await res.json();
  const price = data?.['the-open-network']?.usd;
  if (typeof price !== 'number' || price <= 0) throw new Error('CoinGecko: invalid price');
  return price;
}

/** Fetch TON/USD from Binance (TONUSDT ticker). */
async function fetchBinance(): Promise<number> {
  const res = await fetch(
    'https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const data: any = await res.json();
  const price = parseFloat(data?.price);
  if (!isFinite(price) || price <= 0) throw new Error('Binance: invalid price');
  return price;
}

/** Fetch TON/USD from OKX (TON-USDT ticker). */
async function fetchOKX(): Promise<number> {
  const res = await fetch(
    'https://www.okx.com/api/v5/market/ticker?instId=TON-USDT',
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`OKX ${res.status}`);
  const data: any = await res.json();
  const price = parseFloat(data?.data?.[0]?.last);
  if (!isFinite(price) || price <= 0) throw new Error('OKX: invalid price');
  return price;
}

/**
 * Returns live TON/USD price, aggregating from multiple exchanges.
 * Falls back through CoinGecko → Binance → OKX → stale cache → 5.5 default.
 */
export async function getLiveTonPriceUSD(): Promise<PriceResult> {
  const now = Date.now();

  // Serve cache if still fresh
  if (priceCache && now - priceCache.fetchedAt < CACHE_MS) {
    return priceCache;
  }

  const sources: Array<{ name: string; fn: () => Promise<number> }> = [
    { name: 'CoinGecko', fn: fetchCoinGecko },
    { name: 'Binance',   fn: fetchBinance },
    { name: 'OKX',       fn: fetchOKX },
  ];

  for (const source of sources) {
    try {
      const price = await source.fn();
      priceCache = { price, source: source.name, fetchedAt: now };
      return priceCache;
    } catch (err) {
      console.warn(`[TON price] ${source.name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // All sources failed — use stale cache if available
  if (priceCache) {
    console.warn('[TON price] All sources failed, serving stale cache');
    return { ...priceCache, source: `${priceCache.source} (stale)` };
  }

  // Last-resort default
  console.error('[TON price] All sources failed and no cache — using default 5.5');
  return { price: 5.5, source: 'default', fetchedAt: now };
}

/**
 * Converts a POW amount to TON at the given live price.
 * Formula: TON = POW / (POW_PER_USD × tonUsdPrice)
 */
export function convertPowToTon(powAmount: number, tonUsdPrice: number): number {
  if (tonUsdPrice <= 0) return 0;
  return powAmount / (POW_PER_USD * tonUsdPrice);
}

/**
 * Returns the number of POW equivalent to 1 TON at the given price.
 * Formula: POW/TON = POW_PER_USD × tonUsdPrice
 */
export function powPerTon(tonUsdPrice: number): number {
  return POW_PER_USD * tonUsdPrice;
}
