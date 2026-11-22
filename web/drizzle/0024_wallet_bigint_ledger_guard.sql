-- 0024 — wallet balances as bigint + an append-only ledger (audit K, A4; finding 13 of A2's money audit).
--
-- 1. `wallet_accounts.available_cents / reserved_cents / held_cents` were `integer` (max SAR 21 474 836.47). The PLATFORM wallet receives every margin and rental and is never swept,
--    so one day the next `platform_fee` update raises "integer out of range" and every payout after it fails. bigint holds SAR 92 trillion; the drizzle column keeps `mode: "number"`
--    (JS numbers are exact to SAR 90 trillion), so no caller changes. Per-movement amounts (`ledger_entries.*_delta_cents`, settlements, withdrawals) stay integer: one movement
--    never approaches the limit, and the zod bounds of the API keep it that way.
--    Lock: ACCESS EXCLUSIVE on `wallet_accounts` for the rewrite — one row per user (100 000 users ≈ a second); `lock_timeout` makes it fail fast behind a long transaction.
-- 2. `ledger_entries` is the books. No application code updates or deletes a row, so the database now refuses it: UPDATE of any money / identity column and every DELETE raise
--    (SQLSTATE 23514, which the API answers as 409). Backdating `created_at`, `note` and `actor_id` stay possible (the demo seeder and test fixtures do that), and a maintenance
--    session can lift the guard explicitly: `select set_config('jr.ledger_maintenance', 'on', true)` inside its transaction (demo-history --reset does). TRUNCATE is not a row event
--    and is not affected (the test helpers truncate between tests).
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
ALTER TABLE "wallet_accounts" ALTER COLUMN "available_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ALTER COLUMN "reserved_cents" TYPE bigint;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ALTER COLUMN "held_cents" TYPE bigint;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "jr_ledger_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF coalesce(current_setting('jr.ledger_maintenance', true), '') = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_entries is append-only: DELETE refused (id %)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.available_delta_cents IS DISTINCT FROM OLD.available_delta_cents OR NEW.reserved_delta_cents IS DISTINCT FROM OLD.reserved_delta_cents
     OR NEW.held_delta_cents IS DISTINCT FROM OLD.held_delta_cents OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.settlement_id IS DISTINCT FROM OLD.settlement_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.simulated IS DISTINCT FROM OLD.simulated THEN
    RAISE EXCEPTION 'ledger_entries is append-only: UPDATE of a money or identity column refused (id %)', OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_entries_guard" ON "ledger_entries";--> statement-breakpoint
CREATE TRIGGER "ledger_entries_guard" BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION "jr_ledger_guard"();
