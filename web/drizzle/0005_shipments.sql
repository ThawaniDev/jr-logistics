ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "allow_partial" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "route_approved_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid,
	"seq" integer NOT NULL,
	"code" text NOT NULL,
	"external_ref" text,
	"recipient_type" text DEFAULT 'consumer' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"contents" text,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"stop_order" integer,
	"defer_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"otp_version" integer DEFAULT 1 NOT NULL,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"otp_sends" integer DEFAULT 0 NOT NULL,
	"notified_at" timestamp with time zone,
	"loaded_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivered_lat" double precision,
	"delivered_lng" double precision,
	"delivered_distance_m" integer,
	"proof_type" text,
	"receiver_name" text,
	"proof_key" text,
	"fail_reason" text,
	"fail_note" text,
	"failed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_request_idx" ON "shipments" USING btree ("request_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_offer_idx" ON "shipments" USING btree ("offer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_request_ref_uniq" ON "shipments" USING btree ("request_id","external_ref") WHERE "shipments"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_request_seq_uniq" ON "shipments" USING btree ("request_id","seq");
