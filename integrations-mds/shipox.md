# Shipox ↔ JR — integration guide

**Mode: merchant.** JR uses the company's Shipox **merchant ("customer") API account** to import its orders, follow their status and
cancel them. Source: https://shipox.docs.apiary.io (API Blueprint snapshot: [vendor-docs/shipox.apib](vendor-docs/shipox.apib)).
Code: `web/src/server/partners/shipox.ts`.

## 1. What Shipox documents, and what JR does with it
| Documented | JR |
|---|---|
| Account manager issues the API account and the **host_name** per environment (test / live) | connection field *API host* (default `https://prodapi.shipox.com`) |
| `POST /api/v1/customer/authenticate {username, password, remember_me}` → `data.id_token` (JWT, **valid 24 h**) | JR signs in when needed, keeps the token ~23 h (per host + username + password, so changed credentials sign in again), signs in again once on a 401 and retries |
| `GET /api/v1/customer/account` | *Test connection* ("Connected to Shipox as …") |
| `GET /api/v1/customer/orders?page&size≤200&status=a,b&from_date_time&search` → `data.list[]` (`id, order_number, status, locations[] (pickup true/false), charge_items[], piece_count, currency, last_status_date …`) | **Scheduled import** (Import new orders + interval): orders since the last run, optionally only in the statuses you list (e.g. `unassigned`); drop-off = the location with `pickup:false`; COD = the `charge_type:"cod"` charge item. Reads every page (≤ 2,000 orders per run); the cursor only moves after a complete read, so nothing is skipped. Also used by *Look up* (`search`). |
| `GET /api/v1/customer/order/{id}/mobile` → `sender_data`, `recipient_data` (name, phone, city, address, lat/lon …) | *Look up / Import* enriches the order with the full recipient |
| `GET /api/v1/customer/order/{order_number}/history_items` → `data.list[{status, status_desc, date}]` | **Scheduled check** and *Refresh*: newest entry wins |
| `PUT /api/v1/customer/order/{order_id}/status?status=cancelled` | JR event *cancelled* → cancel with Shipox's numeric id (**opt-in**); 400 = refused (not retried) |
| `GET /api/v1/customer/orders/airwaybill_mini?ids=…&order_numbers=…` → `{Data:{Value:url}}` | *Print Shipox label* (ids when JR knows them, otherwise order numbers) |
| **Customer webhook**: set **by hand** in Shipox (Customers → customer → Finance Settings → Contract Owner → Company → *Company Endpoint*); body `{order_number, reference_id, status, note, date, customer_id, driver?}`; **no authentication documented** | JR's webhook URL **contains the secret token** (shown once) because Shipox cannot send a header. Mirrors statuses; with Import new orders on, an unknown order is imported (enriched by a lookup). The driver's phone is never stored. |
| Create order v2/v3, prices, cities, service types, food orders, public tracking | not used (they create work in Shipox) |

Only these status values appear in the documentation: `unassigned` ("Order Received"), `assigned_to_courier`, `accepted` and `cancelled`
(from the cancel call). **Shipox's full status list is not published**, so JR treats any other value as information only. Map the ones your
Shipox instance uses (for example a delivered status → *delivered*) under Sync & statuses; only *cancelled* changes anything in JR.
**There is no "set status" call for a carrier**: JR's pick-up/delivery cannot be written into Shipox.

## 2. Set-up
1. Ask your Shipox account manager for the merchant API account (username + password) and the API host for live.
2. JR → Integrations → *Add connection* → **Shipox** → host, username, password → save. Copy the webhook URL shown **once**.
3. Shipox admin → the customer → Finance Settings → Company Endpoint → paste JR's URL → submit.
4. *Test connection*. Sync & statuses: switch on *Import new orders*, set *Statuses to import* (advanced field, e.g. `unassigned`) and an
   interval (e.g. 15 min); switch on *cancel* write-back if wanted; map your status values.
Lost the URL? *Rotate token* → paste the new URL into Shipox.

## 3. Vendor items
- Confirm the full status list of your Shipox instance (to complete the mapping).
- If your instance can sign webhooks or send a header, tell JR — today the URL token is the only documented option.
