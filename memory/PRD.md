# ISNAD (إسناد) — Saudi Logistics & Workforce Marketplace — PRD

## Original Problem Statement
Build a modern Arabic RTL web platform for a Saudi logistics and workforce marketplace connecting businesses (companies, warehouses, logistics firms, event organizers) with temporary operational resources (workers & service providers). 9 service categories: delivery drivers, warehouse workers, loading/unloading, sorting/packing, inventory counting, cars with drivers, cars without drivers, events staff, other logistics services. Three roles: Business, Worker/Service Provider, Admin. Full workflow: request → matching → accept → confirm (escrow) → attendance → completion → payout. Premium Saudi tech brand, Arabic-first RTL, scalable modular architecture.

## MVP Scope (Updated 2026-06-16 — Delivery Drivers Only)
- MVP is scoped to ONE service: delivery drivers (مندوبو التوصيل). All other service categories (warehouse, loading, sorting, inventory, vehicles, events, other) are HIDDEN from the UI via `ENABLED_SERVICES = ["delivery_driver"]` in `/app/backend/catalog.py` and `ENABLED_SERVICE_KEYS` in `/app/frontend/src/lib/constants.js` — architecture and catalog remain intact; enabling a future category is a one-line change.
- Business request fields: number of drivers, date, start time, duration, service area (city + area/neighborhoods), vehicle type (required), estimated shipments per driver, per-shipment rate, live cost estimate + escrow confirmation.
- Driver sees full job details before accepting: date, time, duration, area, vehicle requirement, shipments per driver, expected net earnings.
- Seed migrated (seed_v2): all demo workers are delivery drivers with vehicle types; requests req_1 (published), req_d1 (completed+paid+rated), req_d2 (in_progress, escrow reserved), req_d3 (published); pending withdrawal wd_1 (محمد العتيبي, 200 SAR).

## User Choices (June 2026)
- Auth: Phone number + SMS OTP (SMS MOCKED for demo — OTP shown in API response/UI banner). JWT sessions. Scalable for future identity/document verification.
- Wallet: Full simulated escrow money flow — business tops up (demo), funds reserved on request confirmation, 10% platform commission, worker earnings released after business confirms completion, worker withdrawals with admin approval. All money labeled demo. No real payment gateway.
- Demo seed data: YES — companies, workers, requests in various states, transactions, notifications, ratings, support tickets, pending withdrawal.
- Brand: Dark navy (#0B132B) + emerald (#00E5A3) + gold (#F59E0B), IBM Plex Sans Arabic + Tajawal fonts, premium Saudi tech identity, glass surfaces, subtle glows.

## Architecture
- **Backend** (FastAPI + MongoDB, port 8001, /api prefix):
  - `db.py` (Mongo client), `security.py` (JWT), `deps.py` (role guards), `catalog.py` (9-service catalog + 10% commission), `utils.py` (notify, transactions, wallets, ratings), `seed.py` (idempotent demo seed + admin upsert)
  - Routers: `auth` (OTP send/verify/register/me/logout), `business` (requests CRUD, estimate, matching, confirm+escrow, attendance/no-show+replacement, complete+settlement, cancel+refund, rating, topup, overview), `worker` (availability, offers feed, open jobs, accept/reject/apply, checkin, history, withdrawals, rating), `admin` (stats, users mgmt, requests + manual match, withdrawal decisions, transactions, broadcast, ratings), `common` (profile, wallet, notifications, tickets, catalog, health)
- **Frontend** (React, port 3000): RTL Arabic, role-based dashboard layout, pages: Landing, Login (OTP), Register (role+profile), Business (dashboard, requests, 4-step request wizard, request detail with attendance/escrow/completion/rating, wallet+topup, profile), Worker (dashboard+availability toggle, opportunities, my jobs+checkin, wallet+withdrawals, profile), Admin (dashboard+broadcast, users, requests+manual matching, withdrawals), shared (Notifications, Support tickets)
- **IDs**: string UUIDs (no ObjectId serialization issues). Admin account: emadabuharb1993@gmail.com / +966500000001.

## Implemented (2026-06-16)
- Full phone-OTP auth (mocked SMS) with role-based registration
- Complete request lifecycle with escrow wallet, attendance tracking, no-show replacement offers, settlement with partial refunds
- **Configurable platform pricing (Admin Dashboard → التسعير والإعدادات, no code changes): default price per shipment (8 SAR), commission % (10%), vehicle types (سيدان/فان), service areas (cities)** — stored in `settings` collection, exposed via GET/PATCH /api/admin/settings and public /api/catalog/defaults; commission_rate snapshotted onto each request at creation
- **Draft → Publish flow**: save request as draft, publish later (POST /requests/{id}/publish triggers matching)
- **Full pricing breakdown** shown pre-publish (base amount, commission %, drivers' net, total charged) and on request detail (pricing-breakdown card incl. per-driver net)
- Service renamed to "مندوب توصيل موثوق"; vehicle types = Sedan/Van (settings-driven dropdowns across wizard, register, driver profile)
- Business dashboard: available/reserved/total spent/platform fees + active/attendance-pending/completed/cancelled counts
- Driver dashboard: new offers, active jobs, pending/available/paid earnings, rating; jobs grouped into active-now vs upcoming
- Driver wallet: pending (in-progress escrowed) / available / paid earnings cards
- Extra notifications: request created, replacement found, driver acceptance ack, job completed (business)
- Withdrawal requests with admin approve/reject; two-way ratings on completed jobs
- Admin: dashboards, user management, manual matching, broadcast, support tickets
- Demo seed through seed_v4 (delivery-only dataset, Sedan/Van normalized, platform settings inserted)
- Testing: iter3 — 14/14 new tests + 20 passed/3 idempotent skips existing; 100% frontend flows

## Implemented (2026-09-17) — Admin entry-point exposure & list fixes
- Admin portal route /admin/login confirmed live on preview; entry links on public login page (admin-portal-link) and landing footer (footer-admin-link)
- Admin /requests list: cap raised 300→1000 and business join now includes phone — user's real business (عماد / +966530534184) shows 23 requests in Admin
- Regression: 97 passed / 4 skipped; admin portal E2E (footer link → login → dashboard → requests list) verified by screenshot

## Implemented (2026-09-17) — Real-account E2E verification (iteration 8)
- Verified user's real registered accounts (Business عماد +966530534184, Driver عماد +966593603404) fully connected to Super Admin — both appear in Admin Users, share the single central MongoDB
- Testing agent ran complete E2E on real accounts: driver uploaded 3 docs → admin verified → driver verified → business top-up → publish (terms-gated) → admin visibility → driver accept (terms modal) → overlap block → phone privacy post-accept → checkin → attendance → finish → complete → settlement (160 SAR → 144 driver net + 16 commission) → mutual ⭐5 ratings → linked support ticket → audit log entries
- Fixed test_iteration3 draft-publish test to self-topup when shared wallet is drained
- OTP send 403 for admin/staff confirmed live (agent note was stale)
- Full suite: 73 passed / 4 skipped (after topup fix) + iteration8 E2E 24/24
- Test-suite hardening: self-topup on INSUFFICIENT_FUNDS in shared-wallet tests (iter3/isnad/iter5/iter6), privacy test aligned to VISIBLE_AFTER_ACCEPT semantics, user driver suspension cleared via admin endpoint; final full suite green + iter8 E2E 24/24 on the user's real accounts

## Implemented (2026-09-17) — Admin connectivity layer (iteration 6/7)
- Weekly cancellation policy: cancel_weekly_limit=3 (ISO-week counters cancel_week/cancel_count_week; warning at limit, temp suspension above it) — all configurable in Admin Settings incl new weekly-limit field
- Cancellations registry: GET /api/admin/cancellations (party/kind filters, joined worker/business/request context) + UI page /app/admin/cancellations (nav item, perm requests_view)
- Admin request filters: city + date range on GET /api/admin/requests with UI controls
- Admin dashboard financial totals: total wallet balances, total reserved, driver earnings, cancellations/replacements cards
- Suspension management: POST /api/admin/users/{id}/clear-suspension (audit-logged, driver notified) + UI button in Admin Users; cancellation counts visible per driver
- Audit: driver_cancelled and business_cancelled actions logged
- Test hygiene: OTP-login retry across suites, self-healing driver fixtures, isolated business for topup test
- Tests: test_iteration6.py (5 tests) — full suite 73 passed / 4 skipped
- Iteration 7 testing agent: all iter-6 features verified live (weekly policy, cancellations registry, filters, financial cards, suspension lift, role isolation, fresh-account visibility in admin). Follow-up: /api/business/requests cap raised 200→1000 so seed data stays reachable; OTP-send 403 for admin/staff confirmed live.

## Implemented (2026-09-16) — Policy & flow completion (iteration 5)
- Overlapping-job restriction: driver can hold only one active job per time window — 400 OVERLAPPING_JOB on accept/apply; overlapping requests hidden from open opportunities; suspension respected
- Driver privacy: worker phone masked from business until offer accepted (VISIBLE_AFTER_ACCEPT in request detail)
- Driver cancellation: POST /worker/offers/{id}/cancel with mandatory reason → cancellations collection, cancel_count, policy-driven warning (threshold 2) and temporary suspension (threshold 4, 3 days) — no permanent bans; triggers replacement flow (request → filling, replacement_requested, match_workers re-offers)
- Business-side terms: wizard review step requires checkbox acknowledgment (gates publish), backend stores biz_terms_accepted_at on create-publish and draft-publish
- Configurable cancellation policy: admin settings (cancel_warning_threshold / cancel_suspend_threshold / cancel_suspend_days) with bounds validation, editable in Admin Settings UI
- Cancellation records for business cancels and no-shows (cancellations collection with party/kind/reason/request linkage)
- Tests: test_iteration5.py (6 tests: overlap, cancel policy, privacy, biz terms, settings bounds) — full suite 67 passed / 4 skipped
- Follow-up hardening: OTP send now returns 403 immediately for admin/staff phones (not only at verify); publish/cancel endpoints accept optional JSON bodies for backward compatibility
- Iteration 5 testing agent: 100% backend + frontend flows verified E2E (full request lifecycle, overlap error toast, driver cancel UI, insufficient funds, cancel policy settings, 3-language switching, all dashboard card navigation, privacy masking, admin login)

## Implemented (2026-09-16) — Secure Super Admin authentication
- Dedicated password-based admin portal at /admin/login (email or phone + password), separate from business/driver OTP flow
- bcrypt password hashing; JWT (cookie + bearer); brute-force lockout (5 attempts → 15 min); admin logins audit-logged
- OTP verify now REJECTS admin/staff phones (403) — privileged accounts must use the password portal
- Super Admin bootstrap via env only (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in backend/.env, re-synced on restart); owner email emadabuharb1993@gmail.com; DEV password flagged development-only
- Staff accounts: initial password required at creation (min 8 chars), must_change_password flag, Super Admin can reset passwords, role change, suspend/activate — all from /app/admin/staff
- Change-password card in Admin Settings (admin only); backend /api/auth/change-password (admin/staff only)
- Backend authorization enforced via require_roles("admin") and require_staff(*perms) — verified 401/403 for unauthenticated and business tokens
- Docs: /app/auth_testing.md playbook; test_credentials.md updated with all dev credentials
- Tests: 61 passed / 4 skipped (pytest, includes admin portal, OTP-block, RBAC, staff CRUD, lockout)

## Implemented (2026-09-16) — i18n + Operations batch
- Full 3-language support (Arabic RTL, English LTR, Urdu RTL): every page migrated to `useI18n()` + `translations.js` (ar/en/ur parity verified programmatically); LanguageSwitcher persists to profile (`language` field) and flips `document.dir`
- Wallet balance enforcement at request publish (backend INSUFFICIENT_FUNDS 400 + frontend alert card with required/available + top-up link)
- Terms & Conditions modal before accepting/applying to opportunities (backend enforces `terms: true`)
- Navigation fix: all dashboard StatCards are real links (`to` prop); attendance alert banner links to requests
- Support & Operations Center: role-based ticket categories, linked request, priority, staff escalation levels, activity log
- Admin: compensation % setting (no_work_compensation_pct), dashboard cards for open cases & pending documents, staff RBAC UI, document verification UI, audit log UI
- Worker: finish-job button, "no work provided" report → operational case; doc verification warnings on dashboard
- Bug fix: rating upsert 500 on repeat rating (immutable `_id` moved to `$setOnInsert`) in business.py + worker.py
- Tests: 34 passed / 3 skipped (pytest); frontend smoke-tested in AR/EN/UR

## Backlog
- **P1**: Real SMS provider (Twilio); real payment gateway (Moyasar/Stripe); OTP rate-limiting; weekly auto-settlement for long contracts; driver ID verification upload
- **P2**: Push notifications, in-app chat, analytics charts, CSV export, geo-based matching, recurring contracts
- **P3**: Multi-language (EN), mobile apps, PDF invoices, audit log

## Next Tasks
1. Collect production keys (Twilio, payment gateway) when going live
2. Add OTP rate limiting before production
3. Weekly settlement cron for long-duration contracts
