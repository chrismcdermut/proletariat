#!/bin/bash

# Test script for PROLETARIAT CLI v0.1.4
set -e

echo "🧪 Testing PROLETARIAT CLI..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_PATH="$SCRIPT_DIR/apps/cli/bin/run.js"

# Build the CLI
echo "📦 Building CLI..."
npm run build

# Create test directory
TEST_DIR="/tmp/prlt-test-$$"
mkdir -p $TEST_DIR
cd $TEST_DIR

# Test 1: HQ initialization using JSON mode
echo -e "\n${GREEN}Test 1: HQ initialization (JSON mode)${NC}"
cd $TEST_DIR

# Create HQ using JSON mode (non-interactive) - PMO is always included
node "$CLI_PATH" init --json --name test-hq

if [ -f "test-hq-hq/.proletariat/config.json" ]; then
    echo -e "${GREEN}✓ HQ config.json created${NC}"
else
    echo -e "${RED}✗ HQ config.json not created${NC}"
    exit 1
fi

if [ -f "test-hq-hq/.proletariat/workspace.db" ]; then
    echo -e "${GREEN}✓ workspace.db created${NC}"
else
    echo -e "${RED}✗ workspace.db not created${NC}"
    exit 1
fi

# Test 2: HQ initialization (verify PMO is created)
echo -e "\n${GREEN}Test 2: HQ with PMO (PMO is always included)${NC}"
cd $TEST_DIR

# Create HQ - PMO is now always included
node "$CLI_PATH" init --json --name test-pmo-hq

if [ -f "test-pmo-hq-hq/.proletariat/config.json" ]; then
    echo -e "${GREEN}✓ HQ with PMO created${NC}"
else
    echo -e "${RED}✗ HQ with PMO creation failed${NC}"
    exit 1
fi

# Test 3: HQ with agents
echo -e "\n${GREEN}Test 3: HQ with agents${NC}"
cd $TEST_DIR

# Create HQ with agents (PMO is always included)
node "$CLI_PATH" init --json --name test-agents-hq --agents bezos,musk

if [ -d "test-agents-hq-hq/agents/staff" ]; then
    echo -e "${GREEN}✓ Agents directory created${NC}"
else
    echo -e "${RED}✗ Agents directory not created${NC}"
    exit 1
fi

# Test 4: Verify HQ structure
echo -e "\n${GREEN}Test 4: Verify HQ structure${NC}"
cd $TEST_DIR/test-hq-hq

# Check required directories exist
if [ -d "repos" ] && [ -d "agents" ]; then
    echo -e "${GREEN}✓ HQ directory structure correct${NC}"
else
    echo -e "${RED}✗ HQ directory structure incorrect${NC}"
    exit 1
fi

# Test 5: Verify JSON output format
echo -e "\n${GREEN}Test 5: Verify JSON output${NC}"
cd $TEST_DIR

# Create another HQ and check JSON output (PMO is always included)
OUTPUT=$(node "$CLI_PATH" init --json --name json-test-hq)
if echo "$OUTPUT" | grep -q '"success": true'; then
    echo -e "${GREEN}✓ JSON output format correct${NC}"
else
    echo -e "${RED}✗ JSON output format incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Clean up
cd $OLDPWD
rm -rf $TEST_DIR

echo -e "\n${GREEN}✅ All tests passed!${NC}"