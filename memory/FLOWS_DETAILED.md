# JR Logistics — Comprehensive Real-World Operational Playbook (Detailed Flows)

**Target Ecosystem:** Saudi Logistics Marketplace (Riyadh Phase 1 Pilot)  
**Entities:** Warehouse Requesters (Shippers), Independent Drivers, Courier Logistics Offices, Ops Control Tower, Finance  
**Code Repositories:** Next.js Web Platform (`web/`), Flutter Driver App (`mobile/`)  
**Core Principles:** Strict Unit Conservation, Double-Entry Escrow Ledger, Concurrency Lock Sequencing, Transparent Exceptions

---

## 1. Domain State Machines & Financial Invariants

### 1.1 Composite Request & Offer Lifecycle
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

