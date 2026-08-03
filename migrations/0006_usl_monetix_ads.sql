ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "uslads_ads_watched_today" integer DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monetix_ads_watched_today" integer DEFAULT 0;
