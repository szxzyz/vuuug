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
