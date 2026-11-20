#!/usr/bin/env bash
# Spins up an isolated Next.js server on the TEST database, seeds it, runs the live Dart integration tests,
# optionally the iOS-simulator end-to-end test (pass --e2e), then tears everything down.
# Accounts: the seed creates the demo accounts with usernames and the published demo password (demo.driver / Demo#Pass2026 …); the tests find the
# username of an account by its phone on GET /auth/demo-accounts (test/integration/live_login.dart) and sign in with username + password — no OTP.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)/.."
PORT=${LIVE_PORT:-3102} # never 3100: other projects on this machine use it, and this script kills whatever listens on its port
export ENV_FILE=.env.test

stop_server() { lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null || true; pkill -f "next dev -p $PORT" 2>/dev/null || true; }
# Never reuse a stale server from an earlier run: it may be running old code.
stop_server; sleep 1
if lsof -ti :$PORT >/dev/null 2>&1; then echo "port $PORT is busy"; exit 1; fi
trap stop_server EXIT
rm -rf "$ROOT/web/.next-live"
( cd "$ROOT/web" && npx tsx scripts/reset-test-db.ts && npx tsx scripts/seed.ts )
( cd "$ROOT/web" && DATABASE_URL="postgres://dogorshom@localhost:5432/jr_logistics_test" DEMO_MODE=true NEXT_DIST_DIR=.next-live nohup npx next dev -p $PORT > /tmp/jr-live-server.log 2>&1 & )
for i in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/v1/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:$PORT/api/v1/health" >/dev/null || { echo "server did not start"; tail -20 /tmp/jr-live-server.log; exit 1; }
# The platform defaults to routing OFF and B2B OFF (decisions J2/J3): switch the two settings straight in the test DB for each group of tests.
set_modes() { ( cd "$ROOT/web" && node -e "const {Pool}=require('pg');const p=new Pool({connectionString:'postgres://dogorshom@localhost:5432/jr_logistics_test'});const v=JSON.stringify({routingEnabled:process.argv[1]==='on',b2bShipmentsEnabled:process.argv[1]==='on'});p.query(\"insert into settings(key,value) values('platform',\$1::jsonb) on conflict (key) do update set value = settings.value || excluded.value\",[v]).then(()=>p.end())" "$1" ); sleep 6; } # the server caches settings for 5 s
if [[ -z "${SKIP_LIVE:-}" ]]; then
  set_modes off; JR_API="http://localhost:$PORT" flutter test test/integration/mj_live_test.dart --tags live --reporter expanded   # the default: run sheet, no route approval, free order
  set_modes on;  JR_API="http://localhost:$PORT" flutter test $(ls test/integration/*_test.dart | grep -v mj_live_test) --tags live --reporter expanded # routing + B2B on: the approved-route, one-stop-at-a-time flow
fi
if [[ "${1:-}" == "--e2e" ]]; then
  set_modes on # the simulator test walks the approved-route flow (approve route, one stop at a time)
  # the live tests above signed in as the same demo accounts (and registered a driver): clear the login / register rate-limit counters so the app can sign in too
  ( cd "$ROOT/web" && node -e "const {Pool}=require('pg');const p=new Pool({connectionString:'postgres://dogorshom@localhost:5432/jr_logistics_test'});p.query('delete from rate_limits').then(()=>p.end())" )
  # the app's check-in is geofenced: put the simulator at the demo warehouse and pre-grant location / camera so no native prompt blocks the test.
  # Grant BEFORE the app runs (granting to a running app makes iOS terminate it); permissions survive the re-install of the same bundle id.
  SIM="${DEVICE:-iPhone 17 Pro}"
  # `flutter test` uninstalls the app when it ends, which also forgets the permissions: install it first so there is something to grant to.
  flutter build ios --simulator --debug --dart-define=API_BASE_URL="http://localhost:$PORT" >/dev/null
  xcrun simctl install booted build/ios/iphonesimulator/Runner.app
  xcrun simctl location booted set 24.7136,46.6753 2>/dev/null || true
  xcrun simctl privacy booted grant location com.jrlogistics.jrDriver >/dev/null 2>&1 || true
  xcrun simctl privacy booted grant camera com.jrlogistics.jrDriver >/dev/null 2>&1 || true
  flutter test integration_test/app_test.dart -d "$SIM" --dart-define=API_BASE_URL="http://localhost:$PORT" --reporter expanded
fi
