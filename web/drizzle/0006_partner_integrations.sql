ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "partner_status" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "partner_status_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inbound_token_hash" text,
	"inbound_token_prefix" text,
	"last_checked_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"shipment_id" uuid,
	"request_id" uuid,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"summary" text,
	"payload" jsonb,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_business_id_users_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_events" ADD CONSTRAINT "partner_events_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "partner_outbox" ADD CONSTRAINT "partner_outbox_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_conn_business_idx" ON "partner_connections" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_events_conn_idx" ON "partner_events" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_events_biz_idx" ON "partner_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_events_dedupe_uniq" ON "partner_events" USING btree ("connection_id","dedupe_key") WHERE "partner_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_outbox_due_idx" ON "partner_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_outbox_once_uniq" ON "partner_outbox" USING btree ("connection_id","shipment_id","action");
