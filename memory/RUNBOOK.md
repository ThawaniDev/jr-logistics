# JR Logistics — Runbook: how to run everything

Written for the audit K pass (2026-11-21). Paths are relative to the repository root; `web/` commands run from `web/`.

**What was run while writing this** (always against scratch databases and scratch ports, never the dev database): `createdb`/`dropdb`, migrations (`scripts/migrate.ts`, and `drizzle-kit migrate` through `ENV_FILE`), `seed.ts` (admin only and with demo fixtures), a second dev server, production builds started with good and bad configuration, `pg_dump`/`pg_restore`, the emergency password SQL, the cron tick and both health views, `scripts/shots.mjs`, Docker compose (build, up, health, down), `tsc`, `eslint`, the whole Vitest suite and every integration file alone, Playwright specs one by one against a production build, `flutter analyze`, `flutter test`, `flutter devices`, `npm audit`/`outdated`. **Not run:** `npm run db:seed:history`, `npm run db:backfill:auth`, `npm run i18n:export` (writes the Flutter assets: the lead's step), `mobile/tool/live_test.sh` and the simulator test (the lead's), the iPhone install (no device attached in the session; the command is assembled from `flutter devices`, `ipconfig` and the app config), the stock `npm run e2e` exactly as configured (same server environment, different port and a prebuilt bundle), S3 against a real bucket.

## 0. Map

| Thing | Where | Notes |
|---|---|---|
| Web platform (UI + `/api/v1`) | `web/` | Next.js 16 (App Router, Turbopack), React 19, Drizzle ORM, PostgreSQL 16 |
| Driver app | `mobile/` | Flutter 3.38 (Dart 3.10); talks only to `/api/v1` |
| Docs | `memory/` | index in section 12 |
| Legacy system | `backend/`, `frontend/` | FastAPI/React/Mongo, read-only reference; Production still runs it |

Ports on the development Mac: **3000** dev server · **3101** Playwright production server (`E2E_PORT`) · **3102** Flutter live tests (`LIVE_PORT`) · **3100 belongs to another project (`raqeib`): never start, stop or test anything there.** Scratch servers for experiments: 3105 and up.

Prerequisites: Node 22+ (the Docker image uses 22; the Mac runs 25 — `@zxing/library` declares `node >= 24`, so Node 24 LTS is the safest common version), npm 11, PostgreSQL 16 (Homebrew: `/opt/homebrew/opt/postgresql@16/bin`, not on the default PATH — add it, or use full paths), Flutter 3.38.5, Xcode for the simulator/iPhone, Docker Desktop for the compose stack.

## 1. First-time setup (development)

```bash
cd web
cp .env.example .env.local            # DATABASE_URL, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD at least; DEMO_MODE=true for the demo accounts
createdb jr_logistics                 # any Postgres 16; the Homebrew one hosts other projects' databases too
npm install
npm run db:migrate                    # scripts/migrate.ts: reads .env.local (ENV_FILE=… for another file), advisory lock + lock_timeout, forward-only, safe to repeat
npm run db:seed                       # super admin; with DEMO_MODE=true also the demo accounts + pricing rules (idempotent, never deletes)
npm run db:seed:history -- --yes      # optional: 180 days of demo history (-- --dry-run to preview, -- --reset --yes removes only what it generated)
npm run dev                           # http://localhost:3000
```
`npm run db:migrate`, `db:migrate:run` and `db:migrate:test` (same, with `ENV_FILE=.env.test`) all run `scripts/migrate.ts` — also what the Docker entrypoint runs. It used to be `drizzle-kit migrate`, which has neither the lock nor the timeout (section 7, Migrations). **`npm run db:generate` is disabled on purpose** (it prints why and exits 1).

Accounts (all sign in with **username + password**): super admin = the part of `SUPER_ADMIN_EMAIL` before the `@` (e.g. `admin`) with `SUPER_ADMIN_PASSWORD`; demo accounts, all with `Demo#Pass2026`: `demo.business`, `demo.driver` … `demo.driver6`, `demo.office`, `demo.ops`, `demo.finance1`, `demo.finance2`, `demo.hr`, `demo.support`. The sign-in page lists them as quick-fill buttons while demo mode is on. A database that existed before usernames: `npm run db:backfill:auth`.

A second dev server next to the first one (for experiments, never on 3000/3100): `DATABASE_URL=… NEXT_DIST_DIR=.next-x npm run dev -- -p 3106 -H 0.0.0.0` (a different `NEXT_DIST_DIR` keeps it from fighting over `.next`; delete the folder afterwards, and `git checkout web/tsconfig.json` — Next adds every build folder to that file's `include`).

Restarting the main dev server (it sometimes serves a stale route table after many new files): `pkill -f "jr-logistics/web/node_modules/.bin/next dev"; rm -rf .next; npm run dev -- -H 0.0.0.0` (`-H 0.0.0.0` lets the iPhone and the LAN reach it).

## 2. Checks and tests

| What | Command | Needs | Measured |
|---|---|---|---|
| Types | `npm run typecheck` (`tsc --noEmit`) | – | 13 s |
| Lint | `npm run lint` | – | 55 s; at the end of the audit 0 errors and 1 warning (an unused variable in `tests/integration/csv-readable.test.ts`) |
| Unit tests (no database) | `npx vitest run tests/unit` | `.env.test` | seconds |
| Everything Vitest | `scripts/with-test-db.sh npx vitest run` (`npm test` without the lock) | test DB | **2358 tests / 169 files, 252–312 s** (tests ≈ 185–234 s, module import ≈ 50–58 s; 384 s for 2113 tests on a heavily loaded machine); each integration file passes **alone** too (checked, see audit report) |
| One integration file | `scripts/with-test-db.sh npx vitest run tests/integration/<file>.test.ts` | test DB | 3–10 s |
| Browser tests | `scripts/with-test-db.sh npx playwright test [e2e/<file>.spec.ts]` | test DB, builds `.next-e2e` | see section 3 |
| Flutter | `cd mobile && flutter analyze && flutter test` | – | analyze 3 s; test **817 passed / 22 skipped, 102 s** |
| Flutter live tests | `cd mobile && tool/live_test.sh [--e2e]` | test DB, simulator for `--e2e` | **not run by the audit** (the lead runs it) |
| i18n export | `cd web && npm run i18n:export` | – | writes `mobile/assets/i18n/{en,ar,ur}.json`; `tests/unit/i18n.test.ts` fails when they are out of sync |

**Test database.** `cp .env.test.example .env.test; createdb jr_logistics_test; npm run db:migrate:test`. The name must end in `_test`: `scripts/reset-test-db.ts` truncates every table of it and refuses anything else. Vitest, Playwright's global setup, the live tests and `db:migrate:test` all read `.env.test`.

**The lock.** The test database and the Playwright port are shared, so two suites must never run at once. `scripts/with-test-db.sh <command>` takes a directory lock (`/private/tmp/claude-501/jr-test-db.lock`, or `$JR_TEST_LOCK`), waits silently while another run holds it (`cat $LOCK/pid` shows who) and removes it when the command ends or its holder died. **Never edit that script in place while runs are waiting** (a shell reads a script while it executes it): write a new file and `mv` it over. Stuck lock with a dead holder: it is removed by the next caller; otherwise `rm -rf /private/tmp/claude-501/jr-test-db.lock`.

**Rules of thumb.** Vitest `fileParallelism` is off and every integration file truncates the database in `beforeEach` (`resetDb`), so files are order independent. Specs of the Playwright run share one database for the whole run (`e2e/global-setup.ts` resets and seeds it once): assert relative to a baseline and fund what you spend. Tests that need routing or B2B ON use `tests/helpers/field-modes.ts` / `e2e/field-modes.ts`. Measured with every spec file run alone (fresh DB + fresh server each, ≈ 9 minutes in total): 29 of 34 pass alone; `finance-views` and `gaps` were fixed (`e2e/settled-job.ts` `ensureSettlement()` pays one job when the database has no settlement; a wait for hydration), `reports-fin` and `reports-portals` still need data other specs create (parcels in the last 7 days, COD cash held by drivers), `reports-ops.spec.ts` is empty. A new spec must create what it asserts on (call `ensureSettlement` or build its own job through the APIs).

## 3. Playwright specifics

`playwright.config.ts` builds a **production** bundle into `.next-e2e` (`npx next build && npx next start -p 3101`), so a run starts with a 1–2 minute build. It starts the server with demo mode + the acknowledgement variable, a stub for Google Routes/Geocoding on `127.0.0.1:3199` (started by the global setup), `ALLOW_PRIVATE_OUTBOUND` for the partner stubs and made-up secrets. The database comes from `.env.test`. Reports/traces: `test-results/`. Sign-ins are rate-limited, so `e2e/helpers.ts` keeps one session per account in `e2e/.auth` (wiped by the global setup; pass `{ fresh: true }` to force a real sign-in).

A different port: `E2E_PORT=3104 scripts/with-test-db.sh npx playwright test e2e/roles.spec.ts`.

## 4. Production build and start (locally, to see what production does)

```bash
cd web
NEXT_DIST_DIR=.next-prod npm run build
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_DIST_DIR=.next-prod \
  DATABASE_URL=postgres://localhost:5432/<a scratch database> AUTH_SECRET=$(openssl rand -hex 32) CRON_SECRET=$(openssl rand -hex 32) \
  node node_modules/.bin/next start -p 3105
```
Gotchas, all observed: (1) **`next start` reads `web/.env.local`** and `.env`, even in production — an unset variable silently takes its value from there (including the dev database). `env -i` plus explicit values (or an empty value, `DATABASE_URL=`, which counts as set) avoids it. (2) A production build **refuses to start** with a bad configuration: exit code 1 within a second, JSON lines on stderr (`{"level":"fatal","msg":"config: …"}`), e.g. no `DATABASE_URL`, a missing or placeholder `AUTH_SECRET`/`CRON_SECRET`, `STORAGE_DRIVER=s3` without `S3_BUCKET`/keys. Demo/test deployments (`DEMO_MODE=true` plus `ALLOW_DEMO_IN_PRODUCTION=yes-this-is-a-demo-deployment`) may use short secrets and only get warnings. (3) `next build` writes the build folder into `web/tsconfig.json`'s `include` — `git checkout web/tsconfig.json` afterwards. (4) `SIGTERM` stops the server within about a second (it also works through `npx`), so `docker stop` is graceful.

## 5. Docker / compose

`web/Dockerfile` (node 22 alpine, three stages, runs as user `jr`, `HEALTHCHECK` on `/api/v1/health`), `web/docker-entrypoint.sh` (applies migrations, seeds the super admin when `SUPER_ADMIN_*` are set, `next start`), `web/docker-compose.yml` (Postgres 16 + the app, volumes `pgdata` and `uploads`).

```bash
cd web
AUTH_SECRET=$(openssl rand -hex 32) CRON_SECRET=$(openssl rand -hex 32) SUPER_ADMIN_PASSWORD='<strong>' docker compose up --build -d
docker compose logs -f app              # config warnings and errors are JSON lines
curl -s localhost:3000/api/v1/health
docker compose down                     # add -v to delete the database and the uploads volume
```
Compose maps port 3000: stop the dev server first or use an override file (`ports: !override ["3108:3000"]`) and `-p <project name>`.

Verified on the Mac (project `a7jr`, port 3108, removed afterwards): the image builds in about 4 minutes (1.6 GB; it was 3.15 GB before the `COPY --chown` fix), the container runs as user `jr`, migrations apply, the super admin is created and can sign in, `/api/v1/health` answers 200, the Docker `HEALTHCHECK` turns `healthy`, `/data/uploads` and `.next/cache` are writable, the start-up log shows the `config:` warnings and `{"msg":"scheduler started"}`, and a container started with `CRON_SECRET=change-me` logs a `fatal` line and stops. Not verified: a real S3 bucket, TLS/proxy settings, more than one replica.

## 6. Environment variables

Authoritative, commented list: `web/.env.example` (every variable the code reads). Summary:

| Variable | Required in production | Default / effect |
|---|---|---|
| `DATABASE_URL` | **yes** (start-up check) | – |
| `AUTH_SECRET` | **yes**, ≥ 16 chars, not a placeholder | signs delivery codes and two-step tokens; changing it invalidates both |
| `CRON_SECRET` | yes unless `INTERNAL_SCHEDULER=true` (then a warning) | `POST /api/v1/cron/tick`, deep `/health`; ≥ 16 chars, not `change-me` |
| `INTEGRATIONS_SECRET` | for warehouse-system connections | encrypts partner credentials; changing it makes stored keys unreadable |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | first start only | creates the admin (temporary password; on a non-demo deployment `seed.ts` refuses a guessable one: 12+ characters, letters and digits, no "password"/"admin"/"changeme"/"123456") |
| `APP_URL` | recommended | tracking links; default `http://localhost:3000` (warned in production) |
| `TRUSTED_PROXY` | recommended | `1` (default), `2` …, `cloudflare`, `none`; invalid values put everyone in one rate-limit bucket (warned) |
| `STORAGE_DRIVER` | yes for uploads | `s3` (+ `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SSE`) or `local` (+ `UPLOAD_DIR`); unset in production = uploads answer 503 |
| `INTERNAL_SCHEDULER`, `SCHEDULER_INTERVAL_SEC` | one of scheduler/cron | in-process housekeeping every 60 s (min 10), one instance at a time (Postgres advisory lock) |
| `GOOGLE_MAPS_API_KEY`, `ROUTE_STOPS_PER_CALL`, `GOOGLE_ROUTES_URL`, `GOOGLE_GEOCODE_URL` | optional | routing/geocoding; without the key a labelled local estimate is used |
| `NEXT_PUBLIC_MAP_TILE_URL` | before launch | map tiles (default public OpenStreetMap) |
| `DEMO_MODE`, `ALLOW_DEMO_IN_PRODUCTION`, `ALLOW_PRIVATE_OUTBOUND` | never on a real site | demo accounts/simulated top-ups; tests only |
| `DB_POOL_MAX`, `REPORT_POOL_MAX`, `ANALYTICS_CACHE_TTL_MS` | optional | 10 connections for the API (a request waits at most 20 s for one) + 4 for the analytics reports only (so a heavy report load cannot slow the API); report cache 30 s |
| `PORT` | Docker | listening port of the image |
| `ENV_FILE`, `NEXT_DIST_DIR`, `E2E_PORT`, `HISTORY_DEBUG`, `NEXT_TELEMETRY_DISABLED` | tooling | see `.env.example` |
| Flutter: `--dart-define=API_BASE_URL=…`, `--dart-define=MAP_TILE_URL=…` | build time | default `http://localhost:3000` (`10.0.2.2` on Android) |
| Live tests: `LIVE_PORT`, `DEVICE`, `SKIP_LIVE`, `JR_API` | tooling | `mobile/tool/live_test.sh` |

## 7. Operating a running instance

* **Health.** `GET /api/v1/health` → `{"status":"ok","db":{"ok":true,"latencyMs":…}}`, or 503 `DEPENDENCY_UNAVAILABLE` when the database does not answer (the reason is in the server log). With `Authorization: Bearer $CRON_SECRET` it adds `maintenance` (`lastRunAt`, `stale` after 10 minutes without a tick), `queues` (overdue/dead webhooks and partner updates) and `providers` (`sms`, `storage`, `payments` as actually configured). `status:"degraded"` = housekeeping has stopped.
* **Housekeeping.** `INTERNAL_SCHEDULER=true`, or `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/v1/cron/tick` every minute (answers the counts of what it did).
* **Logs.** One JSON line per event on stdout/stderr: `{"level":"error","ts":…,"correlationId":…,"method":…,"path":…,"name":…,"message":…,"pgCode":…,"stack":[…]}`. Every API response carries `x-correlation-id` (and `error.correlation_id` in the body): give it to whoever reads the log. Messages are scrubbed (a database error's bound parameters, passwords and tokens never reach the log; webhook secrets in URLs are redacted); every 5xx is logged. Start-up configuration problems are `level: "warn" | "fatal"` lines starting with `config:`. There is no request/access log (put one on the proxy).
* **Backups** (PostgreSQL 16 client tools; add `/opt/homebrew/opt/postgresql@16/bin` to PATH on the Mac):
  ```bash
  pg_dump -Fc -d "$DATABASE_URL" -f jr_$(date +%Y%m%d_%H%M).dump          # consistent snapshot, compressed; run before every release
  createdb jr_restore_check && pg_restore --no-owner --exit-on-error -d jr_restore_check jr_….dump   # rehearse the restore into an empty database
  ```
  Rehearsed with the scratch database: dump 0.9 s, restore 0.3 s, row counts and the 23 applied migrations identical. Restore for real into an **empty** database, point `DATABASE_URL` at it, start the app (migrations are idempotent). Also back up the uploaded documents (`UPLOAD_DIR` volume or the S3 bucket) and keep the secrets (`AUTH_SECRET`, `INTEGRATIONS_SECRET`) with the backup: without `INTEGRATIONS_SECRET` the stored partner keys cannot be decrypted. Rolling back code never rolls back data.
* **Emergency: nobody can sign in as admin.** (Staff normally reset passwords in Admin › user › Security.) On the database, with a temporary password:
  ```bash
  HASH=$(node -e 'console.log(require("bcryptjs").hashSync(process.argv[1], 11))' 'NewTemp#Pass2026')   # run in web/
  psql "$DATABASE_URL" -c "update users set password_hash='$HASH', must_change_password=true, failed_logins=0, locked_until=null where username='admin'" \
    -c "update sessions set revoked_at=now(), revoke_reason='emergency_reset' where user_id=(select id from users where username='admin') and revoked_at is null" \
    -c "delete from rate_limits where key like 'login%'"
  ```
  (Verified: old password 401, temporary password 200 with `mustChangePassword: true`.) Two-step verification, if enabled, still applies.
* **Locked out by the rate limiter** (10 sign-ins per 15 minutes per address + username): `delete from rate_limits;` or wait.
* **Secrets rotation.** `CRON_SECRET`: change the variable and the scheduler call together. `AUTH_SECRET`: every printed delivery code stops matching and pending two-step tokens fail — do it between delivery windows. `INTEGRATIONS_SECRET`: every partner connection must be re-entered. `SUPER_ADMIN_PASSWORD`: only read when the admin does not exist yet.
* **Migrations are written by hand.** `drizzle-kit generate` is unusable: the snapshots in `web/drizzle/meta/` stop at 0002, `schema.ts` declares only part of the indexes and constraints (108 of 241), so it would emit a migration that re-creates everything from 0003 on. The workflow (what migrations 0023–0028 did):
  1. Change the model in `web/src/db/schema.ts` (the code uses it) **and** write the SQL yourself: next free number after re-reading `web/drizzle/meta/_journal.json` (`NNNN_short_name.sql`).
  2. Statements are separated by `--> statement-breakpoint`. Start with `SET LOCAL lock_timeout = '10s';--> statement-breakpoint`. Make it re-runnable: `IF NOT EXISTS`, `DO $ … EXCEPTION WHEN duplicate_object THEN NULL; END $`. Add CHECK / FK constraints `NOT VALID`, and only when no existing row violates them. Forward-only: there are no down migrations (roll back with a restore).
  3. Add the entry to `_journal.json`: `{ "idx": N, "version": "7", "when": <milliseconds, strictly greater than the previous entry>, "tag": "NNNN_short_name", "breakpoints": true }`. Never edit an applied migration or reuse a number (another worker may be adding one: re-read the journal right before).
  4. Apply to the dev and test databases (`npm run db:migrate`, `npm run db:migrate:test`) and run `tests/integration/data-schema.test.ts` (schema ↔ database parity) and `migrate-lock.test.ts` through the lock.
  5. **Production**: all pending migrations run in **one transaction** at container start, serialised by a Postgres advisory lock (several replicas starting together are safe) with `lock_timeout` 30 s (`MIGRATE_LOCK_TIMEOUT_MS`): a migration stuck behind a long transaction fails fast and the container restarts. `CREATE INDEX CONCURRENTLY` is impossible inside it, so before deploying an index on a big table create it by hand first (`CREATE INDEX CONCURRENTLY IF NOT EXISTS …`); the migration's `IF NOT EXISTS` then does nothing. Which migration locks what: `memory/audit/data.md`.
  6. **Constraints that are still `NOT VALID`** (every one added by 0007 and 0023+) are enforced for new and updated rows but not trusted for old rows. Validate them off-peak, in production too: `npx tsx scripts/validate-constraints.ts --dry-run` lists them, without `--dry-run` it runs `VALIDATE CONSTRAINT` on each (SHARE UPDATE EXCLUSIVE: reads and writes continue, one table scan each; a constraint that existing rows violate is reported and left `NOT VALID`, nothing is changed; exit code 1 when any is violated). Needs `DATABASE_URL` (or `ENV_FILE`).
* **Data retention** (housekeeping jobs delete these automatically; constants in `server/snapshots.ts` `RETENTION_DAYS`, `NOTIFICATION_RETENTION` and `server/maintenance.ts`; the table of growth per table is in `memory/audit/data.md`):

  | Data | Kept |
  |---|---|
  | Driver location history | 90 days |
  | Sign-in events (`login_events`) | 400 days; the typed identifier of a failed sign-in that matched no account is erased after 30 days (the row stays for the failure-rate report) |
  | Message log (SMS records: recipient masked to the last four digits, the text is never stored) | 400 days |
  | Notifications | 90 days once read, 12 months at the most (unread too) |
  | API logs (company API calls) | 30 days |
  | Partner (warehouse-system) events | 180 days; partner outbox 90 days when sent, 180 days when dead |
  | Sessions, one-time codes (history table), rate-limit windows | 1 day after expiry |
  | API idempotency keys | 7 days |
  | **Kept for ever** | audit log, ledger, settlements, invoices, parcel and job events, request activity, hourly/daily metric snapshots, webhook deliveries, entity notes, terms consents. `job_events` / `shipment_events` grow ≈ 86 MB per 10 000 parcels per day (≈ 31 GB a year with all logs): plan partitioning at tens of millions of rows. Retention is partly a legal question (DECISIONS #9). |

  Housekeeping runs in the hourly capture tick of `POST /api/v1/cron/tick` / the internal scheduler: if `maintenance.stale` in the deep health view is true, nothing is being pruned either.
* **Browser preferences.** The theme (System / Light / Dark) is the cookie `jr_theme` (`system`, `light`, `dark`; one year, read on the server so the first byte of the HTML already carries `data-theme`; the same choice is kept in `localStorage.jr_theme`; the cookie wins when both exist). The language is the cookie `jr_lang` (`ar`, `en`, `ur`). Clearing cookies resets them; they are not personal data. The mobile app keeps its theme in shared preferences (System by default).

## 8. Mobile app

```bash
cd mobile
flutter pub get
flutter analyze && flutter test                                   # no server needed
flutter run --dart-define=API_BASE_URL=http://localhost:3000      # iOS simulator; Android emulator: http://10.0.2.2:3000
tool/live_test.sh            # isolated dev server on :3102 + the test DB, live API tests (routing off, then on)
tool/live_test.sh --e2e      # + the full journey on the iPhone 17 Pro simulator (DEVICE="…" to change)
```
`live_test.sh` resets and seeds `jr_logistics_test`: hold the lock (`web/scripts/with-test-db.sh mobile/tool/live_test.sh`) when others work on the machine. It stops whatever listens on `LIVE_PORT`.

**iPhone install (a real device).** The phone must trust the Mac (developer mode on, same Wi-Fi). The dev server must listen on the LAN: `npm run dev -- -H 0.0.0.0`. Find the Mac's address (`ipconfig getifaddr en0`; it changes with the network — the last one was `192.168.100.240`) and the device id (`flutter devices`; the owner's phone shows as "… iPhone (wireless)"):
```bash
cd mobile && flutter run -d <device id> --release --dart-define=API_BASE_URL=http://<mac lan ip>:3000
```
The app bundle id is `com.jrlogistics.jrDriver`. iOS App Transport Security does not apply to plain IP-address hosts, so `http://<ip>` works; a real release needs HTTPS (cleartext is only allowed in the Android debug manifest). Through a tunnel (ngrok) the dev server already allows `*.ngrok*` origins. The sign-in uses a username + password (`demo.driver` / `Demo#Pass2026` on the demo database).

## 9. Common problems

| Symptom | Cause / fix |
|---|---|
| `EADDRINUSE` / "another next dev server is running" | something else holds the port or the `.next` folder; pick another port and `NEXT_DIST_DIR` |
| Dev server shows 404 for new pages / old code | restart it (section 1) |
| A test run waits for ever | another run holds the lock (`cat /private/tmp/claude-501/jr-test-db.lock/pid`) |
| `Refusing to start: …` | the start-up check, section 4; fix the variables named in the log |
| `next build` fails on a type error in `tests/` or `scripts/` | the build type-checks the whole project, including tests and scripts that someone is still editing |
| `git status` shows `web/tsconfig.json` modified | a `next build` with a custom `NEXT_DIST_DIR`; `git checkout web/tsconfig.json` |
| `eslint` reports thousands of problems in `.next-*` | build folders are ignored by `.next*/**` in `eslint.config.mjs`; a new tool folder needs the same prefix |
| Uploads answer 503 "Object storage is not configured" | production with no `STORAGE_DRIVER` |
| Delivery codes / MFA answer 503 "AUTH_SECRET is not configured" | missing `AUTH_SECRET` (the production start-up check now stops the process instead) |
| Sign-in answers 429 | rate limiter, section 7 |

## 10. Scripts (`web/scripts/`)

`migrate.ts` (apply migrations with the lock, section 7) · `validate-constraints.ts` (validate the `NOT VALID` constraints, run off-peak, `--dry-run`; section 7) · `profile-reports.ts` (read-only profiler: runs every analytics report, every drill-down table and the Explorer as the super admin and prints wall time and the slowest statements: `ENV_FILE=/path/to/env npx tsx scripts/profile-reports.ts --preset 30d [--explain 400 --out plans.txt] [--exports] [--only overview,drivers] [--dump file.json]`; point it at a scratch database filled by `npm run db:seed:history -- --yes --days 365 --companies 100 --drivers 300`, never at production) · `route-inventory.ts` (security helper: every API route with its auth and permission guards, `--json`, `--flags`) · `seed.ts` (admin + demo fixtures) · `seed-history.ts` (demo history, `--help`) · `backfill-auth.ts` (usernames for pre-J1 databases) · `reset-test-db.ts` (truncate a `*_test` database) · `export-i18n.ts` · `with-test-db.sh` (lock) · `seed-mcqs.ts` (the public scenario quiz) · `shots.mjs` (screenshots of a running dev server as the demo accounts: `node scripts/shots.mjs /tmp/shots en`) · `scan-i18n.mjs` (lists the translation keys the source uses).

## 11. Release checklist (short)

1. `git status` clean apart from the intended change; `npm run typecheck`, `npm run lint`.
2. `scripts/with-test-db.sh npx vitest run`, then the Playwright run, then `flutter analyze && flutter test` and `tool/live_test.sh --e2e`.
3. `npm run i18n:export` if a dictionary changed (a unit test enforces it).
4. Backup (section 7), deploy, watch the start-up log for `config:` lines, check `/api/v1/health` (deep) and that `maintenance.stale` is false after two minutes.
5. The owner items in `DECISIONS.md` → *Production readiness checklist* (SMS, payments, storage, legal sign-off, strict CSP) are still open.

## 12. Where things are written down

| Document | What |
|---|---|
| `web/README.md`, `mobile/README.md` | the quick start of each app |
| `RUNBOOK.md` (this file), `DEPLOYMENT.md` | operating the new platform; the legacy system's owner guide |
| `DECISIONS.md` | every owner decision (A–J series) and the **production readiness checklist** |
| `PRD.md`, `SRS.md`, `TRACEABILITY.md` | requirements (historic wording: the sign-in is now username + password) and requirement → code → test |
| `PLATFORM_UPDATE_J.md`, `UI_REDESIGN.md`, `ANALYTICS.md`, `FLEET_REPORTS.md`, `PLATFORM_DATA.md`, `DATA_CAPTURE.md`, `DEMO_HISTORY.md` | what the latest rounds built and the frameworks behind reports, exports, captured data and demo data |
| `SHIPMENTS_API.md`, `INTEGRATIONS_API.md` | HTTP contracts (parcels / warehouse systems and the company API) |
| `FLOWS_*.md`, `PLATFORM_FULL_SPEC_AND_FLOWS*.md`, `PLATFORM_BUSINESS_FLOWS_SIMPLE_EN.md`, `AUDIT_SUMMARY_AR.md` | narrative flows and specs (written before J1; their OTP sign-in steps are history) |
| `AUDIT_RESPONSE.md`, `AUDIT_K.md`, `audit/*.md` | the external audit and how it was answered; the K audit brief and the per-area reports |
| `web/AUDIT.md` | the external audit report of 2026-11-05 (see `AUDIT_RESPONSE.md` for what was valid) |
