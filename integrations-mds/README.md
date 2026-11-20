# JR Platform ↔ warehouse systems — overview and guide

JR connects to the order / warehouse systems its companies already use, so orders flow into JR without retyping and every step JR takes
(warehouse, staff, driver) shows up in the company's own system — **as far as each vendor's published API allows**. Nothing here relies
on an undocumented endpoint; where a vendor offers no way to do something, the guide says so.

| System | Mode | Orders reach JR by | JR's progress reaches the system by | Guide |
|---|---|---|---|---|
| **Omniful** | carrier | Omniful calls JR's Shipping-Partner API (`POST /shipments`) | JR posts every status to Omniful's webhook; Omniful can also poll JR | [omniful.md](omniful.md) |
| **Fastcoo** | carrier | Fastcoo posts each order to JR's webhook URL | `Update3plDetails` (JR AWB, label, tracking) + `StatusUpdate` for every step | [fastcoo.md](fastcoo.md) |
| **LogesTech** | merchant | status webhook (new packages, opt-in), lookup by barcode/invoice | cancel and return-to-sender calls only (no "set status" API) | [logestechs.md](logestechs.md) |
| **Shipox** | merchant | scheduled pull of the order list, lookup, webhook | cancel call only (no "set status" API) | [shipox.md](shipox.md) |
| **Fizzpa** | merchant | lookup by Fizzpa order number | cancel (delete) call only (no webhooks, no "set status" API) | [fizzpa.md](fizzpa.md) |
| **Custom system** | custom | JR's documented webhook (orders + statuses) | signed callbacks for every JR event | [custom-webhook.md](custom-webhook.md) |

Adding another system: [ADDING_AN_INTEGRATION.md](ADDING_AN_INTEGRATION.md). Vendor documentation as fetched: [vendor-docs/](vendor-docs/README.md).
API contract (developers): `memory/INTEGRATIONS_API.md`. Decisions: `memory/DECISIONS.md` I1–I20.

---

## 1. The two kinds of partner

**Carrier mode — the system treats JR as its shipping company.** Omniful and Fastcoo have programmes for third-party couriers. The
company selects JR as the carrier inside Omniful / Fastcoo; from then on those systems *send* orders to JR, and expect JR to report
progress. JR gives every such order its own tracking number (AWB, `JR` + 11 digits), a PDF label and a public tracking link.

**Merchant mode — JR works with the company's own customer account.** LogesTech, Shipox and Fizzpa publish an API for *their customers*
(the merchant). JR uses the company's key to read orders and statuses and to cancel/return. These APIs have **no call to set a package's
status**, so a JR pick-up or delivery cannot be written into them — JR shows their status next to its own instead.

## 2. What flows each way

### From the system to JR ("everything that happens there is heard")
| Happening in the system | Carrier mode | Merchant mode |
|---|---|---|
| New order for JR | arrives instantly in **Incoming orders** with a JR AWB | arrives in Incoming orders when *Import new orders* is on (webhook / scheduled pull), or when the company looks it up |
| Status change | shown on the order and on the JR parcel's timeline | same (webhook, and the scheduled check reconciles missed webhooks) |
| Cancellation | order leaves Incoming orders; a parcel still at the warehouse is withdrawn and refunded; a parcel already with a driver is **refused** (Omniful gets an error) and the company is notified | same, except the parcel is only withdrawn when *Auto-cancel* is on; otherwise the company is notified |
| Unknown / undocumented status | shown as sent, logged; the company or a JR admin can map it to a meaning | same |

### From JR to the system ("everything that happens in JR is reflected")
JR events, each sent once, in order, with retries: **accepted · assigned · picked up · out for delivery · arrived · delivered · failed
(reason) · postponed · returned · missing · cancelled · re-shipped**. Which of them a system receives, and as which of *its* status codes,
is set per connection under **Sync & statuses** (defaults follow the vendor's documented codes — see each guide).

| JR event | Omniful (default) | Fastcoo (default) | LogesTech | Shipox | Fizzpa | Custom |
|---|---|---|---|---|---|---|
| accepted (order received) | answered synchronously | `Update3plDetails` | — | — | — | — (the webhook answer carries the result) |
| assigned to a driver | — (optional) | `B` (off by default) | — | — | — | `parcel.assigned` (off) |
| picked up at the warehouse | `dispatched` | `PUC` | — | — | — | `parcel.picked_up` |
| out for delivery (route approved) | `out_for_delivery` | `OD` | — | — | — | `parcel.out_for_delivery` |
| arrived at recipient | — (optional) | `DOP` (off by default) | — | — | — | `parcel.arrived` (off) |
| delivered | `delivered` | `POD` | — | — | — | `parcel.delivered` |
| failed attempt (+ reason) | `unable_to_deliver` | `FD` + reason | — | — | — | `parcel.failed` |
| returned to the warehouse | `return_to_origin` | `ROP` | **return-to-sender call** (opt-in) | — | — | `parcel.returned` |
| missing | `lost` | `MS` | — | — | — | `parcel.missing` |
| cancelled by the company in JR, or the order set aside | `unable_to_deliver` + the reason (the order goes back to Incoming orders) | `CCR` + the reason | **cancel call** (opt-in) | **cancel call** (opt-in) | **delete call** (opt-in) | `parcel.cancelled` |

"—" = the vendor's API has no call for it. Cancel / return calls trigger real logistics in that system, so they are **off until the
company switches them on** (decision I3). A JR-side withdrawal that is not the company's decision (no driver found, request called off)
never cancels the order in the other system; the order simply returns to Incoming orders. A cancellation that came *from* the partner
is never echoed back to it.

## 3. Incoming orders → JR delivery orders
`Integrations → Incoming orders` lists every order JR received or imported: open (waiting for JR), in JR, delivered, undelivered,
cancelled (a sidebar counter shows the open ones; the company also gets one "N new orders" notification per connection per hour).
Select open orders of one city → **Create delivery order** → the request form opens with the parcels filled in (recipient,
phone, address, COD, reference). Problems are flagged before publishing: city JR does not serve, invalid phone, missing details.
An order is linked to its JR parcel by the reference (carrier mode: JR's AWB, which is what JR's label carries, so drivers can scan it).
If the company cancels the parcel in JR or removes it from a draft, the order goes back to *open*. **Set aside** hides an order JR will not
deliver: Omniful / Fastcoo are told JR will not deliver it (`unable_to_deliver` / `CCR` with your reason); merchant systems are not told
(their APIs have no "carrier refuses" call — tell the merchant directly).

## 4. Who can change what
| Action | Company (warehouse admin) | JR staff |
|---|---|---|
| See connections, activity, failed updates, incoming orders | own company | `integrations.view` (or `requests.view`) — any company |
| Create / edit / pause / delete a connection, keys, status mapping, sync switches, polling, rotate credentials, retry, check now | own company | `integrations.manage` — any company, **every change audited** (`partner.*` in the audit log) |
| Create delivery orders from incoming orders | yes | no (the company publishes and pays) |
Super admin holds every permission. Staff presets: *operations* = view + manage, *support* = view. Secrets (API keys, passwords, tokens) are
write-only for everybody: never shown again after saving, never logged, AES-256-GCM encrypted at rest.

## 5. Reliability and security
- Write-backs are queued **in the same database transaction** as the JR action (a rolled-back action never reaches a partner), sent in
  strict order per order (a later update waits while an earlier one retries), at most once per real occurrence, and retried after 1, 5,
  30, 120 and 360 minutes on temporary failures; then parked as *failed update* and the company is notified. A rejected key / payload is
  not retried — fix it, then press *Retry* (refused when a newer update of that order already reached the partner, so a partner is never
  moved backwards). Each run serves every connection fairly (at most 10 per connection per round) and skips a partner after 3
  "unavailable" answers in a row, so one system being down never delays the others.
- Incoming: the same change reported twice (webhook + scheduled check, retries) counts once; an older event never overwrites a newer
  status; an event without a partner time never overrides a timed one; a cancellation older than the status JR shows is ignored; effects
  are applied before an event is marked as seen, so a crash mid-way heals on the partner's retry.
- Partner answers larger than 2 MB, or unreadable, are errors — never silently treated as "no orders"; the import cursor only moves after
  a complete read.
- Tenant isolation: a parcel can only be linked to a connection of its own company (checked when the manifest is saved), and the
  order ↔ parcel link is always scoped to the company.
- Incoming webhooks: per-connection secret token (header, or in the URL for systems that cannot send headers), constant-time comparison,
  64 KB body limit, rate limits, replay de-duplication, stale events never overwrite newer ones, a partner clock in the future is clamped.
- Outgoing calls: SSRF-pinned HTTP (no private networks in production, no redirects), 10-second timeout, capped responses.
- Carrier API (Omniful): per-account key or short-lived signed access token; rotating the key invalidates both immediately.
- JR labels are public PDF links signed with HMAC (knowing an AWB is not enough).

## 6. Operations
- `INTEGRATIONS_SECRET` must be set in production (encryption, label signatures, access tokens — changing it invalidates them).
- `APP_URL` must be the public https address (it is inside every URL JR hands to partners).
- The housekeeping tick (`INTERNAL_SCHEDULER=true`, or an external cron calling `POST /api/v1/cron/tick` every minute) sends the queue and
  runs the scheduled checks (per connection: 5–180 minutes, LogesTech and Fizzpa default 30).
- Monitoring: `Admin → Integrations` (filter *problems only*: a failing connection or stuck updates); each connection's *Activity* shows
  everything that crossed the boundary both ways. Retention: partner traffic log 180 days, delivered updates 90 days, failed ones 180 days;
  orders are kept.

## 7. Verification (2026-11-19, after an independent review whose 15 findings were all fixed and pinned by tests)
- Unit (`web/tests/unit/partners-adapters.test.ts`, 25 tests): every adapter parses the **vendor's own sample payloads** from the
  documentation; status maps only use documented codes; the label's Code 128 barcode is decoded back by a real barcode reader (ZXing);
  the PDF's cross-reference table is valid; tokens/signatures cannot be forged.
- Review regressions (`web/tests/integration/partners-review.test.ts`, 14 tests): one per review finding (large answers, Omniful retry
  idempotency, reconciliation fairness, duplicate / untimed / stale events, tenant isolation, cancellation healing, retry ordering,
  token rotation safety, Omniful status contract + attempts across re-ships, Fizzpa id safety, Fastcoo answer codes, partner fairness,
  credential caching, reference edits).
- UI (`partner-conn-*.test.ts` 58 tests, `partner-orders-lib.test.ts` 16 tests): every connection tab rendered for every system in
  en / ar / ur with no raw keys; mapping / selection / prefill logic; en / ar / ur parity of every new string.
- End-to-end (Playwright, production build): `integrations.spec.ts`, `integrations-connections.spec.ts`, `integrations-orders.spec.ts` —
  4/4 (company adds Omniful and sees the credentials once, edits a mapping, staff see it; a custom system pushes orders → Incoming orders
  → prefilled delivery order → "In JR", set aside / restore; LogesTech connect / test / import / delete). The surrounding specs (flows,
  business views, sidebar, parcels & route, admin system views) still pass.
- Integration (`web/tests/integration/partners-v2.test.ts` 17 tests + `partners.test.ts` 33 tests), against a local stand-in for each
  vendor speaking its documented contract: the full journeys (Omniful create → JR order → driver → ordered webhooks; Fastcoo order →
  3PL details → status codes with token refresh; Shipox poll/webhook/history/cancel/label/re-sign-in; Fizzpa lookup/poll/delete; LogesTech
  catalogue/webhook import/history), cancellations both ways, staff management + audit, permission checks through the real router,
  ordering under failure, and a 300-order volume run.
- Not possible here: calls against the vendors' live systems (no credentials). Each guide lists what to verify with the vendor at go-live.
