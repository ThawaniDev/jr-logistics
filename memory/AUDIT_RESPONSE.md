# Response to `web/AUDIT.md` (external audit, Nov 2026)

Every claim was checked against the code. **Valid findings were fixed or are tracked below; inaccurate statements are listed so they are not acted on.**

## Fixed in code (with tests)
| Audit item | Verdict | What changed | Test |
|---|---|---|---|
| SEC-01 / GAP-AUTH-02 client-IP spoofing via `X-Forwarded-For` | **Valid (HIGH)** | `lib/client-ip.ts`: the IP is read from the **right** of `X-Forwarded-For` (N trusted proxies, `TRUSTED_PROXY`), or `CF-Connecting-IP`, or no header at all (`none`). Values must be valid IPs. | `tests/unit/client-ip.test.ts` |
| SEC-03 / GAP-INT-01 webhook DNS-rebinding window | **Valid (MEDIUM)** | `pinnedFetch`: validate **once**, then connect to that exact address (Host/SNI/certificate unchanged); redirects never followed; response body capped. Also tightened private-range detection (IPv4-mapped IPv6, multicast, benchmarking, `fe80::/10`). | `tests/unit/ssrf.test.ts` (simulated rebinding: the second DNS answer is never used) |
| GAP-REQ-01 / GAP-INT-02 housekeeping depends on an external cron | **Valid** | `INTERNAL_SCHEDULER=true` runs the same tick in-process every `SCHEDULER_INTERVAL_SEC` (default 60) via `instrumentation.ts`; a Postgres advisory lock makes it safe with several replicas. The external `/cron/tick` stays for serverless hosts. Docker compose enables it. | `tests/integration/scheduler.test.ts` |
| SEC-02 / GAP-VER-01 ephemeral document storage | **Valid (HIGH)** | `STORAGE_DRIVER=s3` + `S3_*`: S3-compatible adapter (AWS S3, Cloudflare R2, MinIO) with hand-written SigV4 (no new dependency); objects stay private; optional SSE header. Verified against **AWS's published signing test vectors** and an S3-protocol test server. *Not verified against a live bucket (no credentials here).* | `tests/unit/s3.test.ts` |
| SEC-04 / GAP-AUTH-03 staff without MFA | **Valid (MEDIUM); not required by PRD/SRS** | Optional TOTP two-step verification for staff/admin: RFC 6238 (verified with the RFC vectors), AES-GCM-encrypted secret, 8 one-time recovery codes (hashed), replay protection, rate limiting, admin reset for lost phones, and a policy switch **Require two-step verification for all staff** (server-enforced: un-enrolled staff can only enrol). Default **off**. | `tests/unit/mfa.test.ts`, `tests/integration/mfa.test.ts`, `e2e/gaps.spec.ts` |

## Valid, but needs a decision or external account — not built
| Item | Why not done |
|---|---|
| GAP-AUTH-01 SMS provider, GAP-FIN-01 payment gateway, GAP-FIN-02 bank payouts | The owner has not chosen providers (Decisions #4, #12). The seams (`setSmsProvider`, `setPaymentProvider`) exist and production fails closed. Writing an adapter against a provider API without credentials to test it would be guesswork. |
| GAP-FIN-03 ZATCA Phase 2 e-invoicing | Needs ZATCA onboarding (CSID certificates), the seller's VAT registration and sign-off from the tax owner (Decisions #5/#13). Not something to improvise. |
| GAP-NOT-01 push notifications, GAP-OPS-01 WebSocket/geofencing, GAP-JOB-01 masked-call relay | Provider/product decisions (FCM/APNs account, telephony vendor, geofence radius). Documented in Decisions #12. |
| GAP-VER-02 presigned download URLs | Documents stream through an authorised API route, so every download is permission-checked and audited; a presigned redirect would hand out a bearer URL. Revisit if 8 MB buffers become a memory issue. |
| CSP `script-src` | Needs a nonce pipeline for Next's inline scripts; listed in the production checklist. |

## Statements in the audit that are **incorrect** (so nobody "fixes" them)
- *"18 permissions; presets support/dispatcher/auditor/finance"* — there are **36** permissions and the presets are `support, operations, finance, hr_verification, account_manager, reports`.
- *"Driver verification needs `driver_license` and `vehicle_insurance`"* — the required documents are `national_id`, `driving_license`, `vehicle_registration` (`vehicle_photo` optional). There is no insurance document type.
- *"bcrypt cost 10; password needs upper/lower/digit"* — cost is 11 (4 in tests); the rule is ≥10 characters with at least one letter and one digit.
- *"Separation of duties only blocks the reviewer approving"* — outdated: approval now **requires** a review by a different person (settlement must be `reviewed`), and finance can correct a quantity before payout.
- *"Strikes: 3 within 30 days → 7-day suspension; no-shows add strikes"* — thresholds are admin settings (`cancelWarnAt`, `cancelSuspendAt`, `cancelWindowDays`, `cancelSuspendDays`), and only **driver cancellations** count. This matches the old system. Whether a business-recorded no-show should also count is an **owner policy decision** (risk: a business could wrongly penalise a driver who did show up) — left as is.
- *"Cancellation after acceptance applies a penalty policy"* — there are no cancellation fees (Decision #3); cancelling returns the unspent escrow.
- *"Admin seeding must create default pricing rules"* — rules are entered by the owner in Admin (they are business data); only demo mode seeds sample rules.

## New settings
`TRUSTED_PROXY`, `INTERNAL_SCHEDULER`, `SCHEDULER_INTERVAL_SEC`, `STORAGE_DRIVER=s3` + `S3_BUCKET/S3_REGION/S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_SSE`, and the in-app policy `requireStaffMfa`. See `web/.env.example`. Migration `0002_staff_mfa` adds four columns to `users`.
