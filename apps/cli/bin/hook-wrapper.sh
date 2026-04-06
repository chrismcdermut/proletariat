#!/bin/bash
# TKT-009: Hook wrapper that validates JSON on stdin before passing to the command.
#
# Claude Code sends hook data as JSON on stdin. When a session terminates
# abnormally (e.g. tmux kill-session), the data can be malformed or empty.
# This wrapper reads stdin, validates it's valid JSON, and either passes it
# through or substitutes a minimal fallback payload so downstream consumers
# (claude-notifications-go, prlt session report, etc.) never see parse errors.
#
# Usage:
#   echo '{"valid":"json"}' | hook-wrapper.sh <command> [args...]
#   Configured as: /home/node/.claude/hooks/hook-wrapper.sh prlt session report --agent "$PRLT_AGENT_NAME" --status exited

set -euo pipefail

# Read all of stdin (may be empty or malformed on abnormal termination)
INPUT=$(cat 2>/dev/null || true)

# If empty, provide a minimal fallback
if [ -z "$INPUT" ]; then
  INPUT='{"hook_wrapper":"fallback","reason":"empty_stdin"}'
fi

# Validate JSON — if invalid, substitute a fallback that preserves the raw data
# for debugging. Use jq if available, otherwise try python3, otherwise basic check.
validate_json() {
  if command -v jq >/dev/null 2>&1; then
    echo "$INPUT" | jq '.' >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    echo "$INPUT" | python3 -c 'import sys,json; json.load(sys.stdin)' 2>/dev/null
  else
    # Fallback: basic check — must start with { or [
    case "$INPUT" in
      '{'*|'['*) return 0 ;;
      *) return 1 ;;
    esac
  fi
}

if ! validate_json; then
  # Preserve the raw data in a JSON-safe way for debugging
  ESCAPED=$(echo "$INPUT" | head -c 200 | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' ' ')
  INPUT="{\"hook_wrapper\":\"fallback\",\"reason\":\"invalid_json\",\"raw_truncated\":\"$ESCAPED\"}"
fi

# Execute the wrapped command with validated JSON on stdin
if [ $# -eq 0 ]; then
  # No command given — just output the validated JSON (useful for testing)
  echo "$INPUT"
else
  echo "$INPUT" | exec "$@"
fi
