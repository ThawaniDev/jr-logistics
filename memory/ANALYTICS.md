# Analytics framework (decisions G2–G4, G8, G11) — how to build a report

Written by the framework workstream (prefix `rpf.`). Everything below is verified against the code in `web/src/server/analytics/**`, `web/src/components/reports/**` and the Overview (`/admin/reports`). **If you change a convention here, change the code and this file together.**

## 1. Map

| What | Where |
|---|---|
| Riyadh calendar math (pure, client-safe) | `server/analytics/time.ts`, `periods.ts` (presets, previous/yoy ranges, buckets), `keys.ts` |
| Filter model (zod + parser → exact UTC windows) | `server/analytics/filters.ts` → `parseFilters(query)` |
| Filters → SQL | `server/analytics/conditions.ts` (`scope`, `inWindow`, `anyWindow`, `twinSelect`, `NOT_DRAFT`, `BILLED`, `PARCEL_OUTCOME_AT`) |
| Bucketing + zero fill | `server/analytics/buckets.ts` (`bucketSql`, `zeroFill`, `riyadhDow/Hour`) |
| KPI objects, safe division | `server/analytics/kpi.ts` (`makeKpi`, `safeDiv`, `verdict`); definitions `definitions.ts` (`defineKpis`) |
| Percentiles, histogram, top/bottom N, share, movers | `server/analytics/stats.ts` |
| Cache, statement timeout, `rows()` | `server/analytics/guard.ts` |
| Filter-bar options | `server/analytics/options.ts` → `GET /admin/analytics/options` |
| Drill-down table registry | `server/analytics/registry.ts` → `defineTable()`; route `GET /admin/analytics/:report/table/:name` |
| Overview | `overview.ts`, `overview-kpis.ts`, `overview-series.ts`, `overview-groups.ts`, `insights.ts`, `overview-tables.ts` |
| Routes | `server/api/routes/admin-analytics.ts` (options, overview, tables). Report packs add `GET /admin/analytics/<report>` in their own route file. Reserved names: `options`, `overview`, `notes`, `workbook` (a new report cannot be called `options`, `notes` or `workbook`: `defineTable` throws; `overview` is the one existing report that has that name) |
| UI kit | `components/reports/*` (barrel `@/components/reports`) |
| Shared layout | `app/(app)/admin/reports/layout.tsx` — wraps pages in `<Suspense>` (filters read the URL) |
| Example page | `app/(app)/admin/reports/page.tsx` + `components/reports/overview/*` + `overview-lib.ts` |
| Excel export | `server/export/*` (dependency-free .xlsx writer + workbook builders), `format=xlsx` of every drill table, `/:report/notes`, `/workbook/:kind/:id` — see §7b |
| i18n | `i18n/fragments/rd-reports-f.ts`, prefix `rpf.` (en + ar + ur together) |

## 2. API conventions

* Auth `backoffice`; every analytics route calls `requirePerm(user, "reports.view")`. Money (anything billed, revenue, margin, payouts, COD amounts…) additionally needs `finance.view`: **omit** the number, do not return 0 (`can(user, "finance.view")`; the response says `meta.moneyHidden`). CSV needs `reports.export` and is audited `report.export`.
* Read the filters from **`ctx.query`** (a `URLSearchParams`), never from `ctx.q` — `ctx.q` keeps only the last value of a repeated key. `const f = parseFilters(query)`.
* Money is integer halalas everywhere (`...Cents` fields / `unit: "money"`); percentages are fractions 0–1 (`unit: "percent"`); durations are seconds; `rate` is a plain ratio. The UI formats.
* **No data is `null`, never 0** for ratios/averages (`safeDiv`). Counts and sums are 0 when nothing happened.
* Response shape of a report: `{ meta, kpis, … }`. `meta = { ...filtersMeta(f), generatedAt, cached, empty, moneyHidden }` — `filtersMeta` gives `{ preset, bucket, bucketRequested, compare, period: {from,to,days,start,end}, prevPeriod|null, values }`. Set `meta.empty = true` when the selection has no data at all (the UI then shows "No data for this selection").
* Errors: invalid filters → `422 VALIDATION` with `error.details.<field>` (thrown by `parseFilters`). Query timeout → `503 DEPENDENCY_UNAVAILABLE` with `details.reason = "timeout"` (the UI shows a hint). Unknown table → 404, missing permission → 403.
* Series are arrays of `{ t, <field>… }` points, **zero-filled** for every bucket of the period, and `prev` (the comparison period's points) is aligned **by position** (point *i* of `prev` is what point *i* of the current period compares with). Bucket keys: hour `2026-11-19T14`, day `2026-11-19`, week/month `YYYY-MM-DD` of the first day. Keys are Riyadh wall-clock; format them as UTC (`bucketLabel()` does).

## 3. The filter model (G3)

Query string, identical on every endpoint and in the page URL:

| Param | Values | Meaning |
|---|---|---|
| `preset` | `today 7d 30d 90d mtd qtd ytd 12m` (default `30d`) | rolling windows end today; `7d` = today and the 6 days before; `12m` = the 12 calendar months up to and including this one |
| `from`, `to` | `YYYY-MM-DD`, both required, Riyadh days, **inclusive** | wins over `preset`; max 731 days |
| `bucket` | `auto hour day week month` | `auto`: ≤2 days hour, ≤92 day, ≤200 week, else month. A bucket that would give more than 400 points is refused. **Weeks start on Sunday** (Saudi working week), months on the 1st |
| `compare` | `none prev yoy` (default `prev`) | `prev`: same length immediately before; `mtd/qtd/ytd/12m` compare the same elapsed days of the previous month/quarter/year; a custom range of whole calendar months compares the months before. `yoy`: same dates one year earlier |
| `city service vehicle company office driver status channel` | repeated or comma separated | `city` = **delivery city** of the request; `service` = `delivery_driver\|car_with_driver\|car_without_driver`; `vehicle` = requested vehicle type; `company` = ordering business (id); `office`/`driver` = who carried the work (ids); `status` = request status; `channel` = `web\|api\|mobile` (`requests.created_via`). ≤30 cities, ≤50 ids, ≤12 statuses |

`parseFilters` returns `ResolvedFilters`: `cur` / `prev` windows (`from,to,days,start,end` — `start` inclusive, `end` exclusive UTC instants), `bucket`, `keys` / `prevKeys` (every bucket key, for zero fill), the eight lists, `active` (which lists are set) and `canonical` (stable cache key).

**Honesty rule (G8):** if a filter cannot narrow one of your numbers, tell the user — pass `unfiltered: ignoredFilters(f, [...])` to `makeKpi` (the card shows "Not narrowed by …") or put it in the KPI's `notFilteredBy` in its definition. Never silently ignore a filter.

## 4. Writing a query

Always the same shape — fact table joined to `requests`, scope, time window, aggregate in SQL:

```ts
import { sql } from "drizzle-orm";
import { requests, shipments } from "@/db/schema";
import { anyWindow, scope, twinSelect, twinRead, PARCEL_OUTCOME_AT } from "@/server/analytics/conditions";
import { rows } from "@/server/analytics/guard";

const [r] = await rows(sql`
  select ${twinSelect(f, {                                  // current AND previous period in one pass
    delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
    registered: (w) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
  })}
  from shipments join requests on requests.id = shipments.request_id
  where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT, shipments.createdAt)}`);
const { cur, prev } = twinRead(r, "delivered");              // { cur: number|null, prev: number|null }
```

Rules (violating them is a bug):
1. **Aggregate in SQL**, never loop over rows. Cast aggregates (`::int`, `::float8`) — `pg` returns bigint/numeric as strings; `num()`/`numOrNull()` in `guard.ts` coerce.
2. **Do not alias** `requests`, `offers`, `shipments`, `settlements`, `tickets` — `scope()` and the fragments reference them by name. Joins to other tables (users, profiles) may be aliased.
3. User input only through Drizzle parameters / `scope()`. `sql.raw` is for constants you wrote.
4. One time anchor per measure, documented in its definition: requests by `created_at` (cohort) or `completed_at`; settlements by `created_at`; parcels by `PARCEL_OUTCOME_AT` (delivery time for delivered, failure time for failed/returned — a parcel counts once); offers by `accepted_at`; start punctuality by `requests.starts_at`; accounts by `users.created_at`.
5. Drafts are not orders (`NOT_DRAFT`); rejected settlements are not billed (`BILLED`).
6. `rows()` runs the query in its own **read-only transaction with `statement_timeout` 15 s** and maps a timeout to 503. Run independent queries with `Promise.all` (each takes its own pool connection; the pool is 10). Keep a report under ~20 queries.
7. Series: `bucketSql(col, f.bucket)` as `t`, `group by 1`, then `zeroFill(f.keys, rows, fields)` (and `f.prevKeys` for the comparison query with the previous window). See `overview-series.ts`.
8. Rankings: `limit` in SQL (≤1000 rows even for movers). Drill-down: never more than a page of rows.
9. If a query needs an index (`requests(created_at)`, `settlements(created_at)`, `shipments(delivered_at)`, `offers(accepted_at)`, `users(role, created_at)`) tell the lead/data workstream — do not edit the schema.

### Cache and timeouts (G11)
`cached(key, fn)` in `guard.ts` keeps a finished report 30 s in memory (≤200 entries, per server process; env `ANALYTICS_CACHE_TTL_MS`, `0` disables). Identical in-flight requests share one run. Key = `<report>|<permClass(user)>|<f.canonical>` — `permClass` encodes `finance.view`, `reports.export`, `drivers.sensitive`, `wallets.view`, so a user never reads an entry computed for more permissions. If your report depends on another permission, extend `permClass`. Tests: `clearAnalyticsCache()` in `beforeEach`. Drill-down tables are not cached.

## 5. Add a report (checklist)

1. **Definitions** — register every KPI once: `defineKpis("<report>", [{ key, unit, good, money?, label, definition, numerator?, denominator?, notFilteredBy? }])` (see §6). Keys are global; prefix yours (`ops_late_rate`). A clash is recorded and fails `analytics-kpi.test.ts`.
2. **Server module** `server/analytics/<report>.ts`: `export async function xxxReport(user, query)`: `requirePerm`, `parseFilters(query)`, `money = can(user, "finance.view")`, `cached(...)` around the computation, return `{ meta: { ...filtersMeta(f), empty, moneyHidden: !money }, kpis, … }`. Build KPIs with `makeKpi(key, value, prev, { spark, href, unfiltered })`; never invent a number.
3. **Drill-down tables** in the same module (or `<report>-tables.ts`): `defineTable({ report, name, title, columns, sorts, defaultSort, tiebreak, needs?, moneyKeys?, query })` — see §7.
4. **Route** in your own file (`routes/admin-analytics-<area>.ts`, already imported by `routes/index.ts`): `{ method: "GET", path: "/admin/analytics/<report>", auth: "backoffice", handler: ({ user, query }) => xxxReport(user, query) }`. Tables need no route of their own.
5. **Page** `app/(app)/admin/reports/<report>/page.tsx` (client): `useReportFilters()` → `useApi(\`/admin/analytics/<report>?${filters.qs}\`, { keepPreviousData: true })` → `<ReportShell …>` with `<KpiGrid>`, charts, `<DrillTable>` (§8). The reports layout already provides `<Suspense>`.
6. **i18n** — your own fragment and prefix, en + ar + ur together, same `{placeholders}`. Reuse `rpf.*` for shared words (filters, "No data", "Previous period", weekdays, `rpf.col_*` where they fit).
7. **Tests** — unit tests for pure logic; an integration test (permissions, filters narrow, money omitted without `finance.view`, CSV needs `reports.export`) modelled on `tests/integration/analytics-overview.test.ts`; an e2e spec modelled on `e2e/reports-overview.spec.ts` (filters in the URL, 390 px, Arabic).
8. Update the sidebar? Already done (`nav.ts`): `/admin/reports/<report>`.

## 6. Add a KPI (definition + test)
```ts
defineKpis("ops", [{ key: "ops_late_rate", unit: "percent", good: "lower", label: "rpo.kpi_late_rate", definition: "rpo.def_late_rate", numerator: "rpo.def_late_rate_n", denominator: "rpo.def_late_rate_d" }]);
makeKpi("ops_late_rate", safeDiv(late.cur, due.cur), safeDiv(late.prev, due.prev), { unfiltered: ignoredFilters(f, ["office"]) });
```
* `unit`: `count | money | percent | duration | rate`; `good`: `higher | lower | neutral` (colours the change pill; neutral is never coloured). `money: true` → drop the KPI (not 0) without `finance.view` (`visibleKpis`).
* Every ratio or average has a `numerator` and `denominator` sentence (what is counted, out of what); percentages say their denominator. A definition states the **time anchor** and what is excluded.
* Add the keys to your fragment in all three languages; `analytics-kpi.test.ts` fails when a registered label/definition key is missing or a percentage has no numerator/denominator.
* Add a unit test of the arithmetic with `null`/zero cases (see `analytics-kpi.test.ts`, `overviewKpis`).

## 7. Drill-down tables (`registry.ts`)
`GET /admin/analytics/:report/table/:name?<filters>&page=1&pageSize=25&sort=<key>&dir=asc|desc[&format=csv]` → `{ meta, title, columns[{key,label,type,ns,href,sub,align,sortable}], rows, page, pageSize, total, sort }`.

```ts
defineTable({
  report: "ops", name: "late-jobs", title: "rpo.tbl_late",
  columns: [{ key: "ref", label: "rpo.col_ref", type: "link", href: "/admin/requests/{id}", sub: "company" }, { key: "delayMin", label: "rpo.col_delay", type: "number", align: "end" }, …],
  sorts: { ref: sql`requests.ref`, delayMin: sql`delay_min` }, defaultSort: { key: "delayMin", dir: "desc" }, tiebreak: sql`offers.id`,
  needs: ["finance.view"],          // permissions required on top of reports.view (all of them)
  moneyKeys: ["totalCents"],        // columns/fields removed for viewers without finance.view
  async query({ filters: f, limit, offset, order }) { /* where ${scope(f,…)} … order by ${order} limit ${limit} offset ${offset} */ return { rows, total }; },
});
```
Column `type`: `text number money percent duration date datetime status enum link` (`status`/`enum` translate `<ns>.<value>`; money in halalas; link `href` fills `{field}` from the row; `sub` names a row field shown muted under the value). Include `id` in rows for stable React keys. `phone: false` on a column drops it from the card layout on phones (long tables stay readable). Timestamps may come back from raw SQL in any `pg` format; the dispatcher turns them into ISO-8601 UTC strings (JSON and CSV), so just select the column. The dispatcher validates `sort` against `sorts` (422 otherwise), `pageSize` ≤ 100, and for CSV walks pages of 1000 up to 50 000 rows; the file is UTF-8 with BOM, header = column keys, formula injection neutralised (`toCsv`). Only `defineTable` modules that are imported at startup are visible — import them from your route file.

### 7b. Excel export (`server/export/`, decision I6 of `FLEET_REPORTS.md`)
* `GET /admin/analytics/:report/table/:name?<filters>&format=xlsx[&lang=ar|en|ur][&sort=&dir=]` — same permission (`reports.view` + `reports.export`), same row cap (`MAX_CSV_ROWS` = 50 000, paged by `pageAll`) and same money removal as CSV; audited as `report.export` with `{ rows, truncated, filters, format: "xlsx" }`. `lang` defaults to the viewer's `users.language` (422 for another value). The CSV is unchanged (raw keys, BOM).
* Columns become typed Excel cells from the drill column `type`: `money` halalas → SAR with 2 decimals (header gets "(SAR)"), `percent` fraction → `0.0%`, `duration` seconds → `[h]:mm:ss`, `date`/`datetime` → Excel dates in Riyadh time, `number` → `#,##0` when every value is whole else `#,##0.00`, `enum`/`status` translated through `<ns>.<value>`, `link` as text. A distance given in metres is exported in km (`#,##0.0`, header "(km)") when the column says `xl: "km"` or its key ends in `radiusM|routeM|gpsM|distanceM|legM|tripM`; `xl?: XlType` on a `DrillColumn` overrides the derived type (ignored by the UI). Text starting with `= + - @` (also behind spaces), tab or CR is stored as text with a leading `'` (as `toCsv`). Arabic/Urdu sheets get a right-to-left view. Header row bold + shaded, frozen, auto-filter.
* Every export ends with a **Notes** sheet: title, report, table, period (and the comparison period), filters in words (company/office/driver ids resolved to names, cities/services/vehicles translated), generated-at in Riyadh time, rows exported (or the truncation warning), then the numbered "how to read this" lines (`server/export/notes.ts`: the report's own lines from the fleet notes + the generic lines about units).
* `GET /admin/analytics/:report/notes[?table=name][&lang=]` → `{ notes: string[] }` (`reports.view`; 404 for a report without tables). `GET /office/analytics/notes` is the portal twin.
* `GET /admin/analytics/workbook/:kind/:id?<period filters>[&lang=]` (`kind` = `office|driver`) — Summary (KPIs of `officesReport` / `driversReport` with `office=<id>` / `driver=<id>`: current, previous, change, change %, definition), then Daily, Drivers (offices: `drivers/perf` with the office filter), Daily by driver (offices; only when drivers × days ≤ 20 000 and ≤ 120 drivers, else a line in Notes), Money, Money by day, Jobs, Earnings (offices), Failures — each only if the table is registered and the viewer may see it — then Notes. 404 for an unknown / wrong-role id, audited `{ workbook, id }`. Portal: `GET /office/analytics/workbook` (the signed-in office; `portalCtx` scope, foreign `office` ignored, foreign `driver` matches nothing). `format=xlsx` also works on every portal table (`/business|office/analytics/table/:name`; no staff permission, audited).
* Builder API: `buildXlsx({ sheets: [{ name, rtl?, columns: [{ header, key, type, width?, typeKey? }], rows, freezeHeader?, autoFilter?, notes? } | { name, rtl?, lines: [{ label?, text?, style? }] }] }) => Buffer` (`server/export/xlsx.ts`; types `text int number money percent duration date datetime km` and the signed `dint dnumber dmoney dpercent`).

## 8. Component catalogue (`@/components/reports`)

All client components; colours come from tokens (`chartVars` sets `--rpf-c1…c8` from `--jr-*`; `seriesColor(i)`, `STATUS_COLOR`), every number is `ltr-num`, layout uses logical properties, charts mirror in RTL. Every chart has a `testId` prop and a table view (`<testId>-toggle`).

* `useReportFilters()` → `{ preset, from, to, days, bucket, resolvedBucket, compare, prev, values, qs, activeCount, dirty, set(patch), setValues(key, list), reset() }`. `qs` is the query string for the API (only valid, non-default parameters). URL-synced with batched `useUrlPatch`. A grouping that cannot work for the period (hours over 90 days) is replaced by `auto` instead of failing; the "Showing … compared with …" summary is computed on the client with the same pure period logic as the server, so it follows the selection immediately.
* `<ReportShell title subtitle icon breadcrumbs filters filterKeys? compare? bucket? meta loading error onRetry onRefresh refreshing empty exportHref definitions actions>` — header (refresh, print, CSV for `reports.export`), filter bar, skeleton / error / `NoData`, "Updated at", money-hidden notice and the definitions legend (`definitions={kpis.map(k => ({label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator}))}`). `filterKeys` limits the multi-selects to what your report supports.
* `<ReportFilters filters keys compare bucket>` (inside the shell): period presets + custom range, comparison, bucket, multi-selects (company/office/driver searched on the server, others checkboxes), chips, reset, the "Showing … compared with …" summary.
* `<KpiGrid kpis comparing loading cols partLabel>` / `<KpiCard kpi comparing>` — value, change pill (green/red per the KPI's `good`, always signed; `pp` for percent), previous value, sparkline, definition tooltip, `unfiltered` note; `null` shows "—".
* `<TrendChart title data prev series bucket format rightFormat stacked height labelOf testId>` — `series: [{ key, label, kind: "line"|"area"|"bar", color?, axis?: "left"|"right", format? }]`; `prev` = comparison points (dashed). `<StackedBarChart>` = every series a stacked bar.
* `<DonutChart title slices format centerLabel>`, `<FunnelChart title steps>`, `<Heatmap title cells unit>` (weekday 0 = Sunday × hour), `<HistogramChart title buckets unit stats>`.
* `<BreakdownTable title rows format good>` and `<RankedList …>` — rows `{ key, label, sub?, value, prev?, share?, href?, tone? }` (inline bars, change pill when `prev` is given). `<InsightList items>` for `Insight[]`.
* `<DrillTable report name qs pageSize testId>` — server-paged, sortable, CSV button for `reports.export`; page resets when `qs` changes.
* Building blocks: `ChartCard` (frame, loading/empty, table toggle, legend), `DataTable`, `ChangePill`/`DeltaPill`, `InfoTip`, `MultiSelect`, `Sparkline`, formatters `formatValue(v, kind, locale, compact?)`, `bucketLabel`, `fmtDur`, `fmtPercent`, `fmtMoneyCompact`.
* Pure mapping helpers live in `overview-lib.ts` (unit-tested). Keep component props mapping pure and test it.

## 9. The Overview (reference implementation)

`GET /admin/analytics/overview` → `{ meta, kpis[16], series{requests,parcels,money|null}, funnel[5], breakdowns{city,service,vehicle,channel}, heatmap, fill{n,avg,p50,p90,p95,histogram}, rankings{companies{by,rows},drivers}, movers|null, insights[] }`. KPI anchors: GMV/revenue/AOV/margin by settlement creation (rejected excluded; GMV is customer price excluding VAT); requests created = non-draft by creation; completed by completion; cancellation rate = cohort of requests created in the period; delivery success = delivered ÷ (delivered + failed + returned) by outcome time; first attempt = delivered with ≤1 attempt ÷ delivered; active drivers = drivers with an offer accepted in the period; on-time = arrived ≤ start + grace (`settings.lateGraceMin`) among jobs whose start (+grace) has passed, no-show counts as late; time to fill = last live acceptance − publish for fully staffed requests; signups only honour the city filter. Money pieces (KPIs gmv/revenue/margin_pct/aov, `series.money`, GMV breakdown values, ranking by GMV, `orders`) are absent without `finance.view`; the ranking then falls back to requests.

Funnel: published → a driver accepted → fully staffed → started → completed, over requests created in the period; each step is clamped to the previous one.

## 10. Performance and reliability checklist
* ≤ ~20 bounded aggregate queries per report, all through `rows()`; no per-row queries, no unbounded `select`.
* A new filter or KPI never changes an existing number silently: update its definition text.
* Empty and sparse periods must look right (the Overview shows `rpf.ins_sparse` below 5 requests and "No data for this selection" when everything is zero).
* Phones: nothing scrolls sideways at 390 px; popovers clamp to the viewport; tables use `stack`.
* Verify with `SHOT_PW=… node scripts/shot.mjs admin http://localhost:3000 /tmp/x /admin/reports:overview --w=390 --ar`.

## 11. Known gaps / follow-ups
* Capture tables from migration 0012 (login events, milestone timestamps, snapshots …) are not read yet; add them by extending the fact queries — the framework needs no change.
* The old raw report tables (`/admin/reports/:type` API + `toCsv`) are unchanged; their UI moves to the Data explorer.
* Suggested indexes: see §4 rule 9.

## 12. Report packs as built (2026-11-19)
| Page (`/admin/reports/…`) | API (`GET /admin/analytics/…`) | Modules / UI | KPIs |
|---|---|---|---|
| (Overview) | `overview` | `overview*.ts`, `components/reports/overview/*` | 16 |
| `operations` | `operations` | `server/analytics/ops-*.ts`, `components/reports/ops/*` | 32 `ops_*` |
| `geography` | `geography` | `geo-*.ts`, `components/reports/ops/*` | 8 `geo_*` |
| `deliveries` / `cod` / `finance` | same names | `deliveries-*.ts`, `cod-*.ts`, `finance-*.ts`, `components/reports/fin/*` | 26 / 16 / 33 (finance needs `reports.view` + `finance.view`) |
| `companies` `drivers` `offices` `growth` | same names | `companies-*.ts` `drivers-*.ts` `offices-*.ts` `growth-*.ts`, `components/reports/people/*` | 72 cards (KPI keys `cmp_*`, `flt_*`, `cof_*`, growth) |
| `support` | `support` | `support-*.ts`, `components/reports/support/*` | 23 `sup_*`; SLA targets (first response 4 h, resolution 48 h) in `support-sla.ts` |
| (drivers / offices deep dive) | tables `perf perf_daily daily money money_daily jobs earnings failures` under `drivers` / `offices`; Excel via `format=xlsx`; `workbook/:kind/:id` | `fleet-*.ts`, `portal-fleet-tables.ts`, `server/export/*`, `components/reports/fleet/*` | +20 `fl_*` on drivers and offices — see `FLEET_REPORTS.md` |
| `explorer` | `explorer/datasets`, `explorer/:dataset` | `explorer-*.ts` (23 datasets), `components/reports/explorer/*` | — (needs `reports.export`) |
| Company/office portals (`/business/reports…`, `/office/reports…`) | `GET /business/analytics/*`, `GET /office/analytics/*` | `portal-*.ts`, `components/reports/portal/*` | 22 + 20 |

Conventions added by the packs: every report returns `meta.failed` / `partial` (a section that fails comes back `null`, shows its own error with retry and is not cached); `KpiGrid` has a fixed `data-testid="kpi-grid"` (use `.first()` when a page has several); the CSV writer prefixes cells starting with `-` (negative numbers) with `'` — use two non-negative columns instead; `defineDataset` is idempotent (dev hot reload re-evaluates modules); KPI keys are global — prefix yours (a clash is caught by `kpiConflicts()` in `analytics-kpi.test.ts`).
Portals: the owner is derived from the session; client-supplied `company` / `office` / `driver` are dropped and listed in `meta.ignored`; companies never get provider cost or margin, offices never customer price or margin.
