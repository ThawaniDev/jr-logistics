# Custom system ↔ JR — JR's own integration contract

For any warehouse / order system without a ready-made adapter (decision I17). Both directions, JSON, HTTPS.
Code: `web/src/server/partners/generic.ts`.

## Your system → JR
`POST <webhook URL>` (shown when the connection is created) with `Authorization: Bearer <token>` (also accepted: `x-jr-token`, `x-api-key`;
or put the token as the last path segment: `<webhook URL>/<token>`). Body ≤ 64 KB.

```jsonc
// a new order for JR
{ "type": "order", "reference": "ORD-1001", "id": "your-internal-id",
  "recipient": { "name": "Mona", "phone": "0555123456", "address": "King Fahd Rd 120", "city": "Riyadh", "lat": 24.71, "lng": 46.67, "email": "m@x.sa" },
  "cod": 120.5, "pieces": 2, "weightKg": 1.2, "contents": "Clothes", "notes": "Gate 2", "items": [{ "sku": "A1", "name": "Shirt", "qty": 2 }] }
// a status change (any value is recorded; "cancelled" / "canceled" withdraws the parcel while it is at the warehouse)
{ "reference": "ORD-1001", "status": "cancelled", "note": "customer called", "at": "2026-11-19T10:00:00Z" }
// several at once (≤ 50)
{ "items": [ { … }, { … } ] }
```
Answer: `{ "accepted": true, "matched": <parcels updated>, "orders": [{ "reference", "awb": null, "status": "created" | "updated" | "ignored" }] }`.
401 = wrong token (same answer as "unknown connection"). The same reference twice updates, never duplicates; a replayed status is ignored;
an older status never overwrites a newer one.

## JR → your system
`POST <callback URL>` for every event switched on in Sync & statuses (default on: picked up, out for delivery, delivered, failed,
returned, missing, cancelled):
```jsonc
{ "event": "parcel.delivered", "reference": "ORD-1001", "awb": null, "code": "JR-000123-004", "status": null,
  "reason": null, "note": null, "proof": "otp", "attempts": 1, "receiverName": null, "codCollected": 120.5, "driver": "Ahmed", "occurredAt": "…" }
```
Headers: `x-jr-event: parcel.delivered`, `x-jr-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(signing secret, "<t>.<raw body>")>`.
Verify the signature and reject a `t` older than 5 minutes. Answer any 2xx. Events: `parcel.assigned, picked_up, out_for_delivery,
arrived, delivered, failed, postponed, returned, missing, cancelled, reshipped`. Retries after 1, 5, 30, 120, 360 minutes on 5xx / timeouts;
a 4xx is not retried (fix, then *Retry* in JR). Per-parcel order is guaranteed.
