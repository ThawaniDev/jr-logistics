# JR Logistics — Software Requirements Specification

**Status:** Reconstructed target specification for owner review  
**Source:** `Pasted markdown.md` (371 lines; dated implementation/operation record)  
**Version:** 1.0 · 5 November 2026

> **Evidence convention:** **[S]** source-recorded implementation/history, not independently verified; **[T]** target requirement inferred from the source; **[D]** owner decision required. This SRS describes a candidate target, not a claim that current code is production-ready. Validate the deployed code and database before implementation.

## 1. Purpose and scope

Specify observable system behavior for a Saudi logistics marketplace with business, direct-driver/provider, courier-office, staff, admin and super-admin actors. Historical scope: nine categories → delivery-only MVP → later enabled vehicle services and office/operations/finance capabilities. Until the owner resolves scope, treat delivery plus `car_with_driver` and `car_without_driver` as candidate current scope and do not silently enable the other six historical categories. [S][D]

## 2. System context and architecture constraints

Source-recorded stack: FastAPI backend, MongoDB, React frontend, `/api` prefix; routers for auth, business, worker, admin, common, custody, complaints and integrations are mentioned. [S] This is a historical observation. The target is a modular client/server system with authenticated API, durable persistence, role-scoped web UI, notification/integration adapters, object/file storage abstraction, audit/event history and operational telemetry. [T]

Do not prescribe a migration to a new framework or database without evidence. Preserve string UUID-style public IDs if compatible with current code. Keep pricing, matching, lifecycle, finance, messaging and integrations behind separable modules/interfaces. Financial effects require transactional/idempotent behavior appropriate to the actual datastore; if atomic multi-record guarantees are unavailable, design explicit ledger/outbox/reconciliation patterns. [T]

**Trust boundaries:** public unauthenticated catalog/auth; authenticated business/provider/office; staff/admin control plane; external API clients; webhook receivers; file storage; third-party SMS/payment/map/relay providers. Validate and authorize at server boundaries regardless of UI controls.

## 3. Actors and permissions model

`Allow` is a capability to be granted only by configured permission; this table is a target baseline, not a claim of existing exact grants. `Own` means own/assigned/linked records only.

| Capability | Business | Direct driver | Office | Operations/support staff | Finance staff | Admin/super admin |
|---|---:|---:|---:|---:|---:|---:|
| Manage own profile/docs | Own | Own | Own | Assigned scope | Assigned scope | Allow |
| Create/view business requests | Own | — | As configured | View assigned | View financial scope | Allow |
| Accept/execute offer | — | Own/assigned | Linked driver administration only | No impersonation | — | Allow only via audited action |
| Job chat/events | Own job | Own job | Linked/authorized job | Assigned cases | Financial evidence as needed | Allow |
| Confirm quantities/raise dispute | Own business side | Own driver side | If authorized party | Record/resolve per policy | Review evidence | Allow by permission |
| Verify documents/users | — | — | Submit/view own scope | Assigned verification | — | Grant/revoke |
| Pricing/settings | — | — | Agreement data only | No | Read approved financial config | Configure |
| Settlement/payout | View own status | View/request own payout | View office settlement | No approve by default | Review/approve by policy | Configure/override with audit |
| API keys/webhooks | Own business | — | If office account supported | — | — | Revoke/administer |
| Complaints/custody | Party's own | Party's own | Party's linked jobs | Handle assigned | View financial impact | Configure/override |

All staff permissions must be explicit, least-privilege, revocable and server-enforced. Segregation between settlement creator/reviewer/approver is [D]. Super-admin bootstrap/password lifecycle is [S], but secrets must come from protected environment/secret management and never be seeded into documentation.

## 4. Functional requirements

Each requirement has a unique ID and a verifiable acceptance condition. Priority: P0 launch control, P1 core target, P2 enhancement. Evidence in the final column uses [S]/[T]/[D].

### Identity, access, verification and consent

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| AUTH-001 | Support approved authentication methods by role. Historical design uses phone OTP for business/provider and separate password portal for staff/admin. | Tests show valid and invalid flow per role; privileged roles cannot authenticate through a disallowed route; no OTP/secret leakage. Provider and production mode are explicit. | P0 [S][D] |
| AUTH-002 | Enforce server-side role and permission checks on every protected operation. | Unauthenticated and wrong-role requests receive consistent 401/403; UI hiding alone never grants access. | P0 [S][T] |
| AUTH-003 | Protect login against brute force, enumeration and OTP abuse; define session expiry/revocation. | Configured rate/lockout controls are verified; logout/revocation invalidates session; responses do not reveal account existence. Exact thresholds [D]. | P0 [S][D] |
| AUTH-004 | Require versioned terms consent where configured and preserve immutable evidence. | Record user, role, terms version, accepted time and permitted request metadata; consent cannot be edited in place; publishing/participation is gated according to approved policy. | P0 [S][D] |
| VER-001 | Support profile and document submission, expiry validation, review, request-more-info, approval and rejection states. | Invalid date rejected; status, reviewer and decision history visible only to authorized roles; business/provider gates follow approved rules. | P0 [S][D] |
| VER-002 | Prevent unauthorized document access and define storage adapter behavior. | Owner/authorized reviewer can retrieve; unrelated roles cannot; storage outage returns controlled error; fallback is explicitly configured and persistent. | P0 [S][T] |

### Catalog, pricing and request management

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| CAT-001 | Provide configurable catalog of services and enabled state. | UI/API/matching use the same enabled set; disabled service cannot be submitted through direct API. Owner resolves nine-category vs three-service scope. | P0 [S][D] |
| CAT-002 | Validate vehicle and temperature capability against selected service and pricing rule. | Only configured combinations appear and API rejects invalid combinations. Canonical catalog must be approved. | P0 [S][D] |
| CAT-003 | Provide configurable pickup/delivery city and area catalogs. | Out-of-scope pickup/delivery is rejected with clear explanation; exact initial scope (Riyadh pickup) is configurable and confirmed. | P0 [S][D] |
| PRICE-001 | Resolve a current approved price rule by applicable service, vehicle/temperature, origin/destination and business override/global fallback. | Deterministic match selects most-specific valid rule; expired/future/unapproved rules cannot resolve; no rule blocks publication. | P0 [S][D] |
| PRICE-002 | Snapshot all pricing inputs and outputs on request creation/publication. | Later rule edits do not alter historical snapshot; snapshot includes rule/version, units, customer price, provider cost if applicable, currency, effective/expiry and computation inputs. | P0 [S][T] |
| PRICE-003 | Display role-appropriate price breakdown and protect margin/provider-cost fields. | Business sees approved payable breakdown; provider sees approved expected earning; only finance/admin sees provider cost/margin; API serialization tests confirm masking. | P0 [S][T] |
| PRICE-004 | Calculate totals using owner-approved units, rounding, tax/fee and quantity rules. | Boundary tests cover rounding, zero/invalid quantities, caps and adjustment; no default legal/tax/pricing policy is invented. | P0 [D] |
| PRICE-005 | Apply the owner-approved commission/fee configuration and snapshot it. | Explicit approved setting drives quote and settlement; source conflict (10% then 0%) appears as unresolved until signed off. | P0 [S][D] |
| REQ-001 | Allow eligible business to create, save draft, edit permitted fields, preview, publish and view a request. | Required fields validated; draft is not offered; publish performs funds/terms/approval/price checks and returns stable request ID. | P0 [S][T] |
| REQ-002 | Capture service-specific quantity, schedule, duration, area, vehicle/temp, shipment assumptions and contact instructions. | Field requirements are driven by service schema; driverless request does not require driver-only fields. Exact service schema [D]. | P0 [S][D] |
| REQ-003 | Support business-specific price override only where authorized and preserve approver/justification. | Unauthorized user cannot alter override; resulting immutable snapshot includes source and approval. | P1 [S][T] |
| REQ-004 | Filter and paginate request lists without silent truncation. | Stable pagination/filter tests cover city/date/status and records above historical caps (200/1000); counts and pages agree. | P1 [S][T] |
| REQ-005 | Support cancellation with reason and approved policy evaluation. | Valid cancel creates linked cancellation/event/audit record and invokes configured replacement/refund/fee behavior; policy thresholds remain configurable and owner-approved. | P0 [S][D] |

### Matching, assignment and job execution

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| MATCH-001 | Match only eligible providers by service, verification, geography, vehicle/temp, availability, suspension and conflict rules. | Every candidate meets hard constraints; exclusion reasons can be inspected by authorized operations; overlap policy is approved and consistently enforced. | P0 [S][D] |
| MATCH-002 | Rank eligible candidates using explainable configured factors. | Same inputs yield deterministic ranking or documented tie-break; score factors are visible to authorized staff; score cannot bypass eligibility. | P1 [S][T] |
| MATCH-003 | Support offer accept/reject/apply and manual assignment where policy permits. | Acceptance checks current slot and eligibility atomically; concurrent accept attempts produce exactly one assignment; every action is attributed. | P0 [S][T] |
| MATCH-004 | Keep direct and office-affiliated provider affiliation explicit. | Assignment/report/payment path uses affiliation snapshot and valid office link; changes later do not rewrite historical job affiliation. | P0 [S][D] |
| MATCH-005 | Support replacement and preserve assignment history. | Replacement excludes incompatible/busy providers, uses atomic first-accept-wins, records offered/accepted/cancelled/no-show/replaced transitions and actors. | P1 [S][T] |
| JOB-001 | Record arrival/check-in separately from acceptance and completion. | Check-in records actor/time/location only if location capture is approved; duplicate/reversed actions follow policy and are audited. | P0 [S][D] |
| JOB-002 | Record business attendance confirmation and loaded quantity independently. | Authorized business/warehouse actor confirms attendance and loading; quantity and evidence are timestamped; no implicit equivalence to delivered quantity. | P0 [S][T] |
| JOB-003 | Require provider delivered-quantity report after loading confirmation. | Finish request requires valid quantity and records expected, loaded and delivered values with actor/time. | P0 [S][T] |
| JOB-004 | Require business confirmation or dispute of delivered quantity. | Confirmation sets final quantity; dispute blocks settlement and creates urgent linked case; transitions are audited. | P0 [S][T] |
| JOB-005 | Complete job only after service-specific required actions and resolved quantity state. | API rejects premature completion; completion is idempotent and creates exactly one settlement intent/event. | P0 [S][T] |
| JOB-006 | Support custody issue/return status per item. | Handover requires item/actor/time; provider confirms; each item ends returned/not returned/damaged or configured state; unresolved issue can block closure only if owner chooses. | P1 [S][D] |
| JOB-007 | Provide chronological job event timeline with actor, role, event, prior/current state and timestamp. | Events are append-only to normal users; authorized correction creates compensating event; timeline order is stable. | P0 [S][T] |
| JOB-008 | Enforce a configurable active-job/overlap policy. | Availability/offer/accept behavior matches approved rule; concurrent schedule boundaries and time zones are tested. Source records both one-active-job and time-window overlap variants. | P0 [S][D] |

### Operations, communications, complaints and SLA

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| OPS-001 | Provide role-scoped in-app job messages and timeline. | Only parties and authorized staff can read/post; message edits/deletes follow retention policy; abusive content/reporting policy [D]. | P1 [S][D] |
| OPS-002 | Mask phone/contact details and offer relay action only through configured provider. | Unauthorized stage/role receives no raw contact data; provider outage is clear; no fake call success. | P0 [S][D] |
| OPS-003 | Create urgent operational tickets linked to business/request/offer/provider and event history. | Configured reason list validates; ticket appears in permitted queue; assignment/status changes audit. | P1 [S][T] |
| OPS-004 | Show live operations queue, at-risk/late jobs and configurable thresholds. | Threshold input is validated; alert calculation uses documented schedule/time zone; false/late statuses can be reproduced. | P1 [S][D] |
| OPS-005 | Compute SLA indicators from scheduled versus actual pickup/delivery timestamps. | on_time/late/missed/at_risk/on_track calculations have approved definitions and boundary tests; no contractual SLA claim is implied. | P1 [S][D] |
| CMP-001 | Allow a party to file a linked complaint/dispute and authorized staff to handle it through open/in_progress/resolved/closed. | Only party or delegated office can create; resolution requires a reason; history and handler assignments are audited; settlement hold rules are applied. | P0 [S][D] |
| CMP-002 | Define compensation/refund and appeal only from approved policy. | No automatic compensation or penalty is created without signed policy; amount, approver and evidence are recorded if enabled. | P0 [D] |

### Finance, settlement, invoices and reporting

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| FIN-001 | Maintain auditable financial entries for business charge, escrow/reserve (if used), platform fee, office earning, provider earning, refund/adjustment and payout. | Entries balance by configured accounting model; retries do not duplicate; source transaction links to request/snapshot and actor. | P0 [S][D] |
| FIN-002 | Separate simulated ledger from real payment state. | Demo top-up/escrow is prominently marked and cannot be mistaken for funds transfer; real provider adapter reports actual provider state only. | P0 [S][T] |
| FIN-003 | Gate settlement on completion, confirmed final quantity, no blocking dispute, approved economics and required reviewer. | Invalid preconditions prevent posting; approval records identity/time; dual control follows owner policy. | P0 [S][D] |
| FIN-004 | Apply direct-driver and office-affiliated settlement rules distinctly. | Each calculation references approved rule and affiliation snapshot; expected totals reconcile; exact office/direct basis confirmed by finance owner. | P0 [S][D] |
| FIN-005 | Support configured payout period and batch processing with per-item outcomes. | Batch is reproducible, idempotent, auditable; failed item remains visibly unpaid and retry-safe. Settlement period and approval policy [D]. | P1 [S][D] |
| FIN-006 | Expose wallet/earnings status without conflating pending, available, approved, sent and paid. | Status transitions reflect authoritative ledger/provider result; no success label before confirmation. | P0 [S][T] |
| FIN-007 | Generate invoice/financial record according to approved tax configuration. | Invoice records source snapshot and totals; PDF/VAT behavior is implemented only after tax owner confirms jurisdiction/rate/content/rounding. | P1 [S][D] |
| FIN-008 | Provide finance and operational reports, including SLA, custody, complaints, affiliations and cancellations. | Definitions, filters, permissions, timezone, pagination and totals are documented and match underlying records. | P1 [S][T] |
| FIN-009 | Support ratings for completed work with duplicate/rating policy. | Only authorized participants rate eligible job; repeat behavior follows policy; audit/immutability and visibility are tested. | P2 [S][D] |

### Flutter driver application, Google routing and WhatsApp handoff

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| MOB-001 | Provide a Flutter mobile application for drivers, authenticated through the approved driver identity/session mechanism. | Supported build targets and minimum OS versions are owner-approved; driver can sign in/out and session expiry/revocation is enforced; app uses backend authorization. | P0 [T][D] |
| MOB-002 | Show all operationally required details for shipments assigned to the authenticated driver. | Detail screen includes the owner-approved field set, status, schedule, locations, instructions and permitted customer contact; unassigned/other drivers cannot retrieve these fields through UI or API. | P0 [T][D] |
| MOB-003 | Let a driver request an optimized route/stop sequence for selected eligible assigned shipments using Google Maps Platform. | For a multi-stop case, app/backend submits approved stops/constraints, returns stop order and route estimates, and records optimization failure clearly; driver can review before navigation. Results are not described as guaranteed globally optimal. | P1 [T][D] |
| MOB-004 | Provide Google Maps navigation handoff for the selected route or stop. | Coordinates/addresses are validated; unavailable map app/API produces a clear fallback; no route is silently started with an incorrect stop order. | P1 [T] |
| MOB-005 | Provide WhatsApp redirect buttons with ready-to-send, localized messages for approved customer-contact scenarios. | Tapping opens WhatsApp (or compatible OS handler) with the approved recipient and encoded prefilled text; user must send in WhatsApp; app clearly handles WhatsApp unavailable and safely returns to the shipment. | P1 [T][D] |
| MOB-006 | Do not represent WhatsApp handoff as message transmission, delivery, read receipt or reply capture. | UI and event logs record only handoff initiation where technically available; no success/delivered state is shown without an authoritative supported signal. | P0 [T] |
| MOB-007 | Allow driver to return from a handoff and record progress, no-response or contact exception in JR Logistics. | App resumes the correct shipment; exception records actor/time/reason and routes to the operations workflow; no automatic status change is inferred from opening WhatsApp. | P1 [T] |
| MOB-008 | Keep shipment/customer data access scoped and minimize data passed into external apps. | Only assigned shipment and approved customer fields are available; WhatsApp URL contains only necessary recipient/message parameters; sensitive data is excluded from logs/analytics. | P0 [T][D] |

### Integrations, notifications and shared services

| ID | Requirement | Acceptance condition | Priority / evidence |
|---|---|---|---|
| INT-001 | Provide scoped, revocable business API keys; store only verifier/hash, show secret once. | Revoked/invalid key denied; owner scope enforced; key rotation works; maximum key count configurable/approved. | P1 [S][D] |
| INT-002 | Expose versioned job create/list/detail/events endpoints. | Contract defines schemas, errors, pagination, idempotency, auth scopes and version policy; API creates same valid domain job as UI. | P1 [S][T] |
| INT-003 | Deliver webhooks with authenticated signatures, bounded retries and delivery logs. | Receiver can verify signature; duplicate delivery is identifiable; retry/backoff/dead-letter policy and payload fields documented. | P1 [S][T] |
| INT-004 | Record integration request logs with secrets/PII redacted. | Authorized operators can diagnose status/latency without retrieving API secrets or unnecessary personal data. | P1 [S][T] |
| NOT-001 | Notify affected users of material lifecycle, verification, replacement, dispute, completion and payout events. | Correct recipient, locale and template; delivery status recorded; retries/preferences follow approved channel policy. | P1 [S][D] |
| SHR-001 | Provide common profile, catalog/defaults, wallet/status, notifications, health and support services. | Responses are role-filtered, versioned where external, and errors use stable codes. | P1 [S][T] |

## 5. Domain entities and data dictionary

Identifiers should be stable strings; timestamps stored in a consistent timezone (recommend UTC) and rendered in configured Saudi local time. Preserve immutable historical snapshots; names below are logical entities, not mandated collection names.

| Entity | Key fields / relationships |
|---|---|
| User | id, role, status, language, profile, verification state, affiliation type/office_id, created/updated; can own requests, offers, documents, credentials, wallets. |
| StaffPermission | user_id, permission set, scope, granted_by, timestamps; explicit grants/revocations. |
| Office | id, legal/display profile, verification, agreement, settings; linked providers and jobs. |
| ProviderProfile | user_id, service eligibility, vehicle/temp, city/areas, availability, documents, rating; direct/office affiliation. |
| BusinessProfile | user_id or organization_id, verification, addresses, pricing override, webhook configuration. |
| ServiceCatalogItem | key, localized labels, enabled flag, required fields, supported provider type. |
| VehicleCapability | vehicle key, temperature capability, service compatibility, active flag. |
| Area | city/area key, localized names, pickup/delivery enablement. |
| PricingRule | id, service, vehicle/temp, pickup/delivery, optional business, unit, price, provider_cost, currency, status, version, agreement_ref, effective_at, expiry_at, approver. |
| Request | id, business_id, service, schedule, origin/destination, quantities, status, terms/approval references, pricing_snapshot, cancellation/close times. |
| Offer/Assignment | id, request_id, provider_id, office_id snapshot, status, offered/accepted/replaced times, actor, expected earning snapshot. |
| JobEvent | id, request_id, offer_id, event_type, actor/role, old/new state, payload, occurred_at; append-only. |
| Attendance/QuantityRecord | request/offer IDs, attendance actor/time, loaded_qty, delivered_qty, final_qty, confirmation/dispute evidence. |
| CustodyItem | request/offer IDs, item type, handover actor/time, provider confirmation, return status/evidence. |
| Message | job, sender, body, timestamp, visibility; retention policy. |
| Ticket/Complaint | type, linked job/request/party, category, priority, status, handler, resolution, history. |
| TermsConsent | user, role, terms version, acceptance time, approved metadata. |
| Document | owner, type, storage reference, expiry, review state, reviewer, timestamps; never expose raw storage key publicly. |
| LedgerEntry/Settlement | request, snapshot, account category, amount/currency, state, source/actor, idempotency key, approval evidence. |
| PayoutBatch/Payout | period, included settlements, totals, per-item result, approver, provider reference. |
| Invoice | request/settlement, parties, tax config snapshot, line items, totals, issue status and file ref. |
| APIKey/WebhookDelivery | business, key hash/scopes/revoked time; endpoint config and delivery attempt status. |
| AuditLog | actor, action, entity, before/after or safe diff, timestamp, request correlation; immutable to ordinary admins. |
| Notification | recipient, event, locale/channel, payload reference, status, attempts. |

## 6. State machines and transition guards

These are target candidate states reconstructed from source. Exact legal/financial meaning requires owner confirmation. Every state change must be actor-authorized, validated server-side, idempotent for retries, and represented in an audit/event trail.

### Request/job composite lifecycle

`draft → pending_approval (if configured) → published → filling → assigned/confirmed → in_progress → delivered_reported → pending_settlement → completed → settlement_approved → payout_pending → paid`

Alternate terminal/exception states: `cancelled`, `expired`, `qty_disputed`, `on_hold`, `rejected`, `no_show`, `replacement_requested`. Source also mentions `confirmed` for driverless rental publish. Do not force all service types through identical states.

| Transition | Guard / effect |
|---|---|
| draft→published | Eligible business, required terms/approval, valid active price snapshot, valid schedule/catalog, required funds only if approved financial model. Trigger matching for staffed services; skip driverless matching. |
| published→filling | Open staffed slots; create offers from eligible candidates. |
| filling→assigned/confirmed | Atomic first valid acceptance; slot available; provider eligible; overlap rule passes. |
| assigned→in_progress | Required arrival/check-in/attendance conditions as configured. |
| in_progress→delivered_reported | Loading confirmed; provider submits delivered quantity. |
| delivered_reported→pending_settlement | Authorized business confirms final quantity; if dispute, go `qty_disputed` and hold finance. |
| qty_disputed→pending_settlement | Authorized resolution records final quantity and resolution evidence. |
| pending_settlement→completed | All required offers ready; settlement created once; finance approval gate controls financial posting. |
| completed→settlement_approved→payout_pending→paid | Approved settlement and payout provider/ledger confirms each step. `paid` only after authoritative success. |
| any allowed active state→cancelled | Party/role/policy permits; record reason, financial effect and replacement path. Exact policy [D]. |
| assigned/in_progress→replacement_requested→filling | Authorized cancellation/no-show/operations reason; release/retain slot and funds per policy; preserve assignment history. |
| driverless published/confirmed→completed | Rental-specific fulfillment evidence and approved revenue/tax calculation; no offers/offices. Exact lifecycle [D]. |

### Supporting state machines

- **Offer:** `offered → accepted | rejected | expired | cancelled`; later `arrived → attendance_confirmed → loading_confirmed → delivered_reported → pending_settlement`; dispute state blocks settlement. Exact mapping between request and offer states should be normalized during implementation.
- **Verification:** `missing → submitted → under_review → approved | rejected | info_requested → resubmitted`. Expired approved documents return to action-required state according to policy.
- **Complaint:** `open → in_progress → resolved → closed`; resolution required to resolve; reopen/appeal policy [D].
- **Custody item:** `prepared → handed_over → acknowledged → returned | not_returned | damaged`; definitions and closure block rules [D].
- **Settlement/payout:** `pending_review → approved → batch_ready → processing → paid | failed | reversed`; retry/reversal creates traceable records, not destructive edits.
- **API key:** `active → revoked`; revocation effective immediately.
- **Webhook delivery:** `queued → delivering → delivered | retry_wait → dead_letter`; exact retry policy [D].

## 7. API contract inventory

Source-referenced routes below are evidence, not a guaranteed current contract. Preserve existing routes where practical and version breaking external APIs. All write endpoints require authentication/authorization, schema validation, stable error envelope and correlation ID.

| Area | Source-referenced endpoints / target contract |
|---|---|
| Auth | OTP send/verify/register/me/logout; admin password login; change password. OTP is source-recorded as mocked; do not expose actual OTP in production. |
| Common | profile, wallet, notifications, tickets, catalog/defaults, health; `GET/PATCH /api/admin/settings` and public `GET /api/catalog/defaults` are source-recorded. |
| Business | requests CRUD, estimate, publish (`POST /requests/{id}/publish`), matching, confirm, attendance/no-show/replacement, completion/settlement, cancel/refund, rating, top-up, overview. Exact route methods/schemas must be extracted from current code. |
| Worker | availability, offers/open jobs, accept/reject/apply, check-in, finish with delivered quantity, history, withdrawals, rating, cancel with reason. |
| Admin/office | stats, users, requests/manual match/smart suggest, withdrawal decisions, transactions, broadcast, ratings, cancellations, clear suspension, pricing/settings, documents, staff, audit, finance/payout batches; office jobs, replace, reports, agreements and linked drivers. |
| Custody/complaints | source mentions custody router and job-linked complaint create/update/history. Exact paths to verify in code. |
| Integrations | `X-API-Key`; versioned `GET/POST /api/v1/jobs`, job detail/events; webhook URL/delivery records; source says `/api/jobs/{id}/contact` hook. Endpoint contract to verify. |

### Inferred API conventions [T]
- Use stable resource IDs, ISO-8601 timestamps, explicit currency/unit, enum values and pagination cursor/limit.
- Use idempotency keys for publish, accept, settlement, payout, and external job creation.
- Use optimistic version/ETag or equivalent for conflicting edits; return conflict rather than silently overwrite.
- Return stable machine-readable error codes (e.g., `INSUFFICIENT_FUNDS`, `OVERLAPPING_JOB`, `NO_APPROVED_PRICE`, `ACTIVE_JOB`, `FORBIDDEN`, `INVALID_TRANSITION`) with localized display text supplied separately.
- Redact secrets and personal data from logs. Define webhook signature, retry, event identifiers and delivery de-duplication before external release.
- Error contract example (illustrative, inferred): `{ "error": { "code": "INVALID_TRANSITION", "message": "...", "correlation_id": "...", "details": {} } }`.

## 8. Integration contracts

| Integration | Source status | Requirement / owner decision |
|---|---|---|
| SMS OTP | Mocked; Twilio named as future. | Adapter interface; production provider, sender, cost, delivery and abuse policy [D]. Never show demo OTP in production. |
| Payment/top-up | Simulated ledger; real gateway backlog. | Define capture/refund/escrow semantics, provider, reconciliation, webhook verification, failure states and whether actual escrow exists [D]. |
| Object storage | Source reports inactive key and local persistent fallback. | Configure durable encrypted storage, access links, retention, malware/content controls as applicable; no local fallback assumption for production [D]. |
| Map/location | Live KSA driver map recorded. | Confirm provider, precision, consent, refresh, retention, availability and cost [D]. |
| Masked contact | Relay-ready action/hook, no number exposure goal. | Provider and fail behavior [D]; do not simulate a connected call. |
| Webhooks/API | API keys and delivery records recorded. | Define external contract, scopes, signatures, limits, retries, event catalog and data minimization. |
| Push/email | Push listed as backlog. | Channel and preference policy [D]. |
| Google Maps Platform | New target dependency for driver route optimization. | Use Routes API waypoint ordering for a driver’s stop sequence where requirements fit; consider Route Optimization API for fleet assignment, time windows, capacities or multi-vehicle planning. Confirm product fit, region coverage, billing, Google Cloud project/API enablement, key restrictions, data handling and fallback before implementation. |
| WhatsApp | Driver app hands off via WhatsApp deep link/OS app handler with prefilled message. | No WhatsApp Business API or in-app messaging is implied; confirm supported deep-link behavior, recipient formatting, templates/languages, customer-data policy, and no-app/no-response fallback. |

## 9. Nonfunctional requirements

Targets marked “confirm” require owner/engineering sizing; none are source-established service guarantees.

| ID | Requirement | Verification |
|---|---|---|
| NFR-001 Availability | Define availability objective, maintenance windows and dependency behavior. [D] | Approved SLO and monitoring evidence. |
| NFR-002 Performance | Define p95 latency and peak workload for catalog, request, matching, operations map and reports. [D] | Load tests on representative dataset. |
| NFR-003 Scalability | Avoid hard-coded list caps/driver pools; paginate/index for growing users/jobs; source notes cap fixes. [S][T] | Dataset/load test above prior caps. |
| NFR-004 Security | TLS in transit; protected secrets/password hashes; least privilege; secure sessions; input validation; dependency and vulnerability management. | Security review and automated checks. |
| NFR-005 Privacy | Minimize and mask contact, identity, location, financial and document fields; define retention/deletion/legal hold. [D] | Role/field access tests and data inventory. |
| NFR-006 Integrity | Preserve financial and lifecycle consistency under retries and concurrent actions. | Concurrency/idempotency/reconciliation tests. |
| NFR-007 Auditability | Sensitive admin, pricing, verification, assignment, cancellation and financial changes produce attributable records. | Audit completeness and tamper/access review. |
| NFR-008 Localization | Arabic/English/Urdu support with correct RTL/LTR; missing translation gate. | Locale parity, direction and screenshot/smoke checks. |
| NFR-009 Accessibility | Keyboard/screen-reader semantics, contrast, focus, responsive behavior and understandable validation. | Accessibility review against chosen standard [D]. |
| NFR-010 Observability | Structured logs, metrics, traces/correlation IDs, actionable alerts, redaction. | Failure injection and dashboard/alert review. |
| NFR-011 Recovery | Define RPO/RTO, encrypted backup, restore tests and incident steps. [D] | Restore drill with measured outcomes. |
| NFR-012 Compatibility | Version API and migration changes; support agreed client/browser matrix. [D] | Compatibility suite. |

## 10. Security, privacy and audit requirements

- Never put passwords, OTPs, API secrets, signing secrets, raw personal phone/email, document images or production credentials in source control, logs, fixtures, or these documents.
- Admin/staff privileges require protected password flow, lockout/rate controls, password-change policy and auditable grants/resets. Source records bcrypt, JWT and lockout; verify current implementation rather than assuming. [S]
- Enforce authorization before fetching/serializing sensitive fields; test business-to-business, office-to-unlinked-driver, driver-to-unassigned-job, staff-permission and admin boundaries.
- Store API key verifier/hash, reveal secret once, scope by business, support revoke/rotate, redact logs. Protect webhook configuration from unsafe destinations and prevent server-side request abuse. [T]
- Define data classification, lawful purpose, consent, retention, deletion, incident response and location tracking rules with owner/legal counsel. These are decisions, not fabricated compliance claims. [D]
- Append immutable audit records for authentication administration, settings/pricing changes, verification, role/permission changes, assignment overrides, cancellation/suspension, quantity resolution, settlement/payout and reset operations.

## 11. Error handling and observability

Every error response must identify safe user-actionable cause and stable code; hide stack traces, secrets and unrelated record existence. Distinguish validation, authentication, authorization, conflict, missing configuration, insufficient funds (only if financial model applies), dependency unavailable and internal failure. Source notes object-storage upstream 401 should surface as controlled 503; treat this as historical example, not universal mapping. [S]

Log correlation ID, actor ID/role where permitted, route, outcome, latency and dependency status; never log OTP, passwords, API keys, raw contact, document contents, or full payment payload. Alert on elevated auth failures, stuck assignments, unresolved disputes, payout failures, webhook dead letters, storage degradation and backup/restore failure. Define thresholds with operators. [T][D]

## 12. Deployment, backup, migration, seed and reset safety

- Maintain environment-specific configuration and secret management; validate required settings at startup. Never include production secrets in seeds or docs.
- Migrations are forward-compatible, observable and reversible where feasible; preserve historical request/pricing/financial snapshots.
- Seed is idempotent and must not overwrite an existing admin password or operational data. Source records a seed overwrite bug fixed; verify fix in current code. [S]
- Demo fixtures must be unmistakably non-production and segregated from live accounts/funds.
- Reset/clean scripts default to dry-run, require explicit environment confirmation, show affected record counts, refuse production by default, require fresh verified backup and explicit approval, preserve audit/legal records per retention policy, and emit an audit event. No destructive reset is run by application startup or test suite against shared/prod data.
- Backup and restore procedures must be documented and restore-tested; source reports a specific preview backup/restore, which is historical and not a standing guarantee. [S]

## 13. Testing strategy

Map automated and manual cases to requirement IDs. Required classes: unit tests for price resolution/state transitions/eligibility; API integration tests for role enforcement and errors; concurrency tests for slot acceptance and settlement idempotency; migration/seed/reset safety tests; integration contract tests with fake adapters that clearly identify themselves as fakes; UI E2E for each role and service lifecycle; localization/RTL smoke tests; privacy field-visibility tests; load/security/accessibility/restore tests against agreed targets. Do not rely on historical iteration counts as current proof. Test against isolated data and never self-top-up or alter real accounts as hidden fixture setup.

## 14. Traceability to PRD

Each SRS requirement is mapped below to a PRD capability section. PRD section numbers refer to the headings in `JR_Logistics_PRD.md`.

| PRD section/capability | SRS IDs |
|---|---|
| PRD 5 scope, catalog and geography | CAT-001, CAT-002, CAT-003 |
| PRD 6 onboarding, identity, verification and consent | AUTH-001, AUTH-002, AUTH-003, AUTH-004, VER-001, VER-002 |
| PRD 7 catalog, pricing and request management | PRICE-001, PRICE-002, PRICE-003, PRICE-004, PRICE-005, REQ-001, REQ-002, REQ-003, REQ-004, REQ-005 |
| PRD 6 matching, assignment and job execution | MATCH-001, MATCH-002, MATCH-003, MATCH-004, MATCH-005, JOB-001, JOB-002, JOB-003, JOB-004, JOB-005, JOB-006, JOB-007, JOB-008 |
| PRD 7 operations, communications, privacy, complaints and SLA | OPS-001, OPS-002, OPS-003, OPS-004, OPS-005, CMP-001, CMP-002 |
| PRD 7 finance, settlement, invoices and reporting | FIN-001, FIN-002, FIN-003, FIN-004, FIN-005, FIN-006, FIN-007, FIN-008, FIN-009 |
| PRD 6 driver mobile journey and PRD 7 routing/contact | MOB-001, MOB-002, MOB-003, MOB-004, MOB-005, MOB-006, MOB-007, MOB-008 |
| PRD 7 API, integrations and notifications | INT-001, INT-002, INT-003, INT-004, NOT-001, SHR-001 |
| PRD 8 UX, accessibility and localization | NFR-008, NFR-009 |
| PRD 9–10 dependencies, risks, security and resilience | NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-010, NFR-011, NFR-012 |
| PRD 11 acceptance criteria | All P0 requirements above; verification approach in section 13 |
| PRD 13 AI implementation guide | Requirements throughout; implementation rules in section 15 |

## 15. AI implementation guide

1. Inspect current repository, runtime config, database schema/data, routes, frontend, deployment and tests before changing code. Record verified behavior separately from source notes.
2. Implement vertical slices across UI/API/data/permissions/audit/tests; do not build disconnected screens or bypass domain state transitions.
3. Preserve backward compatibility, stable IDs, existing integrations and immutable financial/pricing history; use reviewed migrations.
4. Never perform destructive data operations, resets, real-account mutation, credential replacement, or production migrations without explicit owner approval and verified backup/restore.
5. Add tests for each requirement ID and permission/state negative case. Report actual commands/results accurately; do not add fake test evidence.
6. Do not fake SMS, payment, storage, map, relay, VAT, notifications, or webhooks. Use explicit demo adapters only in isolated demo mode and display simulated status clearly.
7. Ask focused questions when a decision in the open-decision list blocks implementation. Do not infer business, legal, tax, price, commission, SLA, cancellation, payout or dispute policy.
8. For Google routing, confirm Routes API versus Route Optimization API based on stops, time windows, vehicle capacity and fleet scope; use official Google documentation and avoid asserting “best” beyond the configured objective. Keep Google keys out of the mobile binary where possible; restrict keys and mediate privileged use server-side.
9. WhatsApp is an external user handoff only: do not invent a WhatsApp API integration, send messages silently, or claim delivery/read state.
10. Update this SRS, its PRD traceability row and the decision record whenever an owner-approved rule changes.

## Appendix A — Owner decisions required

1. Which service types are enabled at launch: delivery only, plus car-with-driver and car-without-driver, or other? What is each service’s workflow?
2. Canonical vehicle types and temperature combinations; city/area catalog; is Riyadh pickup still phase one?
3. Commission/fee schedule: source says 10% initially and later 0%; what applies by service, provider affiliation and effective date?
4. What does “escrow” mean operationally; are funds simulated, authorized/captured, or held by a licensed provider? Top-up and refund rules?
5. Pricing units, quantity reconciliation, provider cost, customer price, overrides, rounding and tax treatment?
6. Direct versus office-affiliated settlement calculation, office agreement precedence, settlement period, approvers and payout provider?
7. Exact job lifecycle per service, attendance evidence, no-show determination, replacement trigger, dispute authority and settlement hold/release?
8. Final cancellation thresholds, weekly counter timezone, warnings, suspension duration, appeals, refunds and compensation?
9. Verification requirements/gates, document types/expiry, consent text/version, privacy retention/deletion and location tracking?
10. Complaints categories, SLA targets, compensation and escalation responsibilities?
11. API scopes, key limits, quotas, idempotency, webhook events/signatures/retry policy and expected integration clients?
12. Production SMS, payment, storage, map, relay and notification providers; availability and failure behavior?
13. VAT applicability/rate/invoice fields and accounting treatment confirmed by finance/tax owner?
14. Availability/performance/security/accessibility objectives, backup RPO/RTO, supported client matrix and production readiness criteria?
15. Driver app targets (Android/iOS minimum versions, offline behavior, push policy, store release owner)?
16. Shipment details visible to driver and customer contact fields; WhatsApp recipient formatting, approved ready-message text and AR/EN/UR variants?
17. Google product selection (Routes API waypoint optimization vs Route Optimization API), optimization objectives/constraints, traffic behavior, key ownership/restrictions, billing limits and failure fallback?
