-- Integrations v2 review fixes: reconciliation rotates through every open order (last_tracked_at), and partner-id lookups use an index.
ALTER TABLE "partner_orders" ADD COLUMN IF NOT EXISTS "last_tracked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_orders_track_idx" ON "partner_orders" ("connection_id", "last_tracked_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_orders_ext_lower_idx" ON "partner_orders" ("connection_id", lower("external_id")) WHERE "external_id" IS NOT NULL;
