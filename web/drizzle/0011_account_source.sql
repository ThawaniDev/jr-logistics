-- Platform data & admin-created accounts (decision G1): who created an account and through which channel.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint
UPDATE "users" SET "source" = 'seed' WHERE "is_demo" = true AND "source" = 'self';
