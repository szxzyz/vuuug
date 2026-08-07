-- Idempotency ledger for AdsGram Reward URL callbacks.
CREATE TABLE IF NOT EXISTS adsgram_reward_callbacks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_key varchar NOT NULL UNIQUE,
  user_id varchar NOT NULL REFERENCES users(id),
  session_id varchar REFERENCES ad_sessions(id),
  reward_amount decimal(30, 10) NOT NULL,
  created_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS adsgram_reward_callbacks_session_idx
  ON adsgram_reward_callbacks(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS adsgram_reward_callbacks_user_idx
  ON adsgram_reward_callbacks(user_id);