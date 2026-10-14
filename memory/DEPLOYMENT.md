# JR Logistics — Owner Deployment & Operations Guide

## Environments
- **Preview** (this environment): React on :3000, FastAPI on :8001, MongoDB local. Hot-reload on code changes. Use it to test every update before release.
- **Production**: managed by Emergent. Deploy/redeploy via the platform's Deploy button (or ask the agent to deploy). The public URL stays the same on ordinary redeploys — existing customers and drivers keep their accounts; no re-registration needed.

## Requesting updates
Ask in chat (code, design, or feature changes). Changes are applied to the codebase, hot-reload in Preview, and only go live after you deploy/redeploy to Production. Routine operations (pricing rules, account approvals, suspensions, settings) are done in the **Admin Dashboard** and never require a redeploy.

## Data safety
- Production data lives in the production MongoDB bound to the deployment. Ordinary updates (code only) do **not** touch the database — no fresh DB, no data deletion.
- Backend writes are schema-flexible (MongoDB); the platform has no destructive migrations. `seed.py` is idempotent and never deletes data (as of iteration 16 it also never overwrites an existing admin password).
- Before significant changes: export a backup — `mongodump` of the production DB (or ask support for a snapshot). Rollback: use the platform's rollback/checkpoint feature to restore a previous code release instantly; note that rollback restores **code**, not data written after the release.

## Secrets / environment variables
- Preview and Production have **separate** env stores. Manage production secrets via the platform's Secrets UI (Re-publish → Secrets tab). Keys used: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `EMERGENT_LLM_KEY` (object storage).
- Never commit real secrets; `.env` files are environment-specific.

## Sessions & caching
- Sessions use per-tab tokens (sessionStorage) — multi-tab isolation by design. After an update, long-open browser tabs may need a refresh; users are not logged out (7-day JWT).

## External integrations status
| Integration | Status |
|---|---|
| SMS OTP | **Simulated** in preview (`demo_otp` returned by API). Needs a real SMS provider (e.g., Twilio) for production. |
| Payments / wallet top-up | **Simulated** ledger. Needs a real payment gateway (Stripe/Moyasar/HyperPay) before charging real customers. |
| Document storage | Local persistent storage fallback (`/app/backend/uploads`) works; cloud object storage requires Universal Key balance (Profile → Manage plan → Universal Key → Add Balance). |
| Company API (B2B) | **Working**: `/api/v1/jobs` with `X-API-Key` auth, call logging, webhook deliveries recorded. |

## Admin access
- Single super admin: emadabuharb1993@gmail.com. Password reset performed securely (bcrypt) on 2026-06; `must_change_password` flag is set — change it at first login via Admin Settings → change password form.
- Staff accounts and role presets managed from Admin → Staff.
