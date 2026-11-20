# LogesTech ↔ JR — integration guide

**Mode: merchant.** JR uses the company's LogesTech *integration API key* (one customer account) to follow its packages, import them
into JR, and cancel / return them. Source: https://docs.logestechs.com (index: [logestechs-llms.txt](logestechs-llms.txt); the pages JR
uses: [vendor-docs/logestechs/](vendor-docs/logestechs/)). Base URL `https://apisv5.logestechs.com/api`, header `X-API-Key: psk_integration_…`.
Code: `web/src/server/partners/logestechs.ts`.

## 1. What LogesTech documents, and what JR does with it
| Documented | JR |
|---|---|
| `GET /secure/integration/address/cities` (needs the key) | *Test connection* — proves the key |
| `GET /secure/integration/packages/statuses` → `[{key, englishValue, arabicValue}]` (needs the key; JR verified the 401 `security.apikey.required` without one) | fetched on *Test*, stored as the connection's **status catalogue** → the inbound mapping editor lists every key with its English/Arabic label |
| **Package Status Webhook**: POST on every status change (created, cancelled, returned, delivered, postponed …), password in `Authorization`, `api_key`, `ApiKey`, `api-key`, `x-api-key`; fields `packageId, barcode, invoiceNumber, status, newStatus, cod, paymentMethod, time, notes, reason, driverName, driverPhone, signatureUrl, postponedDeliveryDate, attachmentUrls, pinCode`; **no retries** | JR's webhook (token in any of those headers). Mirrors the status on the order and the JR parcel; `cancelled` withdraws a parcel still at the warehouse (auto-cancel). With **Import new orders** on, a package JR has not seen becomes an Incoming order, enriched by a status lookup. PIN code, signature link and driver phone are never stored. |
| `PUT /secure/integration/webhook {webhookUrl, webhookPassword}` | *Connect automatically* — sets JR's URL and a fresh token in one click |
| `GET /secure/integration/packages/status?id|barcode|invoice` → object of strings (keys **not published**) | *Look up / Import*: JR reads the recipient fields it can find (tolerant parser); anything missing is completed in JR |
| `GET /secure/integration/packages/status/history?id|barcode|invoice` → `PackageStatusResponse[]` (`packageId, changedBy, createdDate, packageTrackingStatus, statusKey, failedStatus, integrationSource`) | **Scheduled check** (default every 30 min — because webhooks are not retried) and *Refresh*: newest entry wins, older entries never overwrite newer ones, a change already received by webhook is not recorded twice; uses `id` when JR knows the package id (only the documented `packageId`). A 403 ("belongs to a different customer") / 400 / 404 for one package is skipped — it never stops the others or marks the key as bad. |
| `PUT /secure/integration/packages/cancel?…` — only while pending approval / dispatcher assignment | JR event *cancelled* (company cancelled the parcel in JR) → cancel call, **opt-in**. 400 = too late → recorded as "not cancellable", not retried |
| `PUT /secure/integration/packages/return?…&timezone=` body `NoteMessage {note}` — for packages out for delivery | JR event *returned* (back at the warehouse after a failed delivery) → return request with JR's reason, **opt-in** |
| `POST /secure/integration/packages/awb {ids|barcodes|invoicesNumbers ≤100}` → object of strings (a URL) | *Print LogesTech label* |
| Create shipment, delivery cost, service/vehicle/parcel types, regions/cities/villages, fulfillment products / ASN / orders | **not used**: they create work in LogesTech; JR is the one delivering. Available for a future "create in LogesTech" flow if the owner wants it. |

**There is no "list my packages" and no "set package status" call.** So JR cannot pull a worklist (packages arrive by webhook or lookup)
and cannot write *picked up / out for delivery / delivered* into LogesTech. JR shows LogesTech's status next to its own on every parcel.

## 2. Set-up
1. LogesTech admin portal → **Partners → API Integrations** → create the integration for the customer account → copy the key (shown once).
2. JR → Integrations → *Add connection* → **LogesTech** → paste the key → save → *Test connection* (loads the status catalogue).
3. *Connect automatically* (or copy JR's webhook URL + token into the integration's Webhook URL / Password by hand).
4. Sync & statuses: switch on *Import new orders* if LogesTech packages should appear in Incoming orders; switch on *cancel* / *return*
   write-backs if wanted; map any status key whose meaning should differ (only *cancelled* acts in JR); keep the 30-minute check.

## 3. Owner / vendor items
- The keys of the current-status object are unpublished — send JR one real response so the parser can be tightened (decision I6).
- Status keys are per company; the defaults classify by name (`CANCEL…` = cancelled, `DELIVERED…` = delivered, `…RETURN…` = returned,
  `FAIL/REJECT` = failed). Review them once in the mapping editor after the first test.
- Writing JR's progress into LogesTech would need an API LogesTech does not publish (e.g. their partner-company transfer); ask LogesTech.
