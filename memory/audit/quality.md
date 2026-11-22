# Audit A7 — platform quality, operations and configuration (2026-11-21)

Scope: env validation and fail-closed behaviour, error envelope and logging, health/ready, tests (speed, order dependence), dead code and i18n keys, stale docs, dependencies, `.env.example`, Docker, backups, page weight, plus the new **`memory/RUNBOOK.md`**. Method: started the production build on scratch ports (3105, 3106, 3107, 3108) against a scratch database (`jr_a7_scratch`, dropped afterwards) with `env -i` and bad/missing configuration; ran Vitest per file and as a whole; built and ran the Docker stack under a private compose project; measured page weight with Playwright against the production build. Never touched 3000/3100/3101, the dev database, or other workers' processes.

## Summary

| | critical | high | medium | low |
|---|---|---|---|---|
| found | 0 | 1 | 15 | 19 |
| fixed here (with test or live proof) | – | 1 | 12 | 10 |
| open / needs decision | – | – | 2 (dictionary in every page; two order-dependent report specs) | 9 |
| closed by other workers meanwhile | – | – | 1 (#11, lint errors) | – |

The one high finding: **a production build started without any fail-closed check** — it served `/health` with 200 while delivery codes and two-step sign-in could not work (no `AUTH_SECRET`), accepted `CRON_SECRET=change-me` (the value `.env.example` shipped), and a thrown start-up error would have left the server listening and answering 500. Now the process exits with code 1 and says why (verified on a production build and in a container).

## Findings

| # | severity | confidence | where | issue and impact | how verified | status |
|---|---|---|---|---|---|---|
| 1 | **high** | confirmed | `lib/env.ts` (nothing), `instrumentation.ts`, `server/auth/otp.ts:30`, `api/routes/cron.ts` | No start-up validation. Production with no `AUTH_SECRET` boots, `/health` = 200, and every delivery code (`shipments.otpFor`) and MFA step then answers 503 on first use; `CRON_SECRET` of any length/value (even `change-me`, which `.env.example` pre-filled) unlocks the public cron tick and the operator health view; `STORAGE_DRIVER=gcs` / `s3` without bucket fail only at the first upload. | Started `next start` on a production build with `env -i`: boots, 200, 503 later; with the fix: no DB + no secret → exit 1 in 1 s with 3 `fatal` JSON lines (also `CRON_SECRET=change-me`, `STORAGE_DRIVER=s3` incomplete); good config starts with only warnings; demo/e2e config (short secrets + acknowledgement) still starts. Docker: container with `CRON_SECRET=change-me` logs `fatal` and stops. A plain `throw` was not enough: Next kept listening and answered every request 500, so the check calls `process.exit(1)`. | **fixed** — new `lib/env-check.ts` (`checkEnv`, `assertProductionEnv`, `enforceProductionEnv`, `initialAdminPasswordProblem`), `instrumentation.ts`; `tests/unit/env-check.test.ts` (12) |
| 2 | medium | confirmed | `server/scheduler.ts:22,49`, `server/maintenance.ts:125` | A failing housekeeping tick printed `error.message` raw. A database error's message is the failing statement **with its bound parameters** (IBAN, phone, password hash): PII in the log on any tick failure. | Test with a Drizzle-style message was **red on the old code** (`expected '[scheduler] housekeeping every 10s…' not to match /SA0380\|966555\|params:/`), green now | **fixed** — `logError`/`describeError` everywhere; `tests/unit/scheduler-log.test.ts` |
| 3 | medium | confirmed | `server/api/router.ts` `errorResponse`, `server/health.ts`, `api/routes/common.ts:52` | Deliberate 5xx `AppError`s (503 `DEPENDENCY_UNAVAILABLE`: missing secret, storage rejected the upload, "cannot decrypt credentials — was INTEGRATIONS_SECRET changed?", database unavailable on `/health`) were **never logged**; the operator saw a failing probe and an empty log. | Production server with no `AUTH_SECRET`: hit MFA setup (503) → log empty; DB down: `/health` 503, log empty (only the scheduler complained, unstructured) | **fixed** — every 5xx logged with correlation id/method/path; `basicHealth` logs the cause; `tests/unit/error-envelope.test.ts` (6) |
| 4 | medium | confirmed | `db/index.ts` | `new Pool(...)` had no `error` listener and no `connectionTimeoutMillis`. An idle connection dropped by the database (restart, failover, `pg_terminate_backend`) became an uncaught exception that printed the whole `Client` object (195 lines); a saturated or unreachable pool made requests wait for ever. | Terminated the backends of a running production server: 195-line object dump in the log, server survived only thanks to Next's handler | **fixed** — `pool.on("error", logError)`, 20 s connect timeout; `tests/unit/db-pool.test.ts` |
| 5 | medium | confirmed | `.gitignore:34` (`.env*`), `web/README.md` | `.env.example` was **never committed** (ignored by `.env*`) although the README says `cp .env.example .env.local`; there was no template for `.env.test` either (nothing runs without it, `playwright.config.ts` hard-coded `postgres://dogorshom@…`). The file was also incomplete (no active `INTEGRATIONS_SECRET`, `DB_POOL_MAX`, `ANALYTICS_CACHE_TTL_MS`, `NEXT_PUBLIC_MAP_TILE_URL`, `ALLOW_PRIVATE_OUTBOUND`, `GOOGLE_*_URL`, `PORT`, `ENV_FILE`, `NEXT_DIST_DIR`, `E2E_PORT`, `HISTORY_DEBUG`) and pre-filled `CRON_SECRET=change-me`. | `git ls-files .env.example` empty; `git check-ignore -v` names the rule; compared with `grep process.env` over `src/` and `scripts/` | **fixed** — `.gitignore` negations, `.env.example` rewritten (every variable, grouped, required-in-production marked), new `.env.test.example`, `playwright.config.ts` reads the DB from `.env.test`. **Lead: `git add web/.env.example web/.env.test.example`** |
| 6 | medium | confirmed | `Dockerfile` | The final stage did `COPY /app` and then `RUN chown -R /app`: the recursive chown rewrote every file into a second 1.1 GB layer. Image 3.15 GB; `.dockerignore` also let `.next-*` build folders into the context. | `docker history`; rebuilt: **1.64 GB**; container runs as `jr`, uploads and `.next/cache` writable, health `healthy`, admin sign-in 200 | **fixed** — `COPY --chown`, `.dockerignore` (`.next-*`, `.env.*.local`, `e2e/.auth`, `tsconfig.tsbuildinfo`). Still 1.6 GB (dev dependencies and sources ride along: `tsx` is needed by the entrypoint) |
| 7 | medium | confirmed | `scripts/seed.ts`, `docker-entrypoint.sh` | The first super admin was created with **any** `SUPER_ADMIN_PASSWORD` (`admin`, `1`). It is temporary, but it sits in a deployment file until the first sign-in. | `ensureSuperAdmin` has no check (code); with the fix, seeding an empty database with `admin1234` is refused (exit 1) when demo mode is off, a strong password creates the admin, and an existing admin with a weak variable still starts | **fixed** — `initialAdminPasswordProblem` (12+ characters, letters and digits, no password/admin/changeme/123456); unit test; documented |
| 8 | medium | confirmed | `lib/log.ts` `scrub` | The message scrubber redacted `authorization: Bearer abc.def` only up to `Bearer` (the token stayed), `Basic <base64>` the same, and did not know company API keys (`jrk_…`), IBANs, Saudi mobiles or the secret token of an inbound webhook URL inside a message. | Probe: `"authorization: [redacted] abc123.def456"` | **fixed** — shapes added; `tests/unit/log-scrub.test.ts` (5) |
| 9 | medium | confirmed | `server/health.ts` | Deep health reported `providers.payments` from `process.env.PAYMENT_PROVIDER`, a variable nothing else reads: an operator who sets it sees a configured provider while top-ups still answer 503. | code + reading `wallet.ts` (`setPaymentProvider` is only called by tests) | **fixed** — reports the real provider (`paymentProvider().name` or null). Note: **no code path wires an SMS or payment provider from configuration** (owner item in `DECISIONS.md` #12; also `gaps.md` B2) |
| 10 | medium | confirmed | `src/app/layout.tsx` + i18n provider (A5/L1) | **Every HTML document carries the whole dictionary** of the active language as an inline script: 1.19 MB raw / **≈ 350 KB gzipped on every page, including `/login`, `/track` and `/`** (1.43 MB HTML), on top of ≈ 640 KB of JS (1.1 MB on the report pages, recharts). Slow first paint on a phone network, re-sent on every full page load. | `curl --compressed` on the production build: `/login` 351 KB on the wire, HTML 1 434 605 bytes of which the script is 1 192 234; Playwright sum of JS per route (table below) | **open** (not my files) — recommended: per-namespace dictionaries (public / portal / reports) or a cacheable `/i18n/<lang>.<hash>.json`; lazy-load recharts |
| 11 | medium | confirmed | `components/scenarios/quiz-view.tsx:852,856` (A5) | `npm run lint` **fails** (2 errors, `@next/next/no-html-link-for-pages`: `<a href="/api/v1/scenarios/export…">`), plus 3 warnings (unused `ShieldCheck`, `err`, test variable `w`). | `npm run lint` (55 s) | **closed by A5 while I worked** — `npm run lint` now: 0 errors, 1 warning (`tests/integration/csv-readable.test.ts:105`, unused `w`) |
| 12 | low | confirmed | `scripts/with-test-db.sh` | The lock lives under `/private/tmp/claude-501/`: on a machine without that folder `mkdir` fails every time and the script waits **for ever**; comment said port 3100. | read + reproduced with `JR_TEST_LOCK` | **fixed** (`mkdir -p`, `JR_TEST_LOCK`, comment). Applied with an atomic `mv` — editing it in place while three runs were waiting would have made their shells read garbage (I did edit it in place once, noticed, restored the original bytes within about 30 s and watched the waiting runs: none misbehaved) |
| 13 | low | confirmed | `scripts/shots.mjs`, `scripts/append-30-scenarios.ts` | `shots.mjs` signed in through the removed OTP endpoints with a hard-coded old admin password; `append-30-scenarios.ts` (135 KB) is a one-off that appends 30 quiz scenarios to `src/data/mcqs-data.ts`: already applied, **re-running it duplicates them**. | read; `flowNumber: 49` already present | **fixed** — `shots.mjs` rewritten (username login, verified against a scratch server: all pages `ok`), the one-off deleted |
| 14 | low | confirmed | `package.json` | Three runtime dependencies with **zero references** (src, scripts, tests, e2e, configs): `jose`, `date-fns` (26 MB), `class-variance-authority`. | grep + TypeScript import graph | **fixed** — removed from `package.json` and the lockfile only (`--package-lock-only`, `node_modules` untouched so running workers are not disturbed; `npm install` prunes them) |
| 15 | low | confirmed | `api/router.ts` | A wrong method answered 405 with the message "Not found" and no `Allow` header. | `curl -X DELETE /health` | **fixed** + test |
| 16 | low | confirmed | `server/ops.ts` | `auditTrail` and `driverDirectory` unused (definitions are the only occurrence in the repo). | grep + import graph | **deleted** (tsc/eslint clean) |
| 17 | low | confirmed | `eslint.config.mjs`, `tsconfig.json` | ESLint ignored only three named build folders; `.next-a6`, `.next-a7`, `.next-check` … would be linted. Every `next build` with a custom `NEXT_DIST_DIR` also rewrites the tracked `tsconfig.json` `include` (already has `.next-live`, `.next-check`). | read; observed after each build | eslint fixed (`.next*/**`); tsconfig drift documented in the RUNBOOK (`git checkout web/tsconfig.json`) |
| 18 | low | confirmed | docs | Stale: `DEPLOYMENT.md` described only the legacy FastAPI/Mongo/Emergent system; `web/README.md` (36 tables → 53, "78 tests" → 2 113 in 140 files, "8 browser journeys" → ≈ 315, e2e port 3100 → 3101, no `.env.test`); `mobile/README.md` ("phone-OTP sign-in"); OTP sign-in statements in `DEMO_HISTORY.md`, `DATA_CAPTURE.md`, `UI_REDESIGN.md`, `TRACEABILITY.md` AUTH-001. | read against code | **fixed** (those lines; `DEPLOYMENT.md` now new-platform first + legacy appendix; new `RUNBOOK.md`). Left as history: PRD/SRS/FLOWS/PLATFORM_FULL_SPEC (their wording is "historical design"; A8 lists the contradictions) |
| 19 | low | confirmed | `mobile/test/integration/live_api_test.dart:50`, `mobile/tool/live_test.sh` | Skip message suggests `JR_API=http://localhost:3100` (another project's port); the script hard-codes `postgres://dogorshom@…` three times and `/tmp/jr-live-server.log`. | read | open (A6 area; trivial: 3102, `$TEST_DATABASE_URL`) |
| 20 | low | confirmed | `Dockerfile` / dev machine | Node 22 in the image, Node 25 on the Mac, `@zxing/library` declares `node >= 24` (EBADENGINE warning in the build), `@types/node` is `^20`, no `engines`. | Docker build log | open — decision: use Node 24 LTS everywhere and add `engines` |
| 21 | low | confirmed | `server/auth/otp.ts` | File name stale: no OTP sign-in exists; it holds the SMS provider boundary and `signingSecret`. | read | open (rename touches ≈ 10 imports; do with A1) |
| 22 | low | confirmed | `package.json` | `npm audit --omit=dev`: **0 vulnerabilities**. Full `npm audit`: 11 moderate, dev-only (`esbuild ≤ 0.24` through `drizzle-kit`; `minimatch` through the ESLint toolchain) — fixes need `--force` (breaking). Patch updates available (next 16.4.6, react/react-dom 19.3.1, @playwright/test 1.65.1, tailwind 4.3.5, recharts 3.11, lucide 1.77, dotenv 18.0.10, jose…) are **not** applied: nothing in the production audit calls for them, I cannot show they are security fixes, and they would touch every test while seven workers edit. | `npm audit`, `npm outdated` | open (report) |
| 23 | low | confirmed | test infrastructure | Each integration test truncates 53 tables (`resetDb`, median **109 ms**) — about 3 of the 5 minutes of test time. Truncating only tables that have rows would take ≈ 20 ms but changes identity-restart behaviour: not done. | timed 10 truncates | open (suggestion) |
| 24 | low | probable | `docker-entrypoint.sh` + `scripts/seed.ts` | The seed re-creates the configured admin at every start when no user has that e-mail any more (e.g. the e-mail was changed): a second super admin with the deployment-file password (temporary, must be changed, but exists). Admins cannot change their own e-mail through the UI today, so it needs a manual database edit. | code argument | open — decision: create the admin only when the database holds **no** admin |
| 25 | low | confirmed | operations | No request/access log and no liveness/readiness split: `/health` answers 503 when the database is down, so an orchestrator that restarts unhealthy containers restarts a perfectly fine app. | read | open — recommended: access log on the proxy; `/health/live` (always 200) if the orchestrator restarts on failure |
| 26 | low | confirmed | `lib/errors.ts` / router | 5xx `AppError` messages go to the client ("AUTH_SECRET is not configured", "Object storage rejected the upload (HTTP 403)"): they reveal configuration state to anybody who triggers them (the MFA token route is public). | observed | open — recommended: generic client message for 5xx, detail only in the log (changes API wording; owner call) |
| 27 | low | confirmed | `e2e/data-activity.spec.ts:100,128` | Two tests ended in `test.skip(!(await el.count()), "no detail page embeds … yet")`: `count()` is read the instant the page hydrates, so a slow render — or a removed `<ActivityLog>` / `<NotesPanel>` — turned into a green **skip**. Left over from before the components were embedded. (`integrations-connections.spec.ts:88` skips when its predecessor made no connection: acceptable, the predecessor fails loudly.) | read; the assertions that follow already require the element | **fixed** — guards removed, explicit `toBeVisible()` |
| 28 | medium | confirmed | `e2e/finance-views.spec.ts` | **Passes only in the full run**: "settlements: the status filter lives in the URL…" reads *the newest settlement* (first `tbody tr`); a freshly seeded database has none → 60 s timeout, four serial tests never run. | Ran the spec alone: 1 failed (timeout), 4 did not run | **fixed** — new `e2e/settled-job.ts` `ensureSettlement()` (pays one demo job through the APIs when the list is empty; routing switched on for its length and restored) called from `beforeAll`; alone: **7 passed, 12 s** |
| 29 | medium | confirmed (cause probable) | `e2e/gaps.spec.ts` | **Passes only after another spec**: "a staff member with a temporary password is forced to change it…" — alone, the hint "must be different from the current one" never appears; after `flows.spec.ts` the same test passes. The test types into the change-password form right after a server-side redirect, before React has hydrated; on a cold server the typing is lost. | alone: failed; `flows` + `gaps` together: 13 passed | **fixed** — waits for `html[data-hydrated]` first; alone now **6 passed, 11 s** |
| 30 | medium | confirmed | `e2e/reports-fin.spec.ts`, `e2e/reports-portals.spec.ts` | **Pass only in the full run**: "charts have a table view…" needs parcels of the last 7 days (an empty chart is an empty state, not `role="img"`); the COD test needs cash held by drivers (aging bucket "15 days or more"), which only the COD/field-ops specs create; the portals spec's "forged filter … were ignored" needs data of the demo business. After `flows.spec.ts` the portals spec and the first reports-fin test pass, the COD one still fails. | alone: 1 failed + 9 / 20 did not run; combinations | **open** — both files were being edited by another worker; recommended: `ensureSettlement` (parcels) + a COD fixture in `beforeAll` |
| 31 | low | confirmed | `e2e/reports-ops.spec.ts` | The file is **0 bytes** (committed empty): no browser test visits `/admin/reports/operations` or the geography/demand pages. | `wc -c`; grep of `e2e/` | open |
| 32 | medium | confirmed | `scripts/with-test-db.sh` | A holder killed between `mkdir` and writing its `pid` file left a lock directory with **no pid**: the stale-lock check needed a pid file, so every waiter waited for ever — three queued runs sat in the loop for **4 hours** after the usage-limit cut-off (found when I resumed). | `ls -la` of the lock; waiters' elapsed time | **fixed** — a pid-less lock older than a minute is taken over; a fresh pid-less lock is respected (both checked in a scratch lock directory); applied by atomic `mv` |
| 33 | low | confirmed | `package.json` | `db:migrate` / `db:migrate:test` ran `drizzle-kit migrate`, which has none of the advisory lock / `lock_timeout` of `scripts/migrate.ts` (A4 finding 5); `db:generate` would re-create migrations 0003+ (snapshots stop at 0002, A4 finding 17). | read; ran both on a scratch database | **fixed** — the three migrate scripts run `scripts/migrate.ts` (29 migrations applied twice, second run a no-op); `db:generate` prints why it is disabled and exits 1; hand-written migration workflow documented in the RUNBOOK |
| 34 | medium | confirmed | `db/index.ts`, `server/analytics/guard.ts` | (A4 finding 19, handed to me) A heavy report load fires ≈ 35 statements; six at once on the shared pool delayed a trivial `select 1` by up to 1 s. | A4's starvation experiment | **fixed** — second small pool `REPORT_POOL_MAX` (default 4, `application_name=jr-reports`) used only by `timed()`; `tests/unit/db-pool.test.ts` + `tests/integration/report-pool.test.ts` |
| 35 | low | confirmed | `tests/integration/details-orders.test.ts:232` | **Flaky**: the test inserts two chat messages with one `INSERT … VALUES (a), (b)` — both rows get the same `now()` — and then asserts their order (`["Please call me", "OK"]`); the API orders by `created_at`, so a tie came back reversed once in the final full run (it passed in the earlier full run and alone). Not a product bug (two messages in the same millisecond of one thread do not happen). | observed in the whole-suite run; code reading | **fixed** — explicit distinct `createdAt` |

(Fixed: 1–9, 12–18, 27–29, 32–35; closed by others: 11; open: 10, 19–26, 30 and 31.)

## Page weight (production build, JS/CSS decoded, one cold load each)

| Page | JS | CSS | HTML |
|---|---|---|---|
| admin reports (operations / explorer / finance / overview), business reports, office performance | 1.1–1.14 MB | 122 KB | 1.45–1.49 MB |
| business new request | 755 KB | 122 KB | 1.43 MB |
| everything else measured (landing, login, track, admin lists, roles, settings, map, finance › drivers, driver and office home) | 634–682 KB | 122 KB | 1.40–1.50 MB |

Gzipped HTML 350–367 KB on `/login`, `/track`, `/` — see #10.

## Tests: speed and order dependence

* **Vitest, whole suite** (through the lock, verbose): **2 113 tests / 140 files, 384 s** wall (tests 307 s, module import 57 s) on a machine at load average 13 (other workers). 2 111 passed, 2 failed — both `tests/unit/i18n.test.ts`, both caused by in-flight light-mode work (source used `theme.*` keys that were not in the dictionaries yet; Flutter JSON export out of sync).
* **Vitest, final whole run** (`tests/unit` + `tests/integration`, through the lock, after all changes, last run after the session restart): **2 358 tests / 169 files, 252 s (tests 185 s, import 50 s); 2 357 passed, 1 failed** — `tests/unit/i18n.test.ts` "Flutter assets are in sync with the web dictionaries": the lead's pending `npm run i18n:export` (10 427 keys in the JSON vs 10 544 in the dictionaries). My 29 new tests (6 files) pass. Earlier runs of the same day showed what other workers' in-flight work does to the suite (7 failures from A4's new CHECK constraints meeting two old tests, A1's new security test red for hours; one run with 19 failures, 16 of them **mine** — the report-pool change broke two unit-test mocks of `@/db`, fixed within the hour). The first full run (02:26) ran inside the 21:00–24:00 UTC window where the UTC date differs from the Riyadh date: no date-related failure.
* **Slowest**: per file in that run `pricing-edit` 27 s, `csv-readable` 14 s, `portal-analytics` 11 s … but those were load artefacts: `pricing-edit` alone takes **1.15 s** of tests (3.4 s with import). No single test is inherently slow; the floor is the per-test `resetDb` truncate (≈ 109 ms, #23) plus ≈ 0.4 s of module import per file.
* **Order dependence, Vitest**: every integration file truncates the database in `beforeEach` (checked: the only exception is the new `migrate-lock.test.ts`), `fileParallelism` is off, unit files are isolated forks. Ran **each integration file on its own** through the lock: all 53 files present at the start pass alone. No file depends on another.
* **Order dependence, Playwright** — ran each spec file **alone** (fresh database through `global-setup`, fresh production server on :3107, one lock hold per batch): 34 files, **29 pass alone, 4 do not, 1 is an empty file**. Whole sweep ≈ 8.8 minutes of test time (2–33 s per spec; the slowest alone: `account-create` 33 s, `driver-field-ops` 32 s, `details-driver-office` 27 s, `fleet-reports` 23 s, `flows` 22 s). Files that pass **only in the full run**:
  * `finance-views.spec.ts` — "settlements: the status filter lives in the URL…" reads *the newest settlement* (`tbody tr` first row); on a fresh database there is none → 60 s timeout, four serial tests never run. **Fixed**: `e2e/settled-job.ts` `ensureSettlement()` (pays one demo job through the APIs when the list is empty; routing switched on for its length and restored) called from `beforeAll`; alone it now passes (**7 passed, 12 s**).
  * `gaps.spec.ts` — "a staff member with a temporary password is forced to change it…": alone, the hint "must be different from the current one" never appears; after `flows.spec.ts` it passes. Cause: the test types into the change-password form right after a server-side redirect, before React has hydrated, and on a cold server the typing is lost. **Fixed** (wait for `html[data-hydrated]`): alone it now passes (**6 passed, 11 s**).
  * `reports-fin.spec.ts` — "charts have a table view…" needs parcels of the last 7 days (an empty chart renders an empty state, not `role="img"`); the COD test needs cash held by drivers (aging bucket "15 days or more"), which only the COD/field-ops specs create. After `flows.spec.ts` the first passes, the COD one still fails. **Open** — the file is being edited by another worker; recommended: call `ensureSettlement` (parcels) and a COD fixture in `beforeAll`.
  * `reports-portals.spec.ts` — "a forged … filter is ignored and says so" needs data for the demo business (the notice is not shown on an empty report); passes after `flows.spec.ts` (39 tests passed in that combination). **Open**, same recommendation.
  * `reports-ops.spec.ts` is **0 bytes** (committed empty): the operations reports have no browser test at all (nothing else in `e2e/` visits `/admin/reports/operations`).
  * `business-cash-columns.spec.ts` failed alone in my first pass at its first "nothing scrolls sideways at 390 px" check, then passed on a fresh build: that was a stale build of in-flight work, not order.
  * Other flakiness signals: only 7 `waitForTimeout` calls in 6 files; two silent `test.skip` guards removed (#27).

## Needs owner decision

| Question | Recommended default |
|---|---|
| Dictionary delivery (#10): how to stop shipping the whole dictionary in every page | per-namespace dictionaries (public / portal / reports) loaded by layout, then lazy recharts; target < 150 KB gzipped HTML on `/login` |
| Node version (#20) | Node 24 LTS in Docker, CI and the Mac; add `"engines": { "node": ">=24" }` |
| Seed re-creating the env admin (#24) | create it only when the database has no admin at all |
| 5xx messages to clients (#26) | generic text to the client, detail in the log |
| Dependency policy (#22) | apply the patch-level bumps (next 16.4.6, react 19.3.1, playwright 1.65.1) in one commit when no worker is mid-run; then re-run everything |
| Access log / `/health/live` (#25) | proxy access log; add the liveness route only if the orchestrator restarts on unhealthy |

## Cross-area (not touched)

* **A5/L1** — orphan files nobody imports: `src/app/(app)/business/integrations/activity.tsx` (`ActivityLog`, `FailedUpdates`), `src/components/features/admin-accounts.tsx` (`AccountModal`), `src/components/features/office-reports.tsx` (2 lines). Dictionary in every page #10. 9 OTP-login leftovers in the dictionaries with no use anywhere (`auth.change_number`, `auth.code`, `auth.demo_code`, `auth.demo_code_hint`, `auth.send_code`, `auth.staff_prompt`, `auth.staff_sub`, `auth.staff_title`, `auth.verify`) — and about 1 970 of the 10 413 keys have no literal reference (most belong to report families that build keys dynamically — `rpq.*`, `rpd.*`, `dv1/dv3.*`, `fr.*` — so they are not all dead; removing needs a runtime usage trace, not a text search).
* **A6** — finding 14 of `mobile.md` (whole dictionary bundled in the app): a `--mobile` subset in `scripts/export-i18n.ts` would also need `tests/unit/i18n.test.ts` ("assets in sync") changed; not done here. `live_test.sh` hard-codes (#19).
* **A8 asked** — no UI for `deepHealth()`: it is JSON for a monitor, documented in the RUNBOOK (section 7); a Settings › System status card is a feature, not a fix. `x-app-version`: not added.
* **A1** — `server/auth/otp.ts` rename (#21). Nothing else needed: no secret is committed (`git ls-files` scan: only AWS's documented example key in `tests/unit/s3.test.ts`); `NEXT_PUBLIC_*` holds only the tile URL.
* **A3** — `maintenance.ts:125` used `error.message` (fixed, one line); the file is otherwise theirs.

## Checked and fine

* **Fail-closed in production** (verified live): no implicit local storage (503 until configured), demo mode ignored without the long acknowledgement, `/auth/demo-accounts` 404, cookies `HttpOnly; SameSite=Lax; Secure`, HSTS and the API CSP present, `x-powered-by` off, cron guard uses `timingSafeEqual` and refuses an empty secret, deep health only with the secret, no PII in it.
* **Error envelope**: one shape for validation, domain, pg-mapped (23505/23503/23514/22P02/22003…) and unexpected errors; `x-correlation-id` header = body id; a client id is echoed only when `[A-Za-z0-9_.-]{1,64}`; malformed JSON 422; 4 MB body cap answered 413 with `max` (100-Continue case checked with a 5 MB body); the generic 500 never carries the cause.
* **Logging**: one JSON line per event, stack limited to six frames, message capped at 300 characters, bound parameters cut, webhook tokens redacted in the logged path; `x-correlation-id` ties a client error report to a log line.
* **Shutdown**: `SIGTERM` to the server or to the `npx` parent ends it in ≈ 1 s (verified), the advisory lock of the scheduler dies with its connection; scheduler timer is `unref`'d and cannot stack ticks.
* **Backups**: `pg_dump -Fc` → `pg_restore --no-owner --exit-on-error` into an empty database: identical row counts and migration table (rehearsal in the RUNBOOK). Emergency admin password reset recipe verified (old password 401, temporary 200, `mustChangePassword`).
* **Docker**: image builds, migrates, seeds, serves, `HEALTHCHECK` healthy, non-root user, volumes writable.
* **Dev server** on a second port with its own `NEXT_DIST_DIR` works (RUNBOOK section 1).
* **`.env.example` completeness**: every `process.env.*` read in `src/`, `scripts/`, `drizzle.config.ts`, `playwright.config.ts`, `next.config.ts` is now listed (`grep -rhoE "process\.env\.[A-Z_0-9]+"`).
* **Flutter**: `flutter analyze` clean (3 s); `flutter test` **817 passed, 22 skipped, 102 s**.
* **Typecheck** `tsc --noEmit` 13 s clean at the end of the audit (and `eslint .`: 0 errors, 1 warning) (it was red for several minutes at a time while other workers' tests were in flight — those errors also make `next build` fail because the build type-checks `tests/` and `scripts/`).
* i18n: 10 413 keys in each of en/ar/ur, no missing/extra keys.

## Appendix A — exported symbols nothing references (73; TypeScript checker + word search; none deleted outside `ops.ts`)

Found with a checker-based script (symbol references across `src`, `tests`, `e2e`, `scripts`) and confirmed by a word search that the name occurs exactly once in the repository. Not deleted: they sit in files other workers own and are being edited. Dynamic-import users (`health.deepHealth`, `scheduler.startScheduler`, `accounts.ensureSuperAdmin`) are false positives of the checker and excluded. A further ≈ 600 exports are used only inside their own file or only by tests.

- `src/components/features/admin-accounts.tsx`:  L45 AccountModal
- `src/components/features/admin-common.tsx`:  L166 BusinessName  L47 FilterBar
- `src/components/features/admin-create-lib.ts`:  L14 isKind  L15 LANGS
- `src/components/features/admin-fieldops-lib.ts`:  L228 SETTLE_FILTERS
- `src/components/features/admin-offices-lib.ts`:  L10 JobScope  L6 OfficeState  L12 UserRoleFilter
- `src/components/features/admin-shipments.tsx`:  L16 ParcelStats
- `src/components/features/admin-system-lib.ts`:  L123 AuditPeriod  L177 StaffFilter
- `src/components/features/driver-stops-shared.tsx`:  L37 isFailedStop
- `src/components/features/office-lib.ts`:  L118 isPeriod
- `src/components/features/partner-orders-lib.ts`:  L17 EMPTY_COUNTS
- `src/components/features/partner-orders-parts.tsx`:  L19 ADMIN_API
- `src/components/reports/explorer/explorer-lib.ts`:  L6 CatalogColumn  L25 EXPLORER_PARAMS
- `src/components/reports/fin/fin-lib.ts`:  L88 OUTCOME_COLORS
- `src/components/reports/fin/parts.tsx`:  L82 barTable
- `src/components/reports/ops/geo-lib.ts`:  L16 seriesPoints
- `src/components/reports/ops/ops-lib.ts`:  L55 funnelLabel
- `src/components/reports/people/people-lib.ts`:  L31 durBuckets  L51 fmtBy
- `src/components/reports/portal/lib.ts`:  L93 FLAG_KEYS
- `src/db/schema.ts`:  L1045 EntityNote  L1042 LoginEvent  L1044 MessageLogRow  L625 payoutBatches  L1043 ShipmentEvent
- `src/lib/ids.ts`:  L4 numericCode
- `src/lib/money.ts`:  L4 fmtSar  L2 toCents
- `src/lib/username.ts`:  L7 USERNAME_MAX
- `src/server/access.ts`:  L21 requestAccess
- `src/server/accounts.ts`:  L109 findByPhone
- `src/server/activity-sql.ts`:  L32 NO_ACTOR
- `src/server/analytics/cod-live.ts`:  L51 LiveCash
- `src/server/analytics/companies-lib.ts`:  L19 perPair  L22 round1  L79 withUnfiltered
- `src/server/analytics/finance-live.ts`:  L90 SnapSeries
- `src/server/analytics/growth-lib.ts`:  L19 StalledReason
- `src/server/analytics/ops-demand.ts`:  L54 SpeedFacts
- `src/server/analytics/ops-kinds.ts`:  L36 GeoSection  L32 OpsSection
- `src/server/analytics/periods.ts`:  L68 bucketCount
- `src/server/analytics/portal-definitions.ts`:  L76 SHARED_KPI_KEYS
- `src/server/analytics/support-series.ts`:  L89 QualityPoint
- `src/server/demo-history/calendar.ts`:  L14 ksaDateKey
- `src/server/demo-history/ids.ts`:  L42 PERSON_PHONE_LIKE
- `src/server/demo-history/load.ts`:  L80 usableServices
- `src/server/demo-history/prng.ts`:  L79 round2
- `src/server/demo-history/types.ts`:  L79 WithdrawalPlan
- `src/server/demo-history/world.ts`:  L206 WORLD_MIN
- `src/server/details-people-lib.ts`:  L211 rateOrNull
- `src/server/details-people-money.ts`:  L16 MoneyPart
- `src/server/details-pure.ts`:  L45 isCompanyPeriod
- `src/server/finance-drivers-cols.ts`:  L10 DRIVERS_TABLE
- `src/server/finance-drivers-lib.ts`:  L43 FD_KEYS
- `src/server/partners/orders-core.ts`:  L100 orderForParcel
- `src/server/partners/service.ts`:  L376 OrderView
- `src/server/partners/types.ts`:  L51 PUSH_ACTIONS
- `src/server/views.ts`:  L149 assertStaff

## Appendix B — what changed (files)

New: `web/src/lib/env-check.ts`, `web/.env.example` (now committable) and `web/.env.test.example`, `web/e2e/settled-job.ts`, `memory/RUNBOOK.md`; tests `tests/unit/{env-check,scheduler-log,error-envelope,db-pool,log-scrub}.test.ts` and `tests/integration/report-pool.test.ts`.
Edited (web): `src/instrumentation.ts`, `src/lib/log.ts`, `src/db/index.ts` (pool error handler, connect timeout, report pool), `src/server/{health,scheduler,maintenance,ops}.ts` (one line in `maintenance.ts`, two dead functions removed from `ops.ts`), `src/server/analytics/guard.ts` (one line: report pool), `src/server/api/router.ts` (5xx logging, 405 message and `Allow`), `scripts/{seed.ts,shots.mjs,with-test-db.sh}`, `package.json` + lockfile (three unused dependencies out, migrate scripts, `db:generate` disabled), `playwright.config.ts`, `eslint.config.mjs`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.gitignore`, `README.md`, `e2e/{finance-views,gaps,data-activity}.spec.ts`.
Edited (docs): `mobile/README.md`, `memory/{DEPLOYMENT,DEMO_HISTORY,DATA_CAPTURE,UI_REDESIGN,TRACEABILITY}.md`.
Deleted: `scripts/append-30-scenarios.ts`, `ops.auditTrail`, `ops.driverDirectory`.
Temporary, removed at the end: `web/playwright.a7.config.ts`, `web/.next-a7`, scratch databases and ports 3105–3109.
Not run by me (the lead's): `npm run i18n:export`, `mobile/tool/live_test.sh`, the iOS simulator test.
