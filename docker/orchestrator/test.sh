#!/bin/bash
#
# Test script for orchestrator Docker support
#
# This script validates that:
# 1. The Dockerfile builds successfully
# 2. The image contains required tools (prlt, tmux, docker)
# 3. The orchestrator start command accepts Docker flags
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="${PRLT_ORCHESTRATOR_IMAGE:-prlt-orchestrator:latest}"

echo "🧪 Testing Orchestrator Docker Support"
echo "========================================"
echo ""

# Test 1: Build the image
echo "Test 1: Building Docker image..."
if ./build.sh --local; then
  echo "✓ Docker image built successfully"
else
  echo "✗ Failed to build Docker image"
  exit 1
fi
echo ""

# Test 2: Verify prlt CLI is installed
echo "Test 2: Verifying prlt CLI in image..."
if docker run --rm "$IMAGE_NAME" prlt --version > /dev/null 2>&1; then
  PRLT_VERSION=$(docker run --rm "$IMAGE_NAME" prlt --version 2>&1 | head -1)
  echo "✓ prlt CLI found: $PRLT_VERSION"
else
  echo "✗ prlt CLI not found in image"
  exit 1
fi
echo ""

# Test 3: Verify tmux is installed
echo "Test 3: Verifying tmux in image..."
if docker run --rm "$IMAGE_NAME" tmux -V > /dev/null 2>&1; then
  TMUX_VERSION=$(docker run --rm "$IMAGE_NAME" tmux -V)
  echo "✓ tmux found: $TMUX_VERSION"
else
  echo "✗ tmux not found in image"
  exit 1
fi
echo ""

# Test 4: Verify Docker CLI is installed
echo "Test 4: Verifying Docker CLI in image..."
if docker run --rm "$IMAGE_NAME" docker --version > /dev/null 2>&1; then
  DOCKER_VERSION=$(docker run --rm "$IMAGE_NAME" docker --version)
  echo "✓ Docker CLI found: $DOCKER_VERSION"
else
  echo "✗ Docker CLI not found in image"
  exit 1
fi
echo ""

# Test 5: Verify Claude Code is installed
echo "Test 5: Verifying Claude Code in image..."
if docker run --rm "$IMAGE_NAME" claude --version > /dev/null 2>&1; then
  CLAUDE_VERSION=$(docker run --rm "$IMAGE_NAME" claude --version 2>&1 | head -1)
  echo "✓ Claude Code found: $CLAUDE_VERSION"
else
  echo "✗ Claude Code not found in image"
  exit 1
fi
echo ""

# Test 6: Verify orchestrator start accepts Docker flags
echo "Test 6: Verifying orchestrator start command accepts --docker flag..."
cd "$PROJECT_ROOT"
if ./apps/cli/bin/run.js orchestrator start --help 2>&1 | grep -q "\--docker"; then
  echo "✓ --docker flag is recognized"
else
  echo "✗ --docker flag not found in help output"
  exit 1
fi
echo ""

# Test 7: Verify orchestrator start accepts run-on-host flag
echo "Test 7: Verifying orchestrator start command accepts --run-on-host flag..."
if ./apps/cli/bin/run.js orchestrator start --help 2>&1 | grep -q "\--run-on-host"; then
  echo "✓ --run-on-host flag is recognized"
else
  echo "✗ --run-on-host flag not found in help output"
  exit 1
fi
echo ""

echo "========================================"
echo "✓ All tests passed!"
echo ""
echo "The orchestrator Docker support is working correctly."
echo ""
echo "To use it:"
echo "  prlt orchestrator start --docker"
echo ""
echo "See docs/orchestrator-docker.md for full documentation."
