# ISNAD Auth Testing Playbook

## Two auth channels (strictly separated)
1. **Business/Driver**: phone + SMS OTP (mocked — `demo_otp` in API response) via `/api/auth/otp/send` + `/api/auth/otp/verify`. Admin/staff phones are REJECTED at OTP verify (403).
2. **Super Admin / Staff**: email-or-phone + password via `/api/auth/admin/login` (bcrypt hashes, JWT, httpOnly cookie + bearer token). Brute-force: 5 failed attempts → 15-min lockout (`login_attempts` collection, key `ip:identifier`). Every admin login is audit-logged.

## Super Admin bootstrap
- Initialized at backend startup by `seed_admin()` in `/app/backend/seed.py`.
- Credentials come from env only: `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` in `/app/backend/.env`. If either is missing, startup fails fast (RuntimeError).
- If the env password changes, the hash is re-synced on next restart.
- NEVER hardcode passwords in source. DEVELOPMENT password currently set in backend/.env: `Isnad-Dev-Admin-2026!` — DEVELOPMENT ONLY, must be changed before production (rotate in .env + restart, or use Settings → Change Password in the admin UI).

## Credentials (see /app/memory/test_credentials.md for full list)
- Super Admin: emadabuharb1993@gmail.com / Isnad-Dev-Admin-2026! (DEV ONLY)
- Seeded staff (+966500000301/302/303): Isnad-Dev-Staff-2026! (DEV ONLY, must_change_password=true)
- Staff created via UI: initial password set by Super Admin at creation; must_change_password=true; Super Admin can reset via staff table.

## Key endpoints
- POST /api/auth/admin/login {email|phone, password} → {token, user}
- POST /api/auth/change-password {current_password, new_password} (admin/staff only, min 8 chars)
- POST /api/admin/staff (super admin only, requires password ≥ 8)
- PATCH /api/admin/staff/{id} (name/role/permissions/status/password)
- GET /api/auth/me — works for both channels

## Backend authorization
- `require_roles("admin")` — super-admin-only (settings, staff mgmt)
- `require_staff(*perms)` — admin OR staff with listed permission; business/worker tokens get 403
- `get_current_user` rejects suspended accounts

## Manual verification
```
API=https://tawazon.preview.emergentagent.com
curl -X POST $API/api/auth/admin/login -H "Content-Type: application/json" \
  -d '{"email":"emadabuharb1993@gmail.com","password":"Isnad-Dev-Admin-2026!"}'
curl $API/api/auth/me -H "Authorization: Bearer <token>"
curl -o /dev/null -w "%{http_code}" $API/api/admin/stats   # 401 without token
# OTP must reject admin phone:
curl -X POST $API/api/auth/otp/verify -H "Content-Type: application/json" \
  -d '{"phone":"+966500000001","code":"<demo_otp>"}'        # 403
```
