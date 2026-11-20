-- Last index requests from the report packs (onboarding / verification funnels).
CREATE INDEX IF NOT EXISTS "documents_owner_kind_status_idx" ON "documents" ("owner_kind", "status", "reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_created_idx" ON "documents" ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_invites_office_responded_idx" ON "office_invites" ("office_id", "responded_at");
