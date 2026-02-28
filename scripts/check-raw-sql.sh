#!/usr/bin/env bash
# check-raw-sql.sh — Guardrail to prevent new raw SQL usage outside approved legacy folders.
#
# This script detects new .prepare( and .exec( calls in files that are NOT in the
# approved legacy directories. It is designed to run in CI to block accidental
# introduction of raw SQL during the Drizzle ORM migration.
#
# Exit codes:
#   0 = no violations found
#   1 = violations found (new raw SQL in non-legacy files)
#
# Usage:
#   ./scripts/check-raw-sql.sh              # Check working tree
#   ./scripts/check-raw-sql.sh --diff HEAD  # Check only changed lines vs HEAD

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Approved legacy directories ───────────────────────────────────────────
# These directories contain existing raw SQL that will be migrated incrementally.
# New raw SQL in these directories is allowed until the module is migrated.
APPROVED_LEGACY=(
  "apps/cli/src/lib/database/index.ts"
  "apps/cli/src/lib/pmo/storage/"
  "apps/cli/src/lib/pmo/schema.ts"
  "apps/cli/src/lib/pmo/storage-sqlite.ts"
  "apps/cli/src/lib/pmo/utils.ts"
  "apps/cli/src/lib/pmo/index.ts"
  "apps/cli/src/lib/pmo/find-pmo.ts"
  "apps/cli/src/lib/pmo/diet.ts"
  "apps/cli/src/lib/execution/storage.ts"
  "apps/cli/src/lib/execution/config.ts"
  "apps/cli/src/lib/repos/index.ts"
  # Commands with existing raw SQL (to be refactored in Phase 7)
  "apps/cli/src/commands/ticket/epic.ts"
  "apps/cli/src/commands/ticket/reassign.ts"
  "apps/cli/src/commands/epic/ticket.ts"
  "apps/cli/src/commands/epic/project.ts"
  "apps/cli/src/commands/pmo/init.ts"
  "apps/cli/src/commands/execution/config.ts"
  "apps/cli/src/commands/repo/view.ts"
  "apps/cli/src/commands/branch/where.ts"
  "apps/cli/src/commands/claude/index.ts"
  # Drizzle ORM files (these are the migration target, not raw SQL)
  "apps/cli/src/lib/database/drizzle.ts"
  "apps/cli/src/lib/database/drizzle-schema.ts"
  # Test files are allowed to use raw SQL
  "apps/cli/test/"
)

# ─── Patterns to detect ──────────────────────────────────────────────────
RAW_SQL_PATTERN='\.prepare\(|\.exec\('

# ─── Build exclusion args ─────────────────────────────────────────────────
build_grep_excludes() {
  local excludes=()
  for path in "${APPROVED_LEGACY[@]}"; do
    excludes+=("--glob" "!${path}*")
  done
  echo "${excludes[@]}"
}

# ─── Mode: diff-only or full scan ─────────────────────────────────────────
DIFF_MODE=""
DIFF_REF=""
if [[ "${1:-}" == "--diff" ]]; then
  DIFF_MODE="true"
  DIFF_REF="${2:-HEAD}"
fi

violations=0

if [[ -n "$DIFF_MODE" ]]; then
  # Check only added/modified lines in the diff
  echo "Checking for new raw SQL in diff against ${DIFF_REF}..."

  # Get list of changed .ts files (Added or Modified)
  changed_files=$(cd "$REPO_ROOT" && git diff --name-only --diff-filter=AM "$DIFF_REF" -- 'apps/cli/src/**/*.ts' 2>/dev/null || true)

  if [[ -z "$changed_files" ]]; then
    echo "No TypeScript files changed. OK."
    exit 0
  fi

  for file in $changed_files; do
    # Skip approved legacy files
    skip=false
    for approved in "${APPROVED_LEGACY[@]}"; do
      if [[ "$file" == "$approved"* ]]; then
        skip=true
        break
      fi
    done
    if $skip; then
      continue
    fi

    # Check only added lines (lines starting with +, excluding +++ header)
    added_lines=$(cd "$REPO_ROOT" && git diff "$DIFF_REF" -- "$file" | grep '^+' | grep -v '^+++' | grep -E "$RAW_SQL_PATTERN" || true)

    if [[ -n "$added_lines" ]]; then
      echo ""
      echo "VIOLATION: New raw SQL detected in $file"
      echo "$added_lines" | while read -r line; do
        echo "  $line"
      done
      violations=$((violations + 1))
    fi
  done
else
  # Full scan mode — find ALL raw SQL outside approved directories
  echo "Scanning for raw SQL usage outside approved legacy directories..."

  # Use ripgrep if available, fall back to grep
  if command -v rg &>/dev/null; then
    # shellcheck disable=SC2046
    results=$(cd "$REPO_ROOT" && rg -n "$RAW_SQL_PATTERN" \
      --type ts \
      --glob 'apps/cli/src/**' \
      $(build_grep_excludes) \
      2>/dev/null || true)
  else
    # Fallback: use grep with find
    results=""
    while IFS= read -r file; do
      skip=false
      for approved in "${APPROVED_LEGACY[@]}"; do
        if [[ "$file" == *"$approved"* ]]; then
          skip=true
          break
        fi
      done
      if ! $skip; then
        matches=$(grep -nE "$RAW_SQL_PATTERN" "$file" 2>/dev/null || true)
        if [[ -n "$matches" ]]; then
          while IFS= read -r match; do
            results+="${file}:${match}"$'\n'
          done <<< "$matches"
        fi
      fi
    done < <(find "$REPO_ROOT/apps/cli/src" -name '*.ts' -type f)
  fi

  if [[ -n "$results" ]]; then
    echo ""
    echo "VIOLATIONS: Raw SQL found outside approved legacy directories:"
    echo ""
    echo "$results"
    violations=$(echo "$results" | grep -c '^' || true)
  fi
fi

echo ""
if [[ $violations -gt 0 ]]; then
  echo "FAILED: Found ${violations} file(s) with raw SQL outside approved legacy directories."
  echo ""
  echo "To fix:"
  echo "  1. Use the Drizzle ORM query builder instead of raw .prepare()/.exec()"
  echo "  2. Or add the file to the APPROVED_LEGACY list in scripts/check-raw-sql.sh"
  echo "     (only if migrating an existing module incrementally)"
  echo ""
  echo "See docs/drizzle-migration/ for migration guides and checklists."
  exit 1
else
  echo "OK: No raw SQL violations found."
  exit 0
fi
