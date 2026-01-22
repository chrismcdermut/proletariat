# Proletariat CLI (prlt)

> Multi-agent development orchestration for AI coding assistants

Proletariat orchestrates multiple AI coding agents working on your codebase in parallel. Create tickets, spawn agent sessions, and watch them write code and create PRs - all while keeping each agent isolated in its own git branch.

## Installation

```bash
npm install -g @proletariat/cli
```

---

## TL;DR - Quick Start

```bash
# Initialize workspace
prlt init

# Create a ticket
prlt ticket create --title "Add user authentication" --category feature

# Spawn an agent session to work on it
prlt work start TKT-001

# Watch the board
prlt board
```

That's it. The agent reads your ticket, writes code, and creates a PR.

---

## How It Works

### 1. You create tickets

Tickets define what needs to be built:

```bash
prlt ticket create
```

Add details, acceptance criteria, and subtasks - the more context, the better the agent performs.

### 2. You spawn agent sessions

When ready, spawn an ephemeral agent to work on a ticket:

```bash
prlt work start TKT-001
```

Each spawn creates:
- A new git branch for the work
- An isolated session (Docker, terminal, tmux, or host)
- An AI agent that reads the ticket and starts coding

### 3. Agents work autonomously

The agent:
- Reads your ticket and any linked specs
- Writes code to implement the requirements
- Commits changes and creates a PR
- Session ends when work completes

### 4. You review and merge

```bash
prlt pr status TKT-001    # Check PR
gh pr view                # Review in GitHub
gh pr merge               # Merge when ready
```

---

## Execution Modes

Agents can run in different environments:

| Mode | Description |
|------|-------------|
| `docker` | Isolated Docker container (recommended for safety) |
| `devcontainer` | VS Code devcontainer integration |
| `tmux` | Tmux session (great for multiple agents) |
| `terminal` | New terminal window |
| `foreground` | Current terminal |
| `host` | Direct execution on your machine |

```bash
# Run in Docker (isolated)
prlt work start TKT-001 --mode docker

# Run in tmux (can attach/detach)
prlt work start TKT-001 --mode tmux

# Run on host (fastest, no isolation)
prlt work start TKT-001 --run-on-host
```

Sessions are like threads - you can attach to them, detach, close windows, and the agent keeps working.

---

## Spawning Multiple Agents

Work on multiple tickets in parallel:

```bash
# Spawn all planned tickets
prlt work spawn --all --column Planned

# Spawn specific tickets
prlt work spawn TKT-001 TKT-002 TKT-003

# Preview without executing
prlt work spawn --all --dry-run
```

---

## Core Commands

### Tickets

```bash
prlt ticket create           # Create ticket (interactive)
prlt ticket list             # List tickets
prlt ticket view TKT-001     # View details
prlt ticket edit TKT-001     # Edit ticket
prlt ticket move TKT-001 "In Progress"
```

### Work

```bash
prlt work start TKT-001      # Start single ticket
prlt work spawn --all        # Batch spawn
prlt execution list          # List active sessions
prlt execution logs          # View output
```

### Board

```bash
prlt board                   # View kanban board
prlt board watch             # Watch in real-time
```

### Workspace

```bash
prlt init                    # Initialize workspace
prlt repo add <url>          # Add repository
prlt repo list               # List repos
```

---

## Workspace Structure

```
my-project/
├── .proletariat/
│   ├── config.json          # Configuration
│   └── workspace.db         # SQLite database
├── repos/                   # Your repositories
├── agents/                  # Agent worktrees
│   └── temp/                # Ephemeral agent workspaces
└── pmo/
    └── specs/               # Specifications
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Ticket** | Work item with requirements, acceptance criteria, subtasks |
| **Session** | Running agent instance working on a ticket |
| **Worktree** | Isolated git working directory per agent |
| **PMO** | Project management - tickets, specs, board |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PRLT_HQ_PATH` | Override workspace location |
| `GITHUB_TOKEN` | GitHub authentication |
| `ANTHROPIC_API_KEY` | Claude API access |

---

## Documentation

### Guides
- [Getting Started](../../docs/getting-started.md) - Full walkthrough
- [CLI Reference](../../docs/cli-reference.md) - All commands
- [Troubleshooting](../../docs/troubleshooting.md) - Common issues

### Concepts
- [HQ & Workspace](../../docs/concepts/hq.md)
- [Tickets & PMO](../../docs/concepts/pmo.md)
- [Agents & Sessions](../../docs/concepts/agents.md)
- [Work Execution](../../docs/concepts/work.md)

### Workflows
- [Ticket Lifecycle](../../docs/workflows/ticket-lifecycle.md)
- [Multi-Agent Parallel Work](../../docs/workflows/multi-agent.md)
- [Docker Isolation](../../docs/workflows/docker-setup.md)

---

## License

Apache 2.0
