---
name: Advertiser Task System
description: Architecture decisions for bot/channel advertiser tasks — pricing, verification, penalties, auth patterns
---

## Pricing packages (hard-coded in CreatePanel.tsx)
Without Verification: 100→0.15, 500→0.75, 1k→1.50, 2k→3.00, 5k→7.50, 10k→15.00 TON
With Verification:    100→0.20, 500→1.00, 1k→2.00, 2k→4.00, 5k→10.00, 10k→20.00 TON

**Why:** replaced free-form click count + per-click rate; the fixed tiers are also what should be validated on the backend (current backend reads from admin settings — update that if strict validation is needed).

## Link field semantics
- Bot without verification: `https://t.me/BotName` (converted from @username in CreatePanel)
- Bot with verification: full `https://t.me/BotName?start=CODE` (user supplies verbatim)
- Channel (any type): full `https://t.me/ChannelName` (user supplies full URL)
All stored in `advertiserTasks.link` — no separate columns.

**How to apply:** when reading `task.link` in AdvertiserTaskSheet, `openLink()` handles all these formats.

## Verification flows
- Bot without verification: instant claim after user taps "Open Bot" (no countdown)
- Bot with verification: 3-step flow; paste referral link back; local link format check
- Channel without verification: instant claim after user taps "Open Channel"
- Channel with verification: backend verifyChannelMembership call → auto-claim on success

## 7-day penalty enforcement
- Backend: `/api/tasks/check-channel-penalties` (POST, authenticateTelegram) — called silently on Missions mount
- Deducts 50,000 POW and removes taskClick record so user can re-join
- Uses `taskClicks.clickedAt` (not `claimedAt`) for the 7-day window

## Auth pattern for task endpoints
All `/api/tasks/*` endpoints must use `authenticateTelegram` middleware. Both new endpoints use it.
Do NOT omit middleware even for endpoints that do internal user-presence checks — defense in depth.

## Bot username
Canonical bot username: `@Paid_Adzbot` (note underscore between Paid and Adzbot).
Fallback in client botUsername state: `'Paid_Adzbot'`.

## Channel ID parsing in verify-channel-membership
- Extracts `@segment` from `t.me/<segment>` URLs
- Rejects private invite links (`+hash` or `joinchat` segments) with a 400 error
- Validates username with regex `/^@[A-Za-z][A-Za-z0-9_]{2,31}$/`
