# Getting Started with Proletariat

This guide walks you through setting up Proletariat and completing your first full ticket lifecycle - from creating a ticket to having an AI agent complete the work and create a pull request.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** - Check with `node --version`
- **Git** - Check with `git --version`
- **Docker** (optional) - For containerized agent execution
- **GitHub CLI** (optional) - For PR integration (`gh --version`)

## Step 1: Install Proletariat

Install the `prlt` CLI globally:

```bash
# Using npm
npm install -g @proletariat/cli

# Using pnpm
pnpm add -g @proletariat/cli

# Using yarn
yarn global add @proletariat/cli
```

Verify the installation:

```bash
prlt --version
prlt --help
```

## Step 2: Initialize Your Workspace

Create a new HQ (headquarters) - your central workspace for managing agents and work:

```bash
# Navigate to where you want to create your workspace
mkdir my-project-hq
cd my-project-hq

# Initialize the workspace
prlt init
```

The `init` command will:

1. Create the `.proletariat/` directory with configuration
2. Set up the SQLite database for tracking work
3. Create the `pmo/` directory for tickets and board
4. Initialize default workflow statuses

Your directory structure will look like:

```
my-project-hq/
├── .proletariat/
│   ├── config.json      # Workspace configuration
│   └── workspace.db     # SQLite database
├── repos/               # Your repositories (added later)
├── agents/              # Agent worktrees (created when adding agents)
└── pmo/                 # Project Management Office
    ├── board.md         # Markdown kanban board
    └── specs/           # Specifications
```

## Step 3: Create Your First Ticket

Tickets are the work items that agents will complete. Create one interactively:

```bash
prlt ticket create
```

You'll be prompted for:

- **Title**: A short description (e.g., "Add user login endpoint")
- **Description**: Detailed requirements
- **Priority**: P0 (critical) through P3 (low)
- **Category**: feature, bug, docs, refactor, etc.

Or create with flags:

```bash
prlt ticket create \
  --title "Add user login endpoint" \
  --description "Create POST /api/login endpoint with JWT token response" \
  --priority P1 \
  --category feature
```

View your tickets:

```bash
prlt ticket list
```

Example output:

```
Tickets for: My Project (3 total)
┌────────┬──────────────────────────┬─────────┬──────────┬──────────┐
│ ID     │ Title                    │ Status  │ Priority │ Category │
├────────┼──────────────────────────┼─────────┼──────────┼──────────┤
│ TKT-001│ Add user login endpoint  │ Backlog │ P1       │ feature  │
└────────┴──────────────────────────┴─────────┴──────────┴──────────┘
```

## Step 4: Add AI Agents

Agents are AI coding assistants that work on your tickets. Add one or more:

```bash
# Add a single agent
prlt agent add alice

# Add multiple agents
prlt agent add alice bob carol
```

List your agents:

```bash
prlt agent list
```

Each agent gets their own:

- Git worktree (isolated branch)
- Docker container (when spawning work)
- Workspace directory in `agents/staff/<name>/`

## Step 5: Start Work

Now comes the exciting part - have an agent work on your ticket!

### Option A: Spawn work (Docker container)

```bash
prlt work spawn TKT-001 alice
```

This starts a Docker container with Claude Code, loads the ticket context, and the agent begins working autonomously.

### Option B: Start work manually

```bash
prlt work start TKT-001
```

This prepares the workspace and ticket, letting you work manually or with your preferred AI assistant.

## Step 6: Monitor Progress

While an agent is working:

```bash
# View real-time logs
prlt work logs TKT-001

# Check overall status
prlt work list

# View the board
prlt board
```

The board shows tickets across status columns:

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   Backlog    │   Planned    │ In Progress  │     Done     │
├──────────────┼──────────────┼──────────────┼──────────────┤
│              │              │ TKT-001      │              │
│              │              │ alice        │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

## Step 7: Review and Complete

When the agent finishes and creates a PR:

```bash
# Check PR status
prlt pr status TKT-001

# Mark work as ready for review
prlt work ready TKT-001

# After review and merge, mark complete
prlt work complete TKT-001
```

The ticket automatically moves through statuses:

- `backlog` → `planned` → `in-progress` → `in-review` → `done`

## Complete Workflow Example

Here's the full lifecycle in one script:

```bash
# Setup
mkdir my-project-hq && cd my-project-hq
prlt init

# Create work
prlt ticket create --title "Add health check endpoint" --priority P1

# Assign and spawn
prlt agent add alice
prlt work spawn TKT-001 alice

# Monitor
prlt board
prlt work logs TKT-001

# Complete cycle
prlt work ready TKT-001 --pr  # Creates PR and marks ready
# ... review PR in GitHub ...
prlt work complete TKT-001
```

## Next Steps

Now that you've completed your first ticket lifecycle:

1. **Add more agents** - `prlt agent add bob carol` for parallel work
2. **Create specs** - Detailed requirements with `prlt spec create`
3. **Organize with epics** - Group related tickets with `prlt epic create`
4. **Explore features** - See [Features](features.md) for all capabilities
5. **Learn concepts** - Understand the model in [Concepts](concepts.md)

## Common Commands Reference

| Task | Command |
|------|---------|
| Create ticket | `prlt ticket create` |
| List tickets | `prlt ticket list` |
| View ticket | `prlt ticket view TKT-001` |
| Add agent | `prlt agent add <name>` |
| List agents | `prlt agent list` |
| Start work | `prlt work spawn <ticket> <agent>` |
| View logs | `prlt work logs <ticket>` |
| Show board | `prlt board` |
| Mark ready | `prlt work ready <ticket>` |
| Complete work | `prlt work complete <ticket>` |

## Troubleshooting

### "Docker is not running"

If you see this warning, either:

1. Start Docker Desktop / Docker daemon
2. Work will run on host (less isolated)

### "No agents found"

Add agents first: `prlt agent add alice`

### "Ticket not found"

Verify the ticket ID with `prlt ticket list`

### Permission errors

Ensure you have write access to the workspace directory.

---

See also:
- [Features](features.md) - Full feature documentation
- [Concepts](concepts.md) - Core architecture concepts
- [Command Reference](commands/README.md) - All commands with examples
- [README](../README.md) - Project overview
