-- Decision B7: postpaid credit line. A business wallet's available balance may go negative down to -credit_limit_cents (default 0 = prepaid only).
ALTER TABLE "wallet_accounts" ADD COLUMN IF NOT EXISTS "credit_limit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_accounts" DROP CONSTRAINT IF EXISTS "wallet_nonneg";--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_nonneg" CHECK ("available_cents" + "credit_limit_cents" >= 0 AND "reserved_cents" >= 0 AND "held_cents" >= 0 AND "credit_limit_cents" >= 0);
