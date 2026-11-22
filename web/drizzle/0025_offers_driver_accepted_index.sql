-- 0025 — one index the report packs lean on (audit K, A4; measured on a 365-day / 115 000-offer scratch database).
-- "When did this driver last / first work?" is asked per driver by Reports › Drivers (inactive drivers, time to first job, driver table sorts) as
-- `select max|min(accepted_at) from offers where driver_id = <id>`. Without this index every probe reads all of the driver's offers (≈ 1 100 each on the scratch database: 4.4 ms and 12 000
-- buffers per driver, so a table of 3 000 idle drivers needs ~13 s); with it each probe is one index entry. Reports › Drivers › Inactive: 230 ms → 18–50 ms. Partial (accepted offers only) and
-- 1 MB on a 27 MB table. SHARE lock on `offers` for the build (writes wait, reads continue): on a big production table create it first with
-- `CREATE INDEX CONCURRENTLY IF NOT EXISTS offers_driver_accepted_idx ON offers (driver_id, accepted_at) WHERE accepted_at IS NOT NULL;` — this statement is then a no-op.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_driver_accepted_idx" ON "offers" ("driver_id", "accepted_at") WHERE "accepted_at" IS NOT NULL;
