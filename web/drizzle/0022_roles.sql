-- J8: staff roles are data, not code. `key` is the immutable slug that `users.staff_role` holds (no FK: legacy values keep working); the six presets are the system roles.
-- A role's permissions ARE the effective permissions of its members: saving a role rewrites `users.permissions` of every member in the same transaction (server/roles-write.ts).
-- The seed is idempotent and repeated by `ensureRoles()` at first use, so a database emptied by the test helpers gets its system roles back.
CREATE TABLE IF NOT EXISTS "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "permissions" text[] DEFAULT '{}'::text[] NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "roles_key_unique" UNIQUE ("key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_staff_role_idx" ON "users" ("staff_role") WHERE "staff_role" IS NOT NULL;--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "description", "permissions", "is_system") VALUES
  ('support', 'Support', 'Answers customers: tickets, complaints and account lookups.', ARRAY['users.view', 'requests.view', 'tickets.view', 'tickets.manage', 'complaints.manage', 'notes.manage', 'integrations.view']::text[], true),
  ('operations', 'Operations', 'Runs the day: requests, assignment, attendance, live tracking, documents and cash on delivery.', ARRAY['users.view', 'drivers.view', 'requests.view', 'requests.edit', 'requests.assign', 'attendance.edit', 'replacements.manage', 'live_location.view', 'tickets.view', 'tickets.manage', 'complaints.manage', 'custody.view', 'documents.review', 'cod.manage', 'accounts.create', 'accounts.edit', 'notes.manage', 'integrations.view', 'integrations.manage']::text[], true),
  ('finance', 'Finance', 'Settlements, payouts, withdrawals, refunds and financial reports.', ARRAY['finance.view', 'wallets.view', 'settlements.review', 'settlements.approve', 'payouts.execute', 'withdrawals.manage', 'refunds.manage', 'requests.view', 'reports.view', 'reports.export', 'cod.manage']::text[], true),
  ('hr_verification', 'Verification', 'Verifies drivers, companies and courier offices and reviews their documents.', ARRAY['users.view', 'users.edit', 'drivers.view', 'drivers.sensitive', 'verification.manage', 'documents.review', 'offices.view', 'offices.manage', 'accounts.create', 'accounts.edit', 'notes.manage']::text[], true),
  ('account_manager', 'Account manager', 'Looks after company accounts: requests, pricing, reports and support cases.', ARRAY['users.view', 'requests.view', 'pricing.view', 'reports.view', 'tickets.view', 'offices.view']::text[], true),
  ('reports', 'Reports', 'Read-only analytics, exports and the audit log.', ARRAY['reports.view', 'reports.export', 'audit.view', 'requests.view']::text[], true)
ON CONFLICT ("key") DO NOTHING;
