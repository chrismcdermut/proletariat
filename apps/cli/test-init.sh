#!/bin/bash
set -e

# Test script for prlt init command

# Clean up any test directories from previous runs
rm -rf /tmp/test-init-*

echo "=== Testing prlt init scenarios ==="
echo ""

# Test 1: Outside git repo - should work with HQ suffix choice
echo "Test 1: Initialize outside git repo"
mkdir -p /tmp/test-init-outside
cd /tmp/test-init-outside
echo "Current dir: $(pwd)"
echo "Run: ./bin/run.js init"
echo "(Follow prompts: name=testcompany, add suffix=yes, location=default)"
echo ""

# Test 2: Inside git repo - should suggest sibling directory
echo "Test 2: Initialize inside git repo"
mkdir -p /tmp/test-init-repo
cd /tmp/test-init-repo
git init
echo "Current dir: $(pwd)"
echo "Run: ./bin/run.js init"
echo "(Follow prompts: name=myproject, add suffix=yes, location=../myproject-hq)"
echo ""

# Test 3: Try to create inside git repo (should fail)
echo "Test 3: Try to create HQ inside git repo (should fail)"
mkdir -p /tmp/test-init-jail
cd /tmp/test-init-jail
git init
echo "Current dir: $(pwd)"
echo "Run: ./bin/run.js init"
echo "(Follow prompts: name=jail, add suffix=no, location=./jail)"
echo "This should fail with 'That's jail!' error"
echo ""


echo "=== Test scenarios prepared ==="
echo "Now run each test manually to verify interactive prompts work correctly"