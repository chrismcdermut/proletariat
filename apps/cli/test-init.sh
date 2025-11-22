#!/bin/bash

# Simple integration test for prlt init command
set -e

echo "🧪 Testing prlt init command..."

# Create temp directory for testing
TEST_DIR=$(mktemp -d)
cd $TEST_DIR

# Create a test git repo
mkdir test-repo
cd test-repo
git init
git remote add origin https://github.com/test/test.git
echo "# Test" > README.md
git add .
git commit -m "Initial commit"

# Test 1: Run init in non-interactive mode with HQ
echo "✅ Test 1: Initialize with HQ..."
node /Users/chrismcdermut/Projects/proletariat-hq/proletariat/apps/cli/dist/bin/prlt.js init --hq test-hq --theme billionaires || true

# Check if HQ was created
if [ -d "../test-hq" ]; then
  echo "  ✓ HQ directory created"
else
  echo "  ✗ HQ directory not created"
  exit 1
fi

# Check if PMO was created
if [ -d "../test-hq/pmo" ]; then
  echo "  ✓ PMO directory created"
else
  echo "  ✗ PMO directory not created"
  exit 1
fi

# Check if config was created
if [ -f ".proletariat/repo.json" ]; then
  echo "  ✓ Repo config created"
else
  echo "  ✗ Repo config not created"
  exit 1
fi

echo ""
echo "✅ All tests passed!"
echo "Test directory: $TEST_DIR"

# Cleanup
cd /
rm -rf $TEST_DIR