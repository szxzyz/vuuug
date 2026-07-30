-- Periodic Turnstile counter for ad watching.
-- adsTurnstileCount:     number of successful ad claims since last Turnstile challenge.
-- adsTurnstileThreshold: random target (5–10) before the next challenge is required.
-- Both are backend-authoritative — clients cannot reset them via refresh.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ads_turnstile_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ads_turnstile_threshold integer NOT NULL DEFAULT 0;
