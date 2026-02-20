#!/usr/bin/env bash
# bump-homebrew-formula.sh — Update the Homebrew tap formula for @proletariat/cli
#
# Usage:
#   ./scripts/bump-homebrew-formula.sh [version]
#
# If version is not provided, reads from apps/cli/package.json.
#
# Environment variables:
#   GH_TOKEN    — GitHub token with repo push access to the tap (required in CI)
#   TAP_REPO    — Tap repository (default: chrismcdermut/homebrew-tap)
#   CREATE_PR   — Set to "true" to open a PR instead of pushing directly to main
#
set -euo pipefail

TAP_REPO="${TAP_REPO:-chrismcdermut/homebrew-tap}"
CREATE_PR="${CREATE_PR:-false}"
NPM_PACKAGE="@proletariat/cli"
FORMULA_PATH="Formula/prlt.rb"

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  VERSION="$(node -p "require('$REPO_ROOT/apps/cli/package.json').version")"
fi

echo "==> Bumping Homebrew formula to version ${VERSION}"

# ---------------------------------------------------------------------------
# Fetch the npm tarball URL and compute sha256
# ---------------------------------------------------------------------------
TARBALL_URL="https://registry.npmjs.org/${NPM_PACKAGE}/-/cli-${VERSION}.tgz"
echo "==> Fetching tarball: ${TARBALL_URL}"

# Retry a few times — the tarball may not be available immediately after publish
MAX_RETRIES=5
RETRY_DELAY=10
for i in $(seq 1 "$MAX_RETRIES"); do
  HTTP_CODE=$(curl -s -o /tmp/prlt-tarball.tgz -w '%{http_code}' -L "$TARBALL_URL")
  if [ "$HTTP_CODE" = "200" ]; then
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: Failed to download tarball after ${MAX_RETRIES} attempts (HTTP ${HTTP_CODE})"
    exit 1
  fi
  echo "    Tarball not ready (HTTP ${HTTP_CODE}), retrying in ${RETRY_DELAY}s… (${i}/${MAX_RETRIES})"
  sleep "$RETRY_DELAY"
done

SHA256=$(shasum -a 256 /tmp/prlt-tarball.tgz | awk '{print $1}')
echo "==> SHA256: ${SHA256}"
rm -f /tmp/prlt-tarball.tgz

# ---------------------------------------------------------------------------
# Clone the tap repo
# ---------------------------------------------------------------------------
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Cloning ${TAP_REPO}…"
if [ -n "${GH_TOKEN:-}" ]; then
  git clone --depth 1 "https://x-access-token:${GH_TOKEN}@github.com/${TAP_REPO}.git" "$WORK_DIR/tap"
else
  git clone --depth 1 "https://github.com/${TAP_REPO}.git" "$WORK_DIR/tap"
fi

# ---------------------------------------------------------------------------
# Update the formula
# ---------------------------------------------------------------------------
FORMULA_FILE="$WORK_DIR/tap/${FORMULA_PATH}"
if [ ! -f "$FORMULA_FILE" ]; then
  echo "ERROR: Formula not found at ${FORMULA_PATH}"
  exit 1
fi

echo "==> Updating formula…"

# Replace the url line
sed -i "s|url \".*\"|url \"${TARBALL_URL}\"|" "$FORMULA_FILE"
# Replace the sha256 line
sed -i "s|sha256 \".*\"|sha256 \"${SHA256}\"|" "$FORMULA_FILE"

echo "==> Updated formula:"
cat "$FORMULA_FILE"

# ---------------------------------------------------------------------------
# Commit and push (or open PR)
# ---------------------------------------------------------------------------
cd "$WORK_DIR/tap"
git config user.email "release-bot@proletariat.ai"
git config user.name "proletariat-release-bot"

# Check if anything actually changed
if git diff --quiet; then
  echo "==> Formula already up to date — nothing to commit."
  exit 0
fi

BRANCH="bump-prlt-${VERSION}"

if [ "$CREATE_PR" = "true" ]; then
  git checkout -b "$BRANCH"
  git add "$FORMULA_PATH"
  git commit -m "chore: bump prlt to ${VERSION}"
  git push origin "$BRANCH"
  PR_URL=$(gh pr create \
    --repo "$TAP_REPO" \
    --title "chore: bump prlt to ${VERSION}" \
    --body "Automated formula bump for @proletariat/cli v${VERSION}." \
    --head "$BRANCH" \
    --base main)
  echo "==> Pull request created: ${PR_URL}"
  echo "pr_url=${PR_URL}" >> "${GITHUB_OUTPUT:-/dev/null}"
else
  git add "$FORMULA_PATH"
  git commit -m "chore: bump prlt to ${VERSION}"
  git push origin main
  COMMIT_SHA=$(git rev-parse HEAD)
  echo "==> Pushed to main: https://github.com/${TAP_REPO}/commit/${COMMIT_SHA}"
  echo "commit_sha=${COMMIT_SHA}" >> "${GITHUB_OUTPUT:-/dev/null}"
fi

echo "==> Formula version: ${VERSION}"
echo "formula_version=${VERSION}" >> "${GITHUB_OUTPUT:-/dev/null}"
