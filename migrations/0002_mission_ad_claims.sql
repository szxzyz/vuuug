-- Adds per-user/platform/day claim counters for mission-ad rewards.
-- Fixes an exploit where POST /api/missions/ads/watch had no server-side
-- rate limit, letting a single account mint unlimited POW.
CREATE TABLE IF NOT EXISTS "mission_ad_claims" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"platform" varchar NOT NULL,
	"reset_date" varchar NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "mission_ad_claims_user_platform_date_unique" UNIQUE("user_id","platform","reset_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mission_ad_claims" ADD CONSTRAINT "mission_ad_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
