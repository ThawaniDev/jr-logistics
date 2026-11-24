# JR Logistics — Comprehensive Real-World Operational Playbook (Detailed Flows)

**Target Ecosystem:** Saudi Logistics Marketplace (Riyadh Phase 1 Pilot)  
**Entities:** Warehouse Requesters (Shippers), Independent Drivers, Courier Logistics Offices, Ops Control Tower, Finance  
**Code Repositories:** Next.js Web Platform (`web/`), Flutter Driver App (`mobile/`)  
**Core Principles:** Strict Unit Conservation, Double-Entry Escrow Ledger, Concurrency Lock Sequencing, Transparent Exceptions

---

> **Update L reality check (2026-11-22).** These flows are *narratives*: names of states, reason codes, endpoints and amounts were written to illustrate the rules and several no longer match the code (audit K, `memory/audit/gaps.md` §5). Where a flow is superseded, a note **Update L** sits under its title. The real contracts are `SHIPMENTS_API.md`, `INTEGRATIONS_API.md`, `SRS.md` / `TRACEABILITY.md` and `DECISIONS.md`. Summary of what changed since the flows were written:
>
> | Flow | State | What runs |
> |---|---|---|
> | 01, 04, 05, 07–11, 20–22, 28–29, 32 | still the right idea | Steps that name a warehouse **confirmation** are automatic since E16; parcel exceptions are recorded per stop (`POST /offers/:id/stops/:sid/fail`, reasons from the stop-fail list), not as one `contact-exception` for the whole job. Flows 20–22 were not re-checked line by line in Update L. |
> | 02 | corrected | Billing is capped at booked and loaded (A1); there is no "accept the extra" step. |
> | 03, 06, 30 | **fees not implemented** | No show-up indemnity (SAR 50), no demurrage / detention surcharge (SAR 35), no SLA auto-shift. **Decision #8 "no fees" is what runs; amounts are pending the owner (O4).** |
> | 12 | off by default | Route optimisation only when `routingEnabled` is ON (J2). |
> | 13, 14, 15 | partly out of scope | POS / card terminals are not custody items (C8); a `not_returned` outcome only records a note and an event. |
> | 16 | changed | COD is tracked (E17) with cash-risk limits (flow 35). |
> | 18, 19 | numbers differ | No-show: business only from `startsAt + lateGraceMin` (30 min); suspension: warning at 2 / suspension at 4 cancellations within 7 days, for 3 days (settings). |
> | 23, 24, 25, 26 | **superseded (E16)** | No warehouse confirm / dispute; no `resolveDispute` route. |
> | 27 | **superseded (E18)** | No review / approval step; paid at once. |
> | 31 | **retired (C9)** | Office selection and the priority window were removed. |
> | 33–39 | **new** | Category 8 at the end of this file. |

## 1. Domain State Machines & Financial Invariants

### 1.1 Composite Request & Offer Lifecycle
> **Update L:** `delivered_reported → pending_settlement → completed` happens in one go (E16 / E18: automatic confirmation and immediate payment); `qty_disputed` is legacy and unreachable. `offers.loadedUnits` is the parcels scanned onto the vehicle, `deliveredUnits` / `finalUnits` are derived from the delivered parcels and can never exceed booked or loaded.

The platform separates the aggregate booking request (`requests`) from the individual vehicle/driver assignment (`offers`).
```
[requests]
draft ──► published ──► filling ──► assigned ──► in_progress ──► completed
   │           │           │            │             │
   └───────────┴───────────┴────────────┴─────────────┴─────► cancelled / expired

[offers]
offered ──► accepted ──► arrived ──► attendance_confirmed ──► delivered_reported ──► pending_settlement ──► completed
   │            │           │                  │                       │                      ▲
   ├──► rejected├──► cancelled                 ├──► no_show            └──► qty_disputed ─────┤
   └──► expired └──► replaced                  └──► replaced               (holds settlement)
```

### 1.2 Mathematical Ledger Invariants
1. **Unit Balance:** $\text{Loaded Units} = \text{Delivered Units} + \text{Returned Units} + \text{Damaged Units}$
2. **Escrow Conservation:**
   $$\text{Reserved Cents} = \text{Unit Price} \times \text{Expected Units}$$
   $$\text{Customer Charge} = \text{Unit Price} \times \text{Final Units}$$
   $$\text{Provider Net} = \text{Provider Cost} \times \text{Final Units}$$
   $$\text{Platform Margin} = \text{Customer Charge} - \text{Provider Net}$$
   $$\text{Escrow Refund} = \text{Reserved Cents} - \text{Customer Charge}$$

---

## 2. Detailed Operational Flows

---

### Category 1: Loading Bay, Capacity & Quantity Mismatches

#### Flow 01: Asymmetric Delivery — Booked 50, Loaded 30, Delivered 25, 5 Returned
> **Update L:** step 5 is per parcel (`/stops/:sid/deliver` and `/stops/:sid/fail`), step 7 is the end of the route, and **step 8 does not exist** (E16): the delivery is confirmed automatically and the settlement is paid in the same transaction (E18). The money in *Financial Calculation* is right.
- **Real-World Context:**
  A hypermarket fulfillment center in Sulay books a delivery driver for 50 parcels scheduled for 08:00 dispatch. Due to morning picker shortages, only 30 parcels are staged. The driver loads 30 cartons. During the delivery shift, 25 consignees receive their orders; 5 consignees are unreachable or refuse COD. At 18:00, the driver returns to the warehouse dock, returns the 5 undelivered parcels, and reports 25 delivered.
- **Participating Actors:** Warehouse Supervisor, Direct Driver, Platform Operations, Finance.
- **Technical State Transitions:**
  - `requests.status`: `assigned` $\rightarrow$ `in_progress` $\rightarrow$ `completed`
  - `offers.status`: `accepted` $\rightarrow$ `arrived` $\rightarrow$ `attendance_confirmed` $\rightarrow$ `delivered_reported` $\rightarrow$ `pending_settlement` $\rightarrow$ `completed`
  - `offers.loadedUnits`: `30`, `offers.deliveredUnits`: `25`, `offers.finalUnits`: `25`
- **Step-by-Step Execution:**
  1. Driver arrives at dock: mobile app captures GPS coordinates and calls `POST /offers/:id/checkin`.
  2. Warehouse supervisor clicks **Confirm Attendance** in web portal (`POST /offers/:id/attendance` with `present: true`).
  3. Warehouse stages 30 cartons and inputs `units: 30` via `POST /offers/:id/loading`.
  4. Driver receives in-app alert: *"Confirm 30 parcels loaded"*. Driver counts physical cartons and taps **Confirm** via `POST /offers/:id/loading-ack` (`ok: true`).
  5. Driver delivers 25 parcels. 5 failed deliveries are logged via `POST /driver/jobs/:id/contact-exception`.
  6. Driver returns to warehouse dock; warehouse receiver scans/counts the 5 returned parcels.
  7. Driver submits final delivery count on mobile: `POST /offers/:id/delivered` (`units: 25`).
  8. Warehouse supervisor dashboard shows prompt: *"Driver reported 25 delivered, 5 returned"*. Supervisor clicks **Confirm Delivery** (`POST /offers/:id/delivery-confirm` with `action: 'confirm', units: 25`).
  9. System triggers `completeIfReady()`:
     - `createSettlement()` records customer charge for 25 units, driver net for 25 units, and platform fee.
     - `releaseReserve()` instantly releases unspent escrow (25 units) back to warehouse wallet.
     - Offer and request transition to `completed`.
- **Financial Calculation:**
  - Booked: 50 $\times$ 16 SAR = 800 SAR reserved.
  - Final Charge: 25 $\times$ 16 SAR = 400 SAR.
  - Driver Earnings: 25 $\times$ 11.50 SAR = 287.50 SAR.
  - Platform Fee: 25 $\times$ 4.50 SAR = 112.50 SAR.
  - Unspent Escrow Refund: 800 - 400 = 400 SAR automatically unlocked.
- **Code Reference:**
  - Handover: `recordLoading()`, `acknowledgeLoading()` in [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L180-L208).
  - Reporting & Escrow: `reportDelivered()`, `confirmDelivery()` in [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L219-L263).
  - Settlement: `createSettlement()` in [`web/src/server/settlement.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/settlement.ts#L23-L37).
- **Recommended SOP & Gaps:**
  - *Recommendation:* Require dock supervisor to scan driver's Return QR code before driver can submit final delivered count, ensuring physical handover occurs prior to digital submission.

---

#### Flow 02: Warehouse Over-Loading Attempt (Exceeding Booked Quota)
> **Update L (A1):** with a parcel manifest the warehouse can only load parcels of the order, and whatever happens at the dock the payment is capped at `min(loaded, booked)` (`maxBillableUnits`) — the cap is applied when the driver reports and when the offer is billed, not when the warehouse types a number. There is no "driver accepts the extra and both sides are billed for 75" variant (the master spec's decision #2 was not built). The "Recommended SOP" below describes the cap at billing time.
- **Real-World Context:**
  Warehouse booked a sedan for 50 parcels (350 SAR escrow reserved). Upon arrival, warehouse attempts to force 75 large parcels into the sedan, exceeding vehicle payload and booked escrow funds.
- **Participating Actors:** Warehouse Dock Worker, Driver, Operations Support.
- **Technical State Transitions:**
  - `offers.loadedAckByDriver`: `false` (disputed)
  - `tickets`: created with category `shipment_count_differs`
- **Step-by-Step Execution:**
  1. Warehouse staff enters `units: 75` on loading form.
  2. Driver refuses: payload exceeds vehicle safety and agreed booking.
  3. Driver taps **Dispute Loading** in Flutter app: `POST /offers/:id/loading-ack` (`ok: false, note: 'Warehouse forcing 75 parcels on 50 parcel booking'`).
  4. System opens urgent ticket and alerts Ops Tower.
  5. Ops Tower contacts warehouse manager: either remove 25 cartons or create a supplemental request.
  6. Warehouse offloads 25 cartons, updates `loadedUnits` to 50. Driver confirms 50.
- **Financial Calculation:** Escrow remains locked at 50 units. Additional parcels require a separate booking.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L194-L208) (`acknowledgeLoading`), `maxBillableUnits()`.
- **Recommended SOP:** Platform automatically enforces `max = request.shipmentsPerDriver` in `recordLoading()`.

---

#### Flow 03: Warehouse Stockout / Outage on Arrival ("Not Put to Work")
> **Update L: step 6 is not implemented.** There is **no show-up fee / indemnity** (no SAR 50 debit, no credit to the driver): ops cancel the request, the whole remaining reserve returns to the warehouse, and the driver is not penalised. Any compensation is a manual wallet adjustment by finance. *Fees: none — amounts pending the owner* (DECISIONS L16). The recommended 45-minute auto-claim timer does not exist. A driver who already worked stops cannot use "not put to work" any more (he ends the route).
- **Real-World Context:**
  Driver checks in on time at 07:55. Warehouse conveyor line suffered an electrical failure; no parcels are sorted or ready for dispatch. Warehouse supervisor tells driver to leave.
- **Participating Actors:** Driver, Warehouse Supervisor, Ops Staff.
- **Technical State Transitions:**
  - `offers.status`: `arrived` $\rightarrow$ `cancelled` (with show-up fee)
  - `tickets`: opened with category `not_put_to_work`
- **Step-by-Step Execution:**
  1. Driver arrives and check-in succeeds.
  2. Warehouse fails to stage goods. Driver waits 45 minutes past start time.
  3. Driver taps **Report: Not Put to Work** in Flutter app (`POST /offers/:id/no-work`).
  4. Ops Tower confirms warehouse outage.
  5. Ops cancels request with warehouse fault attribution.
  6. Ledger debits 50 SAR show-up indemnity from warehouse reserved escrow, credits driver wallet, and refunds remaining escrow to warehouse.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L265-L277) (`reportNoWork`), [`web/src/server/requests.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/requests.ts#L161-L186).
- **Recommended SOP:** Implement automated 45-minute geofenced countdown timer enabling driver to auto-claim show-up compensation if warehouse takes zero action.

---

#### Flow 04: Damaged Cargo Detected at Loading Dock
- **Real-World Context:**
  During morning staging of 40 cartons of olive oil, 4 bottles broke, soaking the bottom cartons.
- **Participating Actors:** Warehouse Staging Clerk, Driver.
- **Technical State Transitions:** `offers.loadedUnits` adjusted down from 40 to 36.
- **Step-by-Step Execution:**
  1. Warehouse originally booked 40 items.
  2. Driver points out leaking oil boxes and refuses to take them.
  3. Warehouse updates `loadedUnits` to 36.
  4. Driver photographs damaged cartons via app and confirms 36 units.
  5. System records `jobEvents` audit entry.
- **Financial Calculation:** Billable units ceiling capped at 36; escrow for 4 unallocated units refunded at job completion.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L180-L208).

---

#### Flow 05: Cold-Chain Temperature Breach at Pickup Dock
- **Real-World Context:**
  Pharmaceutical distributor orders a refrigerated van (`van` with `temperature: "cold"`, +2°C to +8°C). Driver arrives, but vehicle chiller displays +17°C due to refrigerant gas leak.
- **Participating Actors:** Warehouse Quality Officer, Driver, Ops Tower.
- **Technical State Transitions:**
  - `offers.status`: `arrived` $\rightarrow$ `no_show` / `rejected`
  - Offer freed; urgent replacement dispatched.
- **Step-by-Step Execution:**
  1. Warehouse quality officer measures van chamber temperature.
  2. Officer rejects vehicle: `POST /offers/:id/attendance` with `{ present: false, reason: 'chiller_temperature_breach' }`.
  3. Offer marked `no_show`.
  4. `freeSlotAndReplace()` immediately broadcasts replacement offer to certified cold-van drivers in Riyadh.
  5. Qualified replacement driver accepts within 12 minutes.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L159-L177).

---

#### Flow 06: Dock Congestion & Loading Bay Staging Delay (>60 Minutes)
> **Update L: steps 4–5 are not implemented.** There is no dwell-time calculation, no automatic shift of the delivery SLA and **no SAR 35 detention surcharge** (no demurrage rule exists). The driver can open a `business_not_ready` ticket and operations decide. *Fees: none — amounts pending the owner.*
- **Real-World Context:**
  Driver arrives at 07:55. Due to 30 long-haul trucks blocking the yard, driver is not loaded until 09:30 (95 minutes dock dwell time).
- **Participating Actors:** Driver, Dock Master, SLA Engine.
- **Technical State Transitions:** Ticket `business_not_ready` logged; route completion SLA extended.
- **Step-by-Step Execution:**
  1. Driver check-in recorded at 07:55.
  2. At 08:45, driver logs delay in app (`business_not_ready`).
  3. Loading finalized at 09:30. System calculates dwell time = 95 minutes.
  4. Platform dynamically shifts delivery SLA cutoff by 95 minutes to prevent driver late strikes.
  5. 35 SAR detention surcharge credited to driver if demurrage rule is active.
- **Code Reference:** [`web/src/server/ops.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/ops.ts) (`startSla`).

---

### Category 2: Last-Mile Delivery Execution, Recipient Exceptions & Returns

#### Flow 07: Recipient Absent / Unreachable at Doorstep
- **Real-World Context:**
  Driver reaches residential villa in Al-Narjis. Driver rings doorbell, calls phone, and clicks pre-filled WhatsApp handoff. No response after 10 minutes.
- **Participating Actors:** Driver, Consignee, Warehouse.
- **Technical State Transitions:**
  - `jobEvents`: `contact_exception` (`reason: 'unreachable'`)
  - Stop marked failed; parcel routed to Return Manifest.
- **Step-by-Step Execution:**
  1. Driver taps **WhatsApp** in Flutter app; sends pre-filled Arabic message: *"السلام عليكم، مندوب التوصيل عند موقعك..."*.
  2. After 10 minutes, driver selects **Contact Exception** $\rightarrow$ **Customer Unreachable**.
  3. App calls `POST /driver/jobs/:id/contact-exception` with `reason: 'unreachable'`.
  4. Parcel marked for Return to Origin (RTO).
  5. Parcel returned to warehouse dock at 18:00.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L280-L291), [`mobile/lib/data/driver_api.dart`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/mobile/lib/data/driver_api.dart#L39).

---

#### Flow 08: Direct Customer Rejection (Refused COD / Changed Mind)
- **Real-World Context:**
  Consignee opens door, sees package, and states: *"I ordered this 5 days ago, I bought it from a store yesterday, cancel it"* or refuses to pay COD cash.
- **Participating Actors:** Driver, Customer, Warehouse.
- **Technical State Transitions:** Parcel marked `rejected_by_customer`.
- **Step-by-Step Execution:**
  1. Driver marks delivery attempt as `customer_rejected`.
  2. Reason code captured: `cod_refused` or `customer_cancelled`.
  3. Parcel returned to driver's return bin.
  4. Delivered units counter does NOT increment.
  5. Real-time webhook sent to warehouse WMS.
- **Code Reference:** [`web/src/server/integrations.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/integrations.ts).

---

#### Flow 09: Partial Consignee Acceptance (B2B Bulk Split Delivery)
- **Real-World Context:**
  Delivery of 20 cartons of canned tomatoes to a restaurant chain. 18 cartons are perfect; 2 cartons were dented and punctured.
- **Participating Actors:** Driver, Restaurant Receiver, Warehouse B2B Account Lead.
- **Technical State Transitions:** Delivered units recorded as 18; 2 units returned.
- **Step-by-Step Execution:**
  1. Driver enters `18` accepted in app.
  2. Driver snaps photo of delivery note signed by receiver stating "Received 18, 2 rejected due to puncture".
  3. Driver returns 2 cartons to warehouse dock.
  4. Final billable units for this drop = 18.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L219-L235).

---

#### Flow 10: Customer Address Out-of-Zone Relocation Request
- **Real-World Context:**
  Driver calls customer in Riyadh; customer states they moved to an agricultural estate in Thumamah (65 km out of zone).
- **Participating Actors:** Driver, Customer, Ops Staff.
- **Technical State Transitions:** Exception logged; parcel returned to hub.
- **Step-by-Step Execution:**
  1. Driver explains route constraints and logs `contact-exception` (`location_issue`).
  2. Ops Tower contacts warehouse: warehouse confirms parcel should not be diverted.
  3. Driver continues standard city route; parcel returned to warehouse at 18:00 for re-dispatch.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L280-L291).

---

#### Flow 11: Mid-Route Cargo Damage / Traffic Accident
- **Real-World Context:**
  Driver involved in minor road accident on Eastern Ring Road. 6 cartons of fragile perfume shatter inside the van.
- **Participating Actors:** Driver, Najm Traffic Officer, Ops Tower, Warehouse.
- **Technical State Transitions:**
  - Ticket `urgent` opened with police report.
  - Settlement holds applied (`holdsSettlement = true`).
- **Step-by-Step Execution:**
  1. Driver ensures personal safety, contacts Najm, and taps **Urgent Help** in app.
  2. Driver uploads photo of Najm accident form + damaged cartons.
  3. Ops Tower alerts warehouse logistics manager.
  4. Undamaged parcels delivered by rescue driver or returned to dock.
  5. Settlement holds prevent payout until insurance claim is resolved.
- **Code Reference:** [`web/src/server/settlement.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/settlement.ts#L46-L51) (`blockingComplaint`).

---

#### Flow 12: Dynamic Multi-Stop Sequence Optimization
> **Update L (J2): routing is OFF by default.** With `routingEnabled` off the app shows a plain list of the driver's stops (any order), there is no "Optimize Route" button and `POST /offers/:id/route/optimize` answers `409 ROUTING_DISABLED`. This flow applies only when the owner switches routing on (Settings › Field operations); then Google Routes is used when a key is configured, otherwise a labelled straight-line estimate.
- **Real-World Context:**
  Driver receives 28 delivery stops across northern and eastern Riyadh.
- **Participating Actors:** Driver, Google Maps Routes API.
- **Technical State Transitions:** Route waypoints re-ordered by minimal latency.
- **Step-by-Step Execution:**
  1. In Flutter app, driver navigates to **Route Screen**.
  2. Taps **Optimize Route**. App calls `POST /driver/route/optimize`.
  3. Server invokes Google Routes API with waypoint optimization.
  4. Optimized sequence rendered with polyline. Driver starts navigation.
- **Code Reference:** [`web/src/server/routing.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/routing.ts) (`optimizeRoutePlan`), [`mobile/lib/features/jobs/route_screen.dart`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/mobile/lib/features/jobs/route_screen.dart).

---

### Category 3: Custody, POS Terminals, Cash & Assets

#### Flow 13: POS Terminal Handover & Verified Return
> **Update L: not supported (decision C8).** Custody item types are `phone`, `charger`, `bag`, `other` (`CUSTODY_ITEM_TYPES`); there is no `pos_device` and no card collection. Cash on delivery is collected in cash and tracked per parcel (E17, flow 35).
- **Real-World Context:**
  Warehouse issues bank mada POS card terminal (Serial #ING-88210) to driver for COD card collections.
- **Participating Actors:** Warehouse Asset Clerk, Driver.
- **Technical State Transitions:**
  - `custody_items.status`: `handed_over` $\rightarrow$ `acknowledged` $\rightarrow$ `returned`
- **Step-by-Step Execution:**
  1. Warehouse calls `POST /offers/:id/custody` with `itemType: 'pos_device'`, serial number, and description.
  2. Driver Flutter app receives alert; driver verifies physical device and taps **Acknowledge Custody** (`POST /custody/:id/acknowledge`).
  3. Driver uses POS device during shift.
  4. At 18:00 dock checkout, warehouse clerk inspects terminal and calls `POST /custody/:id/return` with `outcome: 'returned'`.
- **Code Reference:** [`web/src/server/support.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/support.ts#L157-L186).

---

#### Flow 14: Unreturned POS Equipment Post-Shift
> **Update L:** the same applies to any custody item: recording `not_returned` (note mandatory) stores the note and a `custody_not_returned` event. It does **not** create a complaint, hold the settlement or suspend the driver automatically — operations use the complaint / wallet-adjustment / suspension tools by hand.
- **Real-World Context:**
  Driver completes route, returns parcel returns, but forgets POS terminal in his personal vehicle and leaves warehouse.
- **Participating Actors:** Warehouse Clerk, Driver, Ops Tower, Finance.
- **Technical State Transitions:**
  - `custody_items.status`: `not_returned`
  - Automated complaint filed with `holdsSettlement = true`.
- **Step-by-Step Execution:**
  1. Warehouse logs `outcome: 'not_returned'` on custody record.
  2. System auto-generates complaint holding driver settlement.
  3. Driver's mobile wallet displays payout freeze warning.
  4. Next morning, driver returns terminal to dock; warehouse marks `returned`.
  5. Settlement lock is automatically cleared.
- **Code Reference:** [`web/src/server/support.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/support.ts#L174-L184), [`web/src/server/settlement.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/settlement.ts#L46-L51).

---

#### Flow 15: Damaged Custody Equipment Handback
- **Real-World Context:**
  Driver drops barcode scanner on warehouse concrete floor, cracking the touch screen.
- **Participating Actors:** Driver, Warehouse Asset Lead, Finance.
- **Technical State Transitions:**
  - `custody_items.status`: `damaged`
  - Ledger adjustment posted to driver account.
- **Step-by-Step Execution:**
  1. Warehouse logs `outcome: 'damaged'` with repair estimate (250 SAR).
  2. Ops validates damage photos.
  3. Finance posts `wallet.adjust` ledger entry: debits 250 SAR from driver earnings, credits 250 SAR to warehouse account.
- **Code Reference:** [`web/src/server/support.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/support.ts#L180), [`web/src/server/wallet.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/wallet.ts).

---

#### Flow 16: Cash-on-Delivery (COD) Deposit Shortage
> **Update L (E17, L6):** the warehouse (or the super admin) records "Receive money from driver" per order, partial receipts allowed, never above what is outstanding. A shortage therefore simply **stays outstanding** on the driver — it counts toward his cash limit, ages, and blocks new offers and part of his withdrawals once over the limit or overdue (flow 35). COD cash never touches the wallet ledger; a deduction from his earnings, if the owner wants one, is a manual wallet adjustment.
- **Real-World Context:**
  Driver collects 3,200 SAR in physical cash across 14 COD orders. At evening cash count, cashier counts 3,050 SAR (150 SAR shortage).
- **Participating Actors:** Driver, Cashier, Finance Controller.
- **Technical State Transitions:** Discrepancy voucher attached; settlement adjusted.
- **Step-by-Step Execution:**
  1. Cashier logs cash discrepancy ticket in platform.
  2. Driver confirms cash calculation error and signs acknowledgment.
  3. Finance applies 150 SAR deduction against driver shift payout via double-entry adjustment.
- **Code Reference:** [`web/src/server/support.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/support.ts), [`web/src/server/wallet.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/wallet.ts).

---

### Category 4: Driver Attendance, No-Shows & Logistics Office Replacements

#### Flow 17: Punctual Attendance & Seamless Check-In
- **Real-World Context:**
  Driver arrives at warehouse gate at 07:48 for an 08:00 shift.
- **Participating Actors:** Driver, Warehouse Gate Guard, System.
- **Technical State Transitions:**
  - `offers.status`: `accepted` $\rightarrow$ `arrived` $\rightarrow$ `attendance_confirmed`
  - `requests.status`: `assigned` $\rightarrow$ `in_progress`
- **Step-by-Step Execution:**
  1. Flutter app sends GPS coordinates on `POST /offers/:id/checkin`.
  2. Status transitions to `arrived`.
  3. Warehouse clicks **Confirm Attendance** (`POST /offers/:id/attendance` with `present: true`).
  4. Request activates into `in_progress`.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L131-L158).

---

#### Flow 18: Late Arrival Beyond Grace Period (>15 Minutes)
> **Update L:** the business may record a no-show only from `startsAt + lateGraceMin` (default **30** minutes; staff are exempt); the 40-minute example still qualifies, a driver 10 minutes late does not.
- **Real-World Context:**
  Shift starts at 08:00. Driver arrives unannounced at 08:40. Warehouse dispatch window has already passed.
- **Participating Actors:** Warehouse Supervisor, Late Driver, Ops Tower.
- **Technical State Transitions:**
  - `offers.status`: `no_show`
  - Request slot freed; replacement dispatched.
- **Step-by-Step Execution:**
  1. Warehouse clicks **Reject Attendance** (`present: false, reason: 'arrived_40m_late'`).
  2. Offer marked `no_show`.
  3. `freeSlotAndReplace()` decrements `slotsFilled`, sets request status back to `filling`, and dispatches replacement offers to nearby standby drivers.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L159-L177).

---

#### Flow 19: Driver Total No-Show & 3-Strike Auto-Suspension
> **Update L:** the thresholds are settings: warning at **2** and suspension at **4** cancellations / no-shows within **7** days, for **3** days (not "strike #3 → 7 days"); the whole policy can be switched off. Staff can clear a suspension at any time (it also restarts the count).
- **Real-World Context:**
  Driver accepts delivery shift but ghosts warehouse on Sunday morning.
- **Participating Actors:** Warehouse, Driver, Automated Strike Policy Engine.
- **Technical State Transitions:**
  - Strike recorded; driver account suspended for 7 days.
- **Step-by-Step Execution:**
  1. Warehouse logs no-show at 08:30.
  2. Strike policy engine evaluates driver cancellation history within 30 days (`cancelWindowDays`).
  3. Driver hits strike threshold #3: system auto-suspends account (`suspendedUntil = now + 7 days`, `availability = 'unavailable'`).
  4. Audit log written; push notification sent to driver.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L393-L404).

---

#### Flow 20: Mechanical Breakdown & Logistics Office Fleet Swap
- **Real-World Context:**
  A driver affiliated with "Al-Fares Courier Office" suffers a tire blowout on the highway 15 minutes before shift start.
- **Participating Actors:** Office Driver, Office Dispatcher, Standby Driver, Warehouse.
- **Technical State Transitions:**
  - `offers.status`: `replaced`
  - New offer routed to office's standby roster first.
- **Step-by-Step Execution:**
  1. Driver alerts office dispatcher.
  2. Dispatcher clicks **Replace Driver** on Office Portal (`POST /office/offers/:id/replace`).
  3. `officeReplace()` sets old offer to `replaced` and triggers `freeSlotAndReplace(..., onlyOfficeId: office.id)`.
  4. Standby office driver accepts within 5 minutes.
  5. Warehouse dashboard updates with new driver and vehicle details.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L427-L448).

---

#### Flow 21: Mid-Route Driver Emergency & Cargo Transshipment
- **Real-World Context:**
  Driver delivers 12 of 35 parcels, then suffers acute heatstroke. Van parked on roadside with 23 undelivered parcels.
- **Participating Actors:** Incapacitated Driver, Rescue Driver, Ops Tower, Warehouse.
- **Technical State Transitions:** Delivery split into two offers; cargo custody transferred.
- **Step-by-Step Execution:**
  1. Driver calls JR Operations Emergency hotline.
  2. Ops Tower dispatches a nearby standby driver to vehicle coordinates.
  3. Rescue driver physically counts and takes custody of 23 parcels.
  4. Rescue driver completes the 23 deliveries.
  5. At settlement: Primary driver paid for 12 units; Rescue driver paid for 23 units.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L409-L424) (`staffReplace`).

---

#### Flow 22: Logistics Office Pre-Shift Roster Optimization
- **Real-World Context:**
  18 hours before shift start, office manager notices Driver A's driver license expires at midnight.
- **Participating Actors:** Office Dispatcher, Driver A, Driver B.
- **Technical State Transitions:** Seamless pre-shift swap.
- **Step-by-Step Execution:**
  1. Office manager opens `/office/jobs`, locates tomorrow's job, and clicks **Swap Driver**.
  2. System executes `officeReplace()`.
  3. Driver A's slot is revoked; Driver B accepts.
  4. Warehouse experiences zero operational disruption.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L427-L448).

---

### Category 5: Quantity Audits, Disputes & Escalations

#### Flow 23: Disputed Missing Packages (Warehouse Claims 5 Lost)
> **Update L: superseded by E16 / B8.** The warehouse has no *Dispute* button, `POST /offers/:id/delivery-confirm` does not exist and the `qty_disputed` state cannot be reached; the settlement is not held by a quantity dispute. The delivered count is derived from the parcels the driver actually marked delivered with proof, so a parcel that was not delivered is simply not billed. A claim after the fact is a ticket / complaint (a complaint with `holdsSettlement` still defers the payment while it is open) and, if money must move, a staff wallet adjustment.
- **Real-World Context:**
  Warehouse loaded 30 parcels in morning. Driver reports 25 delivered, returns 0, and claims only 25 were loaded. Warehouse insists 30 were handed over.
- **Participating Actors:** Warehouse Inventory Lead, Driver, Operations Mediator.
- **Technical State Transitions:**
  - `offers.status`: `qty_disputed`
  - Complaint created with `holdsSettlement = true`.
- **Step-by-Step Execution:**
  1. Driver reports 25 delivered.
  2. Warehouse clicks **Dispute** on portal: `POST /offers/:id/delivery-confirm` (`action: 'dispute', note: '5 parcels unaccounted for'`).
  3. Offer transitions to `qty_disputed`. Financial settlement is locked.
  4. Ops reviews morning audit log: driver had confirmed 30 loaded (`loadedAckByDriver = true`).
  5. Driver is held liable for missing 5 parcels.
  6. Ops calls `resolveDispute(staffUser, offerId, 25, 'Driver liable for 5 unreturned items')`.
  7. Value of 5 parcels deducted from driver ledger; settlement released.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L237-L251), [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L293-L313).

---

#### Flow 24: Driver Fraudulent Over-Reporting ("Ghost Deliveries")
> **Update L:** a driver cannot report more than he scanned and each delivery needs its own proof (code / scan / photo / signature), so the "30 delivered" report of this story cannot be submitted; the `maxBillableUnits` cap and the audit trail remain. Staff tools for a suspected fraud: location history, stop events, suspension, wallet adjustment.
- **Real-World Context:**
  Driver delivers 16 parcels, stops working at 14:00, and reports 30 parcels delivered in the app to claim full payout.
- **Participating Actors:** Driver, Warehouse Auditor, Fraud Investigator.
- **Technical State Transitions:** Fraud flag raised; delivered count corrected.
- **Step-by-Step Execution:**
  1. Driver submits 30 delivered.
  2. Warehouse customer CRM alerts 14 undelivered customers.
  3. Warehouse disputes delivery.
  4. Ops reviews GPS breadcrumb logs: driver never visited the 14 customer addresses.
  5. Fraud confirmed: driver suspended, billable count set to 16, unearned units refunded to warehouse.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L215-L217) (`maxBillableUnits`), [`web/src/server/audit.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/audit.ts).

---

#### Flow 25: Operations Tower Conciliation & Binding Resolution
> **Update L: superseded (B8).** `POST /admin/offers/:id/resolve-dispute` was removed; `resolveDispute` remains in `jobs.ts` only for an old database row still in `qty_disputed` and for its test. A binding outcome today = complaint resolution + wallet adjustment (`wallet.adjust`).
- **Real-World Context:**
  Dispute caused by warehouse shipping software printing duplicate barcodes on 8 parcels, confusing sorting.
- **Participating Actors:** Ops Staff (`requests.edit`), Warehouse Manager, Office Manager.
- **Technical State Transitions:** `resolveDispute()` executed; settlement unlocked.
- **Step-by-Step Execution:**
  1. Ops staff opens `/admin/cases` and reviews complaint notes.
  2. Staff examines evidence and determines shared fault (faulty barcodes from warehouse, inadequate driver communication).
  3. Staff sets binding `finalUnits = 27`.
  4. Calls `resolveDispute(staffUser, offerId, 27, 'Ops conciliation settlement')`.
  5. Offer transitions to `pending_settlement`. Complaint marked `resolved`.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L293-L313).

---

#### Flow 26: Post-Fulfillment Clean Sign-Off & Auto-Completion
> **Update L: step 2 does not exist** — nobody clicks *Confirm Delivery*; the system confirms when the driver finishes the route and the request completes when every offer is settled.
- **Real-World Context:**
  Driver loads 30, delivers 30, returns 0. Warehouse supervisor verifies and confirms in portal.
- **Participating Actors:** Driver, Warehouse Supervisor.
- **Technical State Transitions:**
  - `offers.status`: `delivered_reported` $\rightarrow$ `pending_settlement` $\rightarrow$ `completed`
  - `requests.status`: `in_progress` $\rightarrow$ `completed`
- **Step-by-Step Execution:**
  1. Driver submits 30 delivered at 17:30.
  2. Warehouse supervisor clicks **Confirm Delivery** (`units: 30`).
  3. Offer transitions to `pending_settlement`.
  4. `completeIfReady()` executes:
     - `createSettlement()` creates settlement row.
     - Offer transitions to `completed`.
     - Request transitions to `completed`.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L237-L262), [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L319-L344).

---

### Category 6: Financial Ledger, Escrow Release, Multi-Tier Payouts & Cancellations

#### Flow 27: Standard Double-Entry Settlement & VAT Invoicing
> **Update L: steps 2–3 do not exist (E18).** There is no `reviewSettlement` / `approveSettlement`, no separation of duties and no settlement states `pending_review → reviewed → approved`: when the driver's work ends the settlement is created and **paid in the same transaction** (`settleOffer` → `payoutTx`: reserve released, customer charged, payee credited, platform fee booked, invoice issued). An open complaint that holds the job leaves the settlement `approved` (= on hold) and the tick pays it when the hold is lifted; a failed payout is retried by the tick. The invoice carries the platform's seller block (Settings › Company); it is **not** a ZATCA Phase-2 invoice. A zero-value settlement issues no invoice.
- **Real-World Context:**
  Clean delivery shift: 30 parcels @ 20 SAR customer price = 600 SAR. Provider cost @ 14 SAR = 420 SAR. Platform fee = 180 SAR. VAT 15% inclusive.
- **Participating Actors:** Finance Reviewer, Finance Approver, Double-Entry Ledger.
- **Technical State Transitions:**
  - `settlements.status`: `pending_review` $\rightarrow$ `reviewed` $\rightarrow$ `approved` $\rightarrow$ `paid`
- **Step-by-Step Execution:**
  1. Job completes; settlement row created.
  2. Finance Reviewer audits shift notes and marks `reviewed` (`reviewSettlement()`).
  3. Under strict separation of duties, a second Finance Officer clicks `approveSettlement()`.
  4. System executes `payoutTx()`:
     - Warehouse Account: releases 600 SAR from `reserved_cents`, charges 600 SAR.
     - Payee Account: credits 420 SAR to `available_cents` (`kind: 'payout'`).
     - JR Platform Account: credits 180 SAR to platform wallet (`kind: 'platform_fee'`).
  5. Tax invoice generated: Subtotal 521.74 SAR + 78.26 SAR VAT (15%) = 600.00 SAR.
- **Code Reference:** [`web/src/server/settlement.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/settlement.ts#L18-L37), [`web/src/server/settlement.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/settlement.ts#L99-L124).

---

#### Flow 28: Under-Delivery Escrow Auto-Refund (Booked 50, Delivered 25)
- **Real-World Context:**
  Warehouse booked 50 parcels (800 SAR reserved). Final delivery confirmed at 25 parcels.
- **Participating Actors:** System Escrow Engine, Warehouse Accountant, Driver.
- **Technical State Transitions:** Unspent escrow released immediately upon job completion.
- **Step-by-Step Execution:**
  1. Final units set to 25.
  2. At job finalization in `finalizeRequest()`:
     - Reserved escrow: 800 SAR (80,000 halalas).
     - Billable amount: 25 $\times$ 16 SAR = 400 SAR (40,000 halalas).
     - System calls `releaseReserve(tx, r, 40000, ...)`.
  3. 400 SAR is immediately restored to warehouse `available_cents`.
  4. Warehouse statement records clean breakdown: 400 SAR charged, 400 SAR refunded.
- **Code Reference:** [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L337-L339), [`web/src/server/requests.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/requests.ts#L154-L159).

---

#### Flow 29: Logistics Office Payout Processing & Commission Split
- **Real-World Context:**
  Shift completed by a driver affiliated with "Riyadh Courier Office".
- **Participating Actors:** Affiliated Driver, Office Accountant, JR Finance.
- **Technical State Transitions:** Payee mapped to office user ID.
- **Step-by-Step Execution:**
  1. Offer snapshotted `officeId = officeUser.id`.
  2. At payout execution in `payoutTx`:
     ```typescript
     const payee = await ensureAccount(s.officeId ?? s.driverId, tx);
     ```
  3. Net provider cost credited to the Office's wallet account.
  4. Office portal displays consolidated settlement statement with driver ID and shift breakdown.
  5. Office executes internal payroll disbursements.
- **Code Reference:** [`web/src/server/settlement.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/settlement.ts#L105-L112).

---

#### Flow 30: Late Warehouse Cancellation Post-Arrival
> **Update L: step 3 is not implemented** — there is no SAR 50 show-up compensation. Ops cancel (the business cannot once the driver has arrived) and the **whole** remaining reserve returns to the warehouse; if the driver already delivered parcels, ops end his route instead of cancelling so the delivered stops stay paid. *Fees: none — amounts pending the owner.*
- **Real-World Context:**
  Driver arrives at warehouse at 07:55. At 08:15, warehouse cancels request because their ERP server crashed.
- **Participating Actors:** Warehouse Supervisor, Driver, Ops Staff.
- **Technical State Transitions:** Self-service blocked; Ops executes cancellation with indemnity.
- **Step-by-Step Execution:**
  1. Warehouse clicks cancel. Platform blocks self-service because driver has already arrived:
     ```typescript
     if (started && !staff) throw err("INVALID_TRANSITION", "Work has already started — contact operations to cancel");
     ```
  2. Ops staff investigates and processes cancellation.
  3. Driver awarded 50 SAR show-up compensation from escrow.
  4. Remaining reserved escrow refunded to warehouse wallet.
- **Code Reference:** [`web/src/server/requests.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/requests.ts#L161-L186).

---

### Category 7: Marketplace Matching & Capacity Edge Cases

#### Flow 31: Preferred Office Window Expiry & General Market Broadcast
> **Update L: retired (decision C9).** Warehouses can no longer prefer an office; `preferredOfficeId` and `officeWindowEndsAt` are never set and the "office window" step of the tick was removed (B8). Offers go to the general matching pool (the office-first rule remains only for *replacement* offers).
- **Real-World Context:**
  Warehouse creates booking requesting priority allocation to "Express Courier Office" with a 15-minute priority window. The office has no available drivers.
- **Participating Actors:** Warehouse, Preferred Office, Open Marketplace Drivers.
- **Technical State Transitions:** `preferredOfficeId` expires; broadcast to open market.
- **Step-by-Step Execution:**
  1. Request published with `officeWindowEndsAt = now + 15m`.
  2. For 15 minutes, only Express Courier Office drivers receive offers.
  3. At minute 16, maintenance cron runs:
     - Sets `preferredOfficeId = null`, `officeWindowEndsAt = null`.
     - Calls `dispatchOffers(tx, r)`.
  4. Offers broadcast to all eligible independent drivers in Riyadh.
  5. First qualified direct driver accepts and locks the slot.
- **Code Reference:** [`web/src/server/maintenance.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/maintenance.ts#L26-L36), [`web/src/server/matching.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/matching.ts).

---

#### Flow 32: Multi-Vehicle Enterprise Request (5 Dynas Booked)
> **Update L:** the choice "all slots together or partial" is the boolean `requests.allow_partial` (false = all-or-nothing: the request is called off at its start time unless every slot is filled, sparing any offer that already delivered).
- **Real-World Context:**
  Wholesale distribution center books 5 Dynas for a seasonal branch replenishment.
- **Participating Actors:** Warehouse Logistics Director, 5 Candidate Drivers, Dispatch Engine.
- **Technical State Transitions:**
  - `requests.quantity = 5`, `requests.slotsFilled` increments 1 to 5.
  - 5 independent offer lifecycles executed concurrently.
- **Step-by-Step Execution:**
  1. Warehouse creates request for 5 vehicles; escrow reserved for 5 slots.
  2. Offers dispatched. Drivers accept individually.
  3. Each acceptance locks a slot atomically (`FOR UPDATE` on requests table).
  4. When `slotsFilled == 5`, request status transitions to `assigned`.
  5. Drivers 1 to 5 execute independently (e.g. Driver 1 can be at `attendance_confirmed` while Driver 3 is at `arrived`).
  6. If Driver 4 no-shows, only Driver 4's slot is reopened for replacement; Drivers 1, 2, 3, 5 continue uninterrupted.
  7. Request auto-completes when all 5 offers reach settlement readiness.
- **Code Reference:** [`web/src/server/requests.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/requests.ts#L112-L150), [`web/src/server/jobs.ts`](file:///Users/dogorshom/Desktop/Thawani/jr-logisitics/jr-logistics/web/src/server/jobs.ts#L50-L83).

---

### Category 8: Providers, Payments, Cash Risk, Privacy, Legal & App Update (Update L, 2026-11-22)

Each of the first two flows needs its provider **on and complete** (Settings › Payments, super admin); flow 36 describes what happens while SMS is off. Decisions: `DECISIONS.md` L1–L16.

#### Flow 33: Top-Up by Card (PayTabs hosted payment page)
- **Real-World Context:**
  A company's prepaid wallet is low before a large dispatch day. The company adds SAR 2,000 by card from the wallet page.
- **Participating Actors:** Company (business), PayTabs, the platform (server), Finance (only when something needs review).
- **Technical State Transitions:**
  - `payment_intents.status`: `pending` $\rightarrow$ `paid` (or `failed`, `expired`, `needs_review`).
  - Wallet ledger: one `topup` entry, key `paytabs:<intent id>`, `simulated: false`, note = PayTabs `tran_ref`.
- **Step-by-Step Execution:**
  1. The wallet page shows "Add funds" only for the methods that are available (card / bank transfer); with none available (and not demo mode) it says funding is arranged through support and shows the company contact.
  2. Company enters SAR 2,000 (within the console's min / max, default minimum SAR 10). The page calls `POST /wallet/topup/card {amountCents, idempotencyKey}`; the server creates the intent and calls PayTabs `/payment/request` (`tran_type: sale`, `cart_id` = intent id, `cart_currency: SAR`, callback and return URLs derived from `APP_URL`).
  3. The browser is sent to PayTabs' payment page; the company types the card there. **The platform never sees the card number.**
  4. PayTabs calls the IPN `POST /api/v1/payments/paytabs/callback` (the signature header is checked over the raw body) and sends the browser to `POST /api/v1/payments/paytabs/return`, which answers 303 to `/business/wallet?topup=<id>`.
  5. **Neither message is trusted with the money.** `settleIntent` locks the intent, asks PayTabs itself (`/payment/query`), checks `response_status = A`, the amount, the currency and the cart id against the intent, and only then posts the ledger entry. Callback, return, the "Check payment" button (`POST /wallet/topups/:id/check`) and the scheduler may all arrive together: the intent row is locked and the ledger key is unique, so the credit happens **once**.
  6. A mismatch (wrong amount, paid after expiry, on hold for > 48 h …) puts the intent in `needs_review` and alerts Finance (`topups.manage`); Finance can re-check from `/admin/finance/topups` (cards tab).
  7. The scheduler (`reconcileIntents`) re-asks PayTabs about attempts pending more than 10 minutes and marks abandoned ones `expired` after 30 minutes.
- **Financial Calculation:**
  - Company wallet `available` + SAR 2,000.00 exactly (halalas). The gateway's fee (MDR) is **not modelled** — it is settled between PayTabs and the owner outside the platform (owner item).
- **Code Reference:** `web/src/server/payments/card.ts` (`createCardTopup`, `settleIntent`, `reconcileIntents`), `payments/paytabs.ts`, `payments/paytabs-signature.ts`, `payments/http.ts`, `app/api/v1/payments/paytabs/{callback,return}/route.ts`, `server/maintenance-steps/payments.ts`.
- **Recommended SOP & Gaps:** Register the callback URL in the PayTabs dashboard (it must be reachable over https and answer 200); live credentials have not been tested end to end (owner item).

---

#### Flow 34: Top-Up by Bank Transfer with Receipt
- **Real-World Context:**
  A company prefers to pay by bank transfer. It sends SAR 10,000 from its corporate account.
- **Participating Actors:** Company, Finance (`topups.manage`), the platform.
- **Technical State Transitions:**
  - `bank_transfers.status`: `requested` $\rightarrow$ `approved` | `rejected` | `cancelled`.
  - Ledger `topup`, key `banktopup:<id>`, only on approval.
- **Step-by-Step Execution:**
  1. The company opens "Add funds › Bank transfer": it sees JR's bank, account holder, IBAN, SWIFT, the notes and **its own transfer reference** to quote.
  2. After transferring, it sends `POST /wallet/topup/bank` with the amount, the transfer date (not older than 60 days), the bank's reference number and a receipt (photo / PDF, ≤ 8 MB, type checked). Sending the same reference and amount again warns of a duplicate.
  3. Finance sees the request in `/admin/finance/topups` with the receipt (a permission-checked stream), a duplicate marker when another request quotes the same reference and amount, and filters / export.
  4. Finance **approves** — optionally typing the amount that actually arrived — or **rejects** with a required reason. Approval posts the ledger entry once and notifies the company (`topup_approved` / `topup_rejected`); a double click does not credit twice. The company cannot approve its own request, and can cancel it while it is still `requested`.
- **Financial Calculation:** wallet `available` + the *received* amount (default = requested amount).
- **Code Reference:** `web/src/server/payments/bank.ts`, `payments/topups.ts`, `routes/payments.ts`, `admin-finance-topups*.tsx`.
- **Recommended SOP & Gaps:** Retention of receipts is an open owner / lawyer question (`PRIVACY.md` §5).

---

#### Flow 35: Cash-Risk Limits on a Driver
- **Real-World Context:**
  A driver collects cash on delivery all week and has not handed it to the warehouse. By Thursday he holds SAR 3,400, the oldest of it 4 days old.
- **Participating Actors:** Driver, warehouse (receives the cash), the driver's office (if any), Finance and operations.
- **Technical State Transitions:** state `ok` $\rightarrow$ `warn` (80 % of the limit) $\rightarrow$ `over_limit` / `overdue`. Computed live, nothing stored except the once-a-day notice rows (`cash_risk_notices`).
- **Step-by-Step Execution:**
  1. Each COD delivery adds to the driver's outstanding cash; the warehouse's "Receive money from driver" subtracts.
  2. At SAR 2,400 (80 %) he gets `cash_limit_warning`; at SAR 3,000 or when any order's cash is older than 3 days he gets `cash_blocked` / `cash_overdue` (and his office `office_driver_cash`), once per state and Riyadh day (right after the delivery and from the hourly tick).
  3. While blocked: matching skips him, the opportunities list says why, accepting or applying answers `403 CASH_LIMIT`; a job he already accepted keeps running; a withdrawal is limited to `available − overdue cash` (`409 CASH_OUTSTANDING`). His overview and the web driver shell show a banner with what to do.
  4. He hands the cash to the warehouse; the warehouse records the receipt; **the block lifts at once** and offers he missed are made to him again.
  5. Operations see him on the radar (`cash_overdue` / `cash_over_limit`); Finance › Drivers has columns, a filter and a KPI, Finance › COD has the aging buckets (0–1, 2–3, 4–7, 8+ days); the office sees `/office/cash`.
- **Financial Calculation:** halalas; limit SAR 3,000, warning 80 %, 3 days, all editable in Settings › Finance › Cash risk (`0` = off).
- **Code Reference:** `web/src/server/cash-risk.ts`, `cash-risk-lib.ts`, `cash-risk-sql.ts`, `cash-risk-notify.ts`, `cash-aging.ts`, `office-cash.ts`, `ops-alerts.ts`, `jobs.ts` (accept check), `wallet.ts` (withdrawal lien).

---

#### Flow 36: Delivery with SMS Switched Off
- **Real-World Context:**
  The platform goes live before an SMS contract exists. The super admin leaves SMS off.
- **Participating Actors:** Driver, recipient, warehouse, super admin.
- **Technical State Transitions:** stop `loaded` $\rightarrow$ `delivered` with proof `scan`; event payload `codeSkipped: "sms_off"`; message-log row `skipped`.
- **Step-by-Step Execution:**
  1. While `smsEnabled` is off (or on without complete credentials, outside demo mode) no SMS provider is active: when the parcel is loaded nothing is texted to the recipient (tracking link and delivery code), and the log records a `skipped` row per parcel and kind — not a failure.
  2. At the door the driver scans the parcel code (and captures the signature where the warehouse asks). **The recipient's delivery code is not requested**, whatever the warehouse's `requireDeliveryOtp` is; the stop view carries `needsOtp: false, otpOffReason: "sms_off"` (the apps explain that no code is needed) and the public tracking answer carries `deliveryCode: false`.
  3. The switch takes effect immediately, also for parcels already on the road. If the super admin turns SMS on later, the next stop needs the code again; a driver already at the door taps *Resend code*.
  4. A gateway that is **on but failing** (no balance, wrong key, network) is different: the code stays required, the failure is logged with a short reason (`bad_login`, `sender`, `balance`, `text`, `number`, `ip`, `timeout`, `network`) and the status page turns red.
- **Code Reference:** `web/src/server/sms-policy.ts`, `stops.ts` (`deliverStop`), `shipments.ts` (`sendRecipientCodes`, `driverStopView`), `auth/otp.ts` (`activeSmsProvider`), `sms/msegat.ts`.
- **Recommended SOP & Gaps:** Owner items: Msegat sender-id approval and the wording of the delivery-code message.

---

#### Flow 37: Terms Re-Acceptance
- **Real-World Context:**
  The owner's lawyer reviews the built-in company terms and the owner publishes version 1.1.
- **Participating Actors:** Super admin / staff with `settings.edit`, every company, office and driver.
- **Technical State Transitions:** `legal_documents` gets a new published row per language; `GET /auth/me` → `legal.pending: [{kind, version, …}]`; `terms_consents` gets the new acceptance.
- **Step-by-Step Execution:**
  1. In Settings › Legal staff edit a draft for each language (preview, "restore built-in text" if needed), then **Publish** with a version label, an optional effective date, a change note and the switch **"require re-acceptance"**.
  2. From that moment every signed-in user of the affected module gets a blocking page in the web shell (and the app's legal screen) with the changed text; nothing else can be used until he accepts (`POST /legal/accept`, kind + version + language, address recorded).
  3. Staff see acceptance statistics per version; the history keeps every published text (published rows are never edited).
  4. New registrations read the terms of their chosen module (and the privacy policy) before registering; the consent row records kind, version, language and address.
- **Code Reference:** `web/src/server/legal.ts`, `legal-admin.ts`, `legal-defaults.ts`, `routes/legal.ts`, `components/legal/*`, pages `(auth)/terms`, `(auth)/privacy`, `admin/settings/legal`.
- **Recommended SOP & Gaps:** The built-in texts are drafts: lawyer review is an owner item.

---

#### Flow 38: Privacy — Export and Erasure
- **Real-World Context:**
  A former driver asks for his data and then to be erased.
- **Participating Actors:** The person, staff with `privacy.manage`.
- **Technical State Transitions:** `privacy_requests.status`: `pending` $\rightarrow$ `approved` (account anonymised) | `rejected` | `cancelled`.
- **Step-by-Step Execution:**
  1. Profile › *Privacy & data* › **Download my data** (`GET /privacy/export`): one JSON file (profile, documents metadata, requests / jobs, ledger, tickets, notifications, consents, sign-in history without tokens …), rate-limited and audited. It never holds secrets or other people's personal data.
  2. **Request deletion** (`POST /privacy/delete-request`, with a reason). The page first lists the **blockers** computed live: open orders / jobs, undelivered parcels, money in the wallet, pending withdrawals or top-ups, unpaid invoices, cash not handed over, linked drivers. While one exists the request is refused.
  3. Staff open `/admin/privacy`, see the checklist and what approval does, and **approve** (explicit tick) or **reject with a reason**. Approval runs `anonymiseUser` in one transaction: name → "Deleted account"; phone, e-mail, username, IBAN, national id, plate cleared; password and sessions removed; chat, ticket and note text scrubbed; documents deleted from storage after the commit. Ledger, invoices, audit and orders remain but no longer identify the person; a database trigger forbids re-activation.
  4. The hourly retention step separately blanks recipient details of old parcels (12 months), prunes notifications (90 days once read) and old webhook deliveries.
- **Code Reference:** `web/src/server/privacy/*`, `routes/privacy.ts`, `maintenance-steps/privacy.ts`; the data map is `memory/PRIVACY.md`.
- **Recommended SOP & Gaps:** Buyer identity on tax invoices of an erased company, and the retention of proofs / receipts, are open for the owner's lawyer.

---

#### Flow 39: Forced App Update
- **Real-World Context:**
  A server change makes version 1.0 of the driver app unusable. The owner sets a minimum.
- **Participating Actors:** Staff (Settings › General › Mobile app), the driver's phone.
- **Technical State Transitions:** none in the data; the API answers `426 UPGRADE_REQUIRED`.
- **Step-by-Step Execution:**
  1. Staff enter the minimum version and the store link for iOS and / or Android (blank = no minimum).
  2. The app sends `X-Client: mobile`, `X-App-Version`, `X-App-Platform` on every request. A request below the minimum of its platform is answered before anything else with `426` and `details {minVersion, currentVersion, platform, storeUrl}`; the app shows the update screen with the store button.
  3. `GET /catalog` and `GET /health` are exempt so the screen can always read the link; the web and integrators are never affected. Lifting the minimum works at once.
- **Code Reference:** `web/src/server/ops-tools/app-version.ts`, `api/router.ts`, app: `lib/core/version_gate.dart`, `features/update/update_screen.dart`.
