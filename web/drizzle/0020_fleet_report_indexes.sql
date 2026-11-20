-- Indexes of the fleet reports (drivers + courier offices, decisions I1–I12 in memory/FLEET_REPORTS.md). All partial, so they stay small.
-- Active days read the job arrivals of a period (`offers.arrived_at`); the COD balance of a driver reads only the parcels that collected cash; the parcels still pending read only the open ones.
CREATE INDEX IF NOT EXISTS "offers_arrived_idx" ON "offers" ("arrived_at") WHERE "arrived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_cod_offer_idx" ON "shipments" ("offer_id") WHERE "cod_collected_cents" > 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_open_offer_idx" ON "shipments" ("offer_id") WHERE "status" IN ('pending', 'loaded') AND "offer_id" IS NOT NULL;
