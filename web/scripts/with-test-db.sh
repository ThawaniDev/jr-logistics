#!/bin/sh
# Runs a command while holding the lock of the shared test database (and the e2e port), so parallel workers never run two Vitest/Playwright runs at once.
# The lock is a directory (JR_TEST_LOCK overrides where it lives). Waiting is silent: a long wait means another run holds it (see $LOCK/pid).
#   scripts/with-test-db.sh npx vitest run tests/integration/fleet-reports.test.ts
LOCK=${JR_TEST_LOCK:-/private/tmp/claude-501/jr-test-db.lock}
mkdir -p "$(dirname "$LOCK")" # on a machine without that folder mkdir failed every time and the script waited for ever
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ -f "$LOCK/pid" ]; then
    if ! kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then rm -rf "$LOCK"; continue; fi # the holder died
  elif [ -n "$(find "$LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then rm -rf "$LOCK"; continue; fi # no pid file for over a minute: the holder was killed between mkdir and the write (this left three runs waiting for 4 hours)
  sleep 3
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM
"$@"
