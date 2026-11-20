# Fleet reports — drivers and courier offices (decisions I1–I12, 2026-11-20)

Owner request: *"The drivers and courier offices reports need to be more and more advanced and contain more data — see the Thawani project (`/Users/dogorshom/Desktop/Thawani/thawani`, Laravel), page `/admin/delivery-aggregators/{id}`: collect all types of data to be exported and organise it better."*

This file is the **contract** the workstreams build against. Report framework rules are in `ANALYTICS.md` (filters, KPI objects, drill tables, honesty rules) — read it first.

## 1. What Thawani does (and what we map it to)

Thawani's aggregator page = KPI strip + seven tabs, each a table with a date range (default last 30 days, max 1 year) and an Excel export that ends with a "how to read this" notes block:

| Thawani tab / export | Source (Laravel) | Ours |
|---|---|---|
| Delegates (fleet list, live status, current order) | `delegatesData` | existing office › Drivers tab (unchanged) |
| Orders (all orders of the fleet, status filter) | `ordersData` | **`jobs` table** (one row per job = accepted offer) |
| Earnings (commission per order: type, distance, base km, extra km) | `earningsData` | **`earnings` table** (one row per settlement: customer price, provider net, margin, VAT, status, paid) |
| Performance report (one row per day for the whole fleet) | `aggregatorDailyReport` | **`daily` table** (one row per Riyadh day) |
| Delegates performance report (one row per delegate, ~28 columns, day-by-day block appended) | `delegateReportBundles` | **`perf` table** (one row per driver) + workbook "Daily by driver" sheet |
| Performance × finances, daily | `perDay` | **`money_daily` table** |
| Delegates performance × finances | `perDelegate` | **`money` table** |
| All-aggregators overview + "Platform Direct" row | `allCompaniesSummaryReport` | offices **`perf` table**: one row per office + one "Independent drivers" row |
| Notes block in every export (date basis, population, distance definition) | `reportNotes` | the workbook's **Notes** sheet + `notes` in the API response |

Thawani metrics we **adopt** (mapped to our data): on-time / late / very late, average delivery time, average travel / wait / handover time, store→customer radius distance, orders per active day, active days, online days, efficiency (delivered per online hour), offers received, declined vs timed out, decline rate, average response time, ratings count + average, penalties, cash by payment bucket and who holds it, daily fleet counts (registered / connected / with orders). Thawani things that do **not** exist here and are deliberately left out: tips, per-order promised delivery time (our jobs are start-time windows), penalty *amounts* (fines have no amounts — owner decision E-series), card/Apple Pay/SoftPOS buckets (we have COD only).

## 2. Decisions

| # | Decision |
|---|---|
| I1 | **One engine, many entry points.** The new tables are registered with `defineTable()` (see `ANALYTICS.md` §5) on the existing reports `drivers` and `offices`, so paging, sorting, filters (`office`, `driver`, `city`, period …), permissions, money masking and CSV come for free. The entity pages and the office portal call the same API with `office=<id>` / `driver=<id>`. |
| I2 | **Per-driver base.** All new driver metrics live in one extra CTE chain `dx` (`fleet-sql.ts`) built on top of the existing `dd` of `drivers-sql.ts` (do NOT add columns to `dd`: every existing drivers query reads it). Offices aggregate `dx` by `dd.office_id`; drivers with no office form the "Independent drivers" bucket (`office_id is null`). |
| I3 | **Daily grain** = Riyadh calendar day (`bucketSql(col, "day")`), zero-filled for every day of the period (max 366 rows; a longer period is refused with `VALIDATION`). Each measure keeps ITS OWN anchor (see §3) — a daily row is not a cohort; the Notes say so (Thawani does the same: "performance counts an order on the day it was received, finance on the day delivered"). |
| I4 | **No data is `null`, never 0** for averages and ratios (`safeDiv`); counts and sums are 0. Averages only over rows that have both timestamps. Percentages are fractions 0–1, money is integer halalas, durations are seconds, distances are metres in the API (UI shows km). |
| I5 | **Money is permission-gated** (`finance.view`): money columns/tables are removed for everyone else (`moneyKeys`, `needs`). Phone / national id stay masked without `drivers.sensitive`. |
| I6 | **Exports.** Every registered table can be exported as `format=xlsx` (new) next to `format=csv` (unchanged: raw keys, UTF-8 BOM). The `.xlsx` has localized headers (`lang=ar|en|ur`, default the viewer's language), real number formats (money in SAR with 2 decimals, percent, `[h]:mm:ss` durations (so a 45 s response time does not show as 0:00), km), frozen header, RTL for ar/ur, and a **Notes** sheet (filters used, period, generated at, "how to read this" lines). Needs `reports.export`, audited as `report.export`. A **workbook export** for an entity (office or driver) bundles every table of its Reports tab as sheets: Summary (KPIs), Daily, Drivers (offices only), Daily by driver (offices, ≤ 20 000 rows), Money, Money by day, Jobs, Earnings, Failures, Notes. |
| I7 | **Entity report centre.** `/admin/offices/[id]/reports` and `/admin/drivers/[id]/reports` (a new tab): period bar (presets + custom range, default 30 days, compare previous), KPI strip, then a `Segmented` view switch (URL param `view`): Daily · Drivers (offices only) · Money · Money by day · Jobs · Earnings · Failures. Each view = the registered table, with a "Download .xlsx" / "Download CSV" button and a "How to read this" disclosure. Plus "Download workbook". |
| I8 | **Office portal** (`/office/reports/*`) gets the same views for the signed-in office (scope enforced server-side through `portal-registry`; an office can never see another office or the platform direct drivers). |
| I9 | **Report pages** (`/admin/reports/drivers`, `/admin/reports/offices`) get new KPI cards (timing, lateness, distance, offer outcomes, efficiency, complaints) and a new "Performance tables" section with the new tables; the existing cards/charts stay unchanged. |
| I10 | **Honest data gaps are shown, not hidden**: a metric with no source rows is `—` with a hint (e.g. route km needs a Google-planned route; wait time needs the warehouse to record attendance/loading). The Notes list them. |
| I11 | No schema change except indexes (migration number: re-read `drizzle/meta/_journal.json`; the next free one). Every new SQL runs through `rows()` (read-only, 15 s timeout) and is bounded. |
| I12 | i18n prefix **`fr.`** (fleet reports): `rd-fleet.ts` (tables, KPIs, notes, export labels), `rd-fleet-ui.ts` (entity pages / portal / views). en + ar + ur together, then `npm run i18n:export`. |

## 3. Metric catalogue (one definition each — the Notes sheet quotes these)

Anchors: **offers** by `offers.created_at` (offers *pushed*, `PUSHED`) or `offers.accepted_at` (jobs); **parcels** by `PARCEL_OUTCOME_AT`; **settlements** by `settlements.created_at` (paid by `paid_at`); **COD** collected by `shipments.cod_collected_at`, remitted by `cod_remittances.created_at`; **online time** from `driver_availability_log` (as `dd.online_c`); **start punctuality** anchored on `requests.starts_at` (as `punctuality(grace)`).

Existing columns of `dd` are reused as they are (`offered answered accepted acc jobs cancelled noshow replaced due ontime busy deliv fail ret rn rsum earn online resp_p50 succ accept cancel ontime_rate rating util flags`). **New per-driver columns in `dx`** (suffix `_c` = period, `_p` = comparison period where a comparison makes sense; counts are 0 when nothing happened, averages `null`):

| Group | Column | Definition |
|---|---|---|
| Offers | `declined` | pushed offers with `status = 'rejected'` (driver pressed decline) |
| | `timedout` | pushed offers with `status = 'expired'` (never answered) |
| | `decline_rate` | `(declined + timedout) / offered` |
| | `resp_avg`, `resp_p90` | seconds from offer to acceptance, accepted pushed offers |
| Activity | `active_days` | distinct Riyadh days with a job arrival (`offers.arrived_at`) or a parcel outcome |
| | `online_days` | distinct Riyadh days with > 0 available seconds |
| | `jobs_per_active_day`, `parcels_per_active_day` | ratio, `null` without active days |
| | `deliv_per_online_hour` | `deliv / (online / 3600)` — Thawani "efficiency" |
| | `parcels_per_job` | `deliv / jobs` |
| Punctuality | `punctual` | jobs arrived at or before `starts_at` |
| | `late` | arrived after `starts_at`, within the late-grace setting (still "on time" by the existing rule) |
| | `very_late` | arrived after start + grace |
| | `late_avg_min` | average minutes after start, over jobs arrived after start |
| | `arrival_delta_avg_min` | average signed minutes `arrived_at − starts_at` (negative = early) |
| Warehouse time | `attend_avg_min` | `attendance_at − arrived_at` (warehouse confirmed the driver) |
| | `load_avg_min` | `loaded_at − coalesce(attendance_at, arrived_at)` |
| | `wait_avg_min` | `loaded_at − arrived_at` (all time at the warehouse until loaded) — Thawani "meal wait + handover" |
| | `plan_avg_min` | `route_approved_at − loaded_at` (driver reviewing the route) |
| Route time | `stop_avg_min` | per delivered parcel `delivered_at − arrived_at` (time at the door) |
| | `parcel_avg_min` | per delivered parcel `delivered_at − loaded_at` (load → delivered) — Thawani "delivery time" |
| | `job_avg_min` | `final_at − arrived_at` per kept job (capped as `busy`) |
| Distance | `radius_m` | Σ haversine(request pickup pin → parcel delivered pin) over delivered parcels with both pins — Thawani's definition (note: radius, not road) |
| | `route_m` | Σ `shipments.leg_distance_m` over delivered parcels (Google-planned legs only; `null` when none) |
| | `gps_m` | Σ haversine between consecutive `driver_location_history` points of the driver (gap ≤ 10 min, jump ≤ 3 km, accuracy ≤ 100 m), computed only when the query is narrowed to ≤ 200 drivers (office or driver filter) |
| Parcels | `pending_parcels` | parcels of the driver's jobs with no outcome yet (point in time) |
| | `first_attempt` | delivered parcels with `attempts <= 1` ÷ delivered |
| | `deferrals` | Σ `defer_count` of the driver's parcels with an outcome in the period |
| | `proof_otp`, `proof_receipt` | delivered parcels by proof type |
| | `cod_parcels` | delivered parcels with `cod_cents > 0` |
| Failure reasons | (table `failures`) | counts of `fail_reason` for failed/returned parcels: reason × count × share × drivers affected |
| Quality | `stars1..5` | rating distribution (ratings received in the period) |
| | `complaints`, `complaints_open` | complaints whose `offer_id` is the driver's offer, filed in the period / still open |
| | `strikes` | = `cancelled` (driver cancellations; the strike policy counts these) |
| | `suspensions` | `driver_availability_log` rows reason `cancel_strikes` in the period |
| Money (`finance.view`) | `earn` | existing: Σ `provider_cents` of billed settlements created in the period |
| | `customer`, `margin`, `vat`, `refund`, `adjust` | the same settlements: customer price, platform margin, VAT, refunds, adjustments |
| | `paid` | Σ `provider_cents` of settlements with `paid_at` in the period |
| | `pending` | point in time: billed settlements of the driver not yet paid |
| | `cod_collected` | Σ `cod_collected_cents` with `cod_collected_at` in the period |
| | `cod_remitted` | Σ `cod_remittances.amount_cents` created in the period |
| | `cod_held` | point in time: lifetime collected − lifetime remitted, floored at 0 (as `cashHeld`) |
| | `earn_per_job`, `earn_per_parcel`, `earn_per_hour` | ratios of `earn` |

**Per-office columns** = the same measures summed over the office's drivers (rates recomputed from the sums, never averaged) plus: `fleet` (drivers now linked), `drivers_active`, `drivers_online_days`, `links`, `unlinks`, `agreement` state, `verification`, and the settlement figures keyed by `settlements.office_id` (what the office was paid) — the existing `earned/paid/pending` of `offices-sql.ts` stay the source for those three.

## 4. Tables to register (all `GET /admin/analytics/:report/table/:name`)

`drivers` report: `perf` (one row per driver with activity — identity, then groups: offers, activity, punctuality, warehouse time, route time, distance, parcels, quality; sortable; default sort `delivered desc`), `daily` (one row per day for the filtered drivers: `registered online_drivers drivers_with_jobs online_hours jobs delivered failed returned on_time late very_late avg times offers declined timedout cancelled km efficiency`), `money` (per driver, `needs finance.view`), `money_daily` (per day), `jobs` (one row per kept job: ref, company, driver, office, starts, arrived, late min, wait min, load min, route min, parcels expected/delivered/failed/returned, km, COD collected/remitted, earning, status), `failures`.

`offices` report: `perf` (one row per office + the Independent-drivers row, every measure), `daily` (per day for the filtered offices), `money`, `money_daily`, `earnings` (one row per settlement of the office: ref, order, driver, company, customer, provider net, margin, VAT, refund, status, created, paid), `jobs`, `failures`.

Row fields are camelCase of the metric names (`lateAvgMin`, `waitAvgMin`, `radiusM`, `codHeldCents` …); money fields end in `Cents`; every field is in `moneyKeys` if it is money.

Portal (`portal-registry.ts`, scope = the signed-in office, never accepts `office`/`driver` filters outside its fleet): `perf` (its drivers), `daily`, `money`, `money_daily`, `jobs`, `earnings`, `failures`.

## 5. API additions

* `GET /admin/analytics/:report/table/:name?format=xlsx&lang=ar|en|ur` — see I6 (built; `ANALYTICS.md` §7b has the details). Needs `reports.view` + `reports.export`, same 50 000-row cap as CSV, audited `report.export` `{ format: "xlsx" }`.
* `GET /admin/analytics/:report/notes?lang=&table=` → `{ notes: string[] }` — the "how to read this" lines for the table set (also shown in the UI disclosure). `reports.view`. `notes` and `workbook` are reserved path names (a report cannot be called `options`, `notes` or `workbook`).
* `GET /admin/analytics/workbook/:kind/:id?<period filters>&lang=` (`kind` = `office|driver`) → the multi-sheet `.xlsx` (Summary, Daily, Drivers, Daily by driver, Money, Money by day, Jobs, Earnings, Failures, Notes; missing or not-permitted tables are skipped). `reports.view` + `reports.export`; 404 unknown id; audited `{ workbook, id }`.
* Portal equivalents under `/office/analytics/...`: `GET /office/analytics/workbook?<period filters>&lang=`, `GET /office/analytics/notes?table=&lang=`, `format=xlsx&lang=` on `GET /office/analytics/table/:name` (and `/business/analytics/table/:name`).

## 6. File ownership (parallel workers; nobody edits another worker's files)

| Worker | Owns |
|---|---|
| **core** | `server/analytics/fleet-lib.ts`, `fleet-sql.ts`, `fleet-tables-drivers.ts`, `fleet-tables-offices.ts`, `fleet-kpis.ts`, `fleet-notes.ts`; registers tables (import in `drivers.ts` / `offices.ts` is the ONLY edit to those files, plus new KPI definitions appended to `drivers-kpis.ts` / `offices-kpis.ts`); `i18n/fragments/rd-fleet.ts`; tests `tests/unit/fleet-*.test.ts`, `tests/integration/fleet-reports.test.ts`; a migration for indexes if needed |
| **export** | `server/export/xlsx.ts` (zip + OOXML writer), `server/export/workbook.ts`, `format=xlsx` + `notes` + workbook routes (edits `registry.ts`, `portal-registry.ts`, `api/routes/admin-analytics.ts`), `i18n/fragments/rd-fleet-export.ts`; tests `tests/unit/xlsx.test.ts`, `tests/integration/fleet-export.test.ts` |
| **ui** | `components/reports/fleet/**`, the Reports tab (`admin-offices-reports.tsx`, `admin-drivers-reports.tsx`, routes `app/(app)/admin/offices/[id]/reports`, `.../drivers/[id]/reports`, edits to `admin-offices-shell.tsx` / `admin-drivers-shell.tsx` tabs), the office portal pages `app/(app)/office/reports/**`, the new sections of `DriversView.tsx` / `OfficesView.tsx`, `i18n/fragments/rd-fleet-ui.ts`, e2e `e2e/fleet-reports.spec.ts` |

Shared rules: do not touch another worker's files; run DB-backed tests only through `scripts/with-test-db.sh` (one run at a time); never run Playwright (the lead does); new i18n keys in en+ar+ur; `npm run i18n:export` after dictionary changes (the lead runs it once at the end to avoid merge noise); `tsc --noEmit` and `eslint` clean on your files.

## 7. As built (2026-11-20)

**Server (`web/src/server/analytics/fleet-*.ts`)** — `fleet-sql.ts` (`withFleet()` = the existing `dd` chain + the extra per-driver chain `dx`; money columns only when the viewer has `finance.view`), `fleet-office-sql.ts` (offices aggregate `dx`; drivers without an office = `direct`), `fleet-daily-sql.ts`, `fleet-rows-sql.ts`, `fleet-metrics.ts` (ONE metric registry: key, type, group, SQL — tables, CSV/xlsx and help texts are derived from it), `fleet-kpis.ts`, `fleet-facts.ts`, `fleet-notes.ts`, `fleet-tables-{drivers,offices,rows,lib}.ts`, `portal-fleet-tables.ts`. Migration **0020** adds three partial indexes (`offers(arrived_at)`, COD shipments by offer, open shipments by offer). Verified on the dev DB (180 days of demo history): every table 7–211 ms, full reports ≤ 230 ms.

**Tables** (`GET /admin/analytics/:report/table/:name`)
* `drivers`: `perf` (56 columns), `perf_daily` (one row per driver and day; used for per-driver day-by-day), `daily`, `money`, `money_daily`, `jobs`, `failures`.
* `offices`: `perf` (60 columns; one row per office + "Independent drivers" `id=direct`), `money` (same + `direct`), `daily`, `money_daily`, `earnings`, `jobs`, `failures` (daily/earnings/jobs/failures cover work done through offices only; an office filter drops the Independent row).
* Office portal (`/office/analytics/table/:name`): `perf`, `daily`, `money`, `money_daily`, `earnings`, `failures` = the SAME queries run with the session's office forced (`portal-fleet-tables.ts`); the owner never receives customer price, platform margin, VAT, refunds, adjustments or the office column — removed from columns, rows and the sort whitelist (`tests/integration/fleet-portal.test.ts`). The older portal `jobs`, `drivers`, `settlements`, `payouts`, `ledger` tables are unchanged.
* Units: durations `type: "duration"` (seconds); `…Min` columns are minutes (`number`); distances are metres in the API with the new column type **`distance`** (km on screen and `km` in Excel).

**KPIs** added after the existing ones (20, + `fl_cod_held` on offices): `fl_late fl_very_late fl_late_avg fl_arrival_delta fl_wait fl_load fl_stop_time fl_parcel_time fl_job_time fl_radius fl_route fl_decline_rate fl_timeout_rate fl_resp_avg fl_active_days fl_online_days fl_efficiency fl_parcels_per_job first_attempt fl_complaints`. They are grouped on screen by `components/reports/fleet/kpi-groups.ts` (`DRIVER_GROUPS`, `OFFICE_GROUPS`, `PORTAL_GROUPS`); a KPI key in no group lands in "More metrics" (a unit test fails if a known key does).

**Rules worth knowing** — lateness and arrival-vs-start count at most 16 h per job (one demo job was accepted 12 days after its start and swamped the average); a step < 0 or > 16 h is excluded from the door-time average; complaints count only those *about* the driver; `gpsM` is computed only when the query is narrowed to ≤ 200 drivers (office or driver filter), otherwise `null`; `registered` in `daily` = driver accounts created that day.

**UI** — `components/reports/fleet/*` (`FleetReportCenter`, `PeriodBar`, `DownloadMenu`, `FleetNotes`, `WorkbookButton`, `KpiGroups`, `PerfTables`, `fleet-lib.ts`); routes `/admin/offices/:id/reports`, `/admin/drivers/:id/reports`, `/office/reports/performance`; URL params `view=` (`daily|drivers|money|money_daily|jobs|earnings|failures`, default Daily is omitted), `ptable=` on the platform report pages (new "Performance tables" section), plus the usual `preset|from|to|compare`. Test ids: `fr-center fr-period-* fr-view-* fr-table-* fr-download fr-download-xlsx fr-download-csv fr-workbook fr-notes fr-perf-*`. Money views (`money`, `money_daily`, `earnings`) need `finance.view` in the back office; downloads need `reports.export`.

**Tests** — `tests/unit/fleet-lib.test.ts` (21), `fleet-ui-lib.test.ts` (25), `xlsx.test.ts` (22); `tests/integration/fleet-reports.test.ts` (29, hand-computed world in `tests/helpers/fleet-world.ts`), `fleet-export.test.ts` (19), `fleet-portal.test.ts` (8); `e2e/fleet-reports.spec.ts` (15).

**Known limits / next** — the workbook's "Daily by driver" sheet still runs one `daily` query per driver (≤ 120 drivers, ≤ 20 000 rows); `drivers/perf_daily` can replace that loop. Tips, per-order promised delivery time, penalty amounts and card/Apple Pay buckets do not exist in this platform (I10). Route km needs Google-planned routes; wait/load time needs the warehouse to record attendance and loading. Arabic/Urdu wording of the ~300 new labels needs native review.
