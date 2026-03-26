#!/usr/bin/env bash
# Wrapper for mocha that suppresses the known workerpool teardown error.
#
# Mocha parallel mode uses workerpool which can emit a spurious
# "Uncaught error outside test suite" on worker teardown, causing
# exit code 1 even when all real tests pass.
# See: https://github.com/mochajs/mocha/issues/4720
#
# Usage: test/run-mocha.sh [mocha args...]

set +e
OUTPUT=$(npx mocha "$@" 2>&1)
EXIT_CODE=$?
set -e

echo "$OUTPUT"

if [ "$EXIT_CODE" -ne 0 ]; then
  # Check if the only failure is the workerpool teardown error
  FAILING_COUNT=$(echo "$OUTPUT" | grep -oP '(\d+) failing' | head -1 | grep -oP '\d+' || echo "0")
  if [ "$FAILING_COUNT" = "1" ] && echo "$OUTPUT" | grep -q "Uncaught error outside test suite" && echo "$OUTPUT" | grep -q "workerpool/src/WorkerHandler"; then
    echo ""
    echo "⚠ Suppressed known workerpool teardown error (all real tests passed)"
    exit 0
  fi
  exit "$EXIT_CODE"
fi
