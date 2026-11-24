# JR Logistics — Master Operational Flows Summary (Quick Reference)

**Scope:** 32 Core Operational Flows across Warehouses, Drivers, Courier Offices, and Finance  
**Version:** 1.0 · November 2026 · Saudi Logistics Pilot (Riyadh)

> **Update L (2026-11-22):** this quick reference was written before several owner decisions. Differences from what runs: flows 03 / 06 / 30 mention a show-up fee, a detention surcharge and a late-cancellation indemnity — **none is implemented (no fees, amounts pending the owner)**; flows 13–14 mention POS terminals (not supported) ; flow 12 needs routing switched on (off by default); flows 23–27 describe a warehouse confirm / dispute step and a review / approval step that were **removed** (the delivery is confirmed automatically and the settlement is paid at once); flow 31's priority window was retired. Details per flow: `FLOWS_DETAILED.md` (top table) and `PLATFORM_FULL_SPEC_AND_FLOWS_EN.md` (Update L notes). New flows 33–39 are at the end.

---

### Category 1: Loading Bay, Capacity & Quantity Mismatches

**Flow 01: Asymmetric Fulfillment (Booked 50, Loaded 30, Delivered 25, Returned 5)**
- **Scenario:** Warehouse stages only 30 parcels at dock; driver delivers 25; 5 unreachable parcels returned to warehouse dock.
- **System Action:** Warehouse inputs 30 loaded (`recordLoading`); driver acknowledges; driver reports 25 delivered; warehouse confirms 25.
- **Financial Outcome:** Escrow charged for 25 units; remaining 25 units instantly refunded to warehouse wallet; driver paid for 25 units.

**Flow 02: Warehouse Over-Loading Attempt (Booked 50, Warehouse Attempts 75)**
- **Scenario:** Warehouse attempts to load 75 bulky parcels on a 50-parcel booking exceeding vehicle payload and booked escrow.
- **System Action:** App caps billable units at 50 (`maxBillableUnits`); driver disputes loading (`acknowledgeLoading(false)`); ticket opened.
- **Financial Outcome:** Escrow remains locked at 50 units; warehouse offloads excess 25 parcels or creates a second booking request.

**Flow 03: Warehouse Stockout on Arrival ("Not Put to Work")**
- **Scenario:** Driver checks in on time at 08:00, but warehouse sorting system broke down with zero packages ready.
- **System Action:** Driver taps `reportNoWork` after 45m wait; Ops verifies warehouse outage; offer cancelled without driver penalty.
- **Financial Outcome:** Driver receives flat 50 SAR show-up compensation from escrow; remaining reserved escrow refunded to warehouse.

**Flow 04: Damaged Cargo Discovered at Dock Handover**
- **Scenario:** During morning loading, 4 detergent cartons are found leaking out of 40 staged cartons.
- **System Action:** Warehouse adjusts loaded units down to 36; driver captures photos and confirms 36 units; 4 damaged cartons kept at dock.
- **Financial Outcome:** Total billable ceiling updated to 36 units; escrow for 4 unallocated units released back to warehouse.

**Flow 05: Cold-Chain Temperature Breach at Pickup Dock**
- **Scenario:** Chilled pharma order (+2°C to +8°C) arrives; driver's reefer unit fails at +18°C (or dock staging exposed goods to ambient heat).
- **System Action:** Attendance rejected (`confirmAttendance(false, 'temp_breach')`); offer cancelled; replacement cold van auto-dispatched.
- **Financial Outcome:** Driver receives zero pay; warehouse charged zero penalty if vehicle at fault; slot re-offered.

**Flow 06: Dock Congestion & Loading Delay (>60 Minutes)**
- **Scenario:** Driver checks in on time but warehouse staging queues delay loading for 90 minutes.
- **System Action:** Driver logs `business_not_ready` ticket; SLA engine dynamically extends driver's route completion deadline by 90 minutes.
- **Financial Outcome:** Driver protected from late delivery strikes; warehouse billed 35 SAR/hr demurrage detention fee if policy active.

---

### Category 2: Delivery Execution, Recipient Exceptions & Returns

**Flow 07: Recipient Absent / Unreachable at Doorstep**
- **Scenario:** Driver reaches delivery address; customer does not answer calls or pre-filled WhatsApp handoff within 10 minutes.
- **System Action:** Driver logs `contactException('unreachable')`; delivery fails; parcel added to driver's return manifest.
- **Financial Outcome:** Unit not counted as delivered; parcel returned to warehouse dock at shift end; driver earns base stop compensation.

**Flow 08: Direct Customer Rejection (Refused COD / Changed Mind)**
- **Scenario:** Consignee refuses order at doorstep due to lack of cash for COD or changed purchase decision.
- **System Action:** Driver logs `customer_rejected` with reason code; parcel resealed and returned to vehicle custody.
- **Financial Outcome:** Delivered units counter does not increment; warehouse webhook notified in real-time; item returned to hub.

**Flow 09: Partial Consignee Acceptance (B2B Bulk Split Delivery)**
- **Scenario:** Restaurant manager accepts 17 intact cooking oil cartons but rejects 3 crushed boxes from a 20-box order.
- **System Action:** Driver enters 17 delivered, uploads endorsed delivery note photo; returns 3 crushed cartons to warehouse.
- **Financial Outcome:** Final billing calculated on 17 delivered units; 3 units returned and refunded from warehouse escrow.

**Flow 10: Customer Address Out-of-Zone Relocation Request**
- **Scenario:** Customer in Riyadh asks driver to deliver 80 km away in Al-Kharj outside agreed delivery boundaries.
- **System Action:** Driver logs `location_issue`; Ops coordinates with warehouse to reject diversion and return parcel to hub.
- **Financial Outcome:** Stop marked undelivered; package returned to warehouse dock at 18:00 without driver penalty.

**Flow 11: Mid-Route Cargo Damage / Vehicle Collision**
- **Scenario:** Driver rear-ended on Ring Road; 10 fragile cartons shatter inside the van hold.
- **System Action:** Driver files urgent ticket with Najm police report; job paused; settlement frozen (`holdsSettlement = true`).
- **Financial Outcome:** Insurance claim filed; driver paid for intact delivered units; missing units escrow held pending liability signoff.

**Flow 12: Multi-Stop Dynamic Route Sequencing**
- **Scenario:** Driver loads 30 stops across Riyadh; traffic congestion blocks northern ring corridor.
- **System Action:** Driver taps `optimizeRoute` in Flutter app; server calls Google Routes API to re-sequence stops by real-time travel time.
- **Financial Outcome:** Zero financial changes; driver saves ~45 minutes of transit time; customer delivery windows met.

---

### Category 3: Custody, POS Terminals, Cash & Assets

**Flow 13: POS Terminal Handover & Verified Return**
- **Scenario:** Warehouse issues bank mada POS card terminal (S/N 99482) for driver to collect card-on-delivery payments.
- **System Action:** Warehouse creates custody handover; driver acknowledges on mobile; warehouse marks returned at shift end.
- **Financial Outcome:** Custody cycle closed cleanly; driver payout released without liens.

**Flow 14: Unreturned POS Equipment Post-Shift**
- **Scenario:** Driver completes deliveries, returns parcels, but drives home with warehouse-issued POS terminal in vehicle.
- **System Action:** Warehouse marks custody `not_returned`; system auto-files complaint and freezes driver settlement payouts.
- **Financial Outcome:** Driver earnings locked under administrative lien; released only upon verified equipment handback.

**Flow 15: Damaged Custody Equipment Handback**
- **Scenario:** Driver drops barcode scanner on warehouse concrete dock, shattering display glass.
- **System Action:** Warehouse marks custody `damaged`; Ops Tower assesses repair quote (200 SAR).
- **Financial Outcome:** Finance posts 200 SAR ledger adjustment deducting from driver earnings and crediting warehouse account.

**Flow 16: Cash-on-Delivery (COD) Deposit Shortage**
- **Scenario:** Driver collects 2,450 SAR in cash; warehouse cash office counts 2,350 SAR (100 SAR shortage).
- **System Action:** Discrepancy logged; driver signs cash voucher acknowledging calculation shortage.
- **Financial Outcome:** 100 SAR deducted from driver shift earnings via ledger adjustment; warehouse credited in full.

---

### Category 4: Driver Attendance, No-Shows & Logistics Office Replacements

**Flow 17: Punctual Attendance & Seamless Warehouse Check-In**
- **Scenario:** Driver arrives at warehouse dock 10 minutes prior to shift start.
- **System Action:** Mobile app sends GPS check-in (`arrived`); warehouse supervisor confirms attendance with one tap (`present: true`).
- **Financial Outcome:** Shift officially activated (`in_progress`); escrow remains safely reserved.

**Flow 18: Late Arrival Beyond Grace Period (>15 Minutes)**
- **Scenario:** Driver arrives 45 minutes late without prior notice; warehouse dispatch cutoff already breached.
- **System Action:** Warehouse supervisor rejects attendance (`confirmAttendance(false)`); offer set to `no_show`; slot reopened.
- **Financial Outcome:** Late driver receives zero pay; strike recorded; system immediately dispatches replacement offers.

**Flow 19: Driver Total No-Show & 3-Strike Auto-Suspension**
- **Scenario:** Driver confirms shift but ghosts warehouse and turns off phone on dispatch morning.
- **System Action:** Warehouse clicks No-Show; engine records 3rd cancellation strike within 30 days; driver account locked for 7 days.
- **Financial Outcome:** Driver suspended; request slot freed; replacement dispatched to nearest idle driver.

**Flow 20: En-Route Mechanical Breakdown & Courier Office Fleet Swap**
- **Scenario:** Office-affiliated driver's van breaks down 10 km before warehouse dock at 07:15.
- **System Action:** Office dispatcher executes `officeReplace`; offer reassigned to office's standby fleet driver within 10 minutes.
- **Financial Outcome:** Zero disruption to warehouse; payment routed to courier office wallet upon completion.

**Flow 21: Mid-Route Driver Emergency & Cargo Transshipment**
- **Scenario:** Driver falls ill after delivering 10 of 30 parcels; van parked on roadside with 20 undelivered parcels.
- **System Action:** Ops Tower coordinates roadside rescue; rescue driver verifies physical count and takes over digital delivery manifest.
- **Financial Outcome:** Primary driver paid for 10 units; rescue driver paid for 20 units; escrow balances perfectly.

**Flow 22: Logistics Office Proactive Pre-Shift Roster Optimization**
- **Scenario:** Office manager notices Driver A's license expires at midnight before tomorrow's scheduled shift.
- **System Action:** Office manager executes `officeReplace` on portal 12h before shift, seamlessly swapping Driver A with Driver B.
- **Financial Outcome:** Zero warehouse impact; billing and escrow remain untouched.

---

### Category 5: Quantity Audits, Disputes & Escalations

**Flow 23: Disputed Missing Packages (Warehouse Claims 5 Lost)**
- **Scenario:** Warehouse loaded 30 parcels; driver delivers 25, returns 0, and claims only 25 were handed over in morning.
- **System Action:** Warehouse disputes delivery; offer transitions to `qty_disputed`; settlement payouts completely frozen.
- **Financial Outcome:** Ops audits morning loading acknowledgement (signed for 30); driver held liable for 5 lost packages.

**Flow 24: Driver Fraudulent Over-Reporting ("Ghost Deliveries")**
- **Scenario:** Driver delivers 18 parcels but attempts to submit 30 delivered in app to claim unearned payout.
- **System Action:** App enforces `maxBillableUnits`; warehouse CRM catches 12 undelivered customers; fraud ticket logged.
- **Financial Outcome:** Final units adjusted to 18; driver penalized and suspended; 12 undelivered units refunded to warehouse.

**Flow 25: Operations Tower Conciliation & Binding Resolution**
- **Scenario:** Complex dispute over misprinted warehouse shipping labels causing delivery failures across Riyadh.
- **System Action:** Ops staff conducts conciliation hearing; reviews scan logs; executes `resolveDispute` with binding 28 units.
- **Financial Outcome:** Settlement unlocked; complaint resolved; ledger balances and executes payouts.

**Flow 26: Post-Fulfillment Clean Sign-Off & Auto-Completion**
- **Scenario:** Driver loads 30, delivers 30, returns 0; warehouse supervisor verifies and confirms in portal.
- **System Action:** Warehouse clicks `confirmDelivery(units: 30)`; offer marked `pending_settlement`; request auto-completes.
- **Financial Outcome:** Settlement generated instantly; escrow released; job queued for finance review and payout.

---

### Category 6: Financial Ledger, Escrow Release, Multi-Tier Payouts & Cancellations

**Flow 27: Standard Double-Entry Settlement & VAT Invoicing**
- **Scenario:** Clean completion of 30-parcel shift (600 SAR customer price, 420 SAR provider cost, 180 SAR JR fee).
- **System Action:** Finance reviews, separate finance manager approves (separation of duties); `payoutTx` executes.
- **Financial Outcome:** Warehouse charged 600 SAR; driver credited 420 SAR; JR fees credited 180 SAR; 15% VAT invoice issued.

**Flow 28: Under-Delivery Escrow Auto-Refund (Booked 50, Final 25)**
- **Scenario:** Warehouse booked 50 parcels (800 SAR reserved); only 25 parcels successfully delivered.
- **System Action:** Upon job completion, system detects 400 SAR unspent escrow; calls `releaseReserve`.
- **Financial Outcome:** 400 SAR instantly returned to warehouse wallet; driver paid for 25 units; customer charged 400 SAR.

**Flow 29: Logistics Office Payout Processing & Commission Split**
- **Scenario:** Shift completed by a driver linked to "Riyadh Courier Office".
- **System Action:** System routes 100% of provider cost into Courier Office wallet based on offer-time affiliation snapshot.
- **Financial Outcome:** Office receives aggregated payout batch and payroll breakdown report; office disburses driver salaries.

**Flow 30: Late Warehouse Cancellation Post-Arrival**
- **Scenario:** Driver arrives at warehouse at 07:55; warehouse cancels at 08:15 due to unexpected internal IT shutdown.
- **System Action:** Self-service cancellation blocked; Ops executes staff cancellation with warehouse indemnity.
- **Financial Outcome:** Driver awarded 50 SAR call-out fee from reserved escrow; remaining escrow refunded to warehouse.

---

### Category 7: Marketplace Matching & Capacity Edge Cases

**Flow 31: Preferred Office Window Expiry & General Market Spillage**
- **Scenario:** Warehouse requests preferred office with 15-minute priority window; office fails to assign within time.
- **System Action:** Priority window expires; maintenance cron updates request and broadcasts offers to all qualified Riyadh drivers.
- **Financial Outcome:** Slot captured by first valid open-market driver; warehouse pricing and escrow unaffected.

**Flow 32: Multi-Vehicle Enterprise Request (5 Vans Booked)**
- **Scenario:** Distribution center books 5 refrigerated vans for a seasonal grocery delivery surge.
- **System Action:** Escrow reserved for 5 vehicles; 5 drivers accept independently; each offer executes autonomous lifecycle.
- **Financial Outcome:** If 1 driver no-shows, only that slot re-opens; remaining 4 vans operate uninterrupted; clean per-vehicle settlement.

### Category 8: Providers, Payments, Cash Risk, Privacy, Legal & App Update (Update L)

**Flow 33: Top-Up by Card (PayTabs)**
- **Scenario:** A company adds funds from its wallet page; the card is typed on PayTabs' own page.
- **System Action:** The platform asks PayTabs itself (never trusting the callback alone) and credits the wallet once.
- **Financial Outcome:** Wallet `available` + the paid amount; ledger key `paytabs:<intent>`.

**Flow 34: Top-Up by Bank Transfer**
- **Scenario:** The company transfers money, uploads the receipt and the bank reference.
- **System Action:** Finance (`topups.manage`) approves (optionally with the amount received) or rejects with a reason.
- **Financial Outcome:** Credited once on approval (`banktopup:<id>`); the company is notified.

**Flow 35: Cash-Risk Limits**
- **Scenario:** A driver holds SAR 3,000+ of cash on delivery, or cash older than 3 days.
- **System Action:** Warning at 80 %; over the limit or overdue: no new offers (`CASH_LIMIT`), withdrawal limited to balance minus overdue cash (`CASH_OUTSTANDING`); handing the cash over lifts it at once.
- **Financial Outcome:** No money moves; the wallet is protected by the lien.

**Flow 36: Delivery with SMS Off**
- **Scenario:** The super admin has not enabled SMS.
- **System Action:** Nothing is texted and the recipient's delivery code is not demanded; the driver scans the parcel code (and signature where required).
- **Financial Outcome:** Unchanged.

**Flow 37: Terms Re-Acceptance**
- **Scenario:** A new version of a legal document is published with "require re-acceptance".
- **System Action:** Every affected user is blocked until he accepts the new version.
- **Financial Outcome:** None.

**Flow 38: Privacy Export and Erasure**
- **Scenario:** A person downloads his data, then asks to be erased.
- **System Action:** Blockers are shown; staff approve; the account is anonymised in one transaction.
- **Financial Outcome:** Ledger and invoices stay, without identifying the person.

**Flow 39: Forced App Update**
- **Scenario:** The owner sets a minimum app version.
- **System Action:** Older app builds get `426 UPGRADE_REQUIRED` and an update screen with the store link.
- **Financial Outcome:** None.
