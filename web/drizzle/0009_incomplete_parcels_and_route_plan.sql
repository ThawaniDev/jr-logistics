-- Parcels booked by count only (details to follow) + best-route planning (Google Routes) bookkeeping.
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "details_complete" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "geo_source" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "leg_distance_m" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "leg_duration_s" integer;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "route_plan" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_incomplete_idx" ON "shipments" ("request_id") WHERE "details_complete" = false;
