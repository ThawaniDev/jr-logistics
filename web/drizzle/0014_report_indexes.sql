-- Indexes the analytics reports range-scan on (decision G11).
CREATE INDEX IF NOT EXISTS "requests_created_idx" ON "requests" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_starts_idx" ON "requests" ("starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_created_idx" ON "offers" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_accepted_idx" ON "offers" ("accepted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_delivered_idx" ON "shipments" ("delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_failed_idx" ON "shipments" ("failed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_created_idx" ON "shipments" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_created_idx" ON "settlements" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_created_idx" ON "ledger_entries" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_created_idx" ON "tickets" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "complaints_created_idx" ON "complaints" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_created_idx" ON "ratings" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_created_idx" ON "withdrawals" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cod_remittances_created_idx" ON "cod_remittances" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_role_created_idx" ON "users" ("role", "created_at");
