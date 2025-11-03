#!/bin/bash

# Proletariat Main CLI Command
# Unified command for all project types with Claude integration

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Find config
find_config() {
    # Check current directory
    if [[ -f ".proletariat/config.yml" ]]; then
        echo ".proletariat/config.yml"
        return 0
    fi
    
    # Check parent for HQ structure
    if [[ -f "../.proletariat/config.yml" ]]; then
        echo "../.proletariat/config.yml"
        return 0
    fi
    
    # Check for project-hq structure
    HQ_NAME=$(basename "$(pwd)")
    if [[ "$HQ_NAME" == *"-hq" ]]; then
        if [[ -f ".proletariat/config.yml" ]]; then
            echo ".proletariat/config.yml"
            return 0
        fi
    fi
    
    return 1
}

CONFIG_FILE=$(find_config 2>/dev/null) || {
    echo -e "${RED}No proletariat config found${NC}"
    echo "Run 'prlt init' to set up a project"
    exit 1
}

# Parse config
PROJECT_NAME=$(grep "name:" "$CONFIG_FILE" | head -1 | awk '{print $2}')
PROJECT_TYPE=$(grep "type:" "$CONFIG_FILE" | grep -v "board_type" | head -1 | awk '{print $2}')
WORKSPACE_TYPE=$(grep "workspace_type:" "$CONFIG_FILE" | awk '{print $2}')
THEME=$(grep "theme:" "$CONFIG_FILE" | awk '{print $2}')

# Get workspace name based on theme
get_workspace_name() {
    case "$THEME" in
        toyota) echo "bays" ;;
        starwars) echo "stations" ;;
        billionaires) echo "desks" ;;
        companies) echo "offices" ;;
        *) echo "workspaces" ;;
    esac
}

WORKSPACE_NAME=$(get_workspace_name)

# Main command logic
case "$1" in
    init)
        # Run initialization
        $(dirname "$0")/prlt-init-smart.sh
        ;;
        
    go|switch)
        AGENT="$2"
        if [[ -z "$AGENT" ]]; then
            echo "Usage: prlt go <agent>"
            echo "Available agents:"
            grep -A20 "agents:" "$CONFIG_FILE" | grep "^    - " | sed 's/    - /  • /'
            exit 1
        fi
        
        # Find workspace location
        if [[ -d "agent-$WORKSPACE_NAME/$AGENT" ]]; then
            cd "agent-$WORKSPACE_NAME/$AGENT"
        elif [[ -d "../.proletariat/worktrees/$AGENT" ]]; then
            cd "../.proletariat/worktrees/$AGENT"
        elif [[ -d "~/workspaces/$PROJECT_NAME/$AGENT" ]]; then
            cd "~/workspaces/$PROJECT_NAME/$AGENT"
        else
            echo -e "${RED}Agent workspace not found: $AGENT${NC}"
            exit 1
        fi
        
        echo -e "${GREEN}📍 Switched to $AGENT $WORKSPACE_TYPE${NC}"
        exec $SHELL
        ;;
        
    claim)
        shift
        # Interactive claim with Claude integration
        $(dirname "$0")/prlt-claim-interactive.sh "$@"
        ;;
        
    add|create)
        shift
        # Add new ticket
        $(dirname "$0")/prlt-add-ticket.sh "$@"
        ;;
        
    status)
        echo -e "${CYAN}📊 Project Status${NC}"
        echo "Project: $PROJECT_NAME"
        echo "Type: $PROJECT_TYPE"
        echo
        
        # Show agents
        echo "Active agents:"
        grep -A20 "agents:" "$CONFIG_FILE" | grep "^    - " | sed 's/    - /  • /'
        echo
        
        # Show current branches if in workspace
        if [[ -d ".git" ]]; then
            echo "Current branch: $(git branch --show-current)"
        fi
        
        # Check for uncommitted changes
        if git diff --quiet 2>/dev/null; then
            echo "Working tree: clean"
        else
            echo -e "${YELLOW}Working tree: changes pending${NC}"
        fi
        ;;
        
    sync)
        echo -e "${CYAN}🔄 Syncing PMO...${NC}"
        
        # Find PMO location
        PMO_DIR=$(grep "location:" "$CONFIG_FILE" | grep -A1 "pmo:" | tail -1 | awk '{print $2}')
        
        if [[ -d "$PMO_DIR/.git" ]]; then
            (cd "$PMO_DIR" && git pull)
            echo -e "${GREEN}✅ PMO synced${NC}"
        else
            echo -e "${YELLOW}PMO is not a git repository${NC}"
        fi
        ;;
        
    agents|list)
        echo -e "${CYAN}Active agents for $PROJECT_NAME:${NC}"
        grep -A20 "agents:" "$CONFIG_FILE" | grep "^    - " | sed 's/    - /  • /'
        ;;
        
    repos)
        if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
            echo -e "${CYAN}Project repositories:${NC}"
            grep -B1 "path:" "$CONFIG_FILE" | grep "^  [^:]" | sed 's/  //' | sed 's/://' | sed 's/^/  • /'
        else
            echo "Monorepo project: $PROJECT_NAME"
        fi
        ;;
        
    help|*)
        cat << HELP
${CYAN}Proletariat CLI - Multi-agent development orchestration${NC}

Commands:
  ${GREEN}init${NC}              Initialize new project
  ${GREEN}go <agent>${NC}        Switch to agent workspace
  ${GREEN}claim [ticket]${NC}    Claim ticket and launch Claude
  ${GREEN}add${NC}               Add new ticket to PMO
  ${GREEN}status${NC}            Show project status
  ${GREEN}sync${NC}              Sync PMO updates
  ${GREEN}agents${NC}            List active agents
  ${GREEN}repos${NC}             List repositories (multi-repo only)
  ${GREEN}help${NC}              Show this help

Project: ${MAGENTA}$PROJECT_NAME${NC} ($PROJECT_TYPE)
Config: $CONFIG_FILE

Examples:
  prlt go 4runner              # Switch to 4runner workspace
  prlt claim                   # Interactive ticket claim with Claude
  prlt claim implement-oauth   # Claim specific ticket
  prlt add                     # Create new ticket
  prlt status                  # Check project status
HELP
        ;;
esac