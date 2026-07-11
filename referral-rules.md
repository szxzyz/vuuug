---
name: Referral activation and withdrawal rules
description: Rules for when a referral counts as "active" and what's required before withdrawal
---

**Referral activation:** A referred user must watch 10 ads (not 1) for the referral to become `status = 'completed'`. Default changed in `storage.ts` `checkAndActivateReferralBonus`: `referral_ads_required` default is `'10'`.

**Withdrawal gating:** Before any withdrawal is processed, the user must have ≥1 referral with `status = 'completed'` in the `referrals` table. This check runs inside the transaction before the invite-count and ad-count checks.

**Why:** The original default of 1 ad made referral activation trivially easy. The withdrawal active-referral requirement ensures users actually bring in engaged users before cashing out.

**How to apply:** If adding new withdrawal checks, insert them in the same transaction block, after the active-referral check.
