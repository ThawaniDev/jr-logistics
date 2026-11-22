-- 0027 — undo one constraint of 0023 on the databases that already ran it (audit K, A4). `users_email_lower_chk` (e-mail = lower(e-mail)) was too strict: a NOT VALID CHECK is also
-- enforced on every UPDATE of an old row, and rows created before e-mail addresses were lower-cased (the 0021 backfill and its tests model exactly such staff rows: `Jane.Doe@jr.com`)
-- would fail every login / last-seen update. Sign-in e-mail lookups lower-case the input; uniqueness stays case-sensitive at the database. Fresh databases no longer create it (0023
-- was edited before it reached production), so this is a no-op there.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_lower_chk";
