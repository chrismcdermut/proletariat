#!/usr/bin/env bash
# CI Smoke Test: exercises real CLI commands to catch crashes.
# Any unhandled exception or segfault = CI failure.
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

# Run a smoke test command. Expected exit code defaults to 0.
# Usage: smoke "label" expected_exit command [args...]
smoke() {
  local label="$1"
  local expected_exit="$2"
  shift 2

  echo ""
  echo "--- Smoke: $label ---"
  echo "  \$ $*"

  set +e
  output=$("$@" 2>&1)
  actual_exit=$?
  set -e

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "  ✓ exit $actual_exit (expected $expected_exit)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ exit $actual_exit (expected $expected_exit)"
    echo "  Output (last 20 lines):"
    echo "$output" | tail -20 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $label (exit $actual_exit, expected $expected_exit)"
  fi
}

echo "========================================="
echo " prlt CLI Smoke Tests"
echo "========================================="
echo "CLI dir : $CLI_DIR"
echo "Temp dir: $SMOKE_DIR"
echo ""

# ─── Phase 1: Basic binary health ───────────────────────────────────
smoke "prlt --help"    0 $PRLT --help
smoke "prlt --version" 0 $PRLT --version

# ─── Phase 2: HQ initialization ─────────────────────────────────────
HQ_DIR="$SMOKE_DIR/smoke-hq"
smoke "prlt new (create HQ)" 0 $PRLT new --json --name smoke-test --path "$HQ_DIR"

# All subsequent commands run from inside the HQ
cd "$HQ_DIR"

# ─── Phase 3: PMO / ticket commands ─────────────────────────────────
smoke "prlt ticket list (empty board)" 0 $PRLT ticket list --json

# Create a ticket so we can exercise work commands
smoke "prlt ticket create" 0 $PRLT ticket create --json --title "Smoke test ticket" --column Backlog --dry-run

# ─── Phase 4: Database commands ──────────────────────────────────────
smoke "prlt db repair --check-only" 0 $PRLT db repair --check-only

# ─── Phase 5: Work commands (help/dry-run — no git env needed) ───────
smoke "prlt work start --help"  0 $PRLT work start --help
smoke "prlt work ship --help"   0 $PRLT work ship --help

# ─── Phase 6: Other commands ────────────────────────────────────────
smoke "prlt whoami"  0 $PRLT whoami --json

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
