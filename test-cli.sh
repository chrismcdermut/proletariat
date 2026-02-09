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

# Clear environment variables that could cause test data to leak into production databases.
# In devcontainer environments, PRLT_HQ_PATH and DEVCONTAINER are set and would cause the CLI
# to use the production database at /hq/.proletariat/workspace.db instead of the test directory.
unset PRLT_HQ_PATH
unset PRLT_PMO_PATH
unset PRLT_DATABASE_PATH
unset PRLT_CONFIG_PATH
unset DEVCONTAINER
unset PRLT_TEST_ENV

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

# Create HQ using JSON mode (non-interactive)
node "$CLI_PATH" init --json --name test-hq --no-pmo

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

# Test 2: HQ with PMO enabled
echo -e "\n${GREEN}Test 2: HQ with PMO${NC}"
cd $TEST_DIR

# Create HQ with PMO
node "$CLI_PATH" init --json --name test-pmo-hq --pmo

if [ -f "test-pmo-hq-hq/.proletariat/config.json" ]; then
    echo -e "${GREEN}✓ HQ with PMO created${NC}"
else
    echo -e "${RED}✗ HQ with PMO creation failed${NC}"
    exit 1
fi

# Test 3: HQ with agents
echo -e "\n${GREEN}Test 3: HQ with agents${NC}"
cd $TEST_DIR

# Create HQ with agents
node "$CLI_PATH" init --json --name test-agents-hq --agents bezos,musk --no-pmo

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

# Create another HQ and check JSON output
OUTPUT=$(node "$CLI_PATH" init --json --name json-test-hq --no-pmo)
if echo "$OUTPUT" | grep -q '"success": true'; then
    echo -e "${GREEN}✓ JSON output format correct${NC}"
else
    echo -e "${RED}✗ JSON output format incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 6: Project list JSON output
echo -e "\n${GREEN}Test 6: Project list JSON output${NC}"
cd $TEST_DIR/test-pmo-hq-hq

OUTPUT=$(node "$CLI_PATH" project list --json)
if echo "$OUTPUT" | grep -q '"projects"'; then
    echo -e "${GREEN}✓ project list --json returns projects array${NC}"
else
    echo -e "${RED}✗ project list --json output incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

if echo "$OUTPUT" | grep -q '"success": true'; then
    echo -e "${GREEN}✓ project list --json returns success${NC}"
else
    echo -e "${RED}✗ project list --json missing success field${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 7: Project archive/unarchive JSON mode
echo -e "\n${GREEN}Test 7: Project archive JSON mode${NC}"
cd $TEST_DIR/test-pmo-hq-hq

# Archive the default project with force flag
OUTPUT=$(node "$CLI_PATH" project archive default --force --json 2>&1 || true)
if echo "$OUTPUT" | grep -q '"error"' || echo "$OUTPUT" | grep -q 'Archived'; then
    echo -e "${GREEN}✓ project archive --json works${NC}"
else
    echo -e "${RED}✗ project archive --json output incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 8: Project unarchive JSON error handling
echo -e "\n${GREEN}Test 8: Project unarchive JSON error handling${NC}"
cd $TEST_DIR/test-pmo-hq-hq

# Try to unarchive non-existent project
OUTPUT=$(node "$CLI_PATH" project unarchive nonexistent --json 2>&1 || true)
if echo "$OUTPUT" | grep -q '"error"' && echo "$OUTPUT" | grep -q 'PROJECT_NOT_FOUND'; then
    echo -e "${GREEN}✓ project unarchive --json returns proper error${NC}"
else
    echo -e "${RED}✗ project unarchive --json error handling incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Use unique project names based on test run PID
TEST_PROJECT="test-project-$$"
TEST_DELETE_PROJECT="test-delete-$$"

# Test 9: Create a test project for subsequent tests
echo -e "\n${GREEN}Test 9: Create test project${NC}"
cd $TEST_DIR/test-pmo-hq-hq

OUTPUT=$(node "$CLI_PATH" project create --name "Test Project $$" --id "$TEST_PROJECT" --json)
if echo "$OUTPUT" | grep -q '"success": true' && echo "$OUTPUT" | grep -q '"id"'; then
    echo -e "${GREEN}✓ project create --json returns success with id${NC}"
else
    echo -e "${RED}✗ project create --json output incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 10: Project view JSON output includes board data
echo -e "\n${GREEN}Test 10: Project view JSON output${NC}"
cd $TEST_DIR/test-pmo-hq-hq

OUTPUT=$(node "$CLI_PATH" project view "$TEST_PROJECT" --json)
if echo "$OUTPUT" | grep -q '"columns"' && echo "$OUTPUT" | grep -q '"success": true'; then
    echo -e "${GREEN}✓ project view --json returns board data${NC}"
else
    echo -e "${RED}✗ project view --json output incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 11: Project delete JSON prompt has command field
echo -e "\n${GREEN}Test 11: Project delete JSON prompt with command field${NC}"
cd $TEST_DIR/test-pmo-hq-hq

# Create another project first
node "$CLI_PATH" project create --name "Test Delete Project $$" --id "$TEST_DELETE_PROJECT" --json > /dev/null

# Now test delete prompt (without providing ID to trigger project selection)
OUTPUT=$(node "$CLI_PATH" project delete --json 2>&1 || true)
if echo "$OUTPUT" | grep -q '"command"' && echo "$OUTPUT" | grep -q '"prompt"'; then
    echo -e "${GREEN}✓ project delete --json returns prompt with command field${NC}"
else
    echo -e "${RED}✗ project delete --json missing command field in prompt${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 12: Project archive confirmation prompt has command field
echo -e "\n${GREEN}Test 12: Project archive confirmation prompt${NC}"
cd $TEST_DIR/test-pmo-hq-hq

OUTPUT=$(node "$CLI_PATH" project archive "$TEST_DELETE_PROJECT" --json 2>&1 || true)
if echo "$OUTPUT" | grep -q '"command"' && echo "$OUTPUT" | grep -q 'force'; then
    echo -e "${GREEN}✓ project archive --json confirmation has command with --force${NC}"
else
    echo -e "${RED}✗ project archive --json confirmation missing proper command${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 13: Project create JSON mode outputs form prompt
echo -e "\n${GREEN}Test 13: Project create JSON form prompt${NC}"
cd $TEST_DIR/test-pmo-hq-hq

OUTPUT=$(node "$CLI_PATH" project create --interactive --json 2>&1 || true)
if echo "$OUTPUT" | grep -q '"fields"' || echo "$OUTPUT" | grep -q '"prompt"'; then
    echo -e "${GREEN}✓ project create --json outputs form prompt${NC}"
else
    echo -e "${RED}✗ project create --json form prompt incorrect${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Test 14: Project spec JSON output includes available commands
echo -e "\n${GREEN}Test 14: Project spec JSON output${NC}"
cd $TEST_DIR/test-pmo-hq-hq

OUTPUT=$(node "$CLI_PATH" project spec "$TEST_PROJECT" --json 2>&1 || true)
if echo "$OUTPUT" | grep -q '"commands"' && echo "$OUTPUT" | grep -q 'addSpec'; then
    echo -e "${GREEN}✓ project spec --json includes available commands${NC}"
else
    echo -e "${RED}✗ project spec --json missing commands${NC}"
    echo "Output was: $OUTPUT"
    exit 1
fi

# Clean up
cd $OLDPWD
rm -rf $TEST_DIR

echo -e "\n${GREEN}✅ All tests passed!${NC}"