-- Indexes the detail views and the report packs lean on (requested by the workstreams; decision G11).
CREATE INDEX IF NOT EXISTS "shipments_recipient_phone_idx" ON "shipments" ("recipient_phone", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_address_city_idx" ON "shipments" (lower("address"), "city");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_loaded_idx" ON "shipments" ("loaded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_returned_idx" ON "shipments" ("returned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_cod_collected_idx" ON "shipments" ("cod_collected_at") WHERE "cod_collected_cents" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cod_remittances_request_idx" ON "cod_remittances" ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_resolved_idx" ON "tickets" ("resolved_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_assigned_idx" ON "tickets" ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_offer_idx" ON "tickets" ("offer_id") WHERE "offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_category_created_idx" ON "tickets" ("category", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_offer_idx" ON "complaints" ("offer_id") WHERE "offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_category_created_idx" ON "complaints" ("category", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_final_idx" ON "offers" ("final_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_cancel_events_idx" ON "offers" ((coalesce("cancelled_at", "updated_at"))) WHERE "status" IN ('cancelled', 'no_show', 'replaced');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_created_idx" ON "audit_logs" ("action", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_office_created_idx" ON "settlements" ("office_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_paid_idx" ON "settlements" ("paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_invites_office_created_idx" ON "office_invites" ("office_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_logs_business_created_idx" ON "api_logs" ("business_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_business_created_idx" ON "webhook_deliveries" ("business_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_business_created_idx" ON "requests" ("business_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_type_created_idx" ON "notifications" ("type", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_created_idx" ON "invoices" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_decided_idx" ON "withdrawals" ("decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_kind_created_idx" ON "ledger_entries" ("kind", "created_at");
