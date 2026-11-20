# Fastcoo ↔ JR — integration guide

**Mode: carrier.** JR works as a 3PL / courier partner in the **Fastcoo Partner programme**: Fastcoo sends last-mile orders to JR, JR
answers with its own tracking number, label and tracking page, and reports every status with Fastcoo's status codes.
Source: https://doc.fastcoo-tech.com/fastcooPartner (v .0.055, 10 July 2024 — snapshot [vendor-docs/fastcoo-partner.txt](vendor-docs/fastcoo-partner.txt);
merchant status/sub-status list: [vendor-docs/fastcoo-merchant-webhook-statuses.txt](vendor-docs/fastcoo-merchant-webhook-statuses.txt)).
Code: `web/src/server/partners/fastcoo.ts`.

## 1. What Fastcoo documents, and what JR does with it
| Documented | JR |
|---|---|
| **Order Receive Webhook** (Fastcoo → partner): `{app_id, merchent_id, reference_id, BookingMode ("COD" cash collect / "CC" prepaid), codValue, awb_no, sender_*, receiver_city/name/address/phone/email, country_dial_code, description, pieces, weight, sku_details, national_address_id, sender_national_id}`; path named `{base_url}/webhook/API/OrderRecieveLM` | JR's webhook URL for the connection (`…/integrations/hooks/<id>/<token>`, and the same URL + `/webhook/API/OrderRecieveLM`). Creates an **Incoming order**, issues JR's AWB, answers `{accepted, orders:[{reference, awb, trackingUrl, labelUrl, status}]}`. `app_id` must equal the connection's App ID (other accounts' orders are ignored). A city JR does not serve → **HTTP 422** (refused, logged). A repeat of the same `awb_no` updates, never duplicates. |
| **Update3plDetails** (partner → Fastcoo): `POST {baseUrl}/Update3plDetails` Bearer, `{App_ID, ref_no, client_awb, label, tracking_url, order_type}` → `{status:200, message}` | Sent right after JR accepts the order (JR event *accepted*): `ref_no` = Fastcoo's `awb_no`, `client_awb` = JR AWB, `label` = JR's PDF label, `tracking_url` = JR's tracking page. |
| **Status Update** (partner → Fastcoo): `POST {baseUrl}/webhook/API/StatusUpdate` Bearer, `{reference_number, UniqueReference, FailDeliveryReason, StatusCode, StatusDescription, UpdateDate "YYYY-MM-DD HH:MM:SS", App_ID, order_type}` | Every mapped JR event, in order: `reference_number` = JR AWB, `UniqueReference` = Fastcoo `awb_no`, `FailDeliveryReason` = JR fail reason + note (failed only), `StatusDescription` = Fastcoo's label for the code, `UpdateDate` in the configured time zone. A body `status` other than 200 inside an HTTP 200 is treated as a failure. |
| **Refresh token**: `POST {base_url}/oauth/token` form `grant_type=refresh_token, refresh_token, client_id, client_secret` → `{access_token, expires_in, token_type, refresh_token}` | Used when no access token is stored and whenever Fastcoo answers 401; the new access + refresh tokens are saved encrypted (one refresh, then the call is retried once). *Test connection* performs a refresh (it proves all three credentials). |
| Rate limit 180 order creations / minute | Applies to Fastcoo's order creation, not to anything JR sends. |
| Status codes (partner list) | `OP, PUC, RI, SH, IT, DSA, OD, DOP, FD, POD, ROP, B, RFDE, GU, RP, CCR, FDD, MS, DS`; JR also offers `RTC` / `RTR` from Fastcoo's merchant list. |
| A status payload `{awb_no, code, status, updated_date, updated_time, …}` (Fastcoo's webhook format) arriving on JR's URL | Read as a status event, timed by `updated_date` + `updated_time` in the configured zone; `CCR` / `C` = cancelled (withdraws a parcel still at the warehouse), `POD` = delivered, `RTC` = returned. |
| Answers | `status` 200 (or 1) = success; `status:false`, any other code inside an HTTP 200 = failure; `status` 0 / 401 = token refreshed once (one refresh at a time per connection, so a single-use refresh token is never spent twice); "400 Already Exist" on a repeated Update3plDetails = already delivered (success). A payload JR cannot read, or for another App ID, is answered **422** — never "accepted". |

### Status mapping (default, editable under Sync & statuses)
| JR event | Fastcoo code | sent by default |
|---|---|---|
| accepted | — (Update3plDetails) | yes |
| assigned to a driver | `B` Booked – Pickup Scheduled | no |
| picked up | `PUC` Pick Up Collected | yes |
| out for delivery | `OD` Out for delivery | yes |
| arrived at the recipient | `DOP` Delivery On Process | no |
| delivered | `POD` Delivered | yes |
| failed attempt | `FD` Failed Delivery (+ reason) | yes |
| returned to the warehouse | `ROP` Return On Process (switch to `RTC` Return to Client if Fastcoo prefers) | yes |
| missing | `MS` Missing Shipments | yes |
| cancelled by the company in JR / order set aside | `CCR` Cancelled as per Client request (+ reason) | yes |
| postponed / re-shipped | not mapped | — |

## 2. Set-up
1. From Fastcoo's partner onboarding get: **App ID**, **client ID**, **client secret**, **refresh token** (and optionally an access token).
2. JR → Integrations → *Add connection* → **Fastcoo** → enter them (order type *LM — last mile* unless Fastcoo says otherwise) → save.
   JR shows **once** the webhook URL that contains the connection's secret token.
3. Give Fastcoo that URL as the partner's order webhook (if Fastcoo builds the URL as `{base_url}/webhook/API/OrderRecieveLM`, give the
   JR URL as `base_url`; both forms work).
4. *Test connection* (refreshes the token) → *Connected to Fastcoo*.
5. Orders arrive in Incoming orders; each is acknowledged to Fastcoo with JR's AWB, label and tracking link.
Advanced (only if Fastcoo gives different values): API address (default `https://api.fastcoo-tech.com`), the three paths, the time zone of `UpdateDate` (default `Asia/Riyadh`).

## 3. Not documented by Fastcoo (so not built; confirm at onboarding)
- How Fastcoo authenticates the order webhook → JR uses the secret in the URL + the App ID check.
- The URL of **Order Get** (the request body is documented, the endpoint is not) → JR does not call it.
- A cancellation notice to partners → handled if it arrives in Fastcoo's status format (`CCR` / `C`).
- The time zone of `UpdateDate` → configurable (default Asia/Riyadh).
- The page's response-code table ("1 = successfully cancelled, 5 = not found / already cancelled, 0 = authentication error") belongs to a
  cancel API that the partner page does not otherwise describe; JR accepts `status` 200 (and 1) as success, 0/401 as authentication errors.

## 4. Go-live checklist (with Fastcoo)
1. Fastcoo posts a test order → it appears in Incoming orders; Fastcoo shows JR's AWB/label (Update3plDetails). 2. Deliver it → Fastcoo
shows PUC → OD → POD. 3. Fail one → FD with the reason. 4. Confirm the time zone and the RTC/ROP preference. 5. Rotate the URL once and
re-enter it to prove the procedure.
