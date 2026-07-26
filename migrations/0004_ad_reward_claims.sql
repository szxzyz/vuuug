-- Ad reward claim persistence and mission-provider daily counters.
-- These tables are also created by server/migrate.ts for deployments that
-- bootstrap schema through the application startup path.
CREATE TABLE IF NOT EXISTS ad_sessions (
  id varchar PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id),
  context varchar NOT NULL,
  ad_type varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'pending',
  background_entered boolean DEFAULT false,
  background_duration_ms integer DEFAULT 0,
  registered_at timestamp DEFAULT now(),
  used_at timestamp
);

CREATE INDEX IF NOT EXISTS ad_sessions_user_idx ON ad_sessions(user_id);
CREATE INDEX IF NOT EXISTS ad_sessions_registered_idx ON ad_sessions(registered_at);

CREATE TABLE IF NOT EXISTS mission_ad_claims (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  platform varchar NOT NULL,
  reset_date varchar NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT now(),
  CONSTRAINT mission_ad_claims_user_platform_date_unique
    UNIQUE (user_id, platform, reset_date)
);

CREATE INDEX IF NOT EXISTS mission_ad_claims_user_idx
  ON mission_ad_claims(user_id);