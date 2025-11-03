#!/bin/bash

# Proletariat HQ Scaffolding
# Creates the complete project HQ structure

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🏗️  Proletariat HQ Scaffolding${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Get project details
echo -e "${MAGENTA}Project Configuration${NC}"
read -p "Project name: " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-my-project}

read -p "Repository names (comma-separated, e.g., frontend,backend,api): " REPO_INPUT
IFS=',' read -ra REPOS <<< "${REPO_INPUT:-frontend,backend}"

read -p "Agent names (comma-separated, e.g., 4runner,camry,hilux): " AGENT_INPUT  
IFS=',' read -ra AGENTS <<< "${AGENT_INPUT:-4runner,camry}"

# Theme selection
echo
echo "Select agent theme:"
echo "  1) Toyota (4runner, camry, tacoma - agents work in 'bays')"
echo "  2) Star Wars (luke, leia, han - agents work at 'stations')"
echo "  3) Billionaires (elon, jeff, bill - agents work at 'desks')"
echo "  4) Companies (google, apple, amazon - agents work in 'offices')"
echo "  5) Custom (use names provided above)"
read -p "Theme [1-5]: " THEME_CHOICE

case "$THEME_CHOICE" in
    1) 
        THEME="toyota"
        WORKSPACE_NAME="bays"
        WORKSPACE_SINGULAR="bay"
        ;;
    2) 
        THEME="starwars"
        WORKSPACE_NAME="stations"
        WORKSPACE_SINGULAR="station"
        ;;
    3) 
        THEME="billionaires"
        WORKSPACE_NAME="desks"
        WORKSPACE_SINGULAR="desk"
        ;;
    4) 
        THEME="companies"
        WORKSPACE_NAME="offices"
        WORKSPACE_SINGULAR="office"
        ;;
    *) 
        THEME="custom"
        read -p "What should agent workspaces be called? (e.g., desks, bays, offices): " WORKSPACE_NAME
        WORKSPACE_NAME=${WORKSPACE_NAME:-workspaces}
        # Try to determine singular form
        if [[ "$WORKSPACE_NAME" == *"ies" ]]; then
            WORKSPACE_SINGULAR="${WORKSPACE_NAME%ies}y"
        elif [[ "$WORKSPACE_NAME" == *"es" ]]; then
            WORKSPACE_SINGULAR="${WORKSPACE_NAME%es}"
        elif [[ "$WORKSPACE_NAME" == *"s" ]]; then
            WORKSPACE_SINGULAR="${WORKSPACE_NAME%s}"
        else
            WORKSPACE_SINGULAR="$WORKSPACE_NAME"
        fi
        ;;
esac

# Create HQ directory
HQ_DIR="${PROJECT_NAME}-hq"
echo
echo -e "${CYAN}Creating HQ structure at: ${HQ_DIR}${NC}"

if [[ -d "$HQ_DIR" ]]; then
    echo -e "${YELLOW}Warning: $HQ_DIR already exists${NC}"
    read -p "Continue anyway? [y/N]: " CONTINUE
    [[ ! "$CONTINUE" =~ ^[Yy]$ ]] && exit 1
fi

mkdir -p "$HQ_DIR"
cd "$HQ_DIR"

# Create .proletariat config directory
echo -e "\n${BLUE}Setting up configuration...${NC}"
mkdir -p .proletariat

# Create comprehensive config
cat > .proletariat/config.yml << EOF
# Proletariat HQ Configuration
# Project: $PROJECT_NAME
# Created: $(date -I)

project:
  name: $PROJECT_NAME
  type: multi-repo
  structure: hq

# Repository configuration
repos:
EOF

for repo in "${REPOS[@]}"; do
    # Use absolute paths internally, relative for now
    REPO_PATH="$(pwd)/$repo"
    STAFF_PATH="$(pwd)/${repo}-staff"
    
    cat >> .proletariat/config.yml << EOF
  $repo:
    path: ./$repo                    # Relative for display
    absolute_path: $REPO_PATH        # Ready for distributed
    staff_dir: ./${repo}-staff      
    staff_absolute: $STAFF_PATH      # Ready for distributed
    location_type: local             # local | distributed (future)
    remote: git@github.com:OWNER/$repo.git  # TODO: Update with actual remote
    worktrees:
EOF
    for agent in "${AGENTS[@]}"; do
        echo "      - $agent" >> .proletariat/config.yml
    done
done

# Continue config with agents
cat >> .proletariat/config.yml << EOF

# Agent configuration
agents:
  theme: $THEME
  active:
EOF

for agent in "${AGENTS[@]}"; do
    echo "    - $agent" >> .proletariat/config.yml
done

cat >> .proletariat/config.yml << EOF
  workspace_dir: ./agent-$WORKSPACE_NAME
  workspace_type: $WORKSPACE_SINGULAR

# PMO configuration  
pmo:
  enabled: true
  location: ./pmo
  board_type: 5-tool-founder

# Development settings
development:
  default_branch: main
  feature_prefix: feature/
  protect_main: true
EOF

echo -e "  ${GREEN}✓${NC} Created .proletariat/config.yml"

# Create PMO directory
echo -e "\n${BLUE}Setting up PMO...${NC}"
mkdir -p pmo/specs/{backlog,active,completed}

cat > pmo/kanban.md << 'EOF'
---
kanban-plugin: board
---

## 📥 Triage

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

echo -e "  ${GREEN}✓${NC} Created PMO structure"

# Create repository directories and staff directories
echo -e "\n${BLUE}Creating repository structure...${NC}"

for repo in "${REPOS[@]}"; do
    # Create repo directory (will be replaced by clone)
    mkdir -p "$repo"
    echo -e "  ${GREEN}✓${NC} Created $repo/ (ready for git clone)"
    
    # Create staff directory for worktrees
    staff_dir="${repo}-staff"
    mkdir -p "$staff_dir"
    echo -e "  ${GREEN}✓${NC} Created $staff_dir/"
    
    # Note: Worktrees will be created after repos are cloned
done

# Create agent workspaces with symlinks
echo -e "\n${BLUE}Creating agent ${WORKSPACE_NAME}...${NC}"

for agent in "${AGENTS[@]}"; do
    workspace_dir="agent-$WORKSPACE_NAME/$agent"
    mkdir -p "$workspace_dir"
    
    # Create symlinks to each repo's worktree
    for repo in "${REPOS[@]}"; do
        staff_worktree="../${repo}-staff/$agent"
        # Symlink will be created after worktrees exist
        # For now, create placeholder
        touch "$workspace_dir/.pending-$repo"
    done
    
    # Link to PMO
    ln -sf ../../pmo "$workspace_dir/pmo"
    
    # Create agent context file
    cat > "$workspace_dir/.agent-context.md" << EOF
# $agent Agent ${WORKSPACE_SINGULAR^}

## Repositories
EOF
    for repo in "${REPOS[@]}"; do
        echo "- $repo/ (pending setup)" >> "$workspace_dir/.agent-context.md"
    done
    
    cat >> "$workspace_dir/.agent-context.md" << EOF
- pmo/ (project management)

## Status
Waiting for repository setup. Run 'prlt hq setup' after cloning repos.
EOF
    
    echo -e "  ${GREEN}✓${NC} Created agent-$WORKSPACE_NAME/$agent/"
done

# Create helper scripts
echo -e "\n${BLUE}Creating helper scripts...${NC}"

# Clone script
cat > clone-repos.sh << 'CLONE_SCRIPT'
#!/bin/bash

# Repository Clone Helper
# Run this to clone all repositories

set -e

source .proletariat/config.yml 2>/dev/null || true

echo "📦 Cloning repositories..."
echo
echo "This script will clone:"
CLONE_SCRIPT

for repo in "${REPOS[@]}"; do
    echo "echo \"  - $repo\"" >> clone-repos.sh
done

cat >> clone-repos.sh << 'CLONE_SCRIPT'
echo
read -p "Enter GitHub organization/user name: " GITHUB_ORG

CLONE_SCRIPT

for repo in "${REPOS[@]}"; do
    cat >> clone-repos.sh << CLONE_SCRIPT
if [[ ! -d "$repo/.git" ]]; then
    echo "Cloning $repo..."
    git clone git@github.com:\$GITHUB_ORG/$repo.git $repo
else
    echo "✓ $repo already exists"
fi

CLONE_SCRIPT
done

cat >> clone-repos.sh << 'CLONE_SCRIPT'

echo
echo "✅ Repositories cloned!"
echo "Next: Run './setup-worktrees.sh' to create agent worktrees"
CLONE_SCRIPT

chmod +x clone-repos.sh
echo -e "  ${GREEN}✓${NC} Created clone-repos.sh"

# Worktree setup script
cat > setup-worktrees.sh << 'WORKTREE_SCRIPT'
#!/bin/bash

# Worktree Setup Script
# Creates worktrees for all agents in all repos

set -e

echo "🌳 Setting up agent worktrees..."
echo

WORKTREE_SCRIPT

for repo in "${REPOS[@]}"; do
    cat >> setup-worktrees.sh << WORKTREE_SCRIPT
# Setup $repo worktrees
if [[ -d "$repo/.git" ]]; then
    echo "Creating worktrees for $repo..."
WORKTREE_SCRIPT
    
    for agent in "${AGENTS[@]}"; do
        cat >> setup-worktrees.sh << WORKTREE_SCRIPT
    if [[ ! -d "${repo}-staff/$agent" ]]; then
        (cd $repo && git worktree add ../${repo}-staff/$agent -b work/$agent 2>/dev/null || git worktree add ../${repo}-staff/$agent)
        echo "  ✓ Created ${repo}-staff/$agent"
    else
        echo "  • ${repo}-staff/$agent already exists"
    fi
WORKTREE_SCRIPT
    done
    
    cat >> setup-worktrees.sh << WORKTREE_SCRIPT
else
    echo "⚠️  $repo not found - clone it first"
fi

WORKTREE_SCRIPT
done

# Add symlink creation
cat >> setup-worktrees.sh << 'WORKTREE_SCRIPT'
echo
echo "🔗 Creating agent desk symlinks..."

WORKTREE_SCRIPT

for agent in "${AGENTS[@]}"; do
    for repo in "${REPOS[@]}"; do
        cat >> setup-worktrees.sh << WORKTREE_SCRIPT
# Link $agent desk to $repo
if [[ -d "${repo}-staff/$agent" ]]; then
    rm -f agent-$WORKSPACE_NAME/$agent/.pending-$repo
    ln -sfn ../../${repo}-staff/$agent agent-$WORKSPACE_NAME/$agent/$repo
    echo "  ✓ Linked agent-$WORKSPACE_NAME/$agent/$repo"
fi
WORKTREE_SCRIPT
    done
done

cat >> setup-worktrees.sh << 'WORKTREE_SCRIPT'

echo
echo "✅ Worktree setup complete!"
echo
echo "Agent $WORKSPACE_NAME ready at:"
WORKTREE_SCRIPT

for agent in "${AGENTS[@]}"; do
    echo "echo \"  • agent-$WORKSPACE_NAME/$agent/\"" >> setup-worktrees.sh
done

chmod +x setup-worktrees.sh
echo -e "  ${GREEN}✓${NC} Created setup-worktrees.sh"

# Create prlt command
mkdir -p .proletariat/bin
cat > .proletariat/bin/prlt << 'PRLT_SCRIPT'
#!/bin/bash

# Proletariat HQ Command
CONFIG_FILE="$(dirname "$0")/../config.yml"

case "$1" in
    go)
        AGENT="$2"
        if [[ -d "agent-$WORKSPACE_NAME/$AGENT" ]]; then
            cd "agent-$WORKSPACE_NAME/$AGENT" && exec $SHELL
        else
            echo "Agent desk not found: $AGENT"
            echo "Available agents:"
            ls -1 agent-$WORKSPACE_NAME/ 2>/dev/null | sed 's/^/  • /'
        fi
        ;;
        
    status)
        echo "📊 Project Status"
        echo
        echo "Repositories:"
        for dir in *-staff; do
            repo="${dir%-staff}"
            if [[ -d "$repo/.git" ]]; then
                echo "  ✓ $repo (cloned)"
            else
                echo "  ⚠ $repo (not cloned)"
            fi
        done
        echo
        echo "Agent Desks:"
        ls -1 agent-$WORKSPACE_NAME/ 2>/dev/null | sed 's/^/  • /'
        ;;
        
    setup)
        echo "Running setup..."
        if [[ -f setup-worktrees.sh ]]; then
            ./setup-worktrees.sh
        else
            echo "setup-worktrees.sh not found"
        fi
        ;;
        
    *)
        echo "Proletariat HQ Commands:"
        echo "  prlt go <agent>  - Switch to agent desk"
        echo "  prlt status      - Show project status"
        echo "  prlt setup       - Setup/refresh worktrees"
        ;;
esac
PRLT_SCRIPT

chmod +x .proletariat/bin/prlt
echo -e "  ${GREEN}✓${NC} Created prlt command"

# Create README
cat > README.md << README
# $PROJECT_NAME HQ

This is the headquarters for the $PROJECT_NAME multi-repository project.

## Structure

\`\`\`
$HQ_DIR/
├── .proletariat/          # Configuration
├── pmo/                   # Project Management Office
├── [repos]/               # Clone repositories here
├── [repos]-staff/         # Agent worktrees (auto-created)
└── agent-$WORKSPACE_NAME/           # Unified agent workspaces
    ├── $agent/
    │   ├── frontend/ → ../../frontend-staff/$agent
    │   └── backend/ → ../../backend-staff/$agent
\`\`\`

## Quick Start

1. **Clone your repositories:**
   \`\`\`bash
   ./clone-repos.sh
   \`\`\`

2. **Setup agent worktrees:**
   \`\`\`bash
   ./setup-worktrees.sh
   \`\`\`

3. **Start working:**
   \`\`\`bash
   .proletariat/bin/prlt go $agent
   \`\`\`

## Agents

Active agents (theme: $THEME):
README

for agent in "${AGENTS[@]}"; do
    echo "- $agent" >> README.md
done

cat >> README.md << README

## Repositories

Configured repositories:
README

for repo in "${REPOS[@]}"; do
    echo "- $repo" >> README.md
done

echo -e "  ${GREEN}✓${NC} Created README.md"

# Final summary
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ HQ Structure Created!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "${CYAN}Location:${NC} $(pwd)"
echo
echo -e "${CYAN}Next Steps:${NC}"
echo "  1. cd $HQ_DIR"
echo "  2. ./clone-repos.sh        # Clone your repositories"
echo "  3. ./setup-worktrees.sh    # Create agent worktrees"
echo "  4. .proletariat/bin/prlt go <agent>  # Start working"
echo
echo -e "${YELLOW}Structure created:${NC}"
echo "  📁 Repositories: ${REPOS[*]}"
echo "  🤖 Agents: ${AGENTS[*]}"
echo "  🎨 Theme: $THEME"
echo
echo -e "${CYAN}Happy coding! 🚀${NC}"