---
name: Ambassador scheduler stale guard
description: nextPromoAt stale >2h on restart is rescheduled, not fired, to prevent burst posts
---

`runAmbassadorDailyPromos` in telegram.ts now:
1. Skips ambassadors with `posting_mode = 'manual'`
2. If `nextPromoAt` is null, sets initial schedule via `getNextScheduledTime` and skips
3. If `nextPromoAt` is older than 2 hours (server was down), reschedules to next valid slot instead of firing

**Why:** Without the stale guard, a server restart after being down for hours would immediately fire all ambassadors whose `nextPromoAt` had passed, causing a burst of channel posts at the wrong time.

**How to apply:** The 2h threshold is a balance — if the server is down for <2h, it will catch up on missed posts within 2h of the scheduled time. If >2h, it skips the missed post and waits for the next slot.
