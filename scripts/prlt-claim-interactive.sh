#!/bin/bash

# Proletariat Interactive Claim Command
# Claims ticket and launches Claude with full context

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🎯 Ticket Claim & Claude Launch${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Get agent name from current directory or prompt
AGENT=""
if [[ "$(basename "$(dirname "$(pwd)")")" == "agent-"* ]]; then
    AGENT=$(basename "$(pwd)")
else
    read -p "Agent name: " AGENT
fi

# Find PMO location from config
CONFIG_FILE=".proletariat/config.yml"
[[ ! -f "$CONFIG_FILE" ]] && CONFIG_FILE="../.proletariat/config.yml"
[[ ! -f "$CONFIG_FILE" ]] && CONFIG_FILE="../../.proletariat/config.yml"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo -e "${RED}No config found. Run from project directory.${NC}"
    exit 1
fi

PMO_DIR=$(grep "location:" "$CONFIG_FILE" | tail -1 | awk '{print $2}')
PMO_DIR=${PMO_DIR:-"./pmo"}

# Handle ticket selection
TICKET="$1"

if [[ -z "$TICKET" ]]; then
    echo -e "${MAGENTA}Available tickets in PMO:${NC}"
    echo
    
    # Show tickets from kanban
    if [[ -f "$PMO_DIR/kanban.md" ]]; then
        echo "From kanban board:"
        grep -E "^- \\[[ x]\\]" "$PMO_DIR/kanban.md" 2>/dev/null | head -10 | nl -w2 -s") "
    fi
    
    # Show specs from all subdirectories
    if [[ -d "$PMO_DIR/specs" ]]; then
        echo
        echo "Available specs:"
        find "$PMO_DIR/specs" -name "*.md" -type f 2>/dev/null | xargs -n1 basename | sed 's/.md$//' | nl -w2 -s") "
    fi
    
    echo
    read -p "Enter ticket number or name: " TICKET_CHOICE
    
    # If number, look it up
    if [[ "$TICKET_CHOICE" =~ ^[0-9]+$ ]]; then
        # Get from numbered list
        TICKET=$(find "$PMO_DIR/specs" -name "*.md" -type f 2>/dev/null | xargs -n1 basename | sed 's/.md$//' | sed -n "${TICKET_CHOICE}p")
    else
        TICKET="$TICKET_CHOICE"
    fi
fi

if [[ -z "$TICKET" ]]; then
    echo -e "${RED}No ticket specified${NC}"
    exit 1
fi

echo
echo -e "${CYAN}Claiming ticket: ${GREEN}$TICKET${NC}"
echo -e "Agent: ${GREEN}$AGENT${NC}"
echo

# Check if spec exists in any subdirectory
SPEC_FILE=$(find "$PMO_DIR/specs" -name "$TICKET.md" -type f 2>/dev/null | head -1)

if [[ -z "$SPEC_FILE" ]]; then
    SPEC_FILE="$PMO_DIR/specs/backlog/$TICKET.md"
    echo -e "${YELLOW}Spec not found. Creating new spec...${NC}"
    
    read -p "Title: " TITLE
    read -p "Description: " DESCRIPTION
    read -p "Points (1,2,3,5,8): " POINTS
    read -p "Priority (P0-P3): " PRIORITY
    read -p "Urgency (U0-U3): " URGENCY
    
    # Determine queue based on title/description
    QUEUE="Build"
    read -p "Queue (Build/Grow/Support/BizOps/Strategy) [$QUEUE]: " USER_QUEUE
    QUEUE=${USER_QUEUE:-$QUEUE}
    
    # Create spec
    cat > "$SPEC_FILE" << EOF
# $TITLE

**ID**: $TICKET
**Status**: Claimed
**Agent**: $AGENT
**Points**: $POINTS
**Priority**: $PRIORITY
**Urgency**: $URGENCY
**Queue**: $QUEUE
**Created**: $(date -I)
**Claimed**: $(date -I)

## Description
$DESCRIPTION

## Acceptance Criteria
- [ ] TODO: Define acceptance criteria

## Technical Notes
- Agent $AGENT beginning work

## Context
- Claimed via prlt claim
- Branch: feature/$TICKET
EOF
    
    echo -e "${GREEN}✓ Created spec: $SPEC_FILE${NC}"
else
    # Update existing spec with claim info
    sed -i.bak "s/\*\*Status\*\*:.*/\*\*Status\*\*: Claimed/" "$SPEC_FILE"
    sed -i.bak "s/\*\*Agent\*\*:.*/\*\*Agent\*\*: $AGENT/" "$SPEC_FILE"
    echo "**Claimed**: $(date -I)" >> "$SPEC_FILE"
    
    echo -e "${GREEN}✓ Updated spec with claim info${NC}"
fi

# Create feature branch
echo
echo -e "${CYAN}Creating feature branches...${NC}"

# For multi-repo, create branches in all repos
if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    for repo in */; do
        if [[ -d "$repo/.git" ]] && [[ "$repo" != "pmo/" ]]; then
            echo -n "  $repo: "
            (cd "$repo" && 
             git checkout -b "feature/$TICKET" 2>/dev/null || 
             git checkout "feature/$TICKET" 2>/dev/null || 
             echo "branch exists")
        fi
    done
else
    # For monorepo, just create one branch
    git checkout -b "feature/$TICKET" 2>/dev/null || git checkout "feature/$TICKET"
    echo -e "${GREEN}✓ Switched to feature/$TICKET${NC}"
fi

# Update kanban if exists
if [[ -f "$PMO_DIR/kanban.md" ]]; then
    echo
    echo -e "${CYAN}Updating kanban...${NC}"
    
    # Move to In Progress (macOS compatible)
    echo "- [x] [[$TICKET]] @$AGENT" > /tmp/prlt-kanban-entry.tmp
    sed -i.bak "/## 🚀 In Progress/r /tmp/prlt-kanban-entry.tmp" "$PMO_DIR/kanban.md"
    rm -f /tmp/prlt-kanban-entry.tmp
    
    # Remove from other columns
    sed -i.bak "/## 📥 Triage/,/## /{/\\[\\[$TICKET\\]\\]/d;}" "$PMO_DIR/kanban.md"
    sed -i.bak "/## 🏗️ Build Queue/,/## /{/\\[\\[$TICKET\\]\\]/d;}" "$PMO_DIR/kanban.md"
    
    echo -e "${GREEN}✓ Moved to In Progress${NC}"
fi

# Prepare context for Claude
echo
echo -e "${CYAN}Preparing Claude context...${NC}"

CONTEXT_FILE="/tmp/prlt-claude-context-$$.md"

cat > "$CONTEXT_FILE" << EOF
# Agent Context

You are agent **$AGENT** working on ticket **$TICKET** for project **$PROJECT_NAME**.

## Current Task

EOF

# Include spec content
if [[ -f "$SPEC_FILE" ]]; then
    cat "$SPEC_FILE" >> "$CONTEXT_FILE"
fi

cat >> "$CONTEXT_FILE" << EOF

## Workspace Information

- Working directory: $(pwd)
- Branch: feature/$TICKET
- Project type: $PROJECT_TYPE

## Available Commands

- Run tests: npm test (or appropriate for your project)
- Commit changes: git commit -m "$TICKET: description"
- Push changes: git push -u origin feature/$TICKET

## Instructions

1. Review the ticket requirements above
2. Implement the solution
3. Write tests if applicable
4. Commit your changes with ticket reference
5. Push and create PR when ready

Begin by exploring the codebase to understand the current implementation.
EOF

echo -e "${GREEN}✓ Context prepared${NC}"

# Launch Claude
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🚀 Launching Claude CLI...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Check if claude CLI is available
if command -v claude &> /dev/null; then
    # Launch Claude with context
    claude < "$CONTEXT_FILE"
else
    echo -e "${YELLOW}Claude CLI not found.${NC}"
    echo
    echo "To install Claude CLI:"
    echo "  1. Visit: https://claude.ai/download"
    echo "  2. Install the CLI tool"
    echo "  3. Run: claude auth login"
    echo
    echo "Context has been saved to: $CONTEXT_FILE"
    echo "You can manually start Claude and paste this context."
fi

# Cleanup
rm -f "$CONTEXT_FILE" 2>/dev/null || true