#!/bin/sh
set -e
# Apply migrations on every start (idempotent). Seed only creates the super admin unless DEMO_MODE is on.
npx tsx scripts/migrate.ts
if [ -n "$SUPER_ADMIN_EMAIL" ] && [ -n "$SUPER_ADMIN_PASSWORD" ]; then npx tsx scripts/seed.ts; fi
exec npx next start -p "${PORT:-3000}"
