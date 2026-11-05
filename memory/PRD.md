# JR Logistics — Product Requirements Document

**Status:** Reconstructed target specification for owner review  
**Source:** `Pasted markdown.md` (371 lines, implementation notes dated June–October 2026)  
**Version:** 1.0 · 5 November 2026

> **Evidence convention.** **[S] Source-recorded** means the source asserts that behavior was implemented or tested; this is not an independent audit. **[T] Target** is a requirement reconstructed from the record. **[D] Decision** requires owner confirmation. Do not treat a dated implementation note as proof that the current deployment still behaves that way.

## 1. Executive summary

JR Logistics is a Saudi logistics marketplace and operations platform connecting businesses that need logistics capacity with independent drivers/providers and courier offices. Its product history starts with nine logistics categories, narrows to a delivery-driver MVP, and later records enabled car-with-driver, car-without-driver, and courier-office workflows. The intended current product must therefore be confirmed before implementation: this PRD treats the latest recorded scope as the **target candidate**—delivery drivers plus two vehicle services and office participation—while preserving delivery-only as the originally selected MVP baseline. [D]

The platform manages service catalog and pricing, request publication, matching/assignment, job execution and custody, exceptions and complaints, financial settlement, reporting, and integrations. Money, identity, tax, legal and service-level rules must remain configurable or explicitly pending until approved. Historical simulated wallet/payment behavior is not evidence of a real payment integration.

## 2. Product vision and problem

**Vision [T]:** Give Saudi businesses one accountable digital workflow to procure, coordinate, and reconcile temporary logistics capacity, while giving drivers and courier offices clear job terms, operational communication, and transparent earnings.

**Problem [T]:** The source describes fragmented request, matching, attendance, quantity-dispute, communication, custody, settlement, and reporting needs. Businesses need predictable cost and visibility; workers need accurate job requirements and net earnings; operations/finance staff need traceable exceptions and approvals. These are source-grounded product needs, not validated market research.

## 3. Users and stakeholders

| Persona | Needs / capabilities in target |
|---|---|
| Business requester | Register and verify; create, price, save, publish, track and cancel jobs; confirm work/quantity; communicate; manage wallet or approved payment method; rate, complain, report, and integrate by API. |
| Direct driver/provider | Maintain profile, vehicle/temperature capability, documents, availability; receive compatible offers; accept/decline, arrive, confirm attendance/loading, report delivered quantity, dispute, manage custody, chat, view earnings, request payout, complain. |
| Courier office | Manage office profile, agreements, linked drivers, jobs, documents, support, reports, financials and office settlements; invite/link eligible drivers and replace assignments subject to permission. |
| Operations/support staff | Triage tickets/cases/complaints, communicate, monitor late/at-risk jobs, rematch/replace, record decisions and maintain audit trail within permissions. |
| Finance/accountant | Review settlement evidence, approve payout, reconcile batches, invoices and financial reports. Separation of duties is an owner decision. |
| Admin/super admin | Configure catalog, pricing, areas, terms, policies and thresholds; manage users/staff/permissions, verification, assignments, settings, financial controls, audit and reporting. |
| External business system | Create/list jobs and receive event webhooks using scoped, revocable credentials. |

**Roles are not synonymous.** Business, driver/provider, office, staff, admin and super admin must be modeled distinctly. A driver can be platform-owned/direct or office-affiliated. [S] The exact role/permission assignments require approval. [D]

## 4. Goals, non-goals, success measures

### Goals [T]
- Specify one coherent, auditable request-to-close workflow across enabled service types.
- Ensure offers, price, provider cost, expected net, and settlement inputs are consistent and snapshotted.
- Prevent incompatible/overlapping assignments and protect contact/document data.
- Give operations and finance actionable queues, evidence, and permission-scoped controls.
- Support Arabic-first RTL, English LTR, and Urdu RTL without raw translation keys.

### Non-goals until separately approved [D]
- Claiming production readiness, real SMS, payment, storage, VAT compliance, or a real call relay.
- Expanding to all nine original categories (warehouse labor, loading, sorting/packing, inventory counting, event staff, other logistics services) absent explicit scope selection.
- Automating legal determinations, tax advice, insurance, worker classification, or guaranteed SLA.
- Defining prices, commissions, penalties, VAT rate, settlement periods, or cancellation consequences without owner-approved policy.

### Measures (targets to set) [D]
Track request completion and cancellation by service/city; time to first compatible offer and fill rate; on-time pickup/delivery; replacement rate; quantity-dispute and complaint rates/resolution time; business repeat use; driver utilization/earnings/payout time; pricing-rule misses; settlement reconciliation variance; API/webhook success; verification backlog; support case age. Establish baselines and numeric targets with owner before launch.

## 5. Scope and phases

| Phase | Candidate scope | Evidence / status |
|---|---|---|
| Historical concept | Nine categories and full marketplace workflow. | [S] Original vision only. |
| Historical MVP | Delivery drivers only; other service types hidden. | [S] June 16 record. |
| Later expansion | `car_with_driver` and `car_without_driver` enabled; driverless rental bypasses matching; temperature-aware vehicle catalog. Office, API, custody, complaints, operations and finance workflows recorded. | [S] June–October record; current deployment unverified. |
| Owner acceptance | Validate enabled product, complete E2E, pricing/financial rules, legal/operational policies and external integrations. | [T][D] Required before implementation is treated as launch scope. |
| Future | Re-enable other original categories only after separate workflows, pricing, staffing, safety and acceptance criteria are approved. | [D] |

## 6. Core journeys

1. **Onboard:** user selects role, registers using approved authentication, accepts versioned terms, submits required profile/documents, and sees verification status and missing items. Business publishing and driver participation are gated by applicable verification rules. Exact gates need owner confirmation.
2. **Price and request:** business selects service, pickup/delivery city/area, date/time/duration, vehicle/temperature, quantity and service-specific details. System resolves an applicable approved rule, shows a transparent estimate and restrictions, records a price snapshot, then saves draft or publishes after required terms/funds/approval gates.
3. **Assign:** system offers only eligible providers using compatibility, availability, location, active-job/time overlap and affiliation rules. Operations may manually or smart-assign with a recorded reason. First valid acceptance locks the slot atomically. Driverless rental does not create driver offers.
4. **Execute:** assigned worker sees full authorized job details; arrival, attendance, loading/custody, delivered quantity and confirmation/dispute are recorded as distinct events. Do not assume loaded quantity equals delivered quantity. In-app job room, masked-contact action and urgent help link are available where applicable.
5. **Resolve and close:** exceptions enter operations/complaints workflows; replacement follows compatibility and slot-lock rules. Completion and financial release are gated on required confirmations, dispute resolution, accountant approval and configured settlement process.
6. **Reconcile and improve:** parties view job history, ratings, invoices/records, wallet/settlement status and reports; authorized staff audit changes and export/report. API clients can query jobs/events and receive configured webhooks.

### Driver mobile journey (Flutter) [T]

Drivers use a dedicated Flutter mobile app to review assigned shipment details, manage shipment progress, and request an optimized stop order/route using Google Maps Platform. The app provides WhatsApp redirect buttons with ready-to-send message text; it hands off to WhatsApp and does not send or monitor messages itself. “Perfect contact” is therefore limited to a reliable, context-aware handoff, accurate customer details permitted by policy, and clear fallback when WhatsApp is unavailable or the recipient does not respond.

1. Driver signs in and sees assigned/upcoming shipments, required shipment details, status and navigation actions.
2. For a multi-stop route, driver selects eligible stops and asks for the best route. The system returns the ordered stops and route estimates; the driver reviews and starts navigation.
3. At a shipment, driver opens WhatsApp using a prefilled, localized message for the permitted customer contact, then returns to JR Logistics to record progress/exception. No customer message is represented as delivered/read by JR.
4. Driver reports inability to contact or a shipment exception through the in-app operations flow.

Shipment detail visibility must include every field operationally required to fulfill the assigned shipment, subject to role, assignment, and privacy policy. The exact field list (including customer name/phone, address, notes, shipment contents, quantities, time window, and instructions) must be approved; show the customer number only as required for WhatsApp handoff. [D]

## 7. Product capabilities and business rules

### Catalog and geography
- Maintain service catalog and enabled/hidden status. Original nine categories are historical; delivery and later vehicle services are source-recorded. [S]
- Vehicle catalog evolved from sedan/van to sedan, dokker, hiace, van and dyna, with dry/cold capability in some categories. Canonical valid combinations and service applicability require confirmation. [S][D]
- Source records Riyadh-only pickup phase with configurable delivery cities/areas. Actual supported city/area list and expansion plan are unknown. [S][D]

### Pricing and financial model
- Resolve most-specific active pricing rule across service, vehicle/temperature, pickup/delivery city and business override, falling back to global rule only as configured. Source records effective date, expiry, version, agreement reference, provider cost, price and immutable request snapshots. [S]
- Block publication when no approved applicable rule exists. Show customer price, provider cost where authorized, expected margin, commission/fees, provider net, quantity assumptions and total. Never expose provider cost/margin to business or driver unless explicitly authorized. [T]
- Rules must define whether unit is per shipment, driver, hour, trip, rental period or other; taxes/fees, rounding, adjustments, caps and overrides are owner decisions. [D]
- Commission history conflicts: initial 10%, then 0% default with net=gross note. Treat current commission as **unresolved**, not an implicit permanent zero. [S][D]
- Historical escrow/top-up was simulated; later finance/settlement and payout batches are recorded. Source says direct-driver settlement pays rule provider_cost and office path differs; operational semantics and actual payment status require confirmation. [S][D]
- No real gateway, VAT invoice PDF, or real SMS is claimed in source; payment, tax, invoice and provider integration are launch decisions. [S][D]

### Job lifecycle, attendance and disputes
The source records several evolutions. Target workflow must preserve distinct request, assignment, execution, quantity review and finance states. The state machine in the SRS is normative candidate, subject to owner approval. Do not use “completed”, “settled”, “paid” interchangeably.

### Matching, cancellation and replacement
- Candidate eligibility includes service, verification/provider eligibility, city/area, vehicle/temperature, availability, workload/time overlap and suspension. Source records single-active-job behavior in one iteration and overlap rules in another; exact concurrency rule is unresolved. [S][D]
- Smart scoring may rank eligible candidates but must not silently override hard eligibility guards; provide explainable factors to authorized operations users. [T]
- Cancellation source records weekly limit 3 and earlier thresholds (warning 2, suspension at 4 for 3 days), configurable thresholds/days, but policy versions conflict. Do not enact penalties until owner confirms final policy and appeal process. [S][D]
- Replacement excludes busy/incompatible drivers and uses first-accept-wins locking; retain assignment history. [S]

### Operations, privacy and support
- Job room contains timeline, role-checked messages, masked-contact action, linked urgent tickets, complaints, custody and SLA indicators. Contact relay is described as relay-ready/hook only, not proven live. [S]
- Collect only needed contact/location/document data; reveal phone/contact fields by approved stage and role. Source records phone masking until offer accepted. Exact visibility matrix and retention need approval. [S][D]
- Complaint lifecycle includes party-only creation, open/in-progress/resolved/closed, handler, notes, resolution and history. Resolution SLA/compensation is not defined. [S][D]
- Custody supports item handover, driver confirmation and returned/not returned/damaged outcome. Item ownership, liability, evidence and dispute rules require approval. [S][D]

### Roles, verification, policy and audit
- Distinct password-based admin/staff login versus phone OTP for business/driver is source-recorded. OTP is mocked and privileged OTP login blocked in the recorded design. [S] Target auth provider, OTP abuse protection, identity verification and recovery remain unapproved.
- Role/permission enforcement is server-side, least privilege, with staff permission scopes and sensitive-action audits. Source records audit log, versioned terms consent, document verification, approval requests for more info, and suspension controls. [S]
- Define document types, verification criteria, expiry behavior, data retention, consent text/version, cancellation and dispute policy with owner/legal input. Do not invent legal requirements.

### Driver mobile, routing and WhatsApp
- Build the driver-facing mobile app in Flutter. It consumes the same authorized job lifecycle and server-side permissions as the web platform; it must not create a parallel source of truth. [T]
- Show all information the assigned driver needs to execute the shipment, with privacy-safe access limited to assigned jobs and approved fields. [T][D]
- Use Google Maps Platform route optimization to optimize the driver’s stop sequence and provide route details. A small multi-stop route may use Routes API waypoint optimization; fleet-wide assignment, capacity/time-window constraints, or multi-vehicle dispatch may require Route Optimization API. The exact API, constraints, billing and Google Cloud setup must be confirmed. [T][D]
- Present optimized order/estimated route clearly and let drivers review it before opening navigation. Do not claim that an optimization is globally “best”; results depend on provided stops, objectives, constraints and Google’s returned data.
- Provide WhatsApp redirect buttons with ready messages (for example: contact customer, arriving, delivery issue) using an OS/app handoff and prefilled text. WhatsApp sends the message; JR Logistics does not send it, confirm delivery/read status, capture replies, or expose a live chat. Handle missing WhatsApp, cancellation, and return-to-app gracefully. [T]
- Message wording and languages, whether the contact number is pre-addressed, customer-consent/privacy rules, and behavior when no response are owner decisions. [D]

### API, webhooks and notifications
- Source records business API keys (`jrk_`, hash stored, max five, revoke), `X-API-Key`, `/api/v1/jobs` create/list/detail/events, request reuse, webhook URL and delivery records. [S]
- Define scopes, idempotency, pagination, rate limits, key rotation, retry/backoff, signatures, event ordering, payload minimization and webhook SSRF protections before external launch. These details are not fully specified in source. [T][D]
- Notifications cover request, acceptance, replacement, arrival, exceptions and completion; channel delivery guarantees/preferences are unresolved. Push is backlog. [S][D]

## 8. UX, accessibility and localization

Arabic-first, RTL; English LTR; Urdu RTL. Source reports AR/EN/UR parity checks, with missing Urdu admin/office translations falling back to Arabic; make remaining translation completeness a release gate. [S][D] Preserve language preference, direction, numerals/date display and accessible status labels. Use clear, role-specific dashboards and direct links from metrics to actionable queues. Provide responsive layouts, keyboard access, readable contrast, loading/empty/error states and no raw localization keys. Brand direction in source: navy/emerald/gold and IBM Plex Sans Arabic/Tajawal; branding may evolve independently of functional acceptance.

## 9. Dependencies and assumptions

- Existing code/deployment and database are authoritative for current behavior; inspect before changing. Source names FastAPI, MongoDB, React, but architecture may have changed. [S][D]
- Availability of SMS, payment, object storage, maps, contact relay, email/push and external business systems is not assured.
- Owner supplies approved service scope, price schedules and provider costs, commission/fees, tax settings, verification rules, terms, cancellation/complaints policies, geographic catalogs and settlement authority.
- Sensitive data is not reproduced in this specification. Development credentials and real phone/email values in source are intentionally omitted.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Conflicting scope and money rules | Decision register; block affected launch behavior until approved. |
| Old implementation notes mistaken for live truth | Inspect code/config/DB and verify each claimed behavior in a safe environment. |
| Incorrect settlement, quantity or rental accounting | Immutable snapshots, explicit state gates, ledger reconciliation, finance approval and scenario tests. |
| Unauthorized PII/contact/document exposure | Server-side authorization, field-level serialization, access audit, retention controls and negative tests. |
| Destructive reset/seed behavior | Backup, restore verification, environment guard, dry run, explicit approval; never delete production data automatically. |
| Mock integrations presented as real | Label simulation, isolate adapters, fail clearly when provider unavailable, no fabricated success. |
| Translation and operational inconsistency | Translation parity checks and role-by-role E2E in AR/EN/UR. |
| Unclear liability/SLA/tax policy | Owner/legal/finance confirmation before enforcement or public claims. |

## 11. Acceptance criteria

A release candidate is acceptable only when:
- Owner-approved enabled service catalog and geography are reflected consistently in UI, API, validation and matching.
- Every published request has an applicable approved price snapshot; later rule edits do not mutate historical job economics.
- Role/permission and affiliation rules are enforced server-side; sensitive PII and financial fields are masked from unauthorized roles.
- Request, offer, arrival, attendance/loading, delivered quantity, dispute, completion, review, settlement and payout states have guarded transitions and audit events.
- Duplicate acceptance/settlement is prevented under concurrency; retries are idempotent where money or assignment can be affected.
- Disputes block settlement until authorized resolution; payout requires configured approval and produces reconciliation evidence.
- Cancellation, replacement, custody, complaint and SLA calculations follow owner-approved policy and are explainable.
- API/webhook behavior is documented, authenticated, revocable, observable, and tested without representing mocks as real integrations.
- Flutter driver app exposes assigned shipment details within approved privacy rules, supports Google route optimization review/navigation, and hands off WhatsApp prefilled messages without claiming message delivery.
- All supported screens have complete AR/EN/UR strings (or an explicitly approved fallback), correct direction, and actionable empty/error states.
- Backup/restore and reset/seed safety are demonstrated in non-production; production data is never destroyed without approval.
- Tests map to SRS requirement IDs; historic test counts in source are not substitutes for current verification.

## 12. Prioritized backlog

**P0 — owner decisions / launch blockers:** confirm active service scope; commission and financial model; direct/office settlement; payment and top-up semantics; VAT/invoice obligations; final state transitions and dispute authority; geographic and vehicle catalogs; verification/terms/cancellation rules; payout approvals; owner-controlled E2E on current preview; real-vs-simulated integration labels; production backup and restore plan.

**P1 — operational readiness:** build Flutter driver app, integrate the selected Google route API, and implement WhatsApp handoff templates; implement approved SMS/payment/storage adapters; OTP rate limiting and abuse controls; VAT/invoice generation only after tax rules confirmed; complete Urdu admin/office translation; API scopes/idempotency/rate limits/webhook signatures/retries; notification delivery policy; documented reporting definitions and settlement reconciliation.

**P2 — improvements:** push notifications; masked-call relay provider; calendar/time picker polish; expanded categories after dedicated discovery; richer SLA and operational analytics.

## 13. AI implementation guide

1. Inspect the existing repository, configuration, migrations, tests and deployment before editing; distinguish live behavior from this specification.
2. Implement vertical slices: catalog/pricing → request → assignment → execution → exception/dispute → finance → reporting/integrations, with UI, API, data, authorization and tests in each slice.
3. Preserve backward compatibility and historical snapshots; use migrations and explicit deprecation plans.
4. Do not run destructive resets, delete operational records, overwrite credentials, or mutate production data without explicit owner approval and verified backup/restore.
5. Add tests for each accepted SRS requirement and negative authorization/transition cases. Do not claim tests pass unless actually run and report which were run.
6. Do not fake SMS, payment, storage, VAT, relay, map or webhook integrations. Label demos, use adapter boundaries, and report unavailable dependencies clearly.
7. Ask focused owner questions when unresolved decisions block behavior; do not invent policy, legal, tax, pricing or SLA rules. Keep a decision log and update both specifications when approved.
