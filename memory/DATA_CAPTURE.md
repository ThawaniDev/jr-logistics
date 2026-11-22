# Data capture and the shared activity log (decisions G5–G7, G10, G11)

Built 2026-11-19. Migration `web/drizzle/0012_data_capture.sql` (hand-written, `IF NOT EXISTS`, with backfills). i18n prefix `dtk.` (`web/src/i18n/fragments/rd-data.ts`).
Rule for all capture code: **it must never break the action that triggered it.** Failures are logged (`capture:<label>`) and swallowed; writes made inside a caller's transaction run in a SAVEPOINT (`capture()` in `server/data-capture.ts`), so even a database error from a capture statement cannot poison that transaction.

## 1. What is stored

| Table / columns | What | Written by | Retention |
|---|---|---|---|
| `users.last_login_at, last_login_ip, last_login_client, login_count` | last successful sign-in, how many | `recordLogin()` (via `openSession()`) | kept |
| `users.last_seen_at`, `sessions.last_seen_at` | last authenticated request, **at most one write per session per 5 min** (guard is part of the UPDATE) | `resolveSession()` → `touchSeen()` | kept |
| `sessions.ip`, `sessions.revoke_reason` | address a session started from; why it ended (`logout`, `password_changed`, `suspended`, `permissions_changed`, `password_reset`, `revoked`) | `createSession()`, `revokeSession(token, reason)`, `revokeAllSessions(id, reason)` | with the session (purged 1 day after expiry by housekeeping) |
| `login_events` | one row per sign-in attempt: `user_id` (null when no account matched), `identifier` (normalised phone / lower-case email), `method` (`otp`\|`password`\|`api_key`\|`session`), `success`, `failure_reason` (`invalid_code`, `bad_password`, `unknown_user`, `locked`, `rate_limited`, `suspended`, `wrong_portal`, `mfa_failed`), `ip`, `user_agent`, `client`, `session_id` | OTP verify, registration, staff password + 2-step login | 400 days; the `identifier` of a failed attempt that matched no account (`user_id` null — often a mistyped password) is erased after 30 days, the row stays (`redactUnknownLoginIdentifiers`, audit K) |
| `driver_location_history` | `driver_id, lat, lng, accuracy_m, speed_mps, heading, offer_id, recorded_at` — **at most one row per driver per 60 s** (`NOT EXISTS` in the INSERT; the live position on the profile still updates every ping) | `POST /driver/location` | 90 days |
| `driver_availability_log` | `driver_id, from_status, to_status, source` (`driver`\|`system`\|`admin`)`, reason, actor_id, at` (only real changes) | `PUT /driver/availability`; cancel-strike auto suspension (`system` / `cancel_strikes`) | kept |
| `shipment_events` | the per-parcel journey: `shipment_id, request_id, offer_id, type, actor_id/role/name, payload, created_at` — types in `SHIPMENT_EVENT_TYPES` (created, edited, details_completed, assigned, unassigned, loaded[via scan\|warehouse], unscanned, route_positioned, arrived, otp_sent, otp_failed, otp_verified, deferred, failed, delivered, cod_collected, returned, missing, cancelled, reshipped, notify_failed, proof_uploaded, partner_status). Rows of one parcel written in one call get increasing timestamps, so their order is stable | see §2 | kept (cascade with the parcel / request) |
| `message_log` | every outbound message: `channel` (`sms`\|`push`\|`webhook`\|`email`\|`inapp`), `direction`, `recipient` (**masked**: last 4 digits of a phone, host of a webhook URL), `type` (`otp`, `recipient_code`, `recipient_track`, webhook event …), `user_id, request_id, shipment_id`, `status` (`queued`\|`sent`\|`failed`\|`delivered`), `provider_ref`, `error`, `attempts`, `sent_at`, `meta`. **The message text is never stored.** Captured today: SMS (OTP, recipient delivery code / tracking link) and outbound webhooks. `push`/`email`/`inapp` are reserved values | `sendSms()`; `events.ts` (webhook queued) + tick sync | 400 days |
| `requests.first_offer_at, first_accepted_at, filled_at, started_at, last_activity_at` | milestones (see `milestonesFor()`); `last_activity_at` = last job event | `logEvent()` → `touchRequest()`; `reconcileMilestones()` fills what was missed | kept |
| `tickets.first_response_at, first_response_by, reopen_count`; `complaints.first_response_at, first_response_by` | ticket = first **public** staff reply (or the staff resolution when nobody replied; internal notes never count); complaint = first staff action (note, assignment or status change) | `support.ts` via `markFirstResponse()` / `bumpReopen()` | kept |
| `metric_snapshots` | `(scope hour\|day, at, city null=platform, metrics jsonb)`, unique on `(scope, at, coalesce(city,''))`. Hourly keys: `drivers_available, drivers_busy, requests_open, slots_unfilled, requests_in_progress, offers_pending, parcels_pending, parcels_in_transit`. Daily keys: `companies_active, drivers_active, offices_active, tickets_open, complaints_open, wallet_available_cents, wallet_held_cents, wallet_escrow_cents, wallet_liability_cents (= positive available + held + escrow)`, platform-only `credit_exposure_cents, cash_with_drivers_cents (= COD collected − remitted), settlements_pending(_cents), withdrawals_pending(_cents)`. Every row carries every key (0 when empty); the platform row always exists. Hour: `at` = start of the UTC hour, written once. Day: `at` = start of the Riyadh day (UTC+3), refreshed once an hour so the last write is the closing state | `runCaptureTick()` | kept |
| `notifications` | in-app notifications (`user_id, type, title, body, data, read_at`) | `notify()` | read: 90 days, any: 12 months (`NOTIFICATION_RETENTION`, hourly prune in `snapshots.ts`; audit K) |
| `entity_notes` | internal staff notes: `entity` (user\|request\|shipment\|ticket\|complaint\|offer\|settlement\|withdrawal), `entity_id`, `author_id`, `body` (1–4000), `pinned`, soft-deleted (`deleted_at`, `deleted_by`) | `server/notes.ts` | kept |

Backfilled by the migration (where the data exists): `users.last_login_*` and `login_events` from live sessions, request milestones from offers / events, `shipment_events` from job events + parcel timestamps (payload carries `"backfill": true`), first-response times from replies / notes.
New indexes for the activity log: `job_events(actor_id|offer_id, created_at)`, `audit_logs(actor_id, created_at)`, `ledger_entries(request_id|offer_id|settlement_id)`, `ticket_replies(ticket_id, created_at)`, `complaint_notes(complaint_id, created_at)`, `tickets/complaints(request_id, opener)`, `settlements/invoices(request_id)`, `withdrawals(user_id, created_at)`, `ratings(ratee_id)`, `messages(request_id, created_at)`, `notifications((data->>'requestId'), created_at)`, `partner_events/webhook_deliveries(request_id…)`, `offers(office_id)`.

## 2. Capture points

* **Sign-ins** — `auth/session.ts` `openSession()` = `createSession()` + `recordLogin()`; used by the password sign-in (`accounts.loginWithPassword`), registration and the two-step (MFA) sign-in step in `routes/common.ts`. Failures are recorded where they are rejected (`accounts.loginWithPassword`, the MFA step). Logout / mass revocation pass a reason.
* **Parcel journey** — central: `events.ts logEvent()` → `captureFromJobEvent()` mirrors every job event that carries a `shipmentId` (arrived, delivered [+ otp_verified, cod_collected], failed, deferred, loaded via scan, edited, cancelled, otp_sent …) and derives `route_positioned` rows from `route_planned` / `route_reordered`. Bulk operations call `recordShipmentEvents()` / `batchOf()` next to their UPDATE: `saveManifest` (created), `allocateToOffer` (assigned), `markLoaded` (loaded via warehouse, unassigned), `releaseOfferShipments`, `finishLoading`, `confirmReturns`, `completeShipments`, `cancelRequest`, `finalizeRequest`, `resolveDispute` (missing), maintenance (lapsed / called-off requests), `reshipFromRequest`. The activity feed shows mirrored job events **once**, from `shipment_events` (`MIRRORED_JOB_EVENTS`).
* **Request activity / milestones** — `logEvent()` calls `touchRequest()`: one UPDATE that never waits for a row lock (`FOR UPDATE SKIP LOCKED`), so it can neither slow nor deadlock the money-moving transactions. A request that is locked by someone else is caught on its next event, and the hourly tick runs `reconcileMilestones()` (derives the same values from `offers`).
* **Messages** — `auth/otp.ts sendSms()` wraps every SMS send (OTP in `sendOtp`, recipient codes in `shipments.sendRecipientCodes`); `events.ts enqueueWebhook()` logs a `queued` webhook row; the maintenance tick `syncWebhookMessages()` copies the final status (`delivered` / `failed`, attempts, last error) from `webhook_deliveries`.
* **Tick** — `maintenance.ts runMaintenance()` → `snapshots.ts runCaptureTick()`: every tick syncs webhook rows; the first tick of each hour writes the hourly snapshot (per city + platform), refreshes today's daily snapshot, reconciles milestones and prunes (location history 90 d, login events 400 d, message log 400 d, in batches of 10 000). `runMaintenance()` returns the result under `capture`.

## 3. Activity log service

`server/activity.ts` — `entityActivity(viewer, { entity, id, kinds?, actorId?, q?, from?, to?, page, pageSize })` → `{ items, total, kindCounts, hidden, failed, truncated, entity }`.
Entities: `request`, `offer`, `shipment`, `user` (company / office / driver / staff), `ticket`, `complaint`, `settlement`, `withdrawal`.
Item: `{ id, at, kind, source (permission group), table, titleKey, params, actor{id,name,role}, refs[{type,id,label,role}], details }`.
Kinds (chips): `event, parcel, audit, chat, notification, money, support, rating, note, document, login, availability, message, integration`.
Cost: per source one `COUNT` and one `LIMIT`ed SELECT (index-backed, run in parallel), merged in memory; per-source limit = `page × pageSize` (max 20 × 100). A failing source is reported in `failed`, the rest still shows.
**Permissions (G10)** — a source group is read only with one of its permissions; the others are skipped and listed in `hidden` (the UI says so). Opening the entity needs its own view permission.

| Group | Permission (any of) |
|---|---|
| events (order events, parcels), chat, ratings, integration | `requests.view` |
| audit | `audit.view` |
| finance (ledger, settlements, withdrawals, invoices, COD) | `finance.view`, `wallets.view`, `settlements.review`, `withdrawals.manage` |
| support (cases, replies, files, complaints) | `tickets.view`, `tickets.manage`, `complaints.manage` |
| documents | `documents.review`, `verification.manage`, `users.view` |
| logins, availability | `users.view` / `drivers.view` |
| notifications, messages | `users.view` (user) · `requests.view` (order / parcel) · `tickets.view` (case) · `finance.view` (money) |
| notes (read) | the entity's own view permission |
IPs, user agents and coordinates are replaced by `•••` for viewers without `drivers.sensitive`.

Routes (all backoffice, `routes/admin-activity.ts`): `GET /admin/activity/:entity/:id` (query `kinds` comma list, `actorId`, `q`, `from`, `to`, `page`, `pageSize` ≤ 100) · `GET /admin/activity/:entity/:id/export` (CSV, needs `reports.export`, ≤ 5 000 rows, audited as `activity.export`) · `GET|POST /admin/notes/:entity/:id` · `PATCH|DELETE /admin/notes/:noteId` (pin / unpin needs `notes.manage`; delete = author or an admin; audited `note.add` / `note.delete`) · `GET /admin/location-history/:driverId?from&to&offerId` (a driver's sampled path, ≤ 31 days, thinned to 1 500 points, needs `drivers.sensitive`, audited as `location.view`).
New permission **`notes.manage`** (presets `support`, `operations`, `hr_verification`).

## 4. UI components (embed on the detail pages)

```tsx
import { ActivityLog } from "@/components/features/activity-log";
import { NotesPanel } from "@/components/features/notes-panel";
import { RawDataPanel } from "@/components/features/activity-raw";

<ActivityLog entity="request" id={id} />                              // full log: chips with counts, search, person + period filters, export, load more
<ActivityLog entity="user" id={id} kinds={["login", "availability"]} compact title={t("…")} />   // teaser: newest 8, no filters
<NotesPanel entity="ticket" id={id} />                                // add / pin / delete; refreshes every ActivityLog on the page
<RawDataPanel data={record} />                                        // collapsible key / value (copyable) + full JSON, for support
```
Props — `ActivityLog`: `entity`, `id`, `kinds?` (only these kinds), `compact?`, `pageSize?` (30 / 8), `title?`. `NotesPanel`: `entity`, `id`, `title?`. `RawDataPanel`: `data`, `title?`, `defaultOpen?`, `testId?`. Also exported: `JsonView`, `KeyValueList`, `ActivityRow`.
Test ids: `dtk-log, dtk-chip-all, dtk-chip-<kind>, dtk-search, dtk-actor, dtk-from, dtk-to, dtk-clear, dtk-item (data-kind, data-title), dtk-item-toggle, dtk-item-details, dtk-more, dtk-count, dtk-export, dtk-hidden, dtk-failed, dtk-empty, dtk-loading, dtk-notes, dtk-note-body, dtk-note-pin, dtk-note-add, dtk-note, dtk-note-toggle-pin, dtk-note-delete, dtk-note-confirm-delete, dtk-raw, dtk-raw-toggle, dtk-raw-json`.
**Links** from activity items go through `refHref()` in `components/features/activity-lib.ts` — the one place to change when a detail page moves (today: requests `/admin/requests/:id`, cases `/admin/cases/:id`, complaints `/admin/complaints/:id`, companies / drivers / offices by role).

## 5. How to extend

* **A new capture** — write through `capture(x, "label", fn)` (never let it throw into the caller); add the table to `db/schema.ts` + a migration; give it a retention rule in `snapshots.ts pruneCaptureData` if it grows without bound.
* **A new parcel step** — add the type to `SHIPMENT_EVENT_TYPES`, a title `dtk.p_<type>` (en + ar + ur), and emit it with `recordShipmentEvents()` (or let a job event with `payload.shipmentId` map to it in `JOB_TO_PARCEL`).
* **A new activity source** — add a `Source` in `activity-sources*.ts`: one SELECT per entity returning the fixed columns `id, at, actor_id, actor_name, actor_role, type, txt, data` (use `sel()` and `unionAll()`), a `map()` to `{ titleKey, params, refs, details }`, its `group` + `kind`; give the titles `dtk.*` translations (the unit test `data-i18n` fails until you do). New audit actions: add to `KNOWN_AUDIT_ACTIONS` + `dtk.act.<action>`.
* **A new metric** — add the key to `HOURLY_KEYS` / `DAILY_KEYS` and a query in `collectHourly` / `collectDaily`; old snapshots simply lack the key.
* **Known limits** — the location sample window is checked with `NOT EXISTS`, so two pings of one driver inside the same millisecond could both be stored; `api_key` sign-ins are not recorded (a row per API call would drown the table — use `api_keys.last_used_at`); `push` / `email` / `in-app` messages are not in `message_log` (in-app notifications are their own table and appear in the feed).

## 6. Tests

`tests/unit/data-activity-core.test.ts`, `data-capture-lib.test.ts`, `data-activity-lib.test.ts`, `data-i18n.test.ts` (pure logic: merging, paging, permissions, redaction, CSV, mapping, buckets, titles, translations); `tests/integration/data-capture.test.ts` (sign-ins, last seen, location sampling, availability, parcel journeys, SMS / webhook log, milestones, first response, snapshots, retention), `data-activity.test.ts` (feeds of every entity, permissions, paging, filters, export, notes, location history); `e2e/data-activity.spec.ts` (API + component, runs once a detail page embeds the components).
