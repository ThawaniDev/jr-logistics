-- 0026 — the one remaining money ACCUMULATOR that was `integer` (audit K, A4; hand-off from A2's money audit).
-- A payout batch summed many settlements into `total_cents`; a big batch (> SAR 21 474 836.47) could not be stored. Batches were retired by decision E18 (payouts are immediate), so the
-- table only holds history and the rewrite is trivial; bigint keeps the old rows readable. The other money columns are per row and bounded by the API (a single request is at most
-- 500 vehicles x 90 days x the price cap, a settlement / withdrawal / remittance is one job's or one payee's amount): they stay `integer`; an out-of-range value is answered 422, never stored wrong.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
ALTER TABLE "payout_batches" ALTER COLUMN "total_cents" TYPE bigint;
