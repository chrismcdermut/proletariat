# Proletariat CLI (prlt)

> Multi-agent development orchestration for AI coding assistants

Proletariat helps you manage multiple AI coding agents working on your codebase simultaneously. Each agent works in isolated Docker containers with their own git branches, guided by tickets from your PMO (Project Management Office).

## Installation

```bash
# npm
npm install -g @proletariat/cli

# pnpm
pnpm add -g @proletariat/cli

# yarn
yarn global add @proletariat/cli
```

## Quick Start

```bash
# 1. Initialize a new HQ (headquarters)
prlt init

# 2. Create your first ticket
prlt ticket create

# 3. Add agents to work on tickets
prlt agent add alice bob

# 4. Spawn work for an agent
prlt work spawn TKT-001 alice

# 5. Check status
prlt ticket list
prlt agent list
```

## Core Concepts

### HQ (Headquarters)

Your central command center with this structure:

```
my-project-hq/
├── .proletariat/        # Config and workspace database
│   ├── config.json
│   └── workspace.db
├── repos/               # Your repositories
│   └── my-repo/
├── agents/              # Agent configurations
│   └── staff/           # Agent worktrees
│       ├── alice/
│       └── bob/
└── pmo/                 # Project Management Office
    ├── board.md         # Kanban board
    └── specs/           # Specifications
```

### Agents

AI coding assistants that work in isolated environments. Each agent:
- Has their own git worktree/branch
- Runs in a Docker container (optional)
- Works on tickets assigned to them
- Creates PRs when work is complete

### PMO (Project Management Office)

Your ticket-driven workflow system:
- **Tickets** - Work items that flow through status columns
- **Specs** - Detailed requirements linked to tickets
- **Board** - Kanban-style visualization of work progress

### Tickets

Work items with Linear-style statuses:
- `backlog` - Not yet planned
- `planned` - Ready to be worked on
- `in-progress` - Currently being worked
- `in-review` - PR created, awaiting review
- `done` - Completed
- `canceled` - No longer needed

## Key Commands

### Workspace Management

```bash
prlt init                    # Initialize new HQ
prlt workspace list          # List discovered workspaces
```

### Agent Management

```bash
prlt agent add <names...>    # Add new agents
prlt agent list              # List all agents
prlt agent remove <name>     # Remove an agent
prlt agent shell <name>      # Open shell in agent workspace
```

### Ticket Management

```bash
prlt ticket create           # Create new ticket
prlt ticket list             # List all tickets
prlt ticket show <id>        # Show ticket details
prlt ticket assign <id> <agent>  # Assign to agent
prlt ticket move <id> <status>   # Move to status
```

### Work Spawning

```bash
prlt work spawn <ticket> <agent>  # Start agent work in Docker
prlt work list                    # List active work
prlt work logs <ticket>           # View agent output
```

### Specs

```bash
prlt spec create             # Create new spec
prlt spec list               # List all specs
prlt spec show <id>          # Show spec details
prlt ticket link <ticket> <spec>  # Link spec to ticket
```

### Board

```bash
prlt board                   # Show kanban board
prlt board show              # Same as above
```

## Environment Variables

- `PRLT_HQ_PATH` - Override workspace location (useful for dev/testing)
- `DEVCONTAINER` - Set to "true" when running inside devcontainer

## Local Development

```bash
# Clone the repo
git clone https://github.com/proletariat-ai/proletariat.git
cd proletariat

# Install dependencies
pnpm install

# Build
pnpm build:cli

# Run locally (from anywhere in workspace)
pnpm prlt <command>

# Run with isolated test database
pnpm prlt:isolated <command>
```

## Architecture

Proletariat uses a layered architecture:

1. **CLI Layer** - oclif-based command interface
2. **PMO Layer** - Ticket and spec management (SQLite)
3. **Agent Layer** - Git worktree management
4. **Execution Layer** - Docker container orchestration

Data is stored in SQLite (`workspace.db`) with markdown sync to `board.md` for Obsidian compatibility.

## Why Proletariat?

- **Isolation** - Each agent works in their own container, can't mess up your host
- **Ticket-driven** - Clear work assignments and progress tracking
- **Provider-agnostic** - Works with Claude Code, Cursor, Codex (coming soon)
- **Git-native** - Uses worktrees, branches, and PRs you already know
- **Open ecosystem** - Integrates with Linear, GitHub Issues (coming soon)

## Related Documentation

- [CONTRIBUTING.md](../../CONTRIBUTING.md) - Development guidelines
- [ROADMAP.md](../../ROADMAP.md) - Feature roadmap
- [SYSTEM.md](./SYSTEM.md) - Technical architecture (if exists)

## License

Apache 2.0
