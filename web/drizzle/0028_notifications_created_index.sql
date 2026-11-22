-- 0028 — retention of notifications (audit K, A4): the hourly prune deletes `where created_at < $1 and (read_at is not null or created_at < $2) limit 10 000`; without an index on
-- `created_at` every run would scan the whole table. Plain btree. SHARE lock for the build (writes to `notifications` wait): on a big production table create it first with
-- `CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_created_idx ON notifications (created_at);` — this statement is then a no-op.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_created_idx" ON "notifications" ("created_at");
