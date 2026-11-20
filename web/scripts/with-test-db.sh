#!/bin/sh
# Runs a command while holding the lock of the shared test database + port 3100, so parallel workers never run two Vitest/Playwright runs at once.
#   scripts/with-test-db.sh npx vitest run tests/integration/fleet-reports.test.ts
LOCK=/private/tmp/claude-501/jr-test-db.lock
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ -f "$LOCK/pid" ] && ! kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then rm -rf "$LOCK"; continue; fi # the holder died
  sleep 3
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM
"$@"
