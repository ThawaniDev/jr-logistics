-- Field-operations overhaul (decisions E1–E18): warehouse location + per-warehouse switches, route polylines, COD, stop evidence, ticket attachments.
ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "warehouse_lat" double precision;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "warehouse_lng" double precision;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "ops" jsonb;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "leg_polyline" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cod_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cod_collected_cents" integer;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cod_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "loaded_via" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE CASCADE,
  "offer_id" uuid REFERENCES "offers"("id"),
  "kind" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime" text NOT NULL,
  "note" text,
  "uploaded_by" uuid REFERENCES "users"("id"),
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_media_shipment_idx" ON "shipment_media" ("shipment_id", "kind");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cod_remittances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ref" text NOT NULL UNIQUE,
  "request_id" uuid NOT NULL REFERENCES "requests"("id"),
  "offer_id" uuid NOT NULL REFERENCES "offers"("id"),
  "driver_id" uuid NOT NULL REFERENCES "users"("id"),
  "business_id" uuid NOT NULL REFERENCES "users"("id"),
  "amount_cents" integer NOT NULL,
  "received_by" uuid NOT NULL REFERENCES "users"("id"),
  "received_by_role" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cod_remittances_positive" CHECK ("amount_cents" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cod_remittances_offer_idx" ON "cod_remittances" ("offer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cod_remittances_business_idx" ON "cod_remittances" ("business_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cod_remittances_driver_idx" ON "cod_remittances" ("driver_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ticket_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id"),
  "ticket_id" uuid REFERENCES "tickets"("id") ON DELETE CASCADE,
  "reply_id" uuid REFERENCES "ticket_replies"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "name" text NOT NULL,
  "mime" text NOT NULL,
  "size" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_attachments_ticket_idx" ON "ticket_attachments" ("ticket_id");
