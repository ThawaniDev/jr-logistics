# JR Logistics — Owner Deployment & Operations Guide

> **Which system?** The platform that is being built and tested today is `web/` (Next.js + PostgreSQL) with the Flutter driver app in `mobile/`. This page covers that system first. The old FastAPI/React/MongoDB system on Emergent (`backend/`, `frontend/`) is described at the end under *Legacy system*; **Production is still the legacy system** until the new one is released. Commands, environment variables, backups and the day-to-day how-to are in **`RUNBOOK.md`**; the owner decisions and the production checklist are in **`DECISIONS.md`**.

## New platform (`web/` + `mobile/`)

### Environments
| Where | What | Port | Database |
|---|---|---|---|
| Development | `npm run dev` in `web/` | 3000 | `jr_logistics` (demo accounts, 180 days of demo history) |
| Automated tests | Vitest (no server) and Playwright (production build) | e2e 3101 (`E2E_PORT`) | `jr_logistics_test` — wiped by every run |
| Flutter live tests | `mobile/tool/live_test.sh` (dev server) | 3102 (`LIVE_PORT`) | `jr_logistics_test` |
| Production | `docker compose up --build` (staging) or any host that runs the Docker image / `next start` behind a TLS proxy | 3000 inside the container | a managed PostgreSQL 16 |

Port 3100 belongs to another project on the development Mac: never start anything on it.

### Starting production
1. Set `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` (16+ random characters each — `openssl rand -hex 32`), `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (12+ characters, letters and digits; a guessable one stops the first start), `APP_URL` (the public https address), `TRUSTED_PROXY`, a storage driver (`STORAGE_DRIVER=s3` + `S3_*`, or `local` + `UPLOAD_DIR` on a persistent volume) and `INTEGRATIONS_SECRET`. Every variable is explained in `web/.env.example` and in the table in `RUNBOOK.md`.
2. The container entrypoint applies pending migrations, creates the super admin if it does not exist, and starts the server. **A production build refuses to start** (exit code 1, the reasons as JSON lines in the log) when `DATABASE_URL` or `AUTH_SECRET` is missing, when `AUTH_SECRET` / `CRON_SECRET` is shorter than 16 characters or a placeholder such as `change-me`, or when the storage driver is unsupported or incomplete. Less serious problems (no `INTEGRATIONS_SECRET`, `APP_URL` pointing at localhost, demo mode switched on…) are logged as warnings.
3. Housekeeping (webhook retries, expiry, settlements) needs either `INTERNAL_SCHEDULER=true` or an external call of `POST /api/v1/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.
4. Health: `GET /api/v1/health` answers 200 (or 503 when the database is down). With the cron secret it also shows when housekeeping last ran, queue depths and which providers are configured; `status: "degraded"` means the housekeeping has stopped for more than 10 minutes.

### Data safety
- All data is in PostgreSQL. Migrations are forward-only and run at every start; a code-only update does not touch data. Rolling back the code does **not** roll back the database: take a backup before every release (`pg_dump -Fc`, see `RUNBOOK.md` → Backups, with the restore rehearsal).
- Uploaded documents live in the configured storage (S3-compatible bucket or the `UPLOAD_DIR` volume) — back that up too.
- The demo seed and the demo history generator are for development databases only; production never creates demo accounts.
- **Migrations** are hand-written SQL (`drizzle-kit generate` is disabled), run in one transaction under a Postgres advisory lock with a 30 s `lock_timeout` at every start. Some constraints are added `NOT VALID`: validate them off-peak after a release with `npx tsx scripts/validate-constraints.ts --dry-run`, then without `--dry-run`. Adding an index to a big table: create it first by hand with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. Details in `RUNBOOK.md` → Operating a running instance.
- **Retention** (automatic, hourly): location history 90 days; sign-in events 400 days (identifier of unknown-account failures erased at 30); message log 400 days; notifications 90 days when read / 12 months at most; API logs 30 days; partner events 180 days, partner outbox 90 (sent) / 180 (dead); sessions, one-time codes and rate-limit windows 1 day; idempotency keys 7 days. The audit log, ledger, settlements, invoices and parcel/job events are kept for ever. Table in `RUNBOOK.md`; retention is partly a legal question (`DECISIONS.md` #9).

### Sessions
Web sign-in sets an HttpOnly `jr_session` cookie (7 days); the mobile app uses a bearer token (30 days). Everybody signs in with **username + password**; there is no one-time-code sign-in and no self-service password reset — staff reset a password from the account's Security tab. A temporary password (new staff, resets, the first super-admin password) must be replaced at the first sign-in.

### External integrations status
| Integration | Status |
|---|---|
| SMS | **Not connected.** Demo mode only simulates it. Recipient delivery codes and tracking links need a provider (`setSmsProvider`, `server/auth/otp.ts`); production refuses instead of faking. |
| Payments / wallet top-up | **Simulated** in demo mode; in production top-up answers `DEPENDENCY_UNAVAILABLE` until a provider is connected (`setPaymentProvider`, `server/wallet.ts`). |
| Document storage | `STORAGE_DRIVER=s3` (AWS S3, Cloudflare R2, MinIO) or `local` on a persistent volume; nothing else works in production. |
| Google Maps (routing, geocoding) | Optional `GOOGLE_MAPS_API_KEY`; without it routes use a labelled straight-line estimate. Routing is also a super-admin setting (off by default). |
| Warehouse systems / company API | **Working**: `X-API-Key` API, signed webhooks, partner connections (`INTEGRATIONS_SECRET` required). |
| Push notifications, masked-call relay, e-invoicing (ZATCA) | Not built (owner items in `DECISIONS.md`). |

### Admin access
The super admin is created from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` the first time the server starts; it signs in as the part of the e-mail before the `@` (or with the e-mail) and must change the password at the first sign-in. An existing admin's password is never overwritten by a restart. Staff accounts and roles are managed in Admin › Staff and Admin › Roles & permissions.

---

## Legacy system (FastAPI + React + MongoDB on Emergent) — still Production today

### Environments
- **Preview**: React on :3000, FastAPI on :8001, MongoDB local. Hot-reload on code changes. Use it to test every update before release.
- **Production**: managed by Emergent. Deploy/redeploy via the platform's Deploy button (or ask the agent to deploy). The public URL stays the same on ordinary redeploys — existing customers and drivers keep their accounts; no re-registration needed.

### Requesting updates
Ask in chat (code, design, or feature changes). Changes are applied to the codebase, hot-reload in Preview, and only go live after you deploy/redeploy to Production. Routine operations (pricing rules, account approvals, suspensions, settings) are done in the **Admin Dashboard** and never require a redeploy.

### Data safety
- Production data lives in the production MongoDB bound to the deployment. Ordinary updates (code only) do **not** touch the database — no fresh DB, no data deletion.
- Backend writes are schema-flexible (MongoDB); the platform has no destructive migrations. `seed.py` is idempotent and never deletes data (as of iteration 16 it also never overwrites an existing admin password).
- Before significant changes: export a backup — `mongodump` of the production DB (or ask support for a snapshot). Rollback: use the platform's rollback/checkpoint feature to restore a previous code release instantly; note that rollback restores **code**, not data written after the release.

### Secrets / environment variables
- Preview and Production have **separate** env stores. Manage production secrets via the platform's Secrets UI (Re-publish → Secrets tab). Keys used: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `EMERGENT_LLM_KEY` (object storage).
- Never commit real secrets; `.env` files are environment-specific.

### Sessions & caching
- Sessions use per-tab tokens (sessionStorage) — multi-tab isolation by design. After an update, long-open browser tabs may need a refresh; users are not logged out (7-day JWT).

### External integrations status
| Integration | Status |
|---|---|
| SMS OTP | **Simulated** in preview (`demo_otp` returned by API). Needs a real SMS provider (e.g., Twilio) for production. |
| Payments / wallet top-up | **Simulated** ledger. Needs a real payment gateway (Stripe/Moyasar/HyperPay) before charging real customers. |
| Document storage | Local persistent storage fallback (`/app/backend/uploads`) works; cloud object storage requires Universal Key balance (Profile → Manage plan → Universal Key → Add Balance). |
| Company API (B2B) | **Working**: `/api/v1/jobs` with `X-API-Key` auth, call logging, webhook deliveries recorded. |

### Admin access
- Single super admin: emadabuharb1993@gmail.com. Password reset performed securely (bcrypt) on 2026-06; `must_change_password` flag is set — change it at first login via Admin Settings → change password form.
- Staff accounts and role presets managed from Admin → Staff.
