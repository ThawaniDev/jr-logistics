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

## Backlog
- **P1**: Real SMS provider (Twilio); real payment gateway (Moyasar/Stripe); OTP rate-limiting; weekly auto-settlement for long contracts; driver ID verification upload
- **P2**: Push notifications, in-app chat, analytics charts, CSV export, geo-based matching, recurring contracts
- **P3**: Multi-language (EN), mobile apps, PDF invoices, audit log

## Next Tasks
1. Collect production keys (Twilio, payment gateway) when going live
2. Add OTP rate limiting before production
3. Weekly settlement cron for long-duration contracts
