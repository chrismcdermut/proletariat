#!/bin/bash

# Run all tests for Proletariat CLI
# Usage: ./scripts/run-tests.sh [unit|integration|all]

set -e

echo "🧪 Proletariat CLI Test Runner"
echo "=============================="
echo ""

# Default to running all tests
TEST_TYPE=${1:-all}

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to run tests and check result
run_test() {
    local test_name=$1
    local test_command=$2
    
    echo -e "${YELLOW}Running ${test_name}...${NC}"
    echo "Command: ${test_command}"
    echo ""
    
    if eval "${test_command}"; then
        echo -e "${GREEN}✅ ${test_name} passed!${NC}"
        return 0
    else
        echo -e "${RED}❌ ${test_name} failed!${NC}"
        return 1
    fi
}

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from the CLI package directory${NC}"
    exit 1
fi

# Build the project first
echo -e "${YELLOW}Building project...${NC}"
ppnpm run build
echo -e "${GREEN}✅ Build complete${NC}"
echo ""

# Track test results
TESTS_FAILED=0

case $TEST_TYPE in
    unit)
        echo "Running Unit Tests Only"
        echo "----------------------"
        run_test "Unit Tests" "pnpm test" || TESTS_FAILED=$((TESTS_FAILED + 1))
        ;;
    
    integration)
        echo "Running Integration Tests Only"
        echo "-----------------------------"
        run_test "Integration Tests" "pnpm run test:integration" || TESTS_FAILED=$((TESTS_FAILED + 1))
        ;;
    
    all)
        echo "Running All Tests"
        echo "----------------"
        run_test "Unit Tests" "pnpm test" || TESTS_FAILED=$((TESTS_FAILED + 1))
        echo ""
        run_test "Integration Tests" "pnpm run test:integration" || TESTS_FAILED=$((TESTS_FAILED + 1))
        ;;
    
    coverage)
        echo "Running All Tests with Coverage"
        echo "-------------------------------"
        run_test "Unit Tests with Coverage" "pnpm run test:coverage" || TESTS_FAILED=$((TESTS_FAILED + 1))
        echo ""
        run_test "Integration Tests with Coverage" "pnpm run test:integration:coverage" || TESTS_FAILED=$((TESTS_FAILED + 1))
        echo ""
        echo -e "${YELLOW}Coverage reports generated:${NC}"
        echo "  - Unit: ./coverage/"
        echo "  - Integration: ./coverage-integration/"
        ;;
    
    watch)
        echo "Starting Test Watcher"
        echo "--------------------"
        echo "Press Ctrl+C to exit"
        pnpm run test:watch
        ;;
    
    *)
        echo -e "${RED}Invalid test type: $TEST_TYPE${NC}"
        echo "Usage: $0 [unit|integration|all|coverage|watch]"
        exit 1
        ;;
esac

echo ""
echo "=============================="

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✨ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}⚠️ ${TESTS_FAILED} test suite(s) failed${NC}"
    exit 1
fi