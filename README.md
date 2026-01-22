# Proletariat

> Multi-agent development orchestration for AI coding assistants

[![npm version](https://img.shields.io/npm/v/@proletariat/cli.svg)](https://www.npmjs.com/package/@proletariat/cli)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Proletariat (`prlt`) orchestrates multiple AI coding agents working on your codebase in parallel. Create tickets, spawn agent sessions, and watch them write code and create PRs - each agent isolated in its own git branch.

## Why Proletariat?

AI coding assistants are powerful, but managing multiple agents on the same codebase is chaotic:
- Agents conflict with each other's changes
- No clear assignment of who's working on what
- Progress is scattered across chat windows

Proletariat solves this with:

- **Isolation** - Each agent works in its own git branch and session
- **Ticket-driven** - Clear work assignments with progress tracking
- **Flexible execution** - Run in Docker, tmux, terminal, or on host
- **Provider-agnostic** - Works with Claude Code, Codex, Aider
- **Git-native** - Uses worktrees, branches, and PRs you already know

## Quick Start

```bash
# Install
npm install -g @proletariat/cli

# Initialize workspace
prlt init

# Create a ticket
prlt ticket create --title "Add user authentication" --category feature

# Spawn an agent to work on it
prlt work start TKT-001

# Watch the board
prlt board
```

The agent reads your ticket, writes code, and creates a PR.

## How It Works

### 1. Create Tickets

Define what needs to be built:

```bash
prlt ticket create
```

Add requirements, acceptance criteria, subtasks - the more context, the better agents perform.

### 2. Spawn Agent Sessions

When ready, spawn an ephemeral agent:

```bash
prlt work start TKT-001
```

Each spawn creates:
- A new git branch for the work
- An isolated session (Docker, tmux, terminal, or host)
- An AI agent that reads the ticket and starts coding

### 3. Agents Work Autonomously

The agent reads your ticket, writes code, commits changes, and creates a PR. Sessions are like threads - you can attach, detach, close windows, and the agent keeps working.

### 4. Review and Merge

```bash
prlt pr status TKT-001    # Check PR status
gh pr view                # Review in GitHub
gh pr merge               # Merge when ready
```

## Spawning Multiple Agents

Work on multiple tickets in parallel:

```bash
# Spawn all planned tickets
prlt work spawn --all --column Planned

# Spawn specific tickets
prlt work spawn TKT-001 TKT-002 TKT-003
```

## Execution Modes

| Mode | Description |
|------|-------------|
| `docker` | Isolated Docker container |
| `devcontainer` | VS Code devcontainer |
| `tmux` | Tmux session (attach/detach) |
| `terminal` | New terminal window |
| `foreground` | Current terminal |
| `host` | Direct execution |

```bash
prlt work start TKT-001 --mode docker    # Isolated
prlt work start TKT-001 --mode tmux      # Attachable session
prlt work start TKT-001 --run-on-host    # Direct execution
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Ticket** | Work item with requirements and acceptance criteria |
| **Session** | Running agent instance working on a ticket |
| **Worktree** | Isolated git working directory per agent |
| **PMO** | Project management - tickets, specs, board |

## Commands

```bash
# Workspace
prlt init                    # Initialize workspace
prlt repo add <url>          # Add repository

# Tickets
prlt ticket create           # Create ticket
prlt ticket list             # List tickets
prlt ticket view TKT-001     # View details
prlt ticket move TKT-001 "In Progress"

# Work
prlt work start TKT-001      # Start single ticket
prlt work spawn --all        # Batch spawn
prlt execution list          # List active sessions

# Board
prlt board                   # Show kanban board
prlt board watch             # Watch real-time
```

Run `prlt --help` for full command reference.

## Requirements

- Node.js 18+
- Git
- Docker (optional, for containerized execution)

## Documentation

### Getting Started
- [Getting Started Guide](docs/getting-started.md) - Full walkthrough
- [CLI Reference](docs/cli-reference.md) - All commands

### Core Concepts
- [HQ & Workspace](docs/concepts/hq.md) - Workspace structure
- [Tickets & PMO](docs/concepts/pmo.md) - Project management
- [Agents & Sessions](docs/concepts/agents.md) - How agents work
- [Work Execution](docs/concepts/work.md) - Spawning and modes

### Workflow Guides
- [Ticket Lifecycle](docs/workflows/ticket-lifecycle.md) - End-to-end flow
- [Multi-Agent Work](docs/workflows/multi-agent.md) - Parallel development
- [Docker Setup](docs/workflows/docker-setup.md) - Container isolation

### Reference
- [Troubleshooting](docs/troubleshooting.md) - Common issues
- [ROADMAP.md](ROADMAP.md) - Feature roadmap

## Development

```bash
pnpm install       # Install dependencies
pnpm build:cli     # Build
pnpm prlt <cmd>    # Run locally
```

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

---

Built for making AI coding assistants more productive and manageable.
