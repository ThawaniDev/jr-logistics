-- Platform data capture (decisions G5–G7): sign-in history + last seen, driver location history, availability log, per-parcel journey,
-- outbound message log, request milestones, first-response times, hourly/daily snapshots, internal notes, and the indexes the activity log needs.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_ip" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_client" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ip" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoke_reason" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "first_offer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "first_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "filled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "first_response_by" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "reopen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN IF NOT EXISTS "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN IF NOT EXISTS "first_response_by" uuid;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "login_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "identifier" text,
  "method" text NOT NULL,
  "success" boolean NOT NULL,
  "failure_reason" text,
  "ip" text,
  "user_agent" text,
  "client" text,
  "session_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_location_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "accuracy_m" double precision,
  "speed_mps" double precision,
  "heading" double precision,
  "offer_id" uuid,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_availability_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "source" text NOT NULL,
  "reason" text,
  "actor_id" uuid,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "request_id" uuid NOT NULL REFERENCES "requests"("id") ON DELETE CASCADE,
  "offer_id" uuid,
  "type" text NOT NULL,
  "actor_id" uuid,
  "actor_role" text DEFAULT 'system' NOT NULL,
  "actor_name" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel" text NOT NULL,
  "direction" text DEFAULT 'out' NOT NULL,
  "recipient" text,
  "type" text NOT NULL,
  "user_id" uuid,
  "request_id" uuid,
  "shipment_id" uuid,
  "status" text DEFAULT 'queued' NOT NULL,
  "provider_ref" text,
  "error" text,
  "attempts" integer DEFAULT 1 NOT NULL,
  "sent_at" timestamp with time zone,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metric_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "scope" text NOT NULL,
  "city" text,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "metric_snapshots_scope" CHECK ("scope" in ('hour','day'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity" text NOT NULL,
  "entity_id" text NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  CONSTRAINT "entity_notes_body" CHECK (char_length("body") between 1 and 4000)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "login_events_user_idx" ON "login_events" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_created_idx" ON "login_events" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_identifier_idx" ON "login_events" ("identifier", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_failed_idx" ON "login_events" ("created_at") WHERE "success" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dlh_driver_idx" ON "driver_location_history" ("driver_id", "recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dlh_offer_idx" ON "driver_location_history" ("offer_id", "recorded_at") WHERE "offer_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dlh_time_idx" ON "driver_location_history" ("recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dal_driver_idx" ON "driver_availability_log" ("driver_id", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dal_at_idx" ON "driver_availability_log" ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_events_shipment_idx" ON "shipment_events" ("shipment_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_events_request_idx" ON "shipment_events" ("request_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_events_type_idx" ON "shipment_events" ("type", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_events_offer_idx" ON "shipment_events" ("offer_id", "created_at") WHERE "offer_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_events_actor_idx" ON "shipment_events" ("actor_id", "created_at") WHERE "actor_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_created_idx" ON "message_log" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_channel_idx" ON "message_log" ("channel", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_user_idx" ON "message_log" ("user_id", "created_at") WHERE "user_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_request_idx" ON "message_log" ("request_id", "created_at") WHERE "request_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_shipment_idx" ON "message_log" ("shipment_id", "created_at") WHERE "shipment_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_ref_idx" ON "message_log" ("provider_ref") WHERE "provider_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "metric_snapshots_uniq" ON "metric_snapshots" ("scope", "at", (coalesce("city", '')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_snapshots_at_idx" ON "metric_snapshots" ("scope", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_notes_entity_idx" ON "entity_notes" ("entity", "entity_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_notes_author_idx" ON "entity_notes" ("author_id", "created_at");--> statement-breakpoint

-- Indexes on existing tables: what the shared activity log (and the detail pages) read by.
CREATE INDEX IF NOT EXISTS "users_last_seen_idx" ON "users" ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_activity_idx" ON "requests" ("last_activity_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_office_idx" ON "offers" ("office_id") WHERE "office_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_actor_idx" ON "job_events" ("actor_id", "created_at") WHERE "actor_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_offer_idx" ON "job_events" ("offer_id", "created_at") WHERE "offer_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_request_idx" ON "messages" ("request_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_ratee_idx" ON "ratings" ("ratee_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_request_idx" ON "tickets" ("request_id") WHERE "request_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_opener_idx" ON "tickets" ("opened_by", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_replies_ticket_idx" ON "ticket_replies" ("ticket_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_request_idx" ON "complaints" ("request_id") WHERE "request_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_filer_idx" ON "complaints" ("filed_by", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaint_notes_complaint_idx" ON "complaint_notes" ("complaint_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_request_idx" ON "ledger_entries" ("request_id", "created_at") WHERE "request_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_offer_idx" ON "ledger_entries" ("offer_id") WHERE "offer_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_settlement_idx" ON "ledger_entries" ("settlement_id") WHERE "settlement_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_request_idx" ON "settlements" ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_user_idx" ON "withdrawals" ("user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_request_idx" ON "invoices" ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notif_request_idx" ON "notifications" ((("data"->>'requestId')), "created_at") WHERE "data" ? 'requestId';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_actor_idx" ON "audit_logs" ("actor_id", "created_at") WHERE "actor_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_events_request_idx" ON "partner_events" ("request_id", "created_at") WHERE "request_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_events_shipment_idx" ON "partner_events" ("shipment_id", "created_at") WHERE "shipment_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_request_idx" ON "webhook_deliveries" ("request_id", "created_at") WHERE "request_id" is not null;--> statement-breakpoint

-- Backfills (only where the information exists): sign-in history from live sessions, request milestones from offers / events,
-- the parcel journey from job events and parcel timestamps, first-response times from replies and notes.
UPDATE "users" u SET "last_login_at" = s."last_at", "login_count" = s."n", "last_login_client" = s."client"
  FROM (SELECT "user_id", max("created_at") AS "last_at", count(*)::int AS "n", (array_agg("client" ORDER BY "created_at" DESC))[1] AS "client" FROM "sessions" GROUP BY "user_id") s
  WHERE s."user_id" = u."id" AND u."last_login_at" IS NULL;--> statement-breakpoint
UPDATE "users" SET "last_seen_at" = "last_login_at" WHERE "last_seen_at" IS NULL AND "last_login_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "login_events" ("user_id", "identifier", "method", "success", "user_agent", "client", "session_id", "created_at")
  SELECT s."user_id", coalesce(u."phone", u."email"), CASE WHEN u."role" IN ('admin','staff') THEN 'password' ELSE 'otp' END, true, s."user_agent", s."client", s."id", s."created_at"
  FROM "sessions" s JOIN "users" u ON u."id" = s."user_id"
  WHERE NOT EXISTS (SELECT 1 FROM "login_events" le WHERE le."session_id" = s."id");--> statement-breakpoint

UPDATE "requests" r SET "first_offer_at" = x."t" FROM (SELECT "request_id", min("created_at") AS "t" FROM "offers" GROUP BY "request_id") x WHERE x."request_id" = r."id" AND r."first_offer_at" IS NULL;--> statement-breakpoint
UPDATE "requests" r SET "first_accepted_at" = x."t" FROM (SELECT "request_id", min("accepted_at") AS "t" FROM "offers" WHERE "accepted_at" IS NOT NULL GROUP BY "request_id") x WHERE x."request_id" = r."id" AND r."first_accepted_at" IS NULL;--> statement-breakpoint
UPDATE "requests" r SET "filled_at" = x."t"
  FROM (SELECT "request_id", "accepted_at" AS "t", row_number() OVER (PARTITION BY "request_id" ORDER BY "accepted_at") AS "rn" FROM "offers" WHERE "accepted_at" IS NOT NULL) x
  WHERE x."request_id" = r."id" AND x."rn" = r."quantity" AND r."filled_at" IS NULL;--> statement-breakpoint
UPDATE "requests" r SET "started_at" = x."t" FROM (SELECT "request_id", min("route_approved_at") AS "t" FROM "offers" WHERE "route_approved_at" IS NOT NULL GROUP BY "request_id") x WHERE x."request_id" = r."id" AND r."started_at" IS NULL;--> statement-breakpoint
UPDATE "requests" r SET "started_at" = x."t"
  FROM (SELECT "request_id", min("loaded_at") AS "t" FROM "offers" WHERE "loaded_at" IS NOT NULL GROUP BY "request_id") x
  WHERE x."request_id" = r."id" AND r."started_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "shipments" s WHERE s."request_id" = r."id");--> statement-breakpoint
UPDATE "requests" r SET "last_activity_at" = greatest(r."updated_at", x."t") FROM (SELECT "request_id", max("created_at") AS "t" FROM "job_events" GROUP BY "request_id") x WHERE x."request_id" = r."id" AND r."last_activity_at" IS NULL;--> statement-breakpoint
UPDATE "requests" SET "last_activity_at" = "updated_at" WHERE "last_activity_at" IS NULL;--> statement-breakpoint

UPDATE "tickets" t SET "first_response_at" = x."at", "first_response_by" = x."by"
  FROM (SELECT DISTINCT ON ("ticket_id") "ticket_id", "created_at" AS "at", "author_id" AS "by" FROM "ticket_replies" WHERE "internal" = false AND "author_role" IN ('admin','staff') ORDER BY "ticket_id", "created_at") x
  WHERE x."ticket_id" = t."id" AND t."first_response_at" IS NULL;--> statement-breakpoint
UPDATE "tickets" SET "first_response_at" = "resolved_at", "first_response_by" = "assigned_to" WHERE "first_response_at" IS NULL AND "resolved_at" IS NOT NULL AND "assigned_to" IS NOT NULL;--> statement-breakpoint
UPDATE "complaints" c SET "first_response_at" = x."at", "first_response_by" = x."by"
  FROM (SELECT DISTINCT ON ("complaint_id") "complaint_id", "created_at" AS "at", "author_id" AS "by" FROM "complaint_notes" WHERE "author_role" IN ('admin','staff') ORDER BY "complaint_id", "created_at") x
  WHERE x."complaint_id" = c."id" AND c."first_response_at" IS NULL;--> statement-breakpoint

INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_id", "actor_role", "actor_name", "payload", "created_at")
  SELECT s."id", e."request_id", e."offer_id",
    CASE e."type" WHEN 'stop_arrived' THEN 'arrived' WHEN 'stop_otp_failed' THEN 'otp_failed' WHEN 'shipment_delivered' THEN 'delivered' WHEN 'shipment_failed' THEN 'failed'
      WHEN 'stop_deferred' THEN 'deferred' WHEN 'stop_code_resent' THEN 'otp_sent' WHEN 'recipient_notified' THEN 'otp_sent' WHEN 'recipient_notify_failed' THEN 'notify_failed'
      WHEN 'loading_scanned' THEN 'loaded' WHEN 'loading_unscanned' THEN 'unscanned' WHEN 'shipment_updated' THEN 'edited' WHEN 'shipment_details_completed' THEN 'details_completed'
      WHEN 'shipment_cancelled' THEN 'cancelled' WHEN 'partner_status' THEN 'partner_status' WHEN 'stop_proof_uploaded' THEN 'proof_uploaded' END,
    e."actor_id", e."actor_role", e."actor_name",
    coalesce(e."payload", '{}'::jsonb) || CASE WHEN e."type" = 'loading_scanned' THEN '{"via":"scan","backfill":true}'::jsonb ELSE '{"backfill":true}'::jsonb END, e."created_at"
  FROM (SELECT je.*, CASE WHEN (je."payload"->>'shipmentId') ~ '^[0-9a-fA-F-]{36}$' THEN (je."payload"->>'shipmentId')::uuid END AS "sid" FROM "job_events" je
    WHERE je."payload" ? 'shipmentId' AND je."type" IN ('stop_arrived','stop_otp_failed','shipment_delivered','shipment_failed','stop_deferred','stop_code_resent','recipient_notified','recipient_notify_failed',
      'loading_scanned','loading_unscanned','shipment_updated','shipment_details_completed','shipment_cancelled','partner_status','stop_proof_uploaded')) e
  JOIN "shipments" s ON s."id" = e."sid";--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_id", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", NULL, 'created', r."business_id", 'business', jsonb_build_object('seq', s."seq", 'code', s."code", 'backfill', true), s."created_at"
  FROM "shipments" s JOIN "requests" r ON r."id" = s."request_id";--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", s."offer_id", 'loaded', 'system', jsonb_build_object('via', coalesce(s."loaded_via", 'warehouse'), 'backfill', true), s."loaded_at"
  FROM "shipments" s WHERE s."loaded_at" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "shipment_events" x WHERE x."shipment_id" = s."id" AND x."type" = 'loaded');--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", s."offer_id", 'returned', 'system', '{"backfill":true}'::jsonb, s."returned_at" FROM "shipments" s WHERE s."returned_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", s."offer_id", 'failed', 'system', jsonb_build_object('reason', s."fail_reason", 'backfill', true), s."failed_at"
  FROM "shipments" s WHERE s."failed_at" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "shipment_events" x WHERE x."shipment_id" = s."id" AND x."type" = 'failed');--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", s."offer_id", 'delivered', 'system', jsonb_build_object('proofType', s."proof_type", 'backfill', true), s."delivered_at"
  FROM "shipments" s WHERE s."delivered_at" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "shipment_events" x WHERE x."shipment_id" = s."id" AND x."type" = 'delivered');--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", NULL, 'cancelled', 'system', jsonb_build_object('reason', s."fail_reason", 'backfill', true), s."updated_at"
  FROM "shipments" s WHERE s."status" = 'cancelled' AND NOT EXISTS (SELECT 1 FROM "shipment_events" x WHERE x."shipment_id" = s."id" AND x."type" = 'cancelled');--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", s."offer_id", 'missing', 'system', '{"backfill":true}'::jsonb, s."updated_at" FROM "shipments" s WHERE s."status" = 'missing';--> statement-breakpoint
INSERT INTO "shipment_events" ("shipment_id", "request_id", "offer_id", "type", "actor_role", "payload", "created_at")
  SELECT s."id", s."request_id", s."offer_id", 'assigned', 'system', '{"backfill":true}'::jsonb, coalesce(o."accepted_at", o."created_at")
  FROM "shipments" s JOIN "offers" o ON o."id" = s."offer_id";