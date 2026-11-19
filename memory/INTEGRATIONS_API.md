# Warehouse-system integrations — design & API contract

Purpose: a warehouse (JR business) that runs its own order system — LogesTech today, anything else tomorrow — connects it to JR so
parcels are linked by the warehouse's own barcode / order number, status changes flow in, and JR outcomes can flow back.
One **adapter** per system (`web/src/server/partners/<provider>.ts`, registered in `registry.ts`). The platform core never changes.

## What the LogesTech public API allows (and does not)
Docs: https://docs.logestechs.com — `X-API-Key: psk_integration_…`, base `https://apisv5.logestechs.com/api` (configurable per connection).
| Need | LogesTech support | In JR |
|---|---|---|
| Look up a package by barcode / invoice | `GET /secure/integration/packages/status` (response schema NOT published → tolerant parser) | `lookup` (import into the manifest) |
| Status changes | webhook POST, no retries on their side, token in 5 headers | `POST /integrations/hooks/:id` |
| Cancel before pick-up | `PUT /packages/cancel` | `cancelled` write-back (opt-in) |
| Ask for a return | `PUT /packages/return` | `returned` write-back (opt-in) |
| Register our webhook URL/token | `PUT /secure/integration/webhook` | "Connect automatically" button |
| Label (AWB) | `POST /packages/awb` | print label |
| **List my packages / mark delivered** | **does not exist** | so JR cannot pull a worklist or write "delivered" back; parcels are linked by typed/pasted/scanned barcode; "delivered/failed" write-back is not offered for LogesTech (the generic webhook adapter offers it) |

## Data
- `partner_connections` (per business): provider, name, status, `config` (non-secret), `secrets_enc` (AES-256-GCM, `INTEGRATIONS_SECRET`), `settings {sync:{delivered,failed,returned,cancelled}, autoCancel}`, inbound token (sha256 only), health (`lastOkAt/lastError/lastEventAt`).
- `shipments.partner_id` (which connection the parcel came from; **only honoured if the connection belongs to the request owner**), `partner_status`, `partner_status_at` (mirror).
- `partner_events` — audit trail both ways (in / out / lookup / test). `partner_outbox` — write-back queue with retries/backoff (1,5,30,120,360 min), dead-letter, created in the same transaction as the JR event.
- Timeline event `partner_status` (payload `shipmentId, code, provider, providerLabel, status, kind, note`) on the parcel's timeline.

## Business routes (session auth, role business) — all under `/api/v1`
| Method & path | Body → result |
|---|---|
| `GET /integrations/providers` | `{items:[{key,label,description,docsUrl,fields:[{key,label,type,secret,required,placeholder,help,default}],capabilities:{lookup,webhookIn,registerWebhook,push:[…],label},inboundTokenHeaders}]}` — **render forms from `fields`** |
| `GET /integrations/connections` | `{items:[Connection]}` |
| `POST /integrations/connections` | `{provider,name,config?,secrets?,settings?}` → `201 Connection + inboundToken` (**token shown once**) |
| `PATCH /integrations/connections/:id` | `{name?,status?:'active'|'disabled',config?,secrets?,settings?}` → Connection (omitted/empty secret keeps the stored one) |
| `DELETE /integrations/connections/:id` | parcels stay, unlinked |
| `POST …/:id/test` | `{ok,message,kind?}` — never an HTTP error for partner failures (`kind: auth|unavailable|…`) |
| `POST …/:id/register-webhook` | sets URL + fresh token on the partner (LogesTech); `{registered:true}` or error |
| `POST …/:id/rotate-token` | `{inboundToken,webhookUrl}` (shown once; for hand-configured partners) |
| `POST …/:id/lookup` | `{identifiers:[≤100]}` (50 processed) → `{results:[{identifier,found,barcode,invoice,externalId,status,recipientName,recipientPhone,address,city,codAmount,alreadyInJr:{requestRef,code,status}|null,error,errorKind}]}`. Recipient fields may be null — the vendor does not guarantee them; the UI must let the user complete missing data. |
| `POST …/:id/label` | `{identifiers}` → `{url}` |
| `GET …/:id/events?page&pageSize&outcome=ok|ignored|error` | `{items:[{id,direction,kind,outcome,summary,externalId,shipmentId,requestId,createdAt}],page,pageSize,total}` |
| `GET …/:id/outbox` | `{counts:{queued,sent,dead,…},problems:[{id,action,status,attempts,lastError,code,createdAt}]}` |
| `POST /integrations/outbox/:id/retry` | re-queue a dead/skipped update |
Connection = `{id,provider,providerLabel,name,status,config,hasSecret:{apiKey:bool},settings,capabilities,webhookUrl,tokenPrefix,lastCheckedAt,lastOkAt,lastError,lastEventAt,createdAt}`.

Manifest rows (`shipments[]` on request create/update) take an optional **`partnerId`** (the connection the order came from) together with `externalRef` (the partner's barcode/order number). Parcel views (`/requests/:id/shipments`) include `partnerId, partnerStatus, partnerStatusAt`.

## Inbound webhook (public) `POST /integrations/hooks/:connectionId`
Auth = the connection's token in `Authorization` (Bearer or bare) / `x-api-key` / `api_key` / `ApiKey` / `api-key` (LogesTech sends its "password" in all five). 401 for missing/wrong token (indistinguishable from unknown connection). Always 200 for authentic-but-irrelevant payloads. Body ≤ 64 KB, rate-limited. Replays are de-duplicated; stale events never overwrite newer ones.
Effects: parcel `partnerStatus` updated + timeline event; **CANCELLED** withdraws a parcel still at the warehouse (refund) when `autoCancel` (default on); if it is already with a driver → no change, business notified (`partner_cancel_conflict`). The echo guard stops JR from cancelling it back at the partner.
Generic adapter (`provider:"webhook"`) body: `{reference,status,note?,at?}`; outbound callbacks `parcel.delivered|failed|returned|cancelled` signed `x-jr-signature: t=…,v1=hmac_sha256(secret,"t.body")`.

## Admin
`GET /admin/partners` (backoffice, needs `requests.view`) → `{items:[Connection + business, businessId, stuckUpdates]}`.

## Adding another system
1. `web/src/server/partners/<name>.ts` exporting an `Adapter` (fields, capabilities, `test`, optional `lookup/parseWebhook/registerWebhook/push/makeLabel`). Use `ctx.http` only (SSRF-safe).
2. Register it in `registry.ts`. 3. Add provider copy to a `partners-*.ts` i18n fragment. 4. Add tests next to `tests/integration/partners.test.ts` using the local fake server there. Nothing else changes.

## Ops
`INTEGRATIONS_SECRET` (required in production). Write-back runs on the existing scheduler / `POST /cron/tick`.

## Server audit additions
- `GET /admin/partners?page&pageSize≤200&q&provider&status=active|disabled&problemsOnly=1` → `{items,page,pageSize,total}` (the old fixed `limit 200` is gone; items unchanged). `q` matches the connection name, business name or company; `problemsOnly` = a connection with a recorded error or stuck write-backs.
- Inbound hooks: body cap 64 KB is now enforced while reading (`413 PAYLOAD_TOO_LARGE`), an event timestamp more than 5 minutes in the future is treated as "now", and the connection id is validated before any rate-limit counter is created.
- Partner and webhook URLs are checked with the corrected private-address test (IPv4-mapped IPv6 hex forms, NAT64, 6to4, reserved ranges).
