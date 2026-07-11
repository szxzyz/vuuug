---
name: TON price system
description: How POW↔TON conversions work; where live price is fetched and used
---

**Fixed constant:** 10,000,000 POW = $1 USD (`POW_PER_USD` in both `server/tonPriceService.ts` and `client/src/lib/tonPriceService.ts`).

**Dynamic rate:** 1 TON = liveTonUsdPrice USD → powPerTon = POW_PER_USD × liveTonUsdPrice

**Server service (`server/tonPriceService.ts`):**
- `getLiveTonPriceUSD()` — tries CoinGecko → Binance → OKX in order; 60-second cache; stale-value fallback
- `convertPowToTon(pow, tonUsd)` — canonical formula: pow / (POW_PER_USD × tonUsd)
- Exposed via `GET /api/ton-price` → `{ price, source, cached, fetchedAt, powPerUsd, powPerTon }`

**Client service (`client/src/lib/tonPriceService.ts`):**
- Fetches from `/api/ton-price` (not CoinGecko directly); 30-second local cache
- `calculateConversions(tonPriceUSD)` now uses correct `POW_PER_USD = 10_000_000` (was wrongly 10_000)

**Swap endpoints (server/routes.ts):**
- `/api/convert-to-usd` (TON branch): calls `getLiveTonPriceUSD()` + `convertPowToTon()` — no more admin setting
- `/api/convert-to-ton`: same fix

**SwapSheet.tsx:**
- Live rate panel always shown: "1 TON = $X.XXXX | 1 USD = 10,000,000 POW | 1 TON = XX,XXX,XXX POW"
- Refreshes every 60s while sheet is open
- `receiveTON = balancePAD / (POW_PER_USD × tonPrice)` — matches server formula exactly

**Why:** `pad_to_ton_rate` admin setting was a fixed 10M (hardcoded), so 1 TON was always worth $1 regardless of market. The admin setting is now dead for conversions (not removed in case other code reads it, but never used for math).
