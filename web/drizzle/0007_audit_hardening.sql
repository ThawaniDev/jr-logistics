-- Server audit: indexes for the hot queries, integrity constraints, and race-proof uniqueness.
-- CHECK constraints are added NOT VALID: enforced for every new/updated row, without failing on legacy rows.

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS "ledger_request_idx" ON "ledger_entries" USING btree ("request_id") WHERE "request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_settlement_idx" ON "ledger_entries" USING btree ("settlement_id") WHERE "settlement_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_request_idx" ON "settlements" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_business_idx" ON "settlements" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_offer_idx" ON "job_events" USING btree ("offer_id") WHERE "offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "job_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_office_idx" ON "offers" USING btree ("office_id","status") WHERE "office_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_business_created_idx" ON "requests" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_created_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_phone_idx" ON "shipments" USING btree ("recipient_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_phone_last4_idx" ON "shipments" USING btree (right("recipient_phone", 4));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_ref_lower_idx" ON "shipments" USING btree (lower("external_ref")) WHERE "external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_name_lower_idx" ON "shipments" USING btree (lower("recipient_name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_partner_idx" ON "shipments" USING btree ("partner_id") WHERE "partner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_opened_by_idx" ON "tickets" USING btree ("opened_by","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_offer_idx" ON "tickets" USING btree ("offer_id") WHERE "offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_filed_by_idx" ON "complaints" USING btree ("filed_by","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_offer_idx" ON "complaints" USING btree ("offer_id") WHERE "offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_logs_business_idx" ON "api_logs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_logs_created_idx" ON "api_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_business_idx" ON "webhook_deliveries" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_expires_idx" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custody_request_idx" ON "custody_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_outbox_shipment_idx" ON "partner_outbox" USING btree ("shipment_id");--> statement-breakpoint

-- ── Uniqueness the application relied on being "checked first" (race-proof now) ──
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "invites_one_pending_uniq" ON "office_invites" USING btree ("office_id","phone") WHERE "status" = 'pending';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'invites_one_pending_uniq skipped: duplicates exist'; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "agreement_one_accepted_uniq" ON "office_agreements" USING btree ("office_id") WHERE "status" = 'accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'agreement_one_accepted_uniq skipped: duplicates exist'; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "invoices_settlement_uniq" ON "invoices" USING btree ("settlement_id") WHERE "settlement_id" IS NOT NULL;
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'invoices_settlement_uniq skipped: duplicates exist'; END $$;--> statement-breakpoint

-- ── Enum-like columns and money sanity ──
DO $$ BEGIN ALTER TABLE "users" ADD CONSTRAINT "users_role_chk" CHECK ("role" IN ('business','driver','office','staff','admin')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "users" ADD CONSTRAINT "users_status_chk" CHECK ("status" IN ('active','suspended')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "requests" ADD CONSTRAINT "requests_status_chk" CHECK ("status" IN ('draft','published','filling','assigned','confirmed','in_progress','completed','cancelled','expired')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "requests" ADD CONSTRAINT "requests_service_chk" CHECK ("service" IN ('delivery_driver','car_with_driver','car_without_driver')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "requests" ADD CONSTRAINT "requests_money_chk" CHECK ("reserved_cents" >= 0 AND "slots_filled" >= 0 AND "slots_filled" <= "quantity") NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "offers" ADD CONSTRAINT "offers_status_chk" CHECK ("status" IN ('offered','accepted','arrived','attendance_confirmed','delivered_reported','qty_disputed','pending_settlement','completed','rejected','expired','cancelled','no_show','replaced')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "offers" ADD CONSTRAINT "offers_units_chk" CHECK ("expected_units" >= 0 AND "expected_earning_cents" >= 0 AND ("final_units" IS NULL OR "final_units" >= 0)) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "shipments" ADD CONSTRAINT "shipments_status_chk" CHECK ("status" IN ('pending','loaded','delivered','failed','returned','missing','cancelled')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "shipments" ADD CONSTRAINT "shipments_rtype_chk" CHECK ("recipient_type" IN ('consumer','business')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "settlements" ADD CONSTRAINT "settlements_status_chk" CHECK ("status" IN ('pending_review','reviewed','approved','batch_ready','paid','rejected','failed')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "settlements" ADD CONSTRAINT "settlements_money_chk" CHECK ("final_units" >= 0 AND "reserved_cents" >= 0 AND "customer_cents" >= 0 AND "provider_cents" >= 0 AND "margin_cents" >= 0) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_status_chk" CHECK ("status" IN ('pending','approved','paid','rejected')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_chk" CHECK ("status" IN ('open','in_review','resolved') AND "priority" IN ('normal','urgent')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "complaints" ADD CONSTRAINT "complaints_status_chk" CHECK ("status" IN ('open','in_progress','resolved','closed')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "documents" ADD CONSTRAINT "documents_status_chk" CHECK ("status" IN ('submitted','under_review','approved','rejected','info_requested') AND "size" >= 0) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_status_chk" CHECK ("status" IN ('queued','delivered','retry_wait','dead_letter')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "partner_outbox" ADD CONSTRAINT "partner_outbox_status_chk" CHECK ("status" IN ('queued','retry_wait','sent','dead','skipped')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_conn_status_chk" CHECK ("status" IN ('active','disabled')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ── Referential integrity for the ledger / parcels (previously plain uuid columns) ──
DO $$ BEGIN ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE NO ACTION NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE NO ACTION NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_settlement_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE NO ACTION NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "shipments" ADD CONSTRAINT "shipments_partner_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner_connections"("id") ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "job_events" ADD CONSTRAINT "events_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
