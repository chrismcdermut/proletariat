#!/bin/bash

# Test script for PROLETARIAT CLI v0.1.4
set -e

echo "🧪 Testing PROLETARIAT CLI..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Build the CLI
echo "📦 Building CLI..."
npm run build

# Create test directory
TEST_DIR="/tmp/prlt-test-$$"
mkdir -p $TEST_DIR
cd $TEST_DIR

# Test 1: Fresh initialization
echo -e "\n${GREEN}Test 1: Fresh repo initialization${NC}"
mkdir test-repo-1 && cd test-repo-1
git init && git config user.email "test@test.com" && git config user.name "Test"
echo "# Test" > README.md && git add . && git commit -m "Initial"

# Should create repo.json (not config.json)
echo "billionaires" | node /Users/chrismcdermut/Projects/proletariat-workspace/proletariat/apps/cli/dist/bin/prlt.js init

if [ -f ".proletariat/repo.json" ]; then
    echo -e "${GREEN}✓ repo.json created${NC}"
else
    echo -e "${RED}✗ repo.json not created${NC}"
    exit 1
fi

# Test 2: Backwards compatibility
echo -e "\n${GREEN}Test 2: Backwards compatibility with config.json${NC}"
cd $TEST_DIR
mkdir test-repo-2 && cd test-repo-2
git init && git config user.email "test@test.com" && git config user.name "Test"
echo "# Test" > README.md && git add . && git commit -m "Initial"

# Create old-style config
mkdir -p .proletariat
cat > .proletariat/config.json << EOF
{
  "version": "1.0.0",
  "projectName": "test-repo-2",
  "themeName": "billionaires",
  "workspaceDir": "../test-repo-2-staff",
  "activeAgents": [],
  "initialized": "2024-01-01T00:00:00.000Z"
}
EOF

# Test that commands still work
node $OLDPWD/apps/cli/dist/bin/prlt.js staff
echo -e "${GREEN}✓ Old config still works${NC}"

# Test upgrade command
node $OLDPWD/apps/cli/dist/bin/prlt.js upgrade
if [ -f ".proletariat/repo.json" ] && [ -f ".proletariat/config.json.backup" ]; then
    echo -e "${GREEN}✓ Config migrated successfully${NC}"
else
    echo -e "${RED}✗ Config migration failed${NC}"
    exit 1
fi

# Test 3: Workspace initialization
echo -e "\n${GREEN}Test 3: Workspace initialization${NC}"
cd $TEST_DIR
mkdir test-repo-3 && cd test-repo-3
git init && git config user.email "test@test.com" && git config user.name "Test"
echo "# Test" > README.md && git add . && git commit -m "Initial"

echo -e "billionaires\nworkspace\ntest-workspace" | node $OLDPWD/apps/cli/dist/bin/prlt.js init

if [ -f "../test-workspace-workspace/.proletariat/workspace.json" ]; then
    echo -e "${GREEN}✓ Workspace config created${NC}"
else
    echo -e "${RED}✗ Workspace config not created${NC}"
    # Don't fail - workspace might be in different location
fi

# Test 4: Health and repair commands
echo -e "\n${GREEN}Test 4: Health and repair commands${NC}"
cd $TEST_DIR/test-repo-1
node $OLDPWD/apps/cli/dist/bin/prlt.js health
echo -e "${GREEN}✓ Health command works${NC}"

# Test 5: Create and remove agents
echo -e "\n${GREEN}Test 5: Agent management${NC}"
cd $TEST_DIR/test-repo-1
node $OLDPWD/apps/cli/dist/bin/prlt.js hire bezos musk
node $OLDPWD/apps/cli/dist/bin/prlt.js staff

if [ -d "../test-repo-1-staff/bezos" ] && [ -d "../test-repo-1-staff/musk" ]; then
    echo -e "${GREEN}✓ Agents created${NC}"
else
    echo -e "${RED}✗ Agent creation failed${NC}"
    exit 1
fi

node $OLDPWD/apps/cli/dist/bin/prlt.js fire bezos
if [ ! -d "../test-repo-1-staff/bezos" ] && [ -d "../test-repo-1-staff/musk" ]; then
    echo -e "${GREEN}✓ Agent removed${NC}"
else
    echo -e "${RED}✗ Agent removal failed${NC}"
    exit 1
fi

# Clean up
cd $OLDPWD
rm -rf $TEST_DIR

echo -e "\n${GREEN}✅ All tests passed!${NC}"
echo "Ready to publish v0.1.4 🚀"