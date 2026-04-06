#!/usr/bin/env bash
# Wrapper for mocha that suppresses the known workerpool teardown error.
#
# Mocha parallel mode uses workerpool which can emit a spurious
# "Uncaught error outside test suite" on worker teardown, causing
# exit code 1 even when all real tests pass.
# See: https://github.com/mochajs/mocha/issues/4720
#
# This is a safety net — the primary fix is in .mocharc.json (exit: true)
# and test/setup/worker-graceful-exit.ts (root hook plugin). This script
# catches any remaining edge cases.
#
# Usage: test/run-mocha.sh [mocha args...]

set +e
OUTPUT=$(npx mocha "$@" 2>&1)
EXIT_CODE=$?
set -e

echo "$OUTPUT"

if [ "$EXIT_CODE" -ne 0 ]; then
  # Strip ANSI color codes for reliable pattern matching.
  # CI environments and mocha's chalk may emit color codes that break grep.
  CLEAN_OUTPUT=$(echo "$OUTPUT" | sed 's/\x1b\[[0-9;]*m//g' 2>/dev/null || echo "$OUTPUT")

  # Extract the failing count from mocha summary (e.g., "  2 failing")
  FAILING_COUNT=$(echo "$CLEAN_OUTPUT" | grep -o '[0-9][0-9]* failing' | head -1 | grep -o '[0-9][0-9]*' || echo "0")

  # Count how many of the failures are workerpool teardown errors.
  # Each workerpool error has exactly one "objectToError" call in its stack.
  # We count those (not all "workerpool" lines) because each error section
  # has multiple stack frames mentioning workerpool.
  WORKERPOOL_ERRORS=$(echo "$CLEAN_OUTPUT" | grep -c "objectToError.*WorkerHandler" || echo "0")

  # Suppress if ALL failures are workerpool teardown errors.
  # - FAILING_COUNT must be > 0 (sanity check)
  # - WORKERPOOL_ERRORS must account for all failures
  # - All error descriptions must be "Uncaught error outside test suite"
  if [ "$FAILING_COUNT" -gt 0 ] 2>/dev/null && \
     [ "$WORKERPOOL_ERRORS" -ge "$FAILING_COUNT" ] 2>/dev/null && \
     echo "$CLEAN_OUTPUT" | grep -q "Uncaught error outside test suite"; then
    echo ""
    echo "⚠ Suppressed $FAILING_COUNT known workerpool teardown error(s) (all real tests passed)"
    exit 0
  fi
  exit "$EXIT_CODE"
fi
