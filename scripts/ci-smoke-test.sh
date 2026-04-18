#!/usr/bin/env bash
# CI Smoke Test: exercises real CLI commands to catch crashes.
# Any unhandled exception or segfault = CI failure.
#
# "Crash" means: exit code > 2 (signals, segfaults, unhandled throws).
# Exit 0-2 are normal oclif behavior (0 = success, 1-2 = handled error).
#
# This script runs from the repo root and expects the CLI to be built
# (dist/ must exist from a prior build step).
#
# Usage: bash scripts/ci-smoke-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$REPO_ROOT/apps/cli"
PRLT="node $CLI_DIR/bin/run.js"

SMOKE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/prlt-smoke-XXXXXX")
trap 'rm -rf "$SMOKE_DIR"' EXIT

PASS=0
FAIL=0
ERRORS=""

# Run a smoke test command.
# "must_succeed" mode: exit 0 required.
# "must_not_crash" mode: exit 0-2 OK (oclif handled errors); exit >2 = crash.
smoke() {
  local label="$1"
  local mode="$2"  # "must_succeed" or "must_not_crash"
  shift 2

  echo ""
  echo "--- Smoke: $label ---"
  echo "  \$ $*"

  set +e
  output=$("$@" 2>&1)
  actual_exit=$?
  set -e

  local ok=false
  if [ "$mode" = "must_succeed" ] && [ "$actual_exit" -eq 0 ]; then
    ok=true
  elif [ "$mode" = "must_not_crash" ] && [ "$actual_exit" -le 2 ]; then
    ok=true
  fi

  if [ "$ok" = true ]; then
    echo "  ✓ exit $actual_exit ($mode)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ exit $actual_exit ($mode)"
    echo "  Output (last 20 lines):"
    echo "$output" | tail -20 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $label (exit $actual_exit, mode=$mode)"
  fi
}

echo "========================================="
echo " prlt CLI Smoke Tests"
echo "========================================="
echo "CLI dir : $CLI_DIR"
echo "Temp dir: $SMOKE_DIR"
echo ""

# ─── Phase 1: Basic binary health ───────────────────────────────────
smoke "prlt --help"    must_succeed $PRLT --help
smoke "prlt --version" must_succeed $PRLT --version

# ─── Phase 2: HQ initialization ─────────────────────────────────────
HQ_DIR="$SMOKE_DIR/smoke-hq"
smoke "prlt new (create HQ)" must_succeed $PRLT new --json --name smoke-test --path "$HQ_DIR"

# All subsequent commands run from inside the HQ
cd "$HQ_DIR"

# ─── Phase 3: PMO / ticket commands ─────────────────────────────────
# ticket list may exit 1-2 if no work source is configured — that's a
# handled error, not a crash. We only care that it doesn't segfault.
smoke "prlt ticket list"   must_not_crash $PRLT ticket list --json
smoke "prlt ticket create" must_not_crash $PRLT ticket create --json --title "Smoke test ticket" --column Backlog --dry-run

# ─── Phase 4: Database commands ──────────────────────────────────────
smoke "prlt db repair --check-only" must_succeed $PRLT db repair --check-only

# ─── Phase 5: Work commands (help/dry-run — no git env needed) ───────
smoke "prlt work start --help"  must_succeed $PRLT work start --help
smoke "prlt work ship --help"   must_succeed $PRLT work ship --help

# ─── Phase 6: Other commands ────────────────────────────────────────
smoke "prlt whoami" must_not_crash $PRLT whoami --json

# ─── Summary ─────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo " Results: $PASS passed, $FAIL failed"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "FAILURES:$ERRORS"
  exit 1
fi
