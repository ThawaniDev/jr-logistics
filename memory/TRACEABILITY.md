# SRS → implementation → verification

Legend: ✅ implemented and verified by an automated test · 🟡 implemented, partially verified or with a documented limitation · ⛔ intentionally **not** implemented (owner decision / external dependency — see `DECISIONS.md`).
Test locations: **V** = `web/tests/**` (Vitest, real Postgres) · **E** = `web/e2e/**` (Playwright, production build) · **F** = `mobile/test/**` (Flutter unit/widget) · **L** = `mobile/test/integration/live_api_test.dart` (Dart client ↔ real server) · **S** = `mobile/integration_test/app_test.dart` (iOS simulator, full journey).

| SRS | Status | Implementation | Evidence |
|---|---|---|---|
| AUTH-001 auth by role | ✅ | `server/auth/*`, `routes/common.ts` | V api.test *auth*; E flows (username + password sign-in, J1); L registration/logout; S sign-in. Provider: demo only — production refuses (`DEPENDENCY_UNAVAILABLE`). |
| AUTH-002 server-side authz | ✅ | `api/router.ts` auth spec + `can()` | V *authorization* (401/403/404 tenant isolation, per-permission); E route guards |
| AUTH-003 abuse protection, revocation | ✅ | `ratelimit.ts` (atomic, DB-backed), OTP attempts/burn, staff lockout, revocable sessions, no staff-phone enumeration | V *auth*, requirements *enumeration*; L logout revokes |
| AUTH-004 versioned consent | ✅ | `terms_consents` at register / publish / accept | V requirements *AUTH-004* |
| VER-001 documents & states | ✅ | `accounts.ts` | V *documents & verification*; E upload→approve→verified |
| VER-002 document access / storage adapter | ✅ | `readDocument`, `storage.ts` | V other-driver/business 404; requirements *storage guard* |
| CAT-001 services enabled set | ✅ | `settings.enabledServices` | V ops *disabled services* |
| CAT-002 vehicle/temperature validity | ✅ | `requests.ts validate` | V api *validation errors*; L registration |
| CAT-003 city/area scope | ✅ | `settings.cities` | V api *validation* (pickup limited) |
| PRICE-001 deterministic rule resolution | ✅ | `pricing.ts resolveRule` | V api *pricing versions/override*, requirements *effective dating* |
| PRICE-002 immutable snapshot | ✅ | `requests.pricing_snapshot` | V requirements *price edits don't change published request* |
| PRICE-003 margin protection | ✅ | `publicQuote`, `viewRequest` | V api *estimate hides provider cost*; office settlements strip margin |
| PRICE-004 totals / rounding / validation | ✅ | integer halalas, `buildQuote` | V unit *pricing math*; L exact earning/settlement |
| PRICE-005 commission/fee config | 🟡 | replaced by margin model (Decision 3) | V lifecycle *balanced money* — rate-based commission awaits owner |
| REQ-001/002 draft, publish, service schema | ✅ | `requests.ts`, `routes/business.ts` | V lifecycle/gates; E wizard |
| REQ-003 business price override | ✅ | `pricing_rules.business_id` | V api *override wins* |
| REQ-004 pagination | ✅ | `listRequests` | V ops *beyond 200* |
| REQ-005 cancellation | ✅ | `cancelRequest` | V lifecycle *cancel refunds; started work blocks* |
| MATCH-001 eligibility guards | ✅ | `matching.ts evaluateCandidates` | V lifecycle, api *office flow*, ops *suspension* |
| MATCH-002 explainable ranking | ✅ | `factors` + `/admin/requests/:id/suggest` | E/F admin assign UI; V via evaluateCandidates |
| MATCH-003 atomic accept | ✅ | request→offer lock order, partial unique index | V *concurrency* (N of M win N) |
| MATCH-004 affiliation snapshot | ✅ | `offers.office_id` | V ops *office-affiliated pays the office* |
| MATCH-005 replacement + history | ✅ | `freeSlotAndReplace`, `job_events` | V lifecycle *driver cancel…replacement* |
| JOB-001..005 execution & quantities | ✅ | `jobs.ts` | V lifecycle; E; L; S |
| JOB-006 custody | ✅ | `support.ts` | V requirements *custody* |
| JOB-007 timeline | ✅ | append-only `job_events` | V/E/L timeline assertions |
| JOB-008 overlap policy | ✅ | `settings.overlapPolicy` | V lifecycle *overlap*, requirements *single_active* |
| OPS-001 job chat | ✅ | `messages` | V api *chat party-scoped*; S/F chat |
| OPS-002 masked contact relay | ⛔ | In-app chat + WhatsApp hand-off instead | — (needs a relay provider) |
| OPS-003 urgent tickets | ✅ | `openTicket` | V api tickets |
| OPS-004 live queue / alerts | ✅ | `ops.opsAlerts`, map (audited) | V requirements *alerts*; E ops page |
| OPS-005 SLA indicators | ✅ | `startSla` | V unit *SLA* |
| CMP-001 complaints lifecycle | ✅ | `support.ts` | V api *complaints*; V settlement hold |
| CMP-002 compensation / appeal | ⛔ | none by design | — |
| FIN-001 ledger | ✅ | `wallet.ts post`, idempotency keys | V ops *money conserved across the ledger* |
| FIN-002 simulated vs real | ✅ | `simulated` flag, provider adapters | V api *topup simulated*; UI labels |
| FIN-003 settlement gating | ✅ | dispute/complaint hold, SoD | V lifecycle, ops *held complaint*; E finance journey |
| FIN-004 direct vs office | ✅ | `createSettlement`/`payoutTx` | V ops |
| FIN-005 batch & retry | ✅ | `runPayoutBatch`, `retryFailed` | V ops *batch isolates failures* |
| FIN-006 wallet statuses | ✅ | available/reserved/held | V withdrawals; F wallet |
| FIN-007 invoices | 🟡 | invoice **record** with VAT extraction; no PDF/tax content (Decision 5) | V (created at payout) |
| FIN-008 reports | ✅ | `ops.report`, CSV w/ formula-injection guard, audited export | V unit CSV; api *CSV export audited*; requirements *reports* |
| FIN-009 ratings | ✅ | `jobs.rate` | V requirements *ratings* |
| MOB-001 Flutter driver app | ✅ | `mobile/` | F; L; S |
| MOB-002 assigned shipment details only | ✅ | `views.driverJobView` | V api *privacy*; L *recipient hidden before accept*; F widget |
| MOB-003 route optimisation w/ review | ✅ | `routing.ts`, `RouteScreen` | V unit routing; L *honest ordered plan*; F *labelled estimate/Google* |
| MOB-004 navigation hand-off | ✅ | `googleMapsDirections` | F *preserves reviewed order* |
| MOB-005 WhatsApp prefilled hand-off | ✅ | `whatsappLink`, `/driver/jobs/:id/whatsapp` | V unit + api; L; F |
| MOB-006 no delivery/read claims | ✅ | only `whatsapp_handoff_opened` event | F *never claims delivery*; L timeline |
| MOB-007 return & record exception | ✅ | `/contact-exception` | L; F |
| MOB-008 minimal data to external apps | ✅ | URL = recipient number + localized text only | V/L |
| INT-001 API keys | ✅ | `integrations.ts` | V api *API keys* |
| INT-002 versioned job API | ✅ | `/api/v1/jobs*`, idempotency | V api *external create idempotent* |
| INT-003 webhooks | ✅ | HMAC, retries, dead-letter, SSRF guard | V ops *webhooks*; unit signing/SSRF |
| INT-004 redacted request logs | ✅ | `api_logs` (method/path/status/latency only) | V (logged) |
| NOT-001 notifications | 🟡 | in-app, localized, polled; **no push/email/SMS** | V (notify calls); E/F lists |
| SHR-001 shared services | ✅ | catalog/profile/wallet/notifications/health | V/E |
| NFR-004/005/006/007/008/010 | ✅/🟡 | security headers, field-level privacy, idempotent money, audit log, i18n parity (1022 keys ×3, test-enforced), correlation IDs | V i18n parity; V api; E headers via curl |
| NFR-001/002/003/009/011/012 | 🟡 | no SLO/RPO/RTO/load/accessibility audits performed — owner targets needed; pagination removes hard caps | — |

## Audit follow-up (rebuild vs old system) — defects found, fixed and pinned by `web/tests/integration/gaps.test.ts`
| Finding | Fix | Test (V gaps.test) |
|---|---|---|
| Request `contents` never saved (inline comment swallowed the field) | `requests.ts rowFromInput` | *stores what the driver carries* |
| Confirming one driver's attendance closed the remaining slots | `jobs.confirmAttendance` only moves a fully staffed request to `in_progress` | *does not close the remaining open slots* |
| Offers: loading shown for rentals, Rate shown twice | server-driven `businessActions(o, ctx)`, `ratedByMe` | *offers only the actions that can work* |
| Partly staffed requests held escrow forever | `maintenance` closes open slots +1 h after start, refunds escrow | *partly staffed request closes its open slots* |
| Publish with no addresses / unready preferred office | `publishRequest` gates | *publishing needs both addresses…* |
| Billing above booked/loaded quantity could strand a payout | `maxBillableUnits` caps driver report, business confirm, ops resolve, finance correction | *quantity can never exceed…* |
| Dispute did not alert operations | `notifyOps(permission, …)` (admins + staff holding the permission) | *dispute notifies operations* |
| External `Idempotency-Key` race; orphan drafts | claim-first idempotency, cleanup on failure | *two concurrent calls…*, *failed publish leaves no orphan* |
| Webhook secret regenerated on every save | rotate only on URL change / explicit action | *saving the same webhook URL keeps the secret* |
| Office could take another office's reserved request | guard in `assignDriver` | *cannot take over…* |
| Stale office snapshot → settlement paid to wrong payee; cross-office re-link | `dropStaleOffers`, one-office rule, snapshot-only payee | *joining or leaving an office…*, *cannot invite…* |
| Driver saw notes before accepting / addresses forever | `driverJobView` privacy | *completed jobs no longer expose…* |
| Driver dead-end at `arrived`; unguarded no-work / contact reports | `reportNoWork`, `reportContactException` | *arrived … report once* |
| Office replace used a faked admin actor | `officeReplace` with real actor, office-first dispatch | *office replaces its own driver…* |
| Missing office reports/settlement detail/opportunity reasons | `officeReport`, `officeSettlements`, `officeOpportunities` | *office views…* |
| Separation of duties bypassable; no correction/adjustment/ledger/invoice/batch views | `settlement.ts`, `adminviews.ts` | *approval needs a different reviewer*, *correct a quantity*, *manual adjustments*, *batch skips held* |
| Staff privilege escalation; no password reset/unlock; `mustChangePassword` unenforced | `accounts.ts`, `router.ts` | *staff cannot escalate*, *temporary password blocks everything…* |
| Clearing a suspension re-suspended instantly | `strikes_reset_at` (migration 0001) | *clearing a suspension restarts the strike count* |
| Sensitive driver data / finance figures visible to wrong staff | masking, `adminStats(viewer)` | *sensitive driver data is masked*, *dashboard stats hide money…* |
| Report preview/CSV silently capped at 100 rows; unknown type 500 | `pageSize` honoured, full CSV export, enum validation | *reports validate type and honour pageSize* |
| Ratings / cancellations / city summary / invoices not viewable | `adminviews.ts` + `/admin/*` routes | *views … answer for the right permissions* |
| Profile: IBAN/city unvalidated at sign-up, availability bypass, no vehicle edit | `registerUser`, `updateProfile` | *IBAN is validated and canonicalised…* |
| Document type trusted from the client | header (magic-byte) check | V api *documents* (fake PNG → 422) |
| External audit (`AUDIT_RESPONSE.md`): IP spoofing, webhook DNS rebinding, cron dependency, ephemeral storage, staff MFA | `lib/client-ip.ts`, `integrations.pinnedFetch`, `scheduler.ts` + `instrumentation.ts`, `storage-s3.ts`, `auth/mfa.ts` | V unit client-ip, ssrf, s3 (AWS vectors), mfa (RFC 6238 vectors); V integration scheduler, mfa; E gaps *two-step verification* |

## B2C + per-shipment delivery (C-series, see DECISIONS.md and SHIPMENTS_API.md)
| Requirement | Implementation | Tests |
|---|---|---|
| Warehouse provides each shipment's details (B2C consumer / B2B business) | `shipments` table, `prepareManifest`, manifest on `POST/PATCH /requests`, `MANIFEST_REQUIRED` at publish | `shipments.test.ts` manifest suite |
| Driver goes one by one, never bulk | `stops.ts` (`STOP_LOCKED`), derived delivered count, `approveRoute`, `deferStop` once | "one stop at a time" suite |
| Recipient proof: consumer OTP, business OTP or receipt photo | `otpFor` (derived, SMS'd), 5-try lock, resend ≤ 3, `saveProofPhoto` (magic bytes) | OTP / B2B receipt tests |
| Parcel scan (code, own ref, number) at hand-over, delivery and return | `scanMatches`, `markLoaded`, `confirmReturns` | allocation + failed-stop tests |
| Exact billing/escrow per parcel, balanced allocation, refunds | `slotShape`, `allocateToOffer`, `syncOfferUnits`, `buildQuote.totalShipments` | allocation suite |
| Failed attempts, returns, re-ship, end route, replace guard | `failStop`, `releaseOfferShipments`, `endRoute`, `reshipFromRequest`, `guardReplaceManifest` | failed-stop / end-route tests |
| Fix or cancel one parcel before hand-over | `updateShipment`, `cancelShipment` | "fixing or withdrawing" test |
| All-or-nothing requests; office selection removed; no COD/POS | `allowPartial` + maintenance `calledOff`; `preferredOfficeId` ignored; `CUSTODY_ITEM_TYPES` | all-or-nothing + gaps tests |
| Recipient SMS + public tracking + integrator API | `sendRecipientCodes`, `trackShipment`, `/jobs/:id/shipments`, webhooks | notification/tracking tests |
