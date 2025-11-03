#!/bin/bash

# PMO Interactive Initialization Script
# Supports both monorepo and multi-repo projects

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
PMO_BASE_DIR="$(pwd)/pmo"
WORKSPACE_BASE="$HOME/agent-workspaces"
CURRENT_DIR=$(basename "$(pwd)")

# Helper functions
prompt_yes_no() {
    local prompt="$1"
    local default="${2:-n}"
    local response
    
    if [[ "$default" == "y" ]]; then
        prompt="$prompt [Y/n]: "
    else
        prompt="$prompt [y/N]: "
    fi
    
    read -p "$prompt" response
    response=${response:-$default}
    
    [[ "$response" =~ ^[Yy]$ ]]
}

prompt_select() {
    local prompt="$1"
    shift
    local options=("$@")
    
    echo "$prompt"
    for i in "${!options[@]}"; do
        echo "  $((i+1))) ${options[$i]}"
    done
    
    local choice
    read -p "Selection [1-${#options[@]}]: " choice
    
    if [[ "$choice" -ge 1 && "$choice" -le "${#options[@]}" ]]; then
        echo "${options[$((choice-1))]}"
    else
        echo "${options[0]}"
    fi
}

prompt_multi_select() {
    local prompt="$1"
    shift
    local options=("$@")
    local selected=()
    
    echo "$prompt"
    echo "  (Use space-separated numbers, e.g., '1 3 4')"
    
    for i in "${!options[@]}"; do
        echo "  $((i+1))) ${options[$i]}"
    done
    
    local choices
    read -p "Selection: " choices
    
    for choice in $choices; do
        if [[ "$choice" -ge 1 && "$choice" -le "${#options[@]}" ]]; then
            selected+=("${options[$((choice-1))]}")
        fi
    done
    
    printf "%s\n" "${selected[@]}"
}

# Main script
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🚀 PMO Setup Wizard${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Step 1: Project Type
echo -e "${MAGENTA}Step 1: Project Structure${NC}"
PROJECT_TYPE=$(prompt_select "Is this a monorepo or multi-repo project?" "monorepo" "multi-repo")
echo -e "Selected: ${GREEN}$PROJECT_TYPE${NC}\n"

# Step 2: Repo Configuration
REPOS=()
REPO_PATHS=()

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    echo -e "${MAGENTA}Step 2: Repository Setup${NC}"
    
    # Auto-detect sibling directories with .git
    echo "Scanning for nearby repositories..."
    DETECTED_REPOS=()
    for dir in ../*; do
        if [[ -d "$dir/.git" ]]; then
            repo_name=$(basename "$dir")
            if [[ "$repo_name" != "$CURRENT_DIR" && "$repo_name" != *"-pmo" && "$repo_name" != *"-worktrees" ]]; then
                DETECTED_REPOS+=("$repo_name")
            fi
        fi
    done
    
    if [[ ${#DETECTED_REPOS[@]} -gt 0 ]]; then
        echo "Found repositories:"
        for repo in "${DETECTED_REPOS[@]}"; do
            echo "  • $repo"
        done
        
        if prompt_yes_no "Use these detected repositories?" "y"; then
            readarray -t REPOS < <(prompt_multi_select "Select repositories to include:" "${DETECTED_REPOS[@]}")
            for repo in "${REPOS[@]}"; do
                REPO_PATHS+=("../$repo")
            done
        fi
    fi
    
    # Manual entry if needed
    if [[ ${#REPOS[@]} -eq 0 ]]; then
        echo "Enter repository names (empty line to finish):"
        while true; do
            read -p "Repository name: " repo_name
            [[ -z "$repo_name" ]] && break
            read -p "Repository path [../$repo_name]: " repo_path
            repo_path=${repo_path:-"../$repo_name"}
            REPOS+=("$repo_name")
            REPO_PATHS+=("$repo_path")
        done
    fi
    
    echo -e "Repositories configured: ${GREEN}${REPOS[*]}${NC}\n"
else
    echo -e "${MAGENTA}Step 2: Repository Setup${NC}"
    REPOS=("$CURRENT_DIR")
    REPO_PATHS=(".")
    echo -e "Using current repository: ${GREEN}$CURRENT_DIR${NC}\n"
fi

# Step 3: Board Type
echo -e "${MAGENTA}Step 3: Board Type${NC}"
BOARD_TYPE=$(prompt_select "Choose your board type:" "5-tool-founder" "flow")

if [[ "$BOARD_TYPE" == "5-tool-founder" ]]; then
    echo -e "Selected: ${GREEN}5-Tool Founder Board${NC}"
    echo "  • Triage for new ideas"
    echo "  • 5 queues: Build, Grow, Support, BizOps, Strategy"
else
    echo -e "Selected: ${GREEN}Standard Flow Board${NC}"
    echo "  • Simple kanban: Backlog → Ready → In Progress → Done"
fi
echo

# Step 4: Agent Setup
echo -e "${MAGENTA}Step 4: Agent Configuration${NC}"

# Predefined themes
THEMES=(
    "toyota:4runner,camry,tacoma,hilux,tundra,fj40,fj80"
    "starwars:luke,leia,han,chewie,r2d2,c3po"
    "planets:mercury,venus,mars,jupiter,saturn"
    "elements:hydrogen,helium,carbon,nitrogen,oxygen"
    "greek:alpha,beta,gamma,delta,epsilon"
    "custom"
)

THEME_NAMES=()
for theme in "${THEMES[@]}"; do
    THEME_NAMES+=("${theme%%:*}")
done

SELECTED_THEME=$(prompt_select "Choose agent naming theme:" "${THEME_NAMES[@]}")

if [[ "$SELECTED_THEME" == "custom" ]]; then
    echo "Enter agent names (empty line to finish):"
    AGENTS=()
    while true; do
        read -p "Agent name: " agent_name
        [[ -z "$agent_name" ]] && break
        AGENTS+=("$agent_name")
    done
else
    # Extract agents from theme
    for theme in "${THEMES[@]}"; do
        theme_name="${theme%%:*}"
        if [[ "$theme_name" == "$SELECTED_THEME" ]]; then
            IFS=',' read -ra AVAILABLE_AGENTS <<< "${theme#*:}"
            break
        fi
    done
    
    readarray -t AGENTS < <(prompt_multi_select "Select active agents:" "${AVAILABLE_AGENTS[@]}")
fi

echo -e "Active agents: ${GREEN}${AGENTS[*]}${NC}\n"

# Step 5: Workspace Location
echo -e "${MAGENTA}Step 5: Workspace Configuration${NC}"

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    read -p "Agent workspace base directory [$WORKSPACE_BASE]: " custom_workspace
    WORKSPACE_BASE=${custom_workspace:-$WORKSPACE_BASE}
    echo -e "Unified workspaces will be created at: ${GREEN}$WORKSPACE_BASE/<agent-name>${NC}"
else
    GARAGE_DIR="../${CURRENT_DIR}-garage"
    read -p "Worktree directory [$GARAGE_DIR]: " custom_garage
    GARAGE_DIR=${custom_garage:-$GARAGE_DIR}
    echo -e "Worktrees will be created at: ${GREEN}$GARAGE_DIR/<agent-name>${NC}"
fi
echo

# Step 6: Confirmation
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Configuration Summary${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Project Type: ${GREEN}$PROJECT_TYPE${NC}"
echo -e "Board Type: ${GREEN}$BOARD_TYPE${NC}"
echo -e "Repositories: ${GREEN}${REPOS[*]}${NC}"
echo -e "Agents: ${GREEN}${AGENTS[*]}${NC}"
echo -e "Theme: ${GREEN}$SELECTED_THEME${NC}"

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    echo -e "Workspace Base: ${GREEN}$WORKSPACE_BASE${NC}"
else
    echo -e "Worktree Base: ${GREEN}$GARAGE_DIR${NC}"
fi

echo
if ! prompt_yes_no "Proceed with initialization?" "y"; then
    echo -e "${RED}Initialization cancelled.${NC}"
    exit 0
fi

# Step 7: Create PMO Structure
echo
echo -e "${CYAN}Creating PMO structure...${NC}"

# Create directories
mkdir -p "$PMO_BASE_DIR/specs/backlog"
mkdir -p "$PMO_BASE_DIR/specs/active"
mkdir -p "$PMO_BASE_DIR/specs/completed"
mkdir -p "$PMO_BASE_DIR/scripts"

# Create config.yml with dynamic content
cat > "$PMO_BASE_DIR/config.yml" << EOF
# PMO Configuration
# Generated by pmo-init on $(date)

# Project type
type: $PROJECT_TYPE

# Board configuration
board_type: $BOARD_TYPE

# Repository configuration
repos:
EOF

# Add repos to config
for i in "${!REPOS[@]}"; do
    repo="${REPOS[$i]}"
    path="${REPO_PATHS[$i]}"
    
    if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
        cat >> "$PMO_BASE_DIR/config.yml" << EOF
  $repo:
    path: $path
    worktree_base: ${path}-worktrees
    remote: git@github.com:OWNER/$repo.git  # Update this
EOF
    else
        cat >> "$PMO_BASE_DIR/config.yml" << EOF
  $repo:
    path: $path
    worktree_base: $GARAGE_DIR
EOF
    fi
done

# Continue config with agents
cat >> "$PMO_BASE_DIR/config.yml" << EOF

# Agent configuration
agents:
  theme: $SELECTED_THEME
  active:
EOF

for agent in "${AGENTS[@]}"; do
    echo "    - $agent" >> "$PMO_BASE_DIR/config.yml"
done

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    cat >> "$PMO_BASE_DIR/config.yml" << EOF
  workspace_base: $WORKSPACE_BASE
  
# Unified workspace configuration
unified_workspaces:
EOF
    
    for agent in "${AGENTS[@]}"; do
        cat >> "$PMO_BASE_DIR/config.yml" << EOF
  $agent:
    path: $WORKSPACE_BASE/$agent
    repos:
EOF
        for repo in "${REPOS[@]}"; do
            echo "      - $repo" >> "$PMO_BASE_DIR/config.yml"
        done
    done
fi

# Add kanban settings
cat >> "$PMO_BASE_DIR/config.yml" << EOF

# Kanban settings
kanban:
  # Story point scale (Fibonacci)
  point_scale:
    1:  "Trivial (~2 hours)"
    2:  "Simple (half day)"
    3:  "Standard (1 day)"
    5:  "Complex (2-3 days)"
    8:  "Large (1 week)"
    13: "Epic (1-2 weeks)"
    21: "Too large - split"
  
  # Priority options
  priority_options: [HIGH, MEDIUM, LOW]
  
  # Urgency options
  urgency_options: [NOW, SOON, LATER]
EOF

echo -e "  ${GREEN}✓${NC} Created config.yml"

# Create kanban.md based on board type
if [[ "$BOARD_TYPE" == "5-tool-founder" ]]; then
    cat > "$PMO_BASE_DIR/kanban.md" << 'EOF'
---
kanban-plugin: board
---

## 📥 Triage

- [ ] [[example-idea]]
  **Priority:** TBD / **Urgency:** TBD
  **Points:** TBD
  **Category:** TBD / **Status:** Triage
  **Owner:** unassigned / **Agent:** unassigned
  **Timeline:** Started - • Due - • Completed -
  **Spec:** [[specs/backlog/example-idea.md]]
  ***
  Raw idea - needs triage and categorization

## 🏗️ Build Queue

## 📈 Grow Queue

## 🛟 Support Queue

## ⚙️ BizOps Queue

## 🎯 Strategy Queue

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Merged

## 🚀 Released

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[]}
```
%%
EOF
else
    cat > "$PMO_BASE_DIR/kanban.md" << 'EOF'
---
kanban-plugin: board
---

## 📥 Backlog

- [ ] [[example-feature]]
  **Priority:** MEDIUM / **Urgency:** SOON
  **Points:** 5
  **Category:** BUILD / **Status:** Backlog
  **Owner:** unassigned / **Agent:** unassigned
  **Timeline:** Started - • Due - • Completed -
  **Spec:** [[specs/backlog/example-feature.md]]
  ***
  Example feature - replace with real work

## 🎯 Ready

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Merged

## 🚀 Released

## 🚫 Blocked

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[]}
```
%%
EOF
fi

echo -e "  ${GREEN}✓${NC} Created kanban.md"

# Create README
cat > "$PMO_BASE_DIR/README.md" << EOF
# PMO (Project Management Office)

This PMO manages a **$PROJECT_TYPE** project with **$BOARD_TYPE** board style.

## Configuration

- **Project Type:** $PROJECT_TYPE
- **Repositories:** ${REPOS[*]}
- **Active Agents:** ${AGENTS[*]}
- **Theme:** $SELECTED_THEME

## Quick Start

\`\`\`bash
# Claim a ticket
pmo claim <ticket-name>

# Update status
pmo status "Working on API endpoints"

# Complete a ticket
pmo complete <ticket-name>

# Launch agent workspace
pmo launch <agent-name>
\`\`\`

## Board Structure

EOF

if [[ "$BOARD_TYPE" == "5-tool-founder" ]]; then
    cat >> "$PMO_BASE_DIR/README.md" << 'EOF'
The 5-Tool Founder board includes:
- **Triage:** Raw ideas and new tickets
- **Build Queue:** Product/Engineering work
- **Grow Queue:** Marketing/Sales/Growth work
- **Support Queue:** Customer success work
- **BizOps Queue:** Operations/Finance work
- **Strategy Queue:** Vision/Partnership work
EOF
else
    cat >> "$PMO_BASE_DIR/README.md" << 'EOF'
Standard flow board with columns:
- **Backlog:** All unstarted work
- **Ready:** Prioritized and ready to start
- **In Progress:** Active development
- **PR/Review:** In code review
- **Merged:** Code merged to main
- **Released:** Deployed to production
EOF
fi

echo -e "  ${GREEN}✓${NC} Created README.md"

# Step 8: Create Workspaces/Worktrees
echo
echo -e "${CYAN}Setting up agent workspaces...${NC}"

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    # Create unified workspaces with symlinks
    for agent in "${AGENTS[@]}"; do
        workspace_dir="$WORKSPACE_BASE/$agent"
        mkdir -p "$workspace_dir"
        
        # Create symlinks for each repo's worktree
        for i in "${!REPOS[@]}"; do
            repo="${REPOS[$i]}"
            repo_path="${REPO_PATHS[$i]}"
            worktree_path="$repo_path-worktrees/$agent"
            
            # Create worktree if it doesn't exist
            if [[ ! -d "$worktree_path" ]]; then
                echo -e "  Creating worktree for $repo/$agent..."
                (cd "$repo_path" && git worktree add "$worktree_path" -b "agent/$agent")
            fi
            
            # Create symlink in unified workspace
            ln -sf "$(realpath "$worktree_path")" "$workspace_dir/$repo"
        done
        
        # Link to PMO
        ln -sf "$(realpath "$PMO_BASE_DIR")" "$workspace_dir/pmo"
        
        # Create context file
        cat > "$workspace_dir/.claude-context.md" << EOF
# $agent Agent Workspace

## Active Repositories
EOF
        for repo in "${REPOS[@]}"; do
            echo "- $repo/" >> "$workspace_dir/.claude-context.md"
        done
        
        cat >> "$workspace_dir/.claude-context.md" << EOF
- pmo/ (Project Management)

## Current Status
No active ticket. Run 'pmo claim <ticket>' to start.
EOF
        
        echo -e "  ${GREEN}✓${NC} Created unified workspace: $workspace_dir"
    done
else
    # Create simple worktrees for monorepo
    mkdir -p "$GARAGE_DIR"
    
    for agent in "${AGENTS[@]}"; do
        worktree_path="$GARAGE_DIR/$agent"
        
        if [[ ! -d "$worktree_path" ]]; then
            echo -e "  Creating worktree for $agent..."
            git worktree add "$worktree_path" -b "agent/$agent"
        fi
        
        echo -e "  ${GREEN}✓${NC} Created worktree: $worktree_path"
    done
fi

# Create PMO helper script
cat > "$PMO_BASE_DIR/scripts/pmo.sh" << 'EOF'
#!/bin/bash
# PMO Helper Script

# Source configuration
CONFIG_FILE="$(dirname "$0")/../config.yml"

# Parse YAML (basic implementation)
get_config() {
    grep "^$1:" "$CONFIG_FILE" | cut -d':' -f2- | xargs
}

PROJECT_TYPE=$(get_config "type")
BOARD_TYPE=$(get_config "board_type")

case "$1" in
    claim)
        echo "Claiming ticket: $2"
        # Implementation here
        ;;
    status)
        echo "Updating status: $2"
        # Implementation here
        ;;
    complete)
        echo "Completing ticket: $2"
        # Implementation here
        ;;
    launch)
        echo "Launching workspace for: $2"
        # Implementation here
        ;;
    *)
        echo "Usage: pmo {claim|status|complete|launch} [args]"
        ;;
esac
EOF

chmod +x "$PMO_BASE_DIR/scripts/pmo.sh"
echo -e "  ${GREEN}✓${NC} Created pmo.sh helper script"

# Final summary
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ PMO Initialization Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Next steps:"
echo "1. Review and edit $PMO_BASE_DIR/config.yml"
echo "2. Open $PMO_BASE_DIR/kanban.md in Obsidian"
echo "3. Create your first spec in $PMO_BASE_DIR/specs/"
echo

if [[ "$PROJECT_TYPE" == "multi-repo" ]]; then
    echo "Agent workspaces created at:"
    for agent in "${AGENTS[@]}"; do
        echo "  • $WORKSPACE_BASE/$agent"
    done
    echo
    echo "To start working:"
    echo "  cd $WORKSPACE_BASE/<agent-name>"
    echo "  pmo claim <ticket-name>"
else
    echo "Worktrees created at:"
    for agent in "${AGENTS[@]}"; do
        echo "  • $GARAGE_DIR/$agent"
    done
    echo
    echo "To start working:"
    echo "  cd $GARAGE_DIR/<agent-name>"
    echo "  pmo claim <ticket-name>"
fi

echo
echo -e "${CYAN}Happy coding! 🚀${NC}"