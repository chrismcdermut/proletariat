#!/bin/bash

# Proletariat Smart Initialization
# Detects context and guides to appropriate setup

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
echo -e "${CYAN}🚀 Proletariat Initialization${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Detect context
echo -e "${MAGENTA}Analyzing environment...${NC}"

CONTEXT=""
DETECTED_REPOS=()

# Check if we're in a git repo
if git rev-parse --git-dir > /dev/null 2>&1; then
    CONTEXT="in_git_repo"
    REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
    echo -e "  ${GREEN}✓${NC} In git repository: $REPO_NAME"
    
    # Check if it looks like a monorepo
    if [[ -d "apps" ]] || [[ -d "packages" ]] || [[ -d "services" ]] || [[ -f "pnpm-workspace.yaml" ]] || [[ -f "lerna.json" ]]; then
        echo -e "  ${GREEN}✓${NC} Detected monorepo structure"
        CONTEXT="monorepo"
    fi
    
# Check for multiple repos in current directory
elif ls -d */ 2>/dev/null | while read dir; do [[ -d "$dir/.git" ]] && return 0; done; then
    CONTEXT="parent_of_repos"
    for dir in */; do
        if [[ -d "$dir/.git" ]]; then
            DETECTED_REPOS+=("${dir%/}")
        fi
    done
    echo -e "  ${GREEN}✓${NC} Found ${#DETECTED_REPOS[@]} git repositories"
    
# Check for sibling repos
elif ls -d ../*/.git 2>/dev/null | head -1 > /dev/null; then
    CONTEXT="sibling_repos"
    for dir in ../*/; do
        if [[ -d "$dir/.git" ]] && [[ "$(basename "$dir")" != *"-hq" ]] && [[ "$(basename "$dir")" != *"-staff" ]]; then
            DETECTED_REPOS+=("$(basename "$dir")")
        fi
    done
    echo -e "  ${GREEN}✓${NC} Found sibling repositories"
    
else
    CONTEXT="no_repos"
    echo -e "  ${YELLOW}⚠${NC}  No git repositories found"
fi

echo

# Guide based on context
case "$CONTEXT" in
    monorepo)
        echo "Detected monorepo project: ${GREEN}$REPO_NAME${NC}"
        echo
        read -p "Set up Proletariat for this monorepo? [Y/n]: " CONFIRM
        
        if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
            echo "Setup cancelled."
            exit 0
        fi
        
        # Run monorepo setup
        echo
        echo "Setting up monorepo workspace..."
        
        # Create config
        mkdir -p .proletariat
        cat > .proletariat/config.yml << EOF
project:
  name: $REPO_NAME
  type: monorepo

agents:
  active:
    - 4runner
    - camry
    - hilux
  workspace_base: ../.proletariat/worktrees

pmo:
  enabled: true
  location: ./pmo
  board_type: 5-tool-founder
EOF
        
        # Create worktrees
        mkdir -p ../.proletariat/worktrees
        for agent in 4runner camry hilux; do
            if [[ ! -d "../.proletariat/worktrees/$agent" ]]; then
                git worktree add "../.proletariat/worktrees/$agent" -b "work/$agent" 2>/dev/null || true
                echo -e "  ${GREEN}✓${NC} Created worktree for $agent"
            fi
        done
        
        echo
        echo -e "${GREEN}✅ Monorepo setup complete!${NC}"
        echo "Workspaces at: ../.proletariat/worktrees/"
        ;;
        
    parent_of_repos)
        echo "Found multiple repositories in current directory:"
        for repo in "${DETECTED_REPOS[@]}"; do
            echo "  • $repo"
        done
        echo
        echo "This looks like it could be a project HQ!"
        read -p "Create HQ structure for these repos? [Y/n]: " CONFIRM
        
        if [[ ! "$CONFIRM" =~ ^[Nn]$ ]]; then
            # Extract project name from current directory
            PROJECT_NAME=$(basename "$(pwd)")
            if [[ "$PROJECT_NAME" == *"-hq" ]]; then
                PROJECT_NAME="${PROJECT_NAME%-hq}"
            fi
            
            echo
            echo "Creating HQ structure..."
            # Would call scaffold-hq with detected repos
            echo "TODO: Implement HQ setup with detected repos"
        fi
        ;;
        
    sibling_repos)
        echo "Found repositories in parent directory:"
        for repo in "${DETECTED_REPOS[@]}"; do
            echo "  • $repo"
        done
        echo
        echo "Options:"
        echo "  1) Create an HQ structure for these repos"
        echo "  2) Work with just this directory"
        echo "  3) Exit"
        echo
        read -p "Selection [1-3]: " CHOICE
        
        case "$CHOICE" in
            1)
                # Extract project name
                PROJECT_NAME="${DETECTED_REPOS[0]}"
                PROJECT_NAME="${PROJECT_NAME%%-*}"
                read -p "Project name [$PROJECT_NAME]: " USER_NAME
                PROJECT_NAME="${USER_NAME:-$PROJECT_NAME}"
                
                echo "Creating ${PROJECT_NAME}-hq..."
                # Would call scaffold-hq
                ;;
            2)
                echo "Run 'prlt init' from within a git repository."
                ;;
            *)
                echo "Exiting."
                ;;
        esac
        ;;
        
    no_repos)
        echo -e "${YELLOW}No git repositories found.${NC}"
        echo
        echo "What would you like to do?"
        echo "  1) Create a new project HQ structure"
        echo "  2) Initialize a new git repository"  
        echo "  3) Exit"
        echo
        read -p "Selection [1-3]: " CHOICE
        
        case "$CHOICE" in
            1)
                read -p "Project name: " PROJECT_NAME
                echo
                echo "Creating ${PROJECT_NAME}-hq..."
                
                # Create basic HQ structure
                mkdir -p "${PROJECT_NAME}-hq"
                cd "${PROJECT_NAME}-hq"
                
                # Run scaffold
                $(dirname "$0")/prlt-scaffold-hq.sh
                ;;
            2)
                git init
                echo "Git repository initialized."
                echo "Run 'prlt init' again to set up Proletariat."
                ;;
            *)
                echo "Exiting."
                exit 0
                ;;
        esac
        ;;
esac

echo
echo -e "${CYAN}Need help?${NC}"
echo "  • Monorepo: Run from repository root"
echo "  • Multi-repo: Create repos in HQ folder first"
echo "  • Docs: https://github.com/proletariat/docs"