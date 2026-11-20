-- Warehouse-system integrations v2 (decisions I7–I20): incoming-orders inbox, every JR parcel event can be written back in order,
-- per-connection runtime state, admin authorship.

-- Non-secret runtime state written by JR itself (webhook URL a partner registered, status catalogue, poll cursor …).
ALTER TABLE "partner_connections" ADD COLUMN IF NOT EXISTS "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Bumped whenever the credentials a partner presents to JR are rotated: signed access tokens of an older version stop working.
ALTER TABLE "partner_connections" ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD COLUMN IF NOT EXISTS "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD COLUMN IF NOT EXISTS "last_poll_at" timestamp with time zone;--> statement-breakpoint
-- Carrier APIs (Omniful) identify the connection by the key alone, so the hash must be unique and indexed.
CREATE UNIQUE INDEX IF NOT EXISTS "partner_conn_token_uniq" ON "partner_connections" ("inbound_token_hash") WHERE "inbound_token_hash" IS NOT NULL;--> statement-breakpoint

-- Incoming orders: every order JR learns about from a warehouse system (pushed to JR, imported, or seen on a webhook).
CREATE TABLE IF NOT EXISTS "partner_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL REFERENCES "partner_connections"("id") ON DELETE CASCADE,
	"business_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"external_ref" text NOT NULL,
	"invoice" text,
	"awb" text,
	"state" text DEFAULT 'open' NOT NULL,
	"recipient_name" text,
	"recipient_phone" text,
	"recipient_email" text,
	"address" text,
	"city_raw" text,
	"city" text,
	"lat" double precision,
	"lng" double precision,
	"cod_cents" integer,
	"currency" text,
	"pieces" integer,
	"weight_grams" integer,
	"contents" text,
	"notes" text,
	"pickup" jsonb,
	"items" jsonb,
	"slot" jsonb,
	"extra" jsonb,
	"details_complete" boolean DEFAULT false NOT NULL,
	"partner_status" text,
	"partner_status_at" timestamp with time zone,
	"shipment_id" uuid,
	"request_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_orders_ref_uniq" ON "partner_orders" ("connection_id", lower("external_ref"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_orders_awb_uniq" ON "partner_orders" ("awb") WHERE "awb" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_orders_biz_idx" ON "partner_orders" ("business_id", "state", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_orders_shipment_idx" ON "partner_orders" ("shipment_id") WHERE "shipment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_orders_external_idx" ON "partner_orders" ("connection_id", "external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint

-- Write-back queue: any JR parcel event (not only 4 outcomes), delivered strictly in order per parcel, once per occurrence.
ALTER TABLE "partner_outbox" ALTER COLUMN "shipment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_outbox" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_outbox" ADD COLUMN IF NOT EXISTS "partner_order_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_outbox" ADD COLUMN IF NOT EXISTS "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_outbox" ADD COLUMN IF NOT EXISTS "dedupe_key" text;--> statement-breakpoint
UPDATE "partner_outbox" SET "dedupe_key" = "action" || ':legacy:' || coalesce("shipment_id"::text, "id"::text) WHERE "dedupe_key" IS NULL;--> statement-breakpoint
ALTER TABLE "partner_outbox" ALTER COLUMN "dedupe_key" SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "partner_outbox_once_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_outbox_dedupe_uniq" ON "partner_outbox" ("connection_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_outbox_line_idx" ON "partner_outbox" ("connection_id", "partner_order_id", "seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_outbox_shipment_idx" ON "partner_outbox" ("connection_id", "shipment_id", "seq");--> statement-breakpoint

-- Which inbox order an event concerns (audit trail of the order before it becomes a JR parcel).
ALTER TABLE "partner_events" ADD COLUMN IF NOT EXISTS "partner_order_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_events_order_idx" ON "partner_events" ("partner_order_id", "created_at") WHERE "partner_order_id" IS NOT NULL;
--> statement-breakpoint
-- An order's live JR parcel is found by (connection, reference): drafts re-create their parcels on every save, so it is joined, not stored.
CREATE INDEX IF NOT EXISTS "shipments_partner_ref_idx" ON "shipments" ("partner_id", lower("external_ref")) WHERE "partner_id" IS NOT NULL;
