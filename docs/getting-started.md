# Getting Started with Proletariat

This guide walks you through installing Proletariat and spawning your first AI coding agent.

## Prerequisites

- **Node.js 18+** - Required for running the CLI
- **Git** - Required for repository and branch management
- **Docker** (optional) - For containerized agent execution

Verify your setup:

```bash
node --version    # Should be v18.0.0 or higher
git --version     # Any recent version
docker --version  # Optional
```

## Installation

### Homebrew (macOS)

```bash
brew install chrismcdermut/proletariat/prlt
```

Works on both Apple Silicon (arm64) and Intel (x86_64).

### npm (all platforms)

```bash
npm install -g @proletariat/cli
```

### Verify

```bash
prlt --version
```

### Upgrade

```bash
# Homebrew
brew update && brew upgrade prlt

# npm
npm update -g @proletariat/cli
```

## Step 1: Initialize Your Workspace

Create and initialize a workspace:

```bash
mkdir my-project
cd my-project
prlt init
```

This creates:

```
my-project/
├── .proletariat/
│   ├── config.json      # Workspace configuration
│   └── workspace.db     # SQLite database
├── repos/               # Your repositories
├── agents/              # Agent worktrees
│   └── temp/            # Ephemeral agent workspaces
└── pmo/
    └── specs/           # Specifications
```

## Step 2: Add a Repository (Optional)

If you're working with an existing repo:

```bash
prlt repo add https://github.com/your-org/your-repo.git
```

Or initialize in an existing repo directory - prlt will detect it.

## Step 3: Create Your First Ticket

Create a ticket describing what you want built:

```bash
prlt ticket create
```

You'll be prompted for:
- **Title**: Brief description (e.g., "Add user authentication")
- **Description**: Detailed requirements
- **Priority**: P0 (critical), P1 (high), P2 (medium), P3 (low)
- **Category**: feature, bug, refactor, docs, etc.

Or use flags:

```bash
prlt ticket create \
  --title "Add login page" \
  --description "Create a login page with email/password fields" \
  --priority P1 \
  --category feature
```

View your ticket:

```bash
prlt ticket list
prlt ticket view TKT-001
```

## Step 4: Spawn an Agent Session

Start an agent to work on your ticket:

```bash
prlt work start TKT-001
```

You'll be prompted to select:
- **Execution mode**: How to run the agent
- **Action**: What to do (implement, groom, review)

The agent:
1. Creates a new git branch
2. Reads your ticket
3. Writes code to implement it
4. Commits and creates a PR

### Execution Modes

| Mode | Best For |
|------|----------|
| `docker` | Safety - isolated container |
| `tmux` | Multiple agents - attach/detach sessions |
| `terminal` | Single agent - new window |
| `foreground` | Debugging - watch in current terminal |
| `host` | Speed - direct execution |

Example with specific mode:

```bash
prlt work start TKT-001 --mode tmux
```

## Step 5: Monitor Progress

Watch your agent work:

```bash
# View the board
prlt board

# Watch board in real-time
prlt board watch

# List active sessions
prlt execution list

# View logs
prlt execution logs
```

## Step 6: Review and Merge

When the agent creates a PR:

```bash
# Check PR status
prlt pr status TKT-001

# Review in GitHub
gh pr view

# Merge when ready
gh pr merge
```

## Quick Reference

| Task | Command |
|------|---------|
| Initialize | `prlt init` |
| Create ticket | `prlt ticket create` |
| List tickets | `prlt ticket list` |
| Start work | `prlt work start TKT-001` |
| Spawn from Linear | `prlt work linear --team ENG --issue ENG-123` |
| View board | `prlt board` |
| Check PR | `prlt pr status TKT-001` |

## Spawning Multiple Agents

Work on several tickets in parallel:

```bash
# Spawn all planned tickets
prlt work spawn --all --column Planned

# Spawn specific tickets
prlt work spawn TKT-001 TKT-002 TKT-003

# Preview without executing
prlt work spawn --all --dry-run
```

## Sessions as Threads

Agent sessions are like threads:
- **Attach**: Connect to a running session
- **Detach**: Disconnect without stopping
- **Close window**: Session keeps running
- **Kill**: Stop the agent

With tmux mode, use standard tmux commands to manage sessions.

## Next Steps

- [CLI Reference](./cli-reference.md) - All commands
- [Ticket Lifecycle](./workflows/ticket-lifecycle.md) - Full workflow
- [Multi-Agent Work](./workflows/multi-agent.md) - Parallel development
- [Troubleshooting](./troubleshooting.md) - Common issues

## Getting Help

```bash
prlt --help
prlt ticket --help
prlt work start --help
```
