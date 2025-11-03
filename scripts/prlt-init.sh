#!/bin/bash

# Proletariat Project Initialization
# Handles both monorepo and multi-repo setups

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🚀 Proletariat Project Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Step 1: Project Structure Choice
echo -e "${MAGENTA}Step 1: Project Structure${NC}"

CURRENT_DIR=$(basename "$(pwd)")
PROJECT_NAME=""
PROJECT_TYPE=""
DETECTED_REPOS=()

# Ask user explicitly
echo "Is this project a monorepo or multi-repo setup?"
echo "  1) Monorepo - Single repository with multiple apps/packages"
echo "  2) Multi-repo - Multiple separate repositories"
echo
read -p "Selection [1-2]: " TYPE_CHOICE

case "$TYPE_CHOICE" in
    1)
        PROJECT_TYPE="monorepo"
        PROJECT_NAME="$CURRENT_DIR"
        echo -e "Selected: ${GREEN}Monorepo${NC}"
        ;;
    2)
        PROJECT_TYPE="multi-repo"
        echo -e "Selected: ${GREEN}Multi-repo${NC}"
        
        # Help find sibling repos if multi-repo
        echo
        echo "Scanning for nearby repositories..."
        for dir in ../*; do
            if [[ -d "$dir/.git" ]] && [[ "$(basename "$dir")" != *"-pmo" ]] && [[ "$(basename "$dir")" != *"-worktrees" ]]; then
                DETECTED_REPOS+=("$(basename "$dir")")
            fi
        done
        
        if [[ ${#DETECTED_REPOS[@]} -gt 0 ]]; then
            echo "Found repositories:"
            for repo in "${DETECTED_REPOS[@]}"; do
                echo "  • $repo"
            done
        fi
        
        # Try to extract project name from repo patterns
        if [[ ${#DETECTED_REPOS[@]} -gt 0 ]]; then
            PROJECT_NAME=$(echo "${DETECTED_REPOS[0]}" | cut -d'-' -f1)
        fi
        ;;
    *)
        echo "Invalid selection. Defaulting to monorepo."
        PROJECT_TYPE="monorepo"
        PROJECT_NAME="$CURRENT_DIR"
        ;;
esac

echo

read -p "Project name [$PROJECT_NAME]: " USER_NAME  
PROJECT_NAME=${USER_NAME:-$PROJECT_NAME}

# Step 2: Configure based on project type
if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    echo
    echo -e "${MAGENTA}Multi-repo configuration${NC}"
    
    if [[ ${#DETECTED_REPOS[@]} -gt 0 ]]; then
        echo "Detected repositories:"
        for repo in "${DETECTED_REPOS[@]}"; do
            echo "  • $repo"
        done
        read -p "Use these repositories? [Y/n]: " USE_DETECTED
        
        if [[ ! "$USE_DETECTED" =~ ^[Nn]$ ]]; then
            REPOS=("${DETECTED_REPOS[@]}")
        fi
    fi
    
    # Manual entry if needed
    if [[ ${#REPOS[@]} -eq 0 ]]; then
        read -p "Enter repository names (comma-separated): " REPO_INPUT
        IFS=',' read -ra REPOS <<< "$REPO_INPUT"
    fi
else
    echo
    echo -e "${MAGENTA}Monorepo configuration${NC}"
    REPOS=("$PROJECT_NAME")
fi

# Step 3: Agent configuration
echo
echo -e "${MAGENTA}Agent configuration${NC}"

# Check for existing .proletariat config
if [[ -f ".proletariat/config.yml" ]]; then
    echo "Found existing .proletariat config"
    AGENTS=($(grep -A10 "agents:" .proletariat/config.yml | grep "^  - " | sed 's/  - //'))
else
    read -p "Agent names (comma-separated, e.g., 4runner,camry,hilux): " AGENT_INPUT
    IFS=',' read -ra AGENTS <<< "$AGENT_INPUT"
fi

echo -e "Agents: ${GREEN}${AGENTS[*]}${NC}"

# Step 4: Create project structure
echo
echo -e "${CYAN}Creating project structure...${NC}"

# Create .proletariat config directory
PRLT_CONFIG_DIR=".proletariat"
[[ "$PROJECT_TYPE" == "multi-repo" ]] && PRLT_CONFIG_DIR="../$PROJECT_NAME-config/.proletariat"
mkdir -p "$PRLT_CONFIG_DIR"

# Create main config
cat > "$PRLT_CONFIG_DIR/config.yml" << EOF
# Proletariat Configuration
# Project: $PROJECT_NAME
# Type: $PROJECT_TYPE

project:
  name: $PROJECT_NAME
  type: $PROJECT_TYPE
  created: $(date -I)

# Repository configuration
repos:
EOF

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    for repo in "${REPOS[@]}"; do
        cat >> "$PRLT_CONFIG_DIR/config.yml" << EOF
  $repo:
    path: ../$repo
    worktree_base: ../$repo-worktrees
    type: $(detect_repo_type "$repo")
EOF
    done
else
    cat >> "$PRLT_CONFIG_DIR/config.yml" << EOF
  $PROJECT_NAME:
    path: .
    worktree_base: ../$PROJECT_NAME-garage
    type: monorepo
EOF
fi

cat >> "$PRLT_CONFIG_DIR/config.yml" << EOF

# Agent configuration
agents:
  active:
EOF

for agent in "${AGENTS[@]}"; do
    echo "    - $agent" >> "$PRLT_CONFIG_DIR/config.yml"
done

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    cat >> "$PRLT_CONFIG_DIR/config.yml" << EOF
  workspace_type: unified
  workspace_base: ~/workspaces/$PROJECT_NAME
EOF
else
    cat >> "$PRLT_CONFIG_DIR/config.yml" << EOF
  workspace_type: worktree
  workspace_base: ../.proletariat/worktrees
EOF
fi

# Add PMO configuration
cat >> "$PRLT_CONFIG_DIR/config.yml" << EOF

# PMO configuration
pmo:
  enabled: true
  location: $([ "$PROJECT_TYPE" == "multi-repo" ] && echo "../$PROJECT_NAME-pmo" || echo "./pmo")
  board_type: 5-tool-founder
  
# Development settings
development:
  default_branch: main
  branch_prefix: feature/
  pr_template: true
  
# CLI settings
cli:
  aliases:
    - name: go
      description: Switch to agent workspace
    - name: claim  
      description: Claim a ticket
    - name: sync
      description: Sync all repos
EOF

echo -e "  ${GREEN}✓${NC} Created config at $PRLT_CONFIG_DIR/config.yml"

# Step 5: Create workspaces
echo
echo -e "${CYAN}Setting up workspaces...${NC}"

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    # Create unified workspaces
    for agent in "${AGENTS[@]}"; do
        WORKSPACE="$HOME/workspaces/$PROJECT_NAME/$agent"
        mkdir -p "$WORKSPACE"
        
        for repo in "${REPOS[@]}"; do
            REPO_PATH="../$repo"
            WORKTREE_PATH="../$repo-worktrees/$agent"
            
            if [[ -d "$REPO_PATH/.git" ]]; then
                if [[ ! -d "$WORKTREE_PATH" ]]; then
                    echo "  Creating $repo worktree for $agent..."
                    (cd "$REPO_PATH" && git worktree add "$WORKTREE_PATH" -b "work/$agent" 2>/dev/null || true)
                fi
                ln -sf "$(realpath "$WORKTREE_PATH")" "$WORKSPACE/$repo" 2>/dev/null || true
            fi
        done
        
        echo -e "  ${GREEN}✓${NC} Created unified workspace: ~/workspaces/$PROJECT_NAME/$agent"
    done
else
    # Create simple worktrees for monorepo in .proletariat
    WORKTREE_DIR="../.proletariat/worktrees"
    mkdir -p "$WORKTREE_DIR"
    
    for agent in "${AGENTS[@]}"; do
        WORKTREE_PATH="$WORKTREE_DIR/$agent"
        
        if [[ ! -d "$WORKTREE_PATH" ]]; then
            echo "  Creating worktree for $agent..."
            git worktree add "$WORKTREE_PATH" -b "work/$agent" 2>/dev/null || true
        fi
        
        echo -e "  ${GREEN}✓${NC} Created worktree: $WORKTREE_PATH"
    done
fi

# Step 6: Create prlt CLI commands
echo
echo -e "${CYAN}Installing CLI commands...${NC}"

# Create main prlt command
PRLT_CMD="$PRLT_CONFIG_DIR/bin/prlt"
mkdir -p "$(dirname "$PRLT_CMD")"

cat > "$PRLT_CMD" << 'SCRIPT'
#!/bin/bash

# Proletariat CLI
# Source config
CONFIG_FILE="$(dirname "$0")/../config.yml"

# Parse basic config
PROJECT_NAME=$(grep "name:" "$CONFIG_FILE" | head -1 | awk '{print $2}')
PROJECT_TYPE=$(grep "type:" "$CONFIG_FILE" | grep -v "board_type" | head -1 | awk '{print $2}')

case "$1" in
    go|switch)
        AGENT="$2"
        if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
            cd "$HOME/workspaces/$PROJECT_NAME/$AGENT" && $SHELL
        else
            cd "../.proletariat/worktrees/$AGENT" && $SHELL
        fi
        ;;
        
    agents|list)
        echo "Active agents:"
        grep -A20 "agents:" "$CONFIG_FILE" | grep "^    - " | sed 's/    - /  • /'
        ;;
        
    repos)
        echo "Project repositories:"
        grep -B1 "path:" "$CONFIG_FILE" | grep "^  [^:]" | sed 's/  //' | sed 's/://'
        ;;
        
    init)
        shift
        case "$1" in
            pmo)
                echo "Initializing PMO..."
                # Run PMO init
                ;;
            workspace)
                AGENT="$2"
                echo "Initializing workspace for $AGENT..."
                # Create workspace
                ;;
            *)
                echo "Usage: prlt init {pmo|workspace <agent>}"
                ;;
        esac
        ;;
        
    status)
        echo "Project: $PROJECT_NAME"
        echo "Type: $PROJECT_TYPE"
        echo "Agents: $(grep -A20 "agents:" "$CONFIG_FILE" | grep "^    - " | wc -l | xargs) active"
        if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
            echo "Repos: $(grep "path:" "$CONFIG_FILE" | wc -l | xargs) repositories"
        fi
        ;;
        
    help|*)
        cat << HELP
Proletariat CLI - Multi-agent development environment

Commands:
  go <agent>       Switch to agent workspace
  agents           List active agents  
  repos            List project repositories
  status           Show project status
  init pmo         Initialize PMO
  init workspace   Initialize agent workspace
  help             Show this help

Project: $PROJECT_NAME ($PROJECT_TYPE)
HELP
        ;;
esac
SCRIPT

chmod +x "$PRLT_CMD"
echo -e "  ${GREEN}✓${NC} Created prlt command"

# Create global symlink if possible
if [[ -d "$HOME/.local/bin" ]]; then
    ln -sf "$(realpath "$PRLT_CMD")" "$HOME/.local/bin/prlt-$PROJECT_NAME" 2>/dev/null
    echo -e "  ${GREEN}✓${NC} Installed global command: prlt-$PROJECT_NAME"
fi

# Step 7: Initialize PMO
echo
read -p "Initialize PMO (Project Management Office)? [Y/n]: " INIT_PMO

if [[ ! "$INIT_PMO" =~ ^[Nn]$ ]]; then
    if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
        PMO_DIR="../$PROJECT_NAME-pmo"
    else
        PMO_DIR="./pmo"
    fi
    
    mkdir -p "$PMO_DIR/specs"
    
    # Create basic kanban
    cat > "$PMO_DIR/kanban.md" << 'EOF'
---
kanban-plugin: board
---

## 📥 Triage

## 🏗️ Build Queue

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Done
EOF
    
    echo -e "  ${GREEN}✓${NC} Created PMO at $PMO_DIR"
fi

# Done!
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Proletariat Project Initialized!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Project: $PROJECT_NAME"
echo "Type: $PROJECT_TYPE"
echo "Config: $PRLT_CONFIG_DIR/config.yml"
echo

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    echo "Unified workspaces created at:"
    for agent in "${AGENTS[@]}"; do
        echo "  ~/workspaces/$PROJECT_NAME/$agent"
    done
else
    echo "Worktrees created at:"
    for agent in "${AGENTS[@]}"; do
        echo "  ../.proletariat/worktrees/$agent"
    done
fi

echo
echo "Quick commands:"
echo "  prlt go <agent>     # Switch to agent workspace"
echo "  prlt agents         # List agents"
echo "  prlt status         # Project status"
echo
echo "Next steps:"
echo "  1. cd to an agent workspace"
echo "  2. Start working on features"
echo
echo -e "${CYAN}Happy coding! 🚀${NC}"

# Helper function
detect_repo_type() {
    local repo="$1"
    if [[ "$repo" == *"frontend"* ]]; then
        echo "frontend"
    elif [[ "$repo" == *"backend"* || "$repo" == *"api"* ]]; then
        echo "backend"
    elif [[ "$repo" == *"infra"* ]]; then
        echo "infrastructure"
    else
        echo "service"
    fi
}