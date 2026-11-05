#!/usr/bin/env bash
# Spins up an isolated Next.js server on the TEST database, seeds it, runs the live Dart integration tests,
# optionally the iOS-simulator end-to-end test (pass --e2e), then tears everything down.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)/.."
PORT=3100
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
JR_API="http://localhost:$PORT" flutter test test/integration --tags live --reporter expanded
if [[ "${1:-}" == "--e2e" ]]; then
  flutter test integration_test/app_test.dart -d "${DEVICE:-iPhone 17 Pro}" --dart-define=API_BASE_URL="http://localhost:$PORT" --reporter expanded
fi
