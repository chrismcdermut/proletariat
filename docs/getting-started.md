# Getting Started with Proletariat

This guide walks you through installing Proletariat and spawning your first AI coding agent.

## Prerequisites

Before installing Proletariat, ensure you have:

- **Node.js 18+** - Required for running the CLI
- **Git** - Required for repository and branch management
- **Docker** (optional) - Recommended for isolated agent execution

Verify your setup:

```bash
node --version    # Should be v18.0.0 or higher
git --version     # Any recent version
docker --version  # Optional, for containerized agents
```

## Installation

Install Proletariat globally using your preferred package manager:

```bash
# npm
npm install -g @proletariat/cli

# pnpm
pnpm add -g @proletariat/cli

# yarn
yarn global add @proletariat/cli
```

Verify the installation:

```bash
prlt --version
```

## Step 1: Initialize Your Workspace (HQ)

Create a new HQ (headquarters) - your central command center for managing agents and work:

```bash
# Create a new directory for your HQ
mkdir my-project-hq
cd my-project-hq

# Initialize prlt
prlt init
```

This creates the following structure:

```
my-project-hq/
├── .proletariat/        # Config and workspace database
│   ├── config.json      # Workspace configuration
│   └── workspace.db     # SQLite database for tickets, agents, etc.
├── repos/               # Your repositories (added later)
├── agents/              # Agent worktrees
│   └── staff/           # Named agent workspaces
└── pmo/                 # Project Management Office
    └── specs/           # Specification files
```

## Step 2: Add a Repository

Link an existing repository to your HQ:

```bash
# Clone and add a repo
prlt repo add https://github.com/your-org/your-repo.git

# Or add an existing local repo
prlt repo add /path/to/existing/repo
```

List your repositories:

```bash
prlt repo list
```

## Step 3: Create Your First Ticket

Tickets are work items that agents will implement. Create one interactively:

```bash
prlt ticket create
```

You'll be prompted for:
- **Title**: Brief description of the work (e.g., "Add user authentication")
- **Description**: Detailed requirements and context
- **Priority**: P0 (critical), P1 (high), P2 (medium), P3 (low)
- **Category**: feature, bug, refactor, docs, test, chore, etc.

Or create a ticket with flags:

```bash
prlt ticket create \
  --title "Add login page" \
  --description "Create a login page with email/password fields" \
  --priority P1 \
  --category feature
```

View your tickets:

```bash
prlt ticket list
```

## Step 4: Add an Agent

Agents are AI coding assistants that work on your tickets. Add one:

```bash
# Add a single agent
prlt agent staff add alice

# Or add multiple agents
prlt agent staff add alice bob charlie
```

Proletariat supports themed agent names for fun. Try:

```bash
prlt agent themes list           # See available themes
prlt agent themes set billionaires  # Set a theme
prlt agent staff add             # Names auto-generated from theme
```

## Step 5: Spawn Work

Now spawn an agent to work on your ticket:

```bash
# Start work on a specific ticket
prlt work start TKT-001

# Or spawn interactively
prlt work start
```

You'll be prompted to select:
- **Ticket**: Which ticket to work on
- **Agent**: Which agent to assign
- **Mode**: How to run the agent (Docker, terminal, tmux, etc.)
- **Action**: What to do (implement, groom, review, etc.)

### Execution Modes

| Mode | Description |
|------|-------------|
| `docker` | Run in isolated Docker container (recommended) |
| `devcontainer` | Use VS Code devcontainer |
| `terminal` | Open in new terminal window |
| `tmux` | Run in tmux session |
| `foreground` | Run in current terminal |
| `background` | Run in background |

Example with explicit mode:

```bash
prlt work start TKT-001 --mode docker
```

## Step 6: Monitor Progress

Watch your agent work:

```bash
# View the kanban board
prlt board

# Check ticket status
prlt ticket list

# View agent logs (if running in background/docker)
prlt execution logs
```

## Step 7: Review and Merge

When the agent creates a PR:

```bash
# Check PR status
prlt pr status TKT-001

# View in GitHub
gh pr view
```

Review the PR in GitHub, request changes if needed, and merge when ready.

## Quick Reference

| Task | Command |
|------|---------|
| Initialize workspace | `prlt init` |
| Add repository | `prlt repo add <url>` |
| Create ticket | `prlt ticket create` |
| List tickets | `prlt ticket list` |
| Add agent | `prlt agent staff add <name>` |
| Start work | `prlt work start <ticket>` |
| View board | `prlt board` |
| Check status | `prlt ticket list` |

## Next Steps

- [Core Concepts](./concepts/hq.md) - Understand HQ, PMO, and agents in depth
- [Workflow Guides](./workflows/ticket-lifecycle.md) - Common workflow patterns
- [CLI Reference](./cli-reference.md) - Full command documentation
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Getting Help

```bash
# General help
prlt --help

# Command-specific help
prlt ticket --help
prlt work start --help
```

For issues and feature requests, visit the [GitHub repository](https://github.com/proletariat-ai/proletariat).
