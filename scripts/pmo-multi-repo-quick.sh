#!/bin/bash

# Quick Multi-Repo PMO Setup
# Minimal viable multi-repo support

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 Quick Multi-Repo PMO Setup${NC}"
echo

# Get project name
read -p "Project name: " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-my-project}

# Get repos (comma-separated)
read -p "Repository names (comma-separated, e.g., frontend,backend,infra): " REPO_INPUT
IFS=',' read -ra REPOS <<< "$REPO_INPUT"

# Get agents  
read -p "Agent names (comma-separated, e.g., 4runner,camry): " AGENT_INPUT
IFS=',' read -ra AGENTS <<< "$AGENT_INPUT"

# Create PMO directory
PMO_DIR="../${PROJECT_NAME}-pmo"
mkdir -p "$PMO_DIR/specs"

# Create config
cat > "$PMO_DIR/config.yml" << EOF
type: multi-repo
project: $PROJECT_NAME

repos:
EOF

for repo in "${REPOS[@]}"; do
    cat >> "$PMO_DIR/config.yml" << EOF
  $repo:
    path: ../$repo
    worktree_base: ../$repo-worktrees
EOF
done

cat >> "$PMO_DIR/config.yml" << EOF

agents:
  active:
EOF

for agent in "${AGENTS[@]}"; do
    echo "    - $agent" >> "$PMO_DIR/config.yml"
done

cat >> "$PMO_DIR/config.yml" << EOF
  workspace_base: ~/workspaces/$PROJECT_NAME
EOF

# Create kanban
cat > "$PMO_DIR/kanban.md" << 'EOF'
---
kanban-plugin: board
---

## 📥 Triage

## 🏗️ Build Queue

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Done

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
EOF

# Create unified workspaces
echo -e "\n${BLUE}Creating unified workspaces...${NC}"

for agent in "${AGENTS[@]}"; do
    WORKSPACE="$HOME/workspaces/$PROJECT_NAME/$agent"
    mkdir -p "$WORKSPACE"
    
    # Create worktrees and symlinks
    for repo in "${REPOS[@]}"; do
        REPO_PATH="../$repo"
        WORKTREE_PATH="../$repo-worktrees/$agent"
        
        # Create worktree if repo exists
        if [[ -d "$REPO_PATH/.git" ]]; then
            if [[ ! -d "$WORKTREE_PATH" ]]; then
                echo "  Creating $repo worktree for $agent..."
                (cd "$REPO_PATH" && git worktree add "$WORKTREE_PATH" -b "work/$agent" 2>/dev/null || git worktree add "$WORKTREE_PATH")
            fi
            ln -sf "$(realpath "$WORKTREE_PATH")" "$WORKSPACE/$repo" 2>/dev/null || true
        else
            echo "  ⚠️  Repo $repo not found, skipping worktree"
        fi
    done
    
    # Link PMO
    ln -sf "$(realpath "$PMO_DIR")" "$WORKSPACE/pmo"
    
    # Create context file
    cat > "$WORKSPACE/.context" << EOF
Agent: $agent
Project: $PROJECT_NAME
Repos: ${REPOS[*]}
PMO: pmo/kanban.md
EOF
    
    echo -e "  ${GREEN}✓${NC} Created workspace: ~/workspaces/$PROJECT_NAME/$agent"
done

# Create quick command script
cat > "$PMO_DIR/pmo" << 'SCRIPT'
#!/bin/bash

# Quick PMO commands for multi-repo
AGENT=$(basename "$(pwd)")
PROJECT=$(basename "$(dirname "$(pwd)")")

case "$1" in
    claim)
        TICKET=$2
        echo "📋 Claiming $TICKET for $AGENT"
        
        # Update kanban (move to in progress)
        sed -i.bak "s/\[ \] \[\[$TICKET\]\]/\[x\] \[\[$TICKET\]\] @$AGENT/" pmo/kanban.md
        
        # Create branches in all repos
        for repo in */; do
            [[ "$repo" == "pmo/" ]] && continue
            echo "  Creating branch in $repo"
            (cd "$repo" && git checkout -b "feature/$TICKET" 2>/dev/null || git checkout "feature/$TICKET")
        done
        
        echo "✅ Ready to work on $TICKET"
        ;;
        
    sync)
        echo "🔄 Syncing PMO..."
        (cd pmo && git pull 2>/dev/null || echo "PMO not a git repo")
        echo "✅ PMO synced"
        ;;
        
    status)
        echo "📊 Current branches:"
        for repo in */; do
            [[ "$repo" == "pmo/" ]] && continue
            echo -n "  $repo: "
            (cd "$repo" && git branch --show-current)
        done
        ;;
        
    *)
        echo "Usage: pmo {claim|sync|status} [ticket]"
        echo "Run from agent workspace: ~/workspaces/$PROJECT/$AGENT"
        ;;
esac
SCRIPT

chmod +x "$PMO_DIR/pmo"

# Create global launcher
cat > "$HOME/.local/bin/pmo-$PROJECT_NAME" << LAUNCHER
#!/bin/bash
# Global PMO launcher for $PROJECT_NAME

case "\$1" in
    go)
        AGENT=\$2
        cd "$HOME/workspaces/$PROJECT_NAME/\$AGENT"
        echo "📍 Switched to \$AGENT workspace"
        \$SHELL
        ;;
    list)
        echo "Agents for $PROJECT_NAME:"
        ls -1 "$HOME/workspaces/$PROJECT_NAME/"
        ;;
    *)
        echo "Usage: pmo-$PROJECT_NAME {go <agent>|list}"
        ;;
esac
LAUNCHER

chmod +x "$HOME/.local/bin/pmo-$PROJECT_NAME" 2>/dev/null || true

# Done!
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Multi-Repo PMO Ready!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "PMO created at: $PMO_DIR"
echo
echo "Agent workspaces:"
for agent in "${AGENTS[@]}"; do
    echo "  ~/workspaces/$PROJECT_NAME/$agent"
done
echo
echo "Quick commands:"
echo "  cd ~/workspaces/$PROJECT_NAME/<agent>"
echo "  ./pmo/pmo claim <ticket-name>"
echo "  ./pmo/pmo status"
echo
echo "Global command (if ~/.local/bin is in PATH):"
echo "  pmo-$PROJECT_NAME go <agent>    # Jump to agent workspace"
echo "  pmo-$PROJECT_NAME list          # List all agents"
echo
echo "🎉 Happy coding!"