# Omniful ↔ JR — integration guide

**Mode: carrier.** JR appears inside Omniful as a *shipping partner*. Omniful sends shipments to JR through Omniful's standard
"Shipping Partner Integration API" — a contract **JR implements** — and JR reports every status change back to Omniful.
Source: Omniful's Postman collection, folder "Shipping Partner" (snapshot: [vendor-docs/omniful-shipping-partner.txt](vendor-docs/omniful-shipping-partner.txt)).
Code: `web/src/server/partners/omniful.ts` (outbound) and `carrier-omniful.ts` (the API Omniful calls).

## 1. What Omniful documents, and what JR does with it
| Omniful calls JR (JR's base URL + path) | JR's behaviour |
|---|---|
| `POST /auth/validate {api_key}` (api_key mode, health check) | 200 `{success:true,data:{}}` for an active connection's key, else 401 `AUTHENTICATION_ERROR` |
| `POST /auth/token {client_id, client_secret, grant_type}` (access_token mode) | client_id = JR connection id, client_secret = the connection's key → `{access_token, expire_in:3600}`. Omniful re-fetches on any 401 (documented). |
| `POST /shipments` (create forward shipment) | A repeated `system_id` is answered with the first AWB **before** any validation (a retry after Omniful's timeout must never be refused because a setting changed). Then validates what JR can deliver (contract: "raise an error when something is not supported") → `VALIDATION_ERROR` for: currency ≠ SAR, drop country ≠ SA, a city JR does not serve (`system_city`, falling back to `external_city` as documented), COD when the company switched COD off, missing `order_id` / `system_id` / `drop_details` / `payment_details`. Otherwise creates an **Incoming order** and answers `{awb_number, partner_system_id, awb_label, tracking_url}`. **Idempotent on `system_id`** (documented idempotency key): a repeat returns the same AWB. |
| `POST /shipments/cancel {awb_number, reason}` | Not yet in a JR delivery order → cancelled. Waiting at the warehouse in a published JR order → withdrawn + refunded. Already with a driver / delivered → `VALIDATION_ERROR` ("already with a JR driver") and nothing changes; the company is notified. Twice → `ALREADY_CANCELLED`. |
| `GET /shipments/{awb}/tracking` | JR's current state in Omniful's vocabulary (same mapping as the webhooks): `status, status_updated_at, description, reason (failed), number_of_attempts, first_delivery_attempt_at`. Before pick-up: `status:"pending"` — a value outside Omniful's list, which Omniful documents as "may not update shipments", so it never fakes progress. |
| `GET /shipments/{awb}/label` | `{awb_label}` — public PDF URL (signed), `Content-Type: application/pdf`, ends in `.pdf` (Omniful's label rules). |
| `POST /shipments/returns`, `/shipments/returns/cancel`, `GET /shipments/returns/{awb}/label` | `VALIDATION_ERROR`: JR does not collect return shipments from customers (decision I15). **Do not declare the return capabilities at onboarding.** |
| `POST /webhooks/register {webhook_url}` | Stored per connection (Omniful sends one URL per merchant account) → `{is_success:true}`. Must be a public https URL. |

| JR calls Omniful | When |
|---|---|
| `POST <webhook_url>` `{awb_number, status, status_updated_at, description, reason?, number_of_attempts}` (no auth, as documented) | every JR event mapped to an Omniful status (below), in order, retried on failure |

Every answer uses Omniful's envelope: `{"success":true,"data":{…}}` or `{"success":false,"error":{"code","message"}}` with codes
`VALIDATION_ERROR, AUTHENTICATION_ERROR, NOT_FOUND, ALREADY_CANCELLED, INTERNAL_ERROR` (+ `RATE_LIMITED`). Only database work happens
during Omniful's calls, well inside its 10-second timeout.

### Status mapping (default, editable under Sync & statuses)
| JR event | Omniful status |
|---|---|
| picked up at the warehouse | `dispatched` |
| out for delivery (driver approved the route) | `out_for_delivery` |
| delivered | `delivered` |
| failed attempt (reason + note in `reason`) | `unable_to_deliver` |
| returned to the warehouse | `return_to_origin` |
| missing | `lost` |
| cancelled by the company in JR / order set aside in Incoming orders | `unable_to_deliver` with the reason ("Cancelled by the warehouse in JR: …") |
| assigned, arrived, postponed, re-shipped | not sent (map them if you want) |
Only Omniful's 9 documented values can be chosen (Omniful: "Allowed values"); JR refuses any other code in the mapping editor.
`number_of_attempts` counts every JR attempt for the order, also across a re-shipment.
Omniful's documented values: `dispatched, in_transit, out_for_delivery, delivered, unable_to_deliver, lost, partially_delivered, return_in_progress, return_to_origin`.

### Data JR keeps from a shipment
`order_id` (shown as the order's reference), `system_id`, `reference`, recipient (`drop_details`: name, phone, email, address lines +
street + area + building + postal code, coordinates, national address code), pickup hub (`pickup_details`, `location_code`), COD
(`is_cod` / `cod_amount`), boxes, weight, items (SKU, name, quantity), remarks, delivery slot, `meta.custom_fields`. The JR parcel carries
JR's AWB as its reference, so the label scans.

## 2. Set-up
**JR (once, at Omniful onboarding of the "JR" shipping app)** — give Omniful:
- Base URL: `https://<your JR domain>/api/v1/carriers/omniful` (no trailing path; Omniful appends `/shipments` etc.).
- Auth type: either works — `api_key` (simplest) or `access_token` (JR implements `/auth/token`).
- Supported endpoints: forward create, forward cancel, tracking (polling), forward label, automatic webhook registration, status webhooks.
  **Not** the return endpoints.
- Logo and name; no custom fields are required by JR (any you configure are stored with the order).

**Each company (warehouse admin) — or a JR admin for them:**
1. JR → Integrations → *Add connection* → **Omniful** → name it → save. JR shows **once**: the API key, client ID and client secret.
2. In Omniful → Shipping partners → JR → enter the API key (api_key mode) or client ID + client secret (access_token mode). Omniful
   validates it (`/auth/validate` or `/auth/token`) and registers its webhook URL automatically.
3. Check the connection page: *Omniful is connected (last call …)* and *webhook registered*.
4. Optional: Sync & statuses → adjust the mapping; Setup → switch off COD if the company does not want cash shipments.
5. Shipments now arrive in Integrations → Incoming orders. Select them → *Create delivery order*.
Lost the key? *Rotate credentials* issues a new key (old key and any issued access tokens stop at once) — re-enter it in Omniful.

## 3. Limits and owner decisions
- **Returns from customers** are not offered (JR's model is warehouse → recipient). Building reverse pick-ups is a product decision.
- **Currency / country**: SAR and Saudi Arabia only (JR's wallet and coverage). Other values are refused at creation.
- `partially_delivered` is never sent: a JR parcel is delivered as a whole.
- "Set aside" in JR is reported as `unable_to_deliver` with your reason (the contract has no carrier-refusal call; this is the nearest
  documented value). Ask the merchant to re-route or cancel it in Omniful.
- Rate limits are per merchant account (Omniful calls for all merchants from shared addresses): 600 calls/min per account, 120 token
  requests/min per client id.
- Arabic text cannot be printed with the PDF standard fonts, so JR's label prints the barcode, AWB, city, COD, pieces and Latin text;
  an Arabic name/address shows "(see JR app)" — the driver app has the full details (decision I16).

## 4. Go-live checklist (needs Omniful's sandbox)
1. Omniful's health check passes with the key. 2. A test shipment returns an AWB and Omniful downloads the label. 3. After registration,
deliver one parcel end-to-end and confirm Omniful moves through dispatched → out for delivery → delivered. 4. Cancel one shipment before
pick-up and one after (the second must be refused). 5. Watch JR's Activity tab for both directions.

## 5. Troubleshooting
| Symptom | Where to look / fix |
|---|---|
| Omniful says credentials invalid | the key was rotated, or the connection is paused (JR answers 401 for paused connections) |
| Shipments refused | the error message names the reason (city, currency, COD) — also in Activity as *refused order* |
| Omniful not updating | Setup shows whether a webhook is registered; *Failed updates* lists anything Omniful rejected (with its message) |
| Status not sent for an event | Sync & statuses: the event is off or mapped to "don't send" |
