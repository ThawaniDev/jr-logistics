# Per-shipment delivery (B2C + B2B) — API contract

Decisions C1–C12 (and D1–D6, which supersede C3) live in `memory/DECISIONS.md`. This is the wire contract every client (web business, web driver, admin, Flutter) builds on.
All routes are under `/api/v1`. Money is integer halalas. Errors: `{ error: { code, message, details } }`.

## The model in one paragraph
A **delivery request** (`service = delivery_driver`) carries a **manifest**: one **shipment** per parcel, each with its own recipient,
phone, address and a recipient type — `consumer` (B2C, proves receipt with a 4-digit one-time code SMS'd to them) or `business` (B2B,
code **or** a photo of the signed/stamped receipt + receiver name). The number of drivers is **derived** from the manifest
(`ceil(N / shipmentsPerDriver)`, balanced) and the escrow is exactly `N × unit price`. Each driver gets a balanced, contiguous block of
the manifest when they accept. The driver works **one stop at a time** in a planned best-route order (Google Routes, driver-approved — see Addendum D; this replaces the old "static route, no optimiser" rule C3): hand-over →
driver confirms → **approves route** → per stop **arrive → deliver | fail | defer(once)** → finish. The delivered count is never typed: it is
the number of shipments delivered with a valid proof. Car-with-driver / car-without-driver requests have no manifest and are unchanged.
Legacy delivery requests with **no shipments rows** keep the old count-based flow (`manifest: false`).

Shipment `status`: `pending` (not handed over / in pool) → `loaded` → `delivered` | `failed` → `returned` (`missing`, `cancelled`).
Parcel code = `<request ref>-<seq 3 digits>` e.g. `JR-000012-007`. A scan/typed value matches the code, the warehouse's `externalRef`, or just the manifest number (`7`).

## Manifest input (create/update request) — `shipments[]` on `POST /requests`, `PATCH /requests/:id`
```jsonc
{ "recipientType": "consumer" | "business",      // default consumer
  "recipientName": "Mona", "recipientPhone": "0555555555",   // Saudi mobile / +E.164, normalised server-side
  "address": "King Fahd Rd 120, Riyadh", "city": "riyadh",   // city optional; MUST equal the request's deliveryCity
  "lat": 24.7, "lng": 46.6,                       // optional, both or neither
  "contents": "Clothes", "notes": "Gate 2", "externalRef": "ORD-1001" }   // all optional; externalRef unique per request
```
- `POST/PATCH /requests` also take `shipmentsPerDriver` (max parcels per driver, default 30), `allowPartial` (bool, default true; **false = all-or-nothing**:
  if not every driver slot is filled at the start time the request is called off and fully refunded) and `shipmentCount` (estimate only).
- `quantity` is **ignored** when a manifest is present (derived). Omitting `shipments` on PATCH keeps the saved manifest; sending it replaces it (drafts only). Max 2000.
- Validation errors are `422 VALIDATION` with `details.row` (1-based) and `details.field = "shipments.<i>.<field>"`.
- `POST /requests/estimate` → `quote: { unitPriceCents, quantity, expectedUnits, totalUnits, totalCents }` (send `shipmentCount` instead of the array).
- Publishing without parcels → `422 MANIFEST_REQUIRED`. Delivery requests no longer need `deliveryAddress`/`recipient*` (per shipment now).
- **Removed:** `preferredOfficeId` (office selection cancelled — ignored if sent), `GET /business/offices`. (The old `POST /driver/route/optimize` is superseded by `POST /offers/:id/route/optimize`, Addendum D.)

## Business / staff
| Method & path | Body → result |
|---|---|
| `GET /requests/:id/shipments?status=&q=&page=&pageSize≤200` | `{ items[], page, pageSize, total, counts:{status:n} }` — item: `id, seq, code, externalRef, recipientType, recipientName, recipientPhone, address, city, lat, lng, contents, notes, status, offerId, driverName, stopOrder, attempts, loadedAt, arrivedAt, deliveredAt, deliveredDistanceM, proofType('otp'|'receipt'), receiverName, hasProof, failReason, failNote, failedAt, returnedAt` (+ `demoOtp` only in DEMO_MODE, never for staff) |
| `GET /shipments/:id` | `{ shipment, events[] }` (per-parcel timeline; events have `type`, `actorName`, `payload`, `createdAt`) |
| `GET /shipments/:id/proof` | the receipt photo (image bytes) |
| `POST /offers/:id/loading` | `{ all:true }` or `{ codes:[…] }` (manifest jobs: exactly what goes onto the vehicle; unlisted → back to pool), or `{ units }` (legacy). Allowed until the driver approves the route. |
| `POST /offers/:id/returns` | `{ all:true }` or `{ codes:[…] }` → `{ returned, stillOut }` — the warehouse receives undelivered parcels back |
| `POST /offers/:id/delivery-decision` | `{action:'confirm'}` (no `units` for manifest jobs; `422 RETURNS_PENDING {count}` until every failed parcel is marked returned) or `{action:'dispute', note}` |
| `POST /requests/:id/reship` | `{ ids?: [] }` → new **draft** request holding the undelivered parcels (failed/returned/missing/cancelled) |
| `GET /requests/:id` | adds `manifest:boolean`, `unassignedParcels:n`; each `offers[i]` has `parcels:{total,pending,loaded,delivered,failed,returned,missing}`, `routeApprovedAt`, and `actions[]` may include `record_loading`, `confirm_returns`, `confirm_delivery`, `dispute_delivery`, `handover_custody`, `rate`… |
| `GET /track/:code?p=<last4 of phone>` (PUBLIC, rate-limited) | `{ code, sender, stage, city, updatedAt, steps, failReason? }`; `stage ∈ preparing|on_the_way|arrived|delivered|attempt_failed|cancelled` (i18n `track.stage.*`). No address/driver. 404 if code or digits wrong. |
| integrators (X-API-Key) `GET /jobs/:id/shipments` | per-parcel status for their order system; webhook events `shipment_delivered`, `shipment_failed` carry `shipment:{id,code,externalRef,reason}` |

## Driver
`GET /driver/jobs`, `GET /driver/jobs/:id` return the job view. New fields: `manifest`, `stops[]`, `stopsSummary{total,pending,loaded,delivered,failed,returned,missing}`, `routeApprovedAt`, `allowPartial`.
`delivery` and `recipient` are `null` for manifest jobs. `actions[]` is server-driven — render buttons from it:
`accept, reject, checkin, cancel, report_no_work, ack_loading, dispute_loading, approve_route, work_stops, end_route, report_delivered`.
Flow for a manifest job: `attendance_confirmed` → (warehouse hands over) → `ack_loading` → `approve_route` → `work_stops` (until all stops resolved) → `report_delivered`.

Stop (`stops[i]`): `id, seq, stopOrder, code, status, recipientType, address, city, lat, lng, contents, notes, recipientName (current/resolved only), recipientPhone (current only, after route approval), current, attempts, deferCount, canDefer, arrivedAt, waitRemainingSec, proofMode('code'|'code_or_receipt'), hasProof, otpAttemptsLeft, canResend, deliveredAt, failReason, failNote`.
Exactly one stop has `current:true` once the route is approved. **Every stop action on a non-current stop is `409 STOP_LOCKED`.**

| Path (all `POST`) | Body | Notes |
|---|---|---|
| `/offers/:id/route/approve` | – | needs loading acknowledged; texts the first recipient their code |
| `/offers/:id/stops/:sid/arrive` | `{lat?,lng?}` | starts the "unreachable" wait clock |
| `/offers/:id/stops/:sid/deliver` | `{ code, otp? , proof?:'receipt', receiverName?, lat?, lng? }` | `code` = scanned/typed parcel code (required). Then either `otp` (4 digits from the recipient) or — business recipients only — `proof:'receipt'` + `receiverName` after the photo upload. Errors: `OTP_REQUIRED`, `OTP_INVALID {attemptsLeft}`, `OTP_LOCKED` (5 wrong), `VALIDATION field=code|proof|receiverName`, `INVALID_TRANSITION` (not arrived) |
| `/offers/:id/stops/:sid/fail` | `{ reason, note?, lat?, lng? }` | reasons: `unreachable`(needs arrival + wait; `409 WAIT_REQUIRED {remainingSec}`), `refused`, `closed`, `no_otp`, `damaged`(note), `gate_access` (these need arrival), `wrong_address`(note), `out_of_zone`, `other`(note) |
| `/offers/:id/stops/:sid/defer` | – | postpone once ("closed for now"); not for the last stop |
| `/offers/:id/stops/:sid/resend-code` | – | new code SMS'd to the recipient (max 3); unlocks a locked stop |
| `/offers/:id/stops/:sid/proof` | multipart `file` (jpg/png/webp ≤ 8 MB) | B2B receipt photo; needs arrival |
| `/offers/:id/end-route` | `{ reason, note? }` | driver can't continue: delivered stay paid, parcels on board → `failed(driver_unavailable)` to be returned; urgent ticket; also callable by ops (`replacements.manage`) |
| `/offers/:id/delivered` | `{}` | finish the route (units ignored); `409 STOPS_PENDING {remaining}` while stops are open |
| `GET /driver/jobs/:id/whatsapp?shipmentId=<current stop>&kind=` | | only the current stop's recipient |

Recipients are texted automatically (bilingual SMS with the code + tracking link) when their stop becomes current.

## Delivery code
4 digits, derived (never stored), shown **only** to the recipient by SMS. In `DEMO_MODE` the **business** shipment list includes `demoOtp` so demos/tests can read it; production never does.
Drivers/business must never be shown it outside demo mode.

## i18n keys already provided (`src/i18n/fragments/shipments-core.ts`, en/ar/ur)
`shipstatus.*`, `rtype.*` (+`_hint`), `stopfail.*`, `track.stage.*`, `event.*` / `notif.*` for all new events, `err.*` for the 8 new codes.
Add your own keys to **your** fragment file only (`shipments-business.ts` | `shipments-driver.ts` | `shipments-admin.ts`), all three languages.


## Server audit additions (additive — nothing above changes shape)
- `GET /admin/shipments/search?q=&status=&page=&pageSize≤100` (staff, `requests.view`; `q` ≥ 3 chars) → `{items[],page,pageSize,total}`. Finds a parcel across all requests by **code** (exact or prefix), **order reference**, **phone** (any Saudi spelling, or just the **last 4 digits**) or **recipient name**. Item: `id, code, externalRef, recipientName, recipientPhone` (masked `+966•••56` unless `drivers.sensitive`)`, status, city, requestId, requestRef, businessName, offerId, driverName, partnerId, partnerStatus, createdAt`.
- `GET /admin/requests`: `q` also matches the business name, company and phone; new `businessId` filter.
- `GET /admin/drivers`: new `status=active|suspended`, `suspended=0|1`, `pageSize`; response is now `{items,page,pageSize,total}` (`items` unchanged).
- `GET /admin/audit`: `actorId`, `action` (prefix, e.g. `settlement.`), `from`, `to`, `pageSize≤200`; rows gain `actorName`; response `{items,page,pageSize,total}`.
- `GET /admin/tickets`, `/admin/complaints`, `/tickets`, `/complaints`: `q` (ref / subject or description / requester name), `priority=normal|urgent`, `pageSize≤100`; rows gain `openedByName,openedByRole` (tickets) / `filedByName` (complaints); `total` was already present.
- Office: `GET /office/jobs` items gain `service`, `parcels:{total,delivered,failed,returned,pending,loaded,missing}|null`, `lastActivityAt`. `GET /office/drivers` items gain `activeOfferId` and `parcels` (of that offer). **New** `GET /office/jobs/:id` → job metadata (`ref, service, status, driver, business, startsAt, cities, expectedUnits, loadedUnits, deliveredUnits, finalUnits, routeApprovedAt, parcels, lastActivityAt`) + `stops[{seq,stopOrder,code,status,failReason,deliveredAt,failedAt,returnedAt}]` — **no recipient name/phone/address**; `404` unless the offer belongs to the calling office.
- `GET /driver/offers` (and every driver job view): `expiresAt` for an `offered` job (created + `offerExpiryMin`), else `null`.
- Recipient SMS link is now `…/track/<code>?p=<last 4 digits of the recipient phone>` (never the full number); `/track/[code]?p=` is the same public endpoint as before.
- `GET /business/overview`: `returnsPending` = failed parcels not yet marked returned.
- `GET /wallet`: `creditLimitCents` (B7), `maxTopupCents`, and each entry has `requestId`/`requestRef` (null when not request-related). `POST /requests/estimate` adds `creditLimitCents`; `sufficientFunds` includes the credit line. New error `402 CREDIT_LIMIT_EXCEEDED {availableCents,creditLimitCents,requiredCents}`.
- `POST /admin/finance/credit-limit {userId, creditLimitCents}` (staff `wallet.adjust` / `refunds.manage`).
- Business notifications about parcels/routes/returns open `/business/requests/<requestId>`; `partner_cancel_conflict` and `partner_sync_failed` open `/business/integrations`.
- Idempotent stop retries: re-sending `deliver` (same parcel code) or `fail` (same reason) for an already-resolved stop returns the stop with `200`; a different action is still `409 INVALID_TRANSITION`.
- `confirmAttendance present:false` (no-show) → `409 INVALID_TRANSITION` before the job's start time.
- Limits: JSON bodies ≤ 4 MB, uploads ≤ 12 MB, → `413 PAYLOAD_TOO_LARGE`. Every response (errors included) carries `x-correlation-id`.


---
# Addendum D — orders without full details, demo parcels, best route (see DECISIONS D1–D6)

## Booking by count ("details later")
`POST/PATCH /requests` and `POST /requests/estimate` accept **`detailsLater: boolean`**. With it:
- `shipments[]` entries may omit `recipientName` / `recipientPhone` / `address` (anything given is still validated → `422 VALIDATION details.row/field`).
- `shipmentCount` larger than `shipments.length` adds that many **blank placeholder parcels** (cap 2000). `shipments: []` + `shipmentCount: 40` ⇒ 40 blank parcels. `quantity` is derived as before.
- Without `detailsLater` everything is strict exactly as before (name ≥ 2, Saudi/E.164 phone, address ≥ 5).
Parcel views (`GET /requests/:id/shipments`, `GET /shipments/:id`, `GET /requests/:id` manifest) now carry **`detailsComplete: boolean`** (placeholders: `false`, empty strings), `geoSource` (`given|geocoded|geocoded_approx|unresolved|null` — `unresolved` = Google could not find the address; not asked again until it changes), `legDistanceM`, `legDurationS`.
`GET /requests/:id` also adds **`incompleteParcels: n`** (pending/loaded parcels with `detailsComplete=false`) — see below.

| Method & path | Body → result |
|---|---|
| `PATCH /shipments/:id` | partial parcel (`recipientName, recipientPhone, address, contents, notes, externalRef, recipientType, lat, lng`) while `status=pending`. A parcel that is still incomplete may be saved **partially**; a complete parcel can't be blanked. `detailsComplete` is recomputed. |
| `PATCH /requests/:id/shipments` | `{ rows: [{ id? | code? | seq?, ...partial parcel }] }` (≤ 500) → `{ updated, completed, stillIncomplete }`. All-or-nothing; error `422 VALIDATION details.row` (1-based) + `details.field = "rows.<i>.<field>"`. |
| `POST /offers/:id/loading` | `422 DETAILS_INCOMPLETE { count, codes[≤50] }` if any chosen parcel is incomplete (including `all:true`). Send explicit `codes` for the complete ones to hand over only those. |
Integrators (`X-API-Key`): `POST /jobs` accepts `detailsLater` + `shipmentCount` like the portal, and `GET /jobs/:id/shipments` items carry `detailsComplete`; completing details happens in the portal (`PATCH /requests/:id/shipments`).
Timeline events: `shipment_details_completed`, `details_reminder`. Notification: `parcels_details_pending {ref, n}`.

## Demo parcels (demo mode only)
`GET /business/demo-shipments?city=riyadh` → `{ city, total: 80, items: [{ n, ref:"DEMO-001", recipientType, recipientName, recipientPhone, address, city, lat, lng, district, contents, notes }] }`. `404` unless `DEMO_MODE`; `422` for an unsupported city. `GET /catalog` → `demoMode`. Items map 1:1 onto `shipments[]` (`ref` → `externalRef`).

## Best route
`driverJobView` (`GET /driver/jobs[/:id]`) adds, for manifest jobs:
```jsonc
"route": { "planned": true, "provider": "google_routes"|"local_heuristic"|"mixed"|null, "plannedAt": "...", "by": "system"|"driver",
  "totalDistanceM": 24300, "totalDurationS": 6720, "remainingDistanceM": 12000, "remainingDurationS": 3100, "chunks": 2,
  "unlocated": 0, "approximate": 0, "warnings": ["ROUTE_UNLOCATED_STOPS:3", "ROUTING_PROVIDER_FAILED: Google Routes HTTP 503"],
  "googleConfigured": true, "canOptimize": true }
```
and each `stops[i]` adds `located` (has coordinates), `geoSource`, `legDistanceM`, `legDurationS` (driving leg **into** that stop from the previous one / the origin). `stopOrder` is the planned order.
Warnings are `CODE` or `CODE:param` — translate `route.warn.<CODE>` (`{n}` = param); unknown codes fall back to the generic text. `canOptimize` ⇒ show "Re-optimise route".

`POST /offers/:id/route/optimize` (driver) body `{ lat?, lng?, force? }` (GPS origin optional — without it: warehouse pickup, or after approval the stop being served) → `{ plan, cached, changed, currentId, job }` (`job` = fresh driver job view).
`409 INVALID_TRANSITION` (not at the loaded/ack stage), `409 CONFLICT` (parcels changed meanwhile — retry), `429 RATE_LIMITED` (12/h per job; cached repeats are free).
Planning also runs automatically after the warehouse hands the parcels over. `approve` is unchanged (the driver reviews and approves). After approval the **current stop stays first when the driver has arrived at it**; when re-planning moves another stop to the front, that recipient is texted their code.

---
# Addendum E — field-operations overhaul (decisions E1–E18 in DECISIONS.md). THIS IS THE CONTRACT FOR ALL CLIENTS.

Money is integer halalas everywhere (`…Cents`). New error codes (all have `err.<CODE>` i18n keys): `WAREHOUSE_LOCATION_REQUIRED 422`, `LOCATION_REQUIRED 422`, `TOO_FAR_FROM_WAREHOUSE 422 {distanceM, radiusM}`, `EVIDENCE_REQUIRED 422 {note:boolean, photo:boolean}`, `SIGNATURE_REQUIRED 422`, `CASH_MISMATCH 422 {expectedCents}`, `FEATURE_DISABLED 403`.

## E.0 Settings (superadmin) — `GET/PATCH /admin/settings`
New fields (all optional on PATCH): `arrivalGeofenceEnabled:bool` (true) · `arrivalRadiusM:int 20..5000` (200) · `driverCanReorderRoute:bool` (true) · `rescheduleEvidenceText:bool` (true) · `rescheduleEvidencePhoto:bool` (true) · `stopWaitMin:int 0..120` (**default now 0 = no timer**) · `driverSingleActiveJob:bool` (true) · `stopFailStrictRules:bool` (false) · `warehouseDefaults:{requireArrivalConfirmation:bool(true), requireLoadingRecord:bool(false), requireDeliveryOtp:bool(true), requireSignature:bool(false)}`.
`separationOfDuties` and `settlementPeriod` no longer affect settlements (kept in the settings object; the UI should drop/relabel them).

## E.1 Warehouse (business) location + per-warehouse switches
- `business_profiles.warehouse_lat/warehouse_lng` (nullable) and `ops` overrides. **Effective ops** = `warehouseDefaults` ⊕ overrides: `{ requireArrivalConfirmation, requireLoadingRecord, requireDeliveryOtp, requireSignature }`.
- Warehouse: `PUT /business/warehouse { lat, lng }` (own location; audited). `GET /business/overview` now also returns `warehouse:{lat,lng}|null` and `ops` (effective, **read-only for the warehouse**).
- Superadmin / staff with `users.edit`: `GET /admin/businesses/:id/warehouse` → `{ lat, lng, ops (effective), overrides (each true|false|null=inherit), defaults }`; `PATCH /admin/businesses/:id/warehouse { lat?, lng?, ops?: { <switch>: boolean|null } }` (null = inherit the platform default). Audited.
- A new request's `pickupLat/pickupLng` default from the warehouse location when the wizard sends none. `POST /requests/:id/publish` (and create+publish) → `422 WAREHOUSE_LOCATION_REQUIRED` when geofence is on, the service has drivers and no pin can be found.

## E.2 Driver — arrival, attendance, loading (`GET /driver/jobs[/:id]`, `driverJobView`)
New fields on the job view:
```jsonc
"ops": { "requireArrivalConfirmation":true, "requireLoadingRecord":false, "requireDeliveryOtp":true, "requireSignature":false },
"arrival": { "geofence":true, "radiusM":200, "warehouse":{"lat":24.7,"lng":46.6}|null },   // warehouse = null when unknown (check-in then not enforced)
"loading": { "mode":"driver_scan"|"warehouse", "assigned":30, "scanned":12, "finished":false },
"policy": { "canReorderRoute":true, "rescheduleEvidenceText":true, "rescheduleEvidencePhoto":true, "stopWaitMin":0, "failStrict":false },
"cod": { "toCollectCents":123000, "collectedCents":40000, "parcels":5 },          // manifest jobs; parcels = parcels with COD
```
- `POST /offers/:id/checkin { lat, lng }` — GPS required when `arrival.geofence` and `arrival.warehouse` are set. Result is the offer; `status` is `arrived`, or **`attendance_confirmed` directly** when the warehouse has `requireArrivalConfirmation=false`.
- **Scan mode** (`loading.mode == "driver_scan"`, status `attendance_confirmed`, route not approved):
  - `POST /offers/:id/loading/scan { code }` (code / warehouse order ref / manifest number) → `{ shipment:{id,code,seq}, scanned, assigned, already:boolean }`. Errors: `VALIDATION field=code` (not in your load / another driver's / unknown), `DETAILS_INCOMPLETE`, `INVALID_TRANSITION`.
  - `POST /offers/:id/loading/unscan { code }` → `{ scanned, assigned }` (undo a mistaken scan; only before finishing).
  - `POST /offers/:id/loading/finish {}` → `{ loaded, released, job }` — needs ≥ 1 scanned (`VALIDATION field=codes`); sets loaded units, marks the count confirmed, releases the unscanned parcels to the pool, **plans the route**, returns the fresh job view (`route.planned`).
  - `actions[]`: `scan_loading`, `finish_loading` (only once ≥ 1 scanned), `report_no_work`. The old `ack_loading` / `dispute_loading` appear **only in `warehouse` mode**.
  - In `warehouse` mode (`requireLoadingRecord`) the old flow is unchanged: the warehouse `POST /offers/:id/loading`, the driver acknowledges.
- `stops[]` during scan mode lists every assigned parcel with `status` `pending` (not scanned yet) or `loaded` (scanned) — render it as the scan checklist.

## E.3 Driver — route
- `route` adds `canReorder:boolean` (setting on + loading finished + ≥ 2 movable stops) and `manual:boolean` (the order was set by hand), `provider` may now be `"manual"` (translate `route.provider.manual`).
- `POST /offers/:id/route/reorder { order:[stopId,…] }` → `{ plan, currentId, job }`. `order` must be exactly the not-yet-resolved, not-pinned stops (the stop the driver has arrived at is pinned first and is excluded from `order`). Errors: `403 FEATURE_DISABLED` (setting off), `422 VALIDATION field=order`, `409 INVALID_TRANSITION`. Legs of moved stops are re-estimated locally and their polylines cleared. Event `route_reordered`. If the stop at the front changes after approval, its recipient is texted their code.
- `GET /driver/jobs/:id/route-geometry` → `{ origin:{lat,lng}|null, provider, legs:[{ stopId, order:int, from:{lat,lng}|null, to:{lat,lng}|null, polyline:string|null, distanceM, durationS }] }` for the **loaded (still to do) stops in route order**; `polyline` = Google encoded polyline (precision 5) or `null` (estimate → draw a straight line `from→to`). Meant for the map view; fetch when it opens.

## E.4 Driver — stop actions
- **Media** `POST /offers/:id/stops/:sid/media` multipart `file` (jpg/png/webp ≤ 8 MB; magic bytes checked) + field `kind` ∈ `defer|fail|signature` → `201 { id, kind }`. The stop must be the current one. Evidence is consumed by the next action that references its `id`.
- `POST …/defer { note?, mediaId? }` → needs `note` when `policy.rescheduleEvidenceText`, a `mediaId` (kind `defer`) when `policy.rescheduleEvidencePhoto`, else `422 EVIDENCE_REQUIRED {note, photo}` (booleans = which is missing). Still once per stop; not the last stop.
- `POST …/fail { reason, note?, mediaId?, lat?, lng? }` — **every reason accepted anytime** unless `policy.failStrict`; optional photo (`mediaId`, kind `fail`). The `unreachable` wait applies only when `policy.stopWaitMin > 0`.
- `POST …/deliver { code, otp?, proof?, receiverName?, signatureMediaId?, cashCollectedCents?, lat?, lng? }`:
  - stop view adds `needsOtp` (warehouse `requireDeliveryOtp`), `needsSignature`, `codCents`, `proofMode` ∈ `code | code_or_receipt | scan` (`scan` = OTP off → just `code`).
  - `needsOtp` → `otp` (or business receipt) as before; **not** needed when false (`proofType: "scan"`).
  - `needsSignature` → `signatureMediaId` (kind `signature`) else `422 SIGNATURE_REQUIRED`.
  - `codCents > 0` → `cashCollectedCents` must equal `codCents` else `422 CASH_MISMATCH {expectedCents}`.
  - stop view adds `codCents`, `codCollectedCents`.
- `POST /offers/:id/delivered {}` (finish route) now **auto-confirms and settles**: response is the offer in status **`completed`** (settlement paid — E18). `POST /offers/:id/end-route` likewise.
- stats for the cards: `stopsSummary` (`total, pending, loaded, delivered, failed, returned, missing`) + `cod`. "To deliver" = `loaded`; "not delivered" = `failed+returned+missing`.

## E.5 Driver — offers, overview, notifications
- `GET /driver/offers` and `GET /driver/opportunities` → `{ items, hidden:boolean, activeJob:{offerId,requestId,ref,status}|null }`; **`items` is `[]` and `hidden:true`** while the driver has an active job (`accepted|arrived|attendance_confirmed`) and `driverSingleActiveJob` is on. Accepting/applying meanwhile → `409 OVERLAPPING_JOB`. No new offers are created for a busy driver.
- `GET /driver/overview` adds `activeJob` (same shape|null), `cash:{ outstandingCents, orders }`; `newOffers` is 0 while hidden.
- Notification `offer_new` data: `{ requestId, ref, offerId, parcels, pickupCity, deliveryCity, earningCents|null }` (`earningCents` null for office drivers). i18n `notif.offer_new` uses `{ref} {parcels} {pickupCity} {deliveryCity}`. Poll `GET /notifications?unreadOnly=1` (existing) — raise a device notification for unseen `offer_new`.
- New notification types (i18n `notif.*`): `cod_received {ref, amountCents}` (driver), `cod_collected_ops`… see E.7; ticket: `ticket_new`, `ticket_reply_user`, `ticket_resolved`, `ticket_reopened`.

## E.6 Warehouse (business) side
- `GET /requests/:id` → `offers[i]` add `loading:{mode,assigned,scanned,finished}`, `cod:{collectedCents,receivedCents,outstandingCents}`; `actions[]` **no longer contains `confirm_delivery` / `dispute_delivery`**; `record_loading` only when the warehouse `requireLoadingRecord`; `confirm_returns` is offered whenever the offer is `completed` (or `delivered_reported`) and has failed parcels; `rate` when completed.
- **Removed:** `POST /offers/:id/delivery-decision` (404). `POST /offers/:id/returns` is allowed after completion too.
- Parcels: manifest input and views gain `codCents` (input: optional int ≥ 0, ≤ 10 000 000), views also `codCollectedCents`, `codCollectedAt`, `hasSignature`, `mediaCount`. CSV import column `cod` (SAR, decimals allowed → halalas). `GET /shipments/:id/media` → `{ items:[{ id, kind, note, createdAt, byName }] }`; `GET /shipments/:id/media/:mid` → image bytes (owner business, staff `requests.view`, the offer's driver). Parcel timeline events `shipment_failed` / `stop_deferred` carry `mediaId` and `note` in `payload`; deliveries with a signature carry `signatureMediaId`.

## E.7 Cash on delivery
- Driver: `GET /driver/cash` → `{ collectedCents, receivedCents, outstandingCents, orders:[{ offerId, requestId, ref, businessName, parcels, collectedCents, receivedCents, outstandingCents, lastCollectedAt }], recent:[{ id, ref, amountCents, receivedByName, receivedByRole, note, createdAt }] }` (orders with anything collected, outstanding first).
- Warehouse: `GET /business/cod` → `{ totals:{ collectedCents, receivedCents, outstandingCents }, drivers:[{ driverId, driverName, phoneMasked, outstandingCents, orders:[{ offerId, requestId, ref, collectedCents, receivedCents, outstandingCents }] }] }`; `POST /business/cod/receive { offerId, amountCents, note? }` → remittance `{ id, offerId, requestId, driverId, amountCents, … }` (`amountCents` > 0 and ≤ that offer's outstanding, else `422 VALIDATION field=amountCents details.max`); `GET /business/cod/remittances?page=` → `{ items:[{ id, ref, driverName, amountCents, note, receivedByName, receivedByRole, createdAt }], page, pageSize, total }`.
- Superadmin / staff with `cod.manage` (new permission; in the finance and operations presets): `GET /admin/cod?businessId=&driverId=&q=&onlyOutstanding=1&page=` → `{ totals, items:[{ offerId, requestId, ref, businessId, businessName, driverId, driverName, collectedCents, receivedCents, outstandingCents }], page, pageSize, total }`; `POST /admin/cod/receive { offerId, amountCents, note? }` (audited); `GET /admin/cod/remittances?businessId=&driverId=&page=`.
- Events: `cod_collected` (inside `shipment_delivered` payload `{codCents}`), `cod_received {amountCents, offerId}`. Notification to the driver `cod_received`.

## E.8 Finance (E18)
- Settlement is created **and paid** when the offer completes; `settlements.status` is `paid` (or `approved` = on hold by an open complaint, paid automatically when released). Removed routes: `…/settlements/:id/review|approve|reject|pay|retry|correct`, `POST/GET /admin/finance/payout-batches`. `GET /admin/finance/settlements` (+ summary) remain as a read-only history; withdrawals unchanged. Driver/office wallet shows earnings arriving as soon as a job ends (`overview.wallet.pendingCents` is 0 except held ones).

## E.9 Support tickets
- `POST /uploads/ticket` multipart `file` (jpg/png/webp/pdf ≤ 8 MB) → `{ id, name, mime, size }`; `POST /tickets` and `POST /tickets/:id/replies` accept `attachmentIds:string[]` (≤ 3, must be the caller's unattached uploads); `GET /tickets/:id` replies carry `attachments:[{id,name,mime,size}]`; `GET /tickets/attachments/:id` → file bytes (the ticket's opener or staff with `tickets.view`).
- `POST /tickets/:id/reopen { body? }` (opener, within 14 days of resolving) → ticket `open`. Staff: `PATCH /admin/tickets/:id { status?: open|in_review|resolved, priority?: normal|urgent, assignTo?: userId|null, assignToMe?: boolean }`; `GET /admin/tickets/:id` is the same as `GET /tickets/:id`. Staff candidates for assignment: `GET /admin/tickets/assignees` → `{ items:[{id,name}] }`.
- New categories: driver `cod_issue, app_problem`; business `cod_issue, app_problem`; office `app_problem`. Tickets are created by `business|driver|office` (existing `POST /tickets`).
- Notifications: a customer message → the assignee (or ops with `tickets.manage` when unassigned) `ticket_reply_user {ref}`; a new ticket → ops `ticket_new {ref}`; staff reply → customer `ticket_reply` (existing); staff resolve → customer `ticket_resolved`; reopen → assignee/ops `ticket_reopened`.

## E.10 Events added (timeline i18n `event.*`)
`attendance_confirmed` (payload `auto`), `arrival_unverified`, `loading_scanned`, `loading_unscanned`, `loading_finished`, `route_reordered`, `stop_deferred` (+ note/mediaId), `cod_received`, `warehouse_location_updated`, `delivery_confirmed` (payload `auto:true`).
