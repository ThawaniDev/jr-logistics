# Fizzpa ↔ JR — integration guide

**Mode: merchant.** JR uses the company's Fizzpa **agent API key** to import orders by their Fizzpa order number, follow their status on a
schedule, and cancel (delete) them before pickup. Source: https://fizzpa.docs.apiary.io (snapshot: [vendor-docs/fizzpa.apib](vendor-docs/fizzpa.apib)).
Base `https://rest.fizzpa.net/api`; every call sends `Authorization: <your key>` (the key itself, no "Bearer") and `Referer: <URL>`.
Code: `web/src/server/partners/fizzpa.ts`.

## 1. What Fizzpa documents, and what JR does with it
| Documented | JR |
|---|---|
| `GET /Auth/me` → `{success, userData{FullName, CompanyName_En …}}` | *Test connection* ("Connected to Fizzpa as … (company)"); `success:false` = key refused |
| `GET /orders/{orderid}` → the full order (`OrderId, OrderRef, OrderNote, IsDelivered, CollectionTypeId, CollectionType_En, AgentTotal, Recipient*, Phonecode1/Phone1, OrderStatus_En, PieceCount …`) | *Look up / Import*: recipient, phone (`Phonecode1`+`Phone1`), address (+ neighbourhood), city, coordinates, pieces, notes, Fizzpa status. **Only the numeric OrderId** can be looked up (OrderRef is not searchable in the API). |
| `GET /Tracking/{orderid}` → `[{Trackid, TrackingStatus, WhereIN, Note, TrackingDate, UserId}]` | with `GET /orders/{id}`: the **scheduled check** (default every 30 min) and *Refresh* — status = `OrderStatus_En` (or *Delivered* when `IsDelivered`), time/note = newest tracking entry |
| `DELETE /orders/{orderid}` ("if not picked up") → `{success, Message}` | JR event *cancelled* → delete (**opt-in**); `success:false` = refused (not retried). Only with an OrderId Fizzpa itself returned (look-up / import) — a number the company typed is never sent as an OrderId, so another order can never be deleted or mirrored by mistake. |
| `POST /orders` (add order), `GET /orders/label/{id}/{ar|en}/{A4|A6}` | not used: adding creates work in Fizzpa; the label endpoint documents **no response body**, so JR does not offer it |

**Fizzpa documents no webhooks, no order list and no "set status" call.** JR therefore imports by order number, learns about changes only
by polling, and cannot write its own progress into Fizzpa.
**COD:** the only documented pairing is `CollectionTypeId 1` = "Without Collection" (COD 0). For other collection types the amount to
collect is not documented, so JR leaves COD for the company to confirm in the manifest (the order shows Fizzpa's collection type and total).

## 2. Set-up
1. Get your agent API key from Fizzpa and the website address registered with it (sent as `Referer`).
2. JR → Integrations → *Add connection* → **Fizzpa** → key + registered website address → save → *Test connection*.
3. Incoming orders → *Import an order* → type the Fizzpa order number (or use the lookup in the request form).
4. Sync & statuses: keep the scheduled check (5–180 minutes); switch on *cancel* write-back if wanted; map Fizzpa status names you use.

## 3. Vendor items
- Fizzpa's status names / `TrackingStatus` numbers beyond "New", 1 "Record Created" and 2 "Shipping company confirm shipping order" are
  not published — send a list to complete the mapping.
- The COD meaning of collection types other than 1.
- A webhook or an order list would let JR react instantly instead of polling.
