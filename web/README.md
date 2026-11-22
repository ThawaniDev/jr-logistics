# JR Logistics — web platform (Next.js + PostgreSQL)

One Next.js (App Router) codebase serving **both** the web UI and the versioned HTTP API (`/api/v1/*`) that the Flutter driver app uses.
Stack: Next 16 · React 19 · TypeScript · Tailwind v4 (brand tokens in `src/app/globals.css`) · Drizzle ORM · PostgreSQL 16 · Zod · Vitest · Playwright.

```
src/db            schema.ts (53 tables, money = integer halalas) · migrations in ./drizzle
src/server        domain services (pricing, requests, matching, jobs, settlement, wallet, support, ops, integrations, routing…)
src/server/api    tiny typed router + route modules (auth/business/driver/office/admin/external/cron)
src/app           pages: / · /login (one sign-in for every role) · /register · /account/change-password · /business · /driver · /office · /admin (staff share it, permission-gated)
src/i18n          ar · en · ur dictionaries (single source; exported to the Flutter app)
tests             unit + integration (Vitest, real Postgres)        e2e   Playwright browser tests on a production build
```

## Run
```bash
cp .env.example .env.local          # set DATABASE_URL, SUPER_ADMIN_EMAIL/PASSWORD (every variable is documented in the file)
createdb jr_logistics               # any Postgres 16
npm i && npm run db:migrate && npm run db:seed && npm run dev      # http://localhost:3000   (migrations are hand-written SQL; `db:generate` is disabled, see memory/RUNBOOK.md)
```
`DEMO_MODE=true` (dev only) seeds demo accounts that sign in with a **username + password** (`demo.business`, `demo.driver`, `demo.office`, staff `demo.ops` / `demo.finance1` / `demo.hr` / `demo.support`; password `Demo#Pass2026`; the super admin signs in as the local part of `SUPER_ADMIN_EMAIL`, or with the e-mail address). The sign-in page lists them as quick-fill buttons. A database that existed before usernames: `npm run db:backfill:auth`. There is no one-time-code sign-in; the people staff create get a username and a temporary password they must replace at the first sign-in (staff reset a forgotten password from the account's Security tab).

## Test
```bash
cp .env.test.example .env.test      # the test database must be named *_test: the suites truncate it
createdb jr_logistics_test && npm run db:migrate:test
npm test                 # ~2350 unit + integration tests in ~170 files (real DB; never touches your dev DB), about 5-9 minutes
npm run e2e              # ~315 browser tests in 37 spec files on a production build (own server on :3101, same test DB); a build of 1-2 minutes, then about 10 minutes of tests (2-35 s per spec file)
npm run typecheck && npm run lint
npm run i18n:export      # regenerate ../mobile/assets/i18n/*.json after editing dictionaries
```
Several people (or agents) sharing one machine: run every DB-backed suite through `scripts/with-test-db.sh <command>` (a lock, so two runs never share the test database).
Everything else — dev server, backups, mobile live tests, iPhone install, the environment-variable table — is in **`../memory/RUNBOOK.md`**.

## Deploy
`docker compose up --build` (needs `AUTH_SECRET` and `CRON_SECRET` of 16+ random characters — `openssl rand -hex 32` — and `SUPER_ADMIN_PASSWORD`). Read `../memory/DECISIONS.md` → *Production readiness checklist* first: SMS/payment providers, durable storage and a cron hitting `POST /api/v1/cron/tick` (or `INTERNAL_SCHEDULER=true`) are required for real use. Production **fails closed**: a production build refuses to start (exit code 1, reasons as JSON lines on stderr) with no `DATABASE_URL`, a missing/short/placeholder `AUTH_SECRET` or `CRON_SECRET`, or an unsupported/incomplete `STORAGE_DRIVER`; and it offers no fake delivery code, top-up or storage.

## API at a glance
Session auth (cookie for web, `Authorization: Bearer` for mobile — send `X-Client: mobile`). Errors: `{ "error": { "code", "message", "correlation_id", "details" } }` with stable codes (`SLOT_TAKEN`, `INSUFFICIENT_FUNDS`, `NO_APPROVED_PRICE`, …); the same id is in the `x-correlation-id` header and in the server log line of any 5xx. `GET /api/v1/health` is the liveness/readiness probe (200, or 503 when the database is down); with `Authorization: Bearer $CRON_SECRET` it adds scheduler freshness and queue depths.
External integrations: `X-API-Key: jrk_…` + `Idempotency-Key` → `POST/GET /api/v1/jobs`, `GET /api/v1/jobs/{id}/events`; signed webhooks. See *Business → API & webhooks* in the app.
