---
name: Ambassador posting modes
description: Ambassadors can post automatically (scheduled) or manually (on-demand with 24h rate limit)
---

Three new columns on `ambassadors` table (added in schema + migration):
- `posting_mode` VARCHAR DEFAULT 'automatic' — 'automatic' | 'manual'
- `manual_post_last_at` TIMESTAMP — tracks last manual post for 24h rate limit
- `require_channel_join` BOOLEAN DEFAULT false — if true, users must be channel members to claim promo codes

**Automatic mode:** scheduler fires based on `next_promo_at` + `posting_schedule`. Switching to manual clears `nextPromoAt` so scheduler stops.

**Manual mode:** scheduler skips these ambassadors. POST /api/ambassador/post-now enforces 24h rate limit; records `manual_post_last_at` after a successful post.

**Require channel join:** promo code claim endpoint checks Telegram channel membership via `verifyChannelMembership` before allowing claim. Uses the ambassador's `channel_id` (numeric, set during channel verification).

**How to apply:** When adding new ambassador features, check `posting_mode` and `require_channel_join` before any automated action.
