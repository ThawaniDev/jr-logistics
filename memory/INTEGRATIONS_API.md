# Warehouse-system integrations — design & API contract (v2, 2026-11-19)

A JR business (warehouse) that runs its own order / warehouse system connects it to JR so that **everything that happens there reaches
JR, and everything that happens to the parcel in JR (warehouse, staff, driver) is reflected there** — as far as each vendor's real API
allows. Decisions I1–I20 in `DECISIONS.md`. Per-vendor guides (what each API documents, set-up steps, limits): `integrations-mds/*.md`.
Code: `web/src/server/partners/` (one adapter per system + a generic core). Adding a system: `integrations-mds/ADDING_AN_INTEGRATION.md`.

## Two shapes of partner (decision I7)
| Mode | Who calls whom | Systems |
|---|---|---|
| **carrier** | the partner treats JR as its shipping company: it **pushes** orders to JR; JR issues its AWB + label + tracking link and reports every status back | Omniful (Shipping-Partner API, JR implements it), Fastcoo (Partner programme) |
| **merchant** | JR uses the warehouse's customer API key to **read** orders/status and cancel / return; these APIs have no "set status" call | LogesTech, Shipox, Fizzpa |
| **custom** | JR's own signed webhook contract, both directions | any other system |

## Data (migrations 0013_partner_sync — journal idx 15 — and 0016_partner_track — idx 16: `partner_orders.last_tracked_at` + indexes)
- `partner_connections` + `meta` (JR-written runtime state: Omniful webhook URL, LogesTech status catalogue, poll cursor), `token_version` (rotating credentials kills issued access tokens), `last_poll_at`, `created_by/updated_by`. Unique index on `inbound_token_hash` (carrier APIs find the connection by key).
- **`partner_orders`** = Incoming orders. Identity `(connection, lower(external_ref))`; `awb` = JR's tracking number (carrier mode, `JR` + 11 digits, globally unique); recipient / address / city (`city` = JR key when matched, `city_raw` as sent) / `cod_cents` (null = partner did not say) / pieces / weight / items / pickup / slot / `extra` (provider ids) / `partner_status(_at)` / `state` `open | cancelled` (+ `cancelled_by` partner|business|staff).
  **The order's JR parcel is derived, never trusted from a stored id**: the newest non-cancelled parcel of the connection whose `external_ref` equals the order's `external_ref` or `awb` (drafts re-create their parcels on every save). Derived states: `open` (no live parcel) · `in_jr` · `delivered` · `undelivered` (failed/returned/missing) · `cancelled`.
  Carrier mode: the parcel's `externalRef` is JR's AWB (that is what JR's label carries, so it scans).
- `partner_outbox`: any JR event, `seq` (strict order per order/parcel: an entry waits while an earlier one of the same line is queued/retrying), `dedupe_key` (one row per real-world occurrence), nullable `shipment_id` (order-level events such as `accepted`), `partner_order_id`.
- `partner_events.partner_order_id`.

## JR events written back (decision I9)
`accepted · assigned · picked_up · out_for_delivery · arrived · delivered · failed · postponed · returned · missing · cancelled · reshipped`.
Source: the parcel journey (`recordShipmentEvents` → `partnerSyncJourney`, same transaction, savepoint) + `route_approved` (→ `out_for_delivery` for every loaded parcel). A JR-side withdrawal (no driver found, request called off) is **not** a cancellation of the warehouse's order — the order simply returns to Incoming orders. A partner-originated cancel is never echoed back.
Per connection: `settings.sync[event]` (adapter defaults underneath, stored values win) and `settings.statusOut[event]` = partner status code to send (absent = documented default, `""` = send nothing). Inbound: `settings.statusIn[partnerStatusLowercase] = status|cancelled|delivered|returned|failed` overrides the documented / classified meaning. Only `cancelled` changes anything in JR.

## Business routes (session, role business) — `/api/v1`
| Method & path | Body → result |
|---|---|
| `GET /integrations/providers` (also staff) | `{items:[Provider]}` — Provider = `{key,label,description,docsUrl,fields:[{key,label,type,secret,required,placeholder,help,default,options,advanced}],capabilities,inboundTokenHeaders,defaults:{sync,statusOut,importNew,pollMinutes},statusOut:[{value,label,hint?}],statusIn:[{value,label,kind}],pollChoices:number[],events:JrEvent[],kinds:EventKind[]}` |
| `GET /integrations/connections` | `{items:[Connection & {orders:{open,inJr}}]}` |
| `POST /integrations/connections` | `{provider,name,config?,secrets?,settings?}` → `201 Connection + Fresh` |
| `GET /integrations/connections/:id` | `Connection & {orders, businessId, business}` |
| `PATCH /integrations/connections/:id` | `{name?,status?:'active'|'disabled',config?,secrets?,settings?}` → Connection. Omitted/empty secret keeps the stored one. settings: `{autoCancel?,importNew?,pollMinutes? (pollChoices),sync?:{ev:bool},statusOut?:{ev:string|""|null(=default)},statusIn?:{status:kind|null(=remove)}}` |
| `DELETE /integrations/connections/:id` | parcels stay, unlinked; its incoming orders are deleted |
| `POST …/:id/test` | `{ok,message,kind?}` (never an HTTP error for partner failures) |
| `POST …/:id/register-webhook` | LogesTech only → `{registered,webhookUrl}` |
| `POST …/:id/rotate-token` | `Fresh` (shown once) |
| `POST …/:id/poll` | "Check now" → `{id,imported,tracked,changed,error?}` (adapters with pollOrders/track) |
| `POST …/:id/lookup` | `{identifiers:[≤100]}` → `{results:[{identifier,found,barcode,invoice,externalId,status,recipientName,recipientPhone,phoneValid,address,city,cityKey,codAmount,lat,lng,pieces,notes,orderId,alreadyInJr,error,errorKind}]}` — found results are remembered as incoming orders |
| `POST …/:id/import` | `{reference}` → OrderDetail (look one order up and add it to Incoming orders) |
| `POST …/:id/label` | partner's own label `{identifiers}` → `{url}` (LogesTech, Shipox) |
| `GET …/:id/events?page&pageSize&outcome=ok|ignored|error&direction=in|out|lookup|test|poll` | `{items:[{id,direction,kind,outcome,summary,externalId,shipmentId,requestId,partnerOrderId,createdAt}],page,pageSize,total}` |
| `GET …/:id/outbox` | `{counts:{queued,sent,dead,skipped,retry_wait},problems:[{id,action,status,attempts,lastError,shipmentId,partnerOrderId,code,ref,createdAt,sentAt,nextAttemptAt}]}` |
| `POST /integrations/outbox/:id/retry` | re-queue a dead/skipped update; `409 INVALID_TRANSITION` when a newer update of the same order already reached the partner |
| `GET /integrations/orders?connectionId&state=open|in_jr|delivered|undelivered|cancelled&q&city&page&pageSize≤200` | `{items:[Order],page,pageSize,total,counts:{open,in_jr,delivered,undelivered,cancelled}}` |
| `GET /integrations/orders/:id` | `OrderDetail = Order & {extra, events:[{id,direction,kind,outcome,summary,createdAt}], updates:[{id,action,status,attempts,lastError,createdAt,sentAt}]}` |
| `POST /integrations/orders/:id/refresh` | ask the partner now (lookup and/or track) → OrderDetail |
| `POST /integrations/orders/manifest` | `{ids:[≤500]}` → `{rows:[{orderId,recipientType,recipientName,recipientPhone,address,city,lat,lng,contents,notes,externalRef,partnerId,codCents,codKnown}],problems:[{id,ref,issue:'not_open'|'incomplete'|'no_city'|'bad_phone'}],cities:string[],deliveryCity:string|null,cityNames:{key:en}}` — rows go straight into the request form's `shipments[]` (drop `orderId`, `codKnown`). `not_open` rows are left out. |
| `POST /integrations/orders/dismiss` | `{ids,reason?}` → `{dismissed}` ("not for JR"; 409 if an order is already in a JR order). Carrier partners get the JR event `cancelled` with the reason (Omniful `unable_to_deliver`, Fastcoo `CCR`, when switched on); merchant systems are not told (no API offers a carrier refusal). |
| `POST /integrations/orders/restore` | `{ids}` → `{restored}` (409 for partner-cancelled orders) |

**Connection** = `{id,provider,providerLabel,name,status,mode,config,hasSecret:{key:bool},settings:{sync,statusOut,statusIn,autoCancel,importNew,pollMinutes},statusMap:{ev:string|null} (effective, only pushable events),statusInOptions:[{value,label,labelAr,kind}] (LogesTech: its live catalogue after a test),statusOutOptions:[{value,label,hint?}],capabilities:{mode,lookup,webhookIn,webhookAuth:'header'|'url',registerWebhook,importOrders,pollOrders,track,push:JrEvent[],label,carrierApi},webhookUrl (base, no token),webhookAuth,webhookUrlTemplate ('…/hooks/<id>/{token}' when the token rides in the URL),tokenPrefix,carrier:{baseUrl,clientId,authModes}|null,runtime:{webhookRegistered,webhookHost,webhookRegisteredAt,lastCarrierCallAt,authMode,lastOrderPollAt,statusCatalogAt},lastCheckedAt,lastOkAt,lastError,lastEventAt,lastPollAt,createdAt,updatedAt}`.
**Fresh** (create / rotate, shown once) = `{inboundToken, webhookUrl (full — includes the token for url-auth partners), carrier:{baseUrl,apiKey,clientId,clientSecret}|null}`.
**Order** = `{id,connectionId,connectionName,businessId,businessName,provider,providerLabel,mode,externalRef,externalId,invoice,awb,displayRef,state,rawState,recipientName,recipientPhone,phoneValid,recipientEmail,address,city,cityRaw,lat,lng,codCents|null,currency,pieces,weightGrams,contents,notes,pickup,items,slot,detailsComplete,partnerStatus,partnerStatusAt,parcel:{id,code,status,requestId,requestRef,requestStatus,deliveredAt,failedAt,failReason}|null,cancelledAt,cancelReason,cancelledBy,labelUrl|null (JR label, carrier mode),trackingUrl|null,createdAt,updatedAt}`.

## Staff routes (backoffice) — same operations, any company, audited (`partner.*` audit actions)
View needs `integrations.view` (or legacy `requests.view`); changes need **`integrations.manage`** (new permissions; super admin has all; presets: operations = both, support = view).
`GET /admin/partners` and `GET /admin/integrations/connections?page&pageSize&q&provider&status&problemsOnly=1&businessId` → `{items:[Connection & {business,businessId,stuckUpdates,orders}],page,pageSize,total}` ·
`POST /admin/integrations/connections {businessId,provider,name,…}` · `GET|PATCH|DELETE /admin/integrations/connections/:id` · `POST /admin/integrations/connections/:id/{test,register-webhook,rotate-token,poll,lookup,import,label}` · `GET …/:id/{events,outbox}` · `POST /admin/integrations/outbox/:id/retry` · `GET /admin/integrations/orders?businessId&…` · `GET /admin/integrations/orders/:id` · `POST /admin/integrations/orders/{manifest,dismiss,restore}` · `POST /admin/integrations/orders/:id/refresh`.

## Public endpoints (partners call these)
- `POST /integrations/hooks/:id` — token in a header the adapter lists (Bearer/bare).
- `POST /integrations/hooks/:id/:token` — token in the path (Shipox and Fastcoo send no auth header); also `…/:token/webhook/API/OrderRecieveLM` and `…/webhook/API/StatusUpdate` (Fastcoo's documented path names). Body ≤ 64 KB. Answer `{accepted,matched,orders:[{reference,awb,trackingUrl,labelUrl,status:'created'|'updated'|'ignored'}]}`; for a carrier partner an unserved city, an unreadable payload or another account's App ID → `422 VALIDATION` (never "accepted"). Status events are applied before order imports. The URL token is redacted from error logs.
- `GET /integrations/labels/:awb/:sig/label.pdf` — JR's A6 label (Code 128 of the AWB), HMAC-signed link, `application/pdf`.
- **Omniful carrier API** — base `<APP_URL>/api/v1/carriers/omniful`: `POST /auth/validate`, `POST /auth/token`, `POST /shipments`, `POST /shipments/cancel`, `GET /shipments/:awb/tracking`, `GET /shipments/:awb/label`, `POST /webhooks/register`; returns endpoints answer `VALIDATION_ERROR` (JR does not collect returns). Omniful's envelope everywhere.
- `GET /track/:code?p=<last4>` also accepts JR's AWB (before dispatch: stage `preparing`).

## Scheduling
The housekeeping tick (`INTERNAL_SCHEDULER` / `POST /cron/tick`) runs the outbox (rounds until nothing unblocks; ≤ 10 per connection per round; a connection is skipped for the run after 3 consecutive "unavailable" answers) and `pollPartners` (per connection, `settings.pollMinutes`, compare-and-set claim; tracking rotates by `last_tracked_at`; one refused order never stops the run; the import cursor moves only after a complete read). Hourly `prunePartnerData` (events 180 d, sent 90 d, dead 180 d). Notification `partner_orders_new` (one per connection per hour, count kept current). A fresh outbox entry is also sent ~2 s later in-process. Retry back-off 1, 5, 30, 120, 360 min, then `dead` + notification `partner_sync_failed`.

## Ops
`INTEGRATIONS_SECRET` (required in production; also keys label signatures and access tokens — changing it invalidates both).

## Update L (W7) — integrator (API key) API and webhooks
The company's own order system (as opposed to a warehouse-system connection above) uses the API-key API. Since Update L: `POST /quote`, `POST /jobs/:id/cancel`, `PATCH /jobs/:id/shipments/:shipmentId`, `POST /jobs/:id/shipments/:shipmentId/cancel`, and the **OpenAPI 3 document at `GET /api/v1/openapi.json`** (public; hand-maintained in `server/ops-tools/openapi.ts`, checked against the routes by `tests/unit/openapi.test.ts`). Details and shapes: `SHIPMENTS_API.md` §L.1.
Webhooks: the business API page has **Send test event** (`POST /business/webhook/test`, event `webhook.test`) and **Retry / Send again** per delivery (`POST /business/webhook/deliveries/:id/retry`, same event id, current URL, attempts reset) — `SHIPMENTS_API.md` §L.2. Signature unchanged: `x-jr-signature: t=<unix>,v1=<hex>` = HMAC-SHA256(`<t>.<raw body>`, signing secret); de-duplicate on `x-jr-delivery`.
