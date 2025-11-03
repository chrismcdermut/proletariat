#!/bin/bash

# Simplified Proletariat Init for Testing
# Quick setup for monorepo projects

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🚀 Proletariat Quick Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Get project name
PROJECT_NAME=$(basename "$(pwd)")
read -p "Project name [$PROJECT_NAME]: " USER_NAME
PROJECT_NAME=${USER_NAME:-$PROJECT_NAME}

# Create config
mkdir -p .proletariat

cat > .proletariat/config.yml << EOF
project:
  name: $PROJECT_NAME
  type: monorepo
  
agents:
  active:
    - 4runner
    - camry
  theme: toyota
  
pmo:
  enabled: true
  location: ./pmo
  board_type: 5-tool-founder
EOF

echo -e "${GREEN}✓ Created .proletariat/config.yml${NC}"

# Create PMO
mkdir -p pmo/specs/{backlog,active,completed}

cat > pmo/kanban.md << 'EOF'
---
kanban-plugin: board
---

## 📥 Triage

## 🏗️ Build Queue

## 📈 Grow Queue  

## 🛑 Support Queue

## ⚙️ BizOps Queue

## 🎯 Strategy Queue

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Done

EOF

echo -e "${GREEN}✓ Created PMO structure${NC}"

# Create sample ticket
cat > pmo/specs/backlog/sample-feature.md << 'EOF'
# Sample Feature Implementation

**ID**: sample-feature
**Status**: Backlog
**Queue**: Build
**Points**: 3
**Priority**: P2
**Urgency**: U2
**Created**: 2025-11-03

## Description

This is a sample ticket to demonstrate the Proletariat workflow.
Implement a new feature that does something useful.

## Acceptance Criteria

- [ ] Feature is implemented
- [ ] Tests are written
- [ ] Documentation is updated

## Technical Notes

_To be added during implementation_

EOF

echo -e "${GREEN}✓ Created sample ticket${NC}"

# Create worktrees
mkdir -p ../.proletariat/worktrees

for agent in 4runner camry; do
    if [[ ! -d "../.proletariat/worktrees/$agent" ]]; then
        git worktree add "../.proletariat/worktrees/$agent" -b "work/$agent" 2>/dev/null || 
        git worktree add "../.proletariat/worktrees/$agent" 2>/dev/null || true
        echo -e "${GREEN}✓ Created worktree for $agent${NC}"
    fi
done

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Project: $PROJECT_NAME"
echo "Config: .proletariat/config.yml"
echo "PMO: pmo/"
echo "Worktrees: ../.proletariat/worktrees/"
echo
echo "Try these commands:"
echo "  prlt status              # Check project status"
echo "  prlt agents              # List agents"
echo "  prlt go 4runner          # Switch to agent workspace"
echo "  prlt claim sample-feature # Claim ticket and launch Claude"
echo "  prlt add                 # Create new ticket"
echo
echo -e "${CYAN}Happy coding! 🚀${NC}"