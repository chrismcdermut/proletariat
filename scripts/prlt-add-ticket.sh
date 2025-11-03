#!/bin/bash

# Proletariat Add Ticket Command
# Interactive ticket creation for PMO

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
echo -e "${CYAN}📝 Create New Ticket${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Find config
CONFIG_FILE=".proletariat/config.yml"
[[ ! -f "$CONFIG_FILE" ]] && CONFIG_FILE="../.proletariat/config.yml" 
[[ ! -f "$CONFIG_FILE" ]] && CONFIG_FILE="../../.proletariat/config.yml"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo -e "${RED}No config found. Run from project directory.${NC}"
    exit 1
fi

# Get PMO location
PMO_DIR=$(grep "location:" "$CONFIG_FILE" | tail -1 | awk '{print $2}')
PMO_DIR=${PMO_DIR:-"./pmo"}

# Ensure specs directory exists
mkdir -p "$PMO_DIR/specs/backlog"
mkdir -p "$PMO_DIR/specs/active" 
mkdir -p "$PMO_DIR/specs/completed"

# Ticket ID generation
echo -e "${MAGENTA}Ticket Identification${NC}"
read -p "Ticket ID (e.g., implement-oauth, fix-navigation): " TICKET_ID

if [[ -z "$TICKET_ID" ]]; then
    # Auto-generate from title
    read -p "Title (will generate ID): " TITLE
    TICKET_ID=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g')
    echo "Generated ID: $TICKET_ID"
else
    read -p "Title: " TITLE
fi

echo

# Queue selection with 5-tool-founder
echo -e "${MAGENTA}Queue Selection (5-Tool-Founder)${NC}"
echo "  1) 🏗️ Build - Product features & engineering"
echo "  2) 📈 Grow - Growth, marketing & user acquisition" 
echo "  3) 🛑 Support - Customer success & operations"
echo "  4) ⚙️ BizOps - Business operations & infrastructure"
echo "  5) 🎯 Strategy - Strategic planning & vision"
read -p "Select queue [1-5]: " QUEUE_CHOICE

case "$QUEUE_CHOICE" in
    1) QUEUE="Build" ;;
    2) QUEUE="Grow" ;;
    3) QUEUE="Support" ;;
    4) QUEUE="BizOps" ;;
    5) QUEUE="Strategy" ;;
    *) QUEUE="Build" ;;
esac

echo

# Description
echo -e "${MAGENTA}Description${NC}"
echo "Enter description (end with empty line):"
DESCRIPTION=""
while IFS= read -r line; do
    [[ -z "$line" ]] && break
    DESCRIPTION+="$line\n"
done

echo

# Acceptance Criteria
echo -e "${MAGENTA}Acceptance Criteria${NC}"
echo "Enter criteria (one per line, empty line to finish):"
CRITERIA=""
CRITERIA_COUNT=0
while IFS= read -r line; do
    [[ -z "$line" ]] && break
    CRITERIA+="- [ ] $line\n"
    ((CRITERIA_COUNT++))
done

echo

# Points estimation
echo -e "${MAGENTA}Estimation${NC}"
echo "Fibonacci points: 1, 2, 3, 5, 8, 13, 21"
read -p "Points estimate: " POINTS
POINTS=${POINTS:-3}

echo

# Priority & Urgency (Eisenhower Matrix)
echo -e "${MAGENTA}Eisenhower Matrix${NC}"
echo "Priority (importance):"
echo "  P0 - Critical/Blocker"
echo "  P1 - High/Important"
echo "  P2 - Medium/Normal"
echo "  P3 - Low/Nice-to-have"
read -p "Priority [P0-P3]: " PRIORITY
PRIORITY=${PRIORITY:-P2}

echo
echo "Urgency (time-sensitive):"
echo "  U0 - Immediate/Emergency"
echo "  U1 - This week"
echo "  U2 - This sprint"
echo "  U3 - Backlog"
read -p "Urgency [U0-U3]: " URGENCY
URGENCY=${URGENCY:-U2}

echo

# Technical details
echo -e "${MAGENTA}Technical Details (optional)${NC}"
read -p "Affected repos (comma-separated, or 'all'): " REPOS
read -p "Dependencies/blockers: " DEPENDENCIES
read -p "Assigned agent (optional): " AGENT

echo

# Create the spec file
SPEC_FILE="$PMO_DIR/specs/backlog/$TICKET_ID.md"

cat > "$SPEC_FILE" << EOF
# $TITLE

**ID**: $TICKET_ID
**Status**: Backlog
**Queue**: $QUEUE
**Points**: $POINTS
**Priority**: $PRIORITY  
**Urgency**: $URGENCY
**Created**: $(date -I)
**Author**: $(whoami)
EOF

[[ -n "$AGENT" ]] && echo "**Assigned**: $AGENT" >> "$SPEC_FILE"
[[ -n "$REPOS" ]] && echo "**Repos**: $REPOS" >> "$SPEC_FILE"
[[ -n "$DEPENDENCIES" ]] && echo "**Dependencies**: $DEPENDENCIES" >> "$SPEC_FILE"

cat >> "$SPEC_FILE" << EOF

## Description

$DESCRIPTION

## Acceptance Criteria

$CRITERIA

## Technical Notes

_To be added during implementation_

## Resources

- [ ] Design docs
- [ ] API specs
- [ ] Related tickets

EOF

echo -e "${GREEN}✓ Created ticket: $SPEC_FILE${NC}"

# Add to kanban if exists
if [[ -f "$PMO_DIR/kanban.md" ]]; then
    echo
    echo -e "${CYAN}Adding to kanban board...${NC}"
    
    # Determine column based on urgency
    if [[ "$URGENCY" == "U0" ]]; then
        COLUMN="## 🚀 In Progress"
    elif [[ "$URGENCY" == "U1" ]]; then
        COLUMN="## 📥 Triage" 
    else
        # Add to appropriate queue
        case "$QUEUE" in
            Build) COLUMN="## 🏗️ Build Queue" ;;
            Grow) COLUMN="## 📈 Grow Queue" ;;
            Support) COLUMN="## 🛑 Support Queue" ;;
            BizOps) COLUMN="## ⚙️ BizOps Queue" ;;
            Strategy) COLUMN="## 🎯 Strategy Queue" ;;
            *) COLUMN="## 📥 Triage" ;;
        esac
    fi
    
    # Add to kanban
    sed -i.bak "/$COLUMN/a\\\n- [ ] [[$TICKET_ID]] $POINTS pts | $PRIORITY/$URGENCY" "$PMO_DIR/kanban.md"
    
    echo -e "${GREEN}✓ Added to kanban: $COLUMN${NC}"
fi

# Commit to PMO if it's a git repo
if [[ -d "$PMO_DIR/.git" ]]; then
    echo
    read -p "Commit to PMO repository? [Y/n]: " COMMIT_CHOICE
    
    if [[ ! "$COMMIT_CHOICE" =~ ^[Nn]$ ]]; then
        (cd "$PMO_DIR" && 
         git add "specs/backlog/$TICKET_ID.md" kanban.md 2>/dev/null &&
         git commit -m "Add ticket: $TICKET_ID - $TITLE" &&
         echo -e "${GREEN}✓ Committed to PMO${NC}")
         
        read -p "Push to remote? [Y/n]: " PUSH_CHOICE
        if [[ ! "$PUSH_CHOICE" =~ ^[Nn]$ ]]; then
            (cd "$PMO_DIR" && git push && echo -e "${GREEN}✓ Pushed to remote${NC}")
        fi
    fi
fi

# Summary
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Ticket Created Successfully${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Ticket: $TICKET_ID"
echo "Queue: $QUEUE"
echo "Priority/Urgency: $PRIORITY/$URGENCY"
echo "Points: $POINTS"
[[ -n "$AGENT" ]] && echo "Assigned: $AGENT"
echo
echo "Next steps:"
echo "  1. Review ticket in PMO: $PMO_DIR/specs/backlog/$TICKET_ID.md"
echo "  2. Claim when ready: prlt claim $TICKET_ID"
echo "  3. This will launch Claude with full context"
echo
echo -e "${CYAN}Happy coding! 🚀${NC}"