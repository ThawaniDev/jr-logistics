-- 0023 — data-layer audit (audit K, A4). Additive and re-runnable: indexes IF NOT EXISTS, uniqueness guarded like 0007, and every CHECK is added NOT VALID **and only when no existing
-- row violates it** (a NOT VALID CHECK is still enforced on UPDATEs of old rows, so a violating legacy row would break unrelated updates of that row). Every statement is metadata-only or
-- a plain read of a table; `lock_timeout` makes a statement that would queue behind a long transaction fail (the container then retries) instead of blocking every other query on the table.
-- NOTE: the migrator runs this file inside ONE transaction, so `CREATE INDEX CONCURRENTLY` is impossible here. On a big production table create the index by hand first
-- (`CREATE INDEX CONCURRENTLY IF NOT EXISTS …`); the `IF NOT EXISTS` below then does nothing. See memory/audit/data.md.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint

-- ── Redundant indexes: each one is an exact duplicate or a leading prefix of another index on the same table (pure write overhead on hot tables) ──
DROP INDEX IF EXISTS "shipments_phone_idx";--> statement-breakpoint            -- (recipient_phone)  ⊂ shipments_recipient_phone_idx (recipient_phone, created_at desc)
DROP INDEX IF EXISTS "webhook_deliveries_business_created_idx";--> statement-breakpoint -- = webhook_business_idx (business_id, created_at)
DROP INDEX IF EXISTS "complaints_filer_idx";--> statement-breakpoint            -- = complaints_filed_by_idx (filed_by, created_at)
DROP INDEX IF EXISTS "documents_status_created_idx";--> statement-breakpoint    -- = documents_status_idx (status, created_at)
DROP INDEX IF EXISTS "users_role_idx";--> statement-breakpoint                  -- (role) ⊂ users_role_created_idx (role, created_at)
DROP INDEX IF EXISTS "api_logs_business_created_idx";--> statement-breakpoint   -- = api_logs_business_idx (business_id, created_at)

-- ── One platform wallet: `wallet_owner_unique (owner_id)` does not stop a second row with owner_id NULL (NULLs are distinct) ──
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "wallet_one_platform_uniq" ON "wallet_accounts" ((true)) WHERE "kind" = 'platform';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'wallet_one_platform_uniq skipped: more than one platform account exists'; END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "wallet_accounts" WHERE NOT (("kind" = 'platform' AND "owner_id" IS NULL) OR ("kind" = 'user' AND "owner_id" IS NOT NULL))) THEN RAISE NOTICE 'wallet_kind_chk skipped: existing rows violate it';
  ELSE ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_kind_chk" CHECK (("kind" = 'platform' AND "owner_id" IS NULL) OR ("kind" = 'user' AND "owner_id" IS NOT NULL)) NOT VALID; END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ── Money that must never be negative / must add up, and lower-case sign-in names ──
-- A CHECK added NOT VALID is still enforced on every UPDATE of an OLD row too, so a legacy row that violates it would make unrelated updates of that row fail (a payout, a login).
-- Each constraint is therefore added only when no existing row violates it; otherwise it is skipped with a NOTICE and `scripts/validate-constraints.ts` / the data owner decide.
-- (NOT VALID itself only avoids the long table scan under the lock; the EXISTS probe below is a plain read.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "invoices" WHERE NOT ("subtotal_cents" >= 0 AND "vat_cents" >= 0 AND "total_cents" >= 0 AND "subtotal_cents" + "vat_cents" = "total_cents")) THEN RAISE NOTICE 'invoices_money_chk skipped: existing rows violate it';
  ELSE ALTER TABLE "invoices" ADD CONSTRAINT "invoices_money_chk" CHECK ("subtotal_cents" >= 0 AND "vat_cents" >= 0 AND "total_cents" >= 0 AND "subtotal_cents" + "vat_cents" = "total_cents") NOT VALID; END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "settlements" WHERE NOT ("vat_cents" >= 0 AND "refund_cents" >= 0)) THEN RAISE NOTICE 'settlements_vat_refund_chk skipped: existing rows violate it';
  ELSE ALTER TABLE "settlements" ADD CONSTRAINT "settlements_vat_refund_chk" CHECK ("vat_cents" >= 0 AND "refund_cents" >= 0) NOT VALID; END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "shipments" WHERE NOT ("cod_cents" >= 0 AND ("cod_collected_cents" IS NULL OR "cod_collected_cents" >= 0))) THEN RAISE NOTICE 'shipments_cod_chk skipped: existing rows violate it';
  ELSE ALTER TABLE "shipments" ADD CONSTRAINT "shipments_cod_chk" CHECK ("cod_cents" >= 0 AND ("cod_collected_cents" IS NULL OR "cod_collected_cents" >= 0)) NOT VALID; END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "requests" WHERE NOT (coalesce("total_cents", 0) >= 0 AND coalesce("unit_price_cents", 0) >= 0 AND coalesce("expected_units", 0) >= 0)) THEN RAISE NOTICE 'requests_amounts_chk skipped: existing rows violate it';
  ELSE ALTER TABLE "requests" ADD CONSTRAINT "requests_amounts_chk" CHECK (coalesce("total_cents", 0) >= 0 AND coalesce("unit_price_cents", 0) >= 0 AND coalesce("expected_units", 0) >= 0) NOT VALID; END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The unique index on `username` is case-sensitive and every lookup lower-cases; 0021 backfilled lower-case names. (E-mail is NOT constrained: older rows may hold mixed-case addresses.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "username" IS NOT NULL AND "username" <> lower("username")) THEN RAISE NOTICE 'users_username_lower_chk skipped: existing rows violate it';
  ELSE ALTER TABLE "users" ADD CONSTRAINT "users_username_lower_chk" CHECK ("username" IS NULL OR "username" = lower("username")) NOT VALID; END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
