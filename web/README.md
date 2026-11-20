# JR Logistics — web platform (Next.js + PostgreSQL)

One Next.js (App Router) codebase serving **both** the web UI and the versioned HTTP API (`/api/v1/*`) that the Flutter driver app uses.
Stack: Next 16 · React 19 · TypeScript · Tailwind v4 (brand tokens in `src/app/globals.css`) · Drizzle ORM · PostgreSQL 16 · Zod · Vitest · Playwright.

```
src/db            schema.ts (36 tables, money = integer halalas) · migrations in ./drizzle
src/server        domain services (pricing, requests, matching, jobs, settlement, wallet, support, ops, integrations, routing…)
src/server/api    tiny typed router + route modules (auth/business/driver/office/admin/external/cron)
src/app           pages: / · /login (one sign-in for every role) · /register · /account/change-password · /business · /driver · /office · /admin (staff share it, permission-gated)
src/i18n          ar · en · ur dictionaries (single source; exported to the Flutter app)
tests             unit + integration (real Postgres)        e2e   browser tests on a production build
```

## Run
```bash
cp .env.example .env.local          # set DATABASE_URL, SUPER_ADMIN_EMAIL/PASSWORD
createdb jr_logistics               # any Postgres 16
npm i && npm run db:migrate && npm run db:seed && npm run dev      # http://localhost:3000
```
`DEMO_MODE=true` (dev only) seeds demo accounts that sign in with a **username + password** (`demo.business`, `demo.driver`, `demo.office`, staff `demo.ops` / `demo.finance1` / `demo.hr` / `demo.support`; password `Demo#Pass2026`; the super admin signs in as the local part of `SUPER_ADMIN_EMAIL`, or with the e-mail address). The sign-in page lists them as quick-fill buttons. A database that existed before usernames: `npm run db:backfill:auth`. There is no one-time-code sign-in; the people staff create get a username and a temporary password they must replace at the first sign-in (staff reset a forgotten password from the account's Security tab).

## Test
```bash
createdb jr_logistics_test && npm run db:migrate:test
npm test                 # 78 unit + integration tests (real DB; never touches your dev DB)
npm run e2e              # 8 browser journeys on a production build (own server on :3100, own DB)
npm run typecheck && npm run lint
npm run i18n:export      # regenerate ../mobile/assets/i18n/*.json after editing dictionaries
```

## Deploy
`docker compose up --build` (needs `AUTH_SECRET`, `CRON_SECRET`, `SUPER_ADMIN_PASSWORD`). Read `../memory/DECISIONS.md` → *Production readiness checklist* first: SMS/payment providers, durable storage and a cron hitting `POST /api/v1/cron/tick` are required for real use. Production **fails closed** (no fake delivery code, top-up or storage).

## API at a glance
Session auth (cookie for web, `Authorization: Bearer` for mobile — send `X-Client: mobile`). Errors: `{ "error": { "code", "message", "correlation_id", "details" } }` with stable codes (`SLOT_TAKEN`, `INSUFFICIENT_FUNDS`, `NO_APPROVED_PRICE`, …).
External integrations: `X-API-Key: jrk_…` + `Idempotency-Key` → `POST/GET /api/v1/jobs`, `GET /api/v1/jobs/{id}/events`; signed webhooks. See *Business → API & webhooks* in the app.
