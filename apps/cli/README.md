# Proletariat

> Multi-agent development orchestration for AI coding assistants

[![npm version](https://img.shields.io/npm/v/@proletariat/cli.svg)](https://www.npmjs.com/package/@proletariat/cli)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Proletariat (`prlt`) is a CLI tool for managing multiple AI coding agents working on your codebase simultaneously. Each agent works in isolated Docker containers with their own git branches, guided by tickets from your PMO (Project Management Office).

## Why Proletariat?

AI coding assistants are powerful, but managing multiple agents on the same codebase is chaotic:

- Agents conflict with each other's changes
- No clear assignment of who's working on what
- Progress is scattered across chat windows
- Security risk of agents running on your host

Proletariat solves this with:

- **Isolation** - Each agent works in their own Docker container and git branch
- **Ticket-driven** - Clear work assignments with progress tracking
- **Provider-agnostic** - Works with Claude Code, Cursor, Codex (coming soon)
- **Git-native** - Uses worktrees, branches, and PRs you already know
- **Open ecosystem** - Integrates with Linear, GitHub Issues, Jira (coming soon)

## Quick Start

Get up and running in under 5 minutes:

```bash
# 1. Install prlt globally
npm install -g @proletariat/cli

# 2. Initialize a new workspace
prlt init

# 3. Create your first ticket
prlt ticket create --title "Add user authentication" --description "Implement JWT auth"

# 4. Add AI agents (billionaire theme by default!)
prlt agent add altman bezos musk

# 5. Spawn work - agent starts working in Docker container
prlt work spawn TKT-001 altman

# 6. Monitor progress
prlt board              # View kanban board
prlt work logs TKT-001  # Watch agent output
```

See the [Getting Started Guide](docs/getting-started.md) for detailed onboarding.

## Prerequisites

- **Node.js 18+** - Required for running the CLI
- **Git** - Required for version control operations
- **Docker** (optional) - For containerized agent execution

## Installation

### npm (recommended)

```bash
npm install -g @proletariat/cli
```

### pnpm

```bash
pnpm add -g @proletariat/cli
```

### yarn

```bash
yarn global add @proletariat/cli
```

### Verify installation

```bash
prlt --version
prlt --help
```

## How It Works

### 1. Create a Workspace

A workspace organizes the repositories needed for a project, workstream, or entire business. It's your central command center:

```
my-workspace/
├── .proletariat/        # Config and workspace database
│   ├── config.json      # Workspace configuration
│   └── workspace.db     # SQLite database
├── repos/               # Your git repositories
│   ├── backend-api/     # Could be multiple repos
│   ├── frontend-web/    # for a full product
│   └── shared-libs/     # or business
├── agents/              # Agent worktrees
│   └── staff/
│       ├── altman/      # Each agent gets isolated workspace
│       ├── bezos/
│       └── musk/
└── pmo/                 # Project Management Office
    ├── board.md         # Markdown kanban board
    └── specs/           # Specification files
```

### 2. Define Work as Tickets

Create tickets to describe the work you want agents to complete:

```bash
prlt ticket create
# Interactive prompts guide you through:
# - Title: What needs to be done
# - Description: Details and requirements
# - Priority: P0 (critical) to P3 (low)
# - Category: feature, bug, docs, etc.
```

### 3. Assign to Agents

```bash
# Add agents with billionaire-themed names
prlt agent add altman bezos gates

# Assign a ticket to an agent
prlt ticket assign TKT-001 altman
```

### 4. Spawn Work

```bash
# Start an agent working on a ticket
prlt work spawn TKT-001 altman

# What happens:
# 1. Docker container starts with Claude Code
# 2. Agent reads the ticket context
# 3. Agent writes code in isolated branch
# 4. Agent creates a PR when done
```

### 5. Review and Merge

```bash
# Watch agent progress in real-time
prlt work logs TKT-001

# Check PR status
prlt pr status TKT-001

# When ready, review and merge in GitHub
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Workspace** | Organizes repos for a project, workstream, or business |
| **Agent** | An AI coding assistant with its own git branch and container |
| **PMO** | Project Management Office - tickets, specs, epics, and board |
| **Ticket** | A work item that flows through status columns |
| **Spec** | Detailed requirements that can be linked to tickets |
| **Epic** | A collection of related tickets for larger features |

See [Concepts](docs/concepts.md) for detailed explanations.

## Command Overview

### Workspace

```bash
prlt init                    # Initialize new workspace
prlt workspace list          # List discovered workspaces
```

### Agents

```bash
prlt agent add <names...>    # Add new agents
prlt agent list              # List all agents
prlt agent remove <name>     # Remove an agent
prlt agent shell <name>      # Open shell in agent workspace
prlt agent themes list       # See available naming themes
```

### Tickets

```bash
prlt ticket create           # Create new ticket (interactive)
prlt ticket list             # List all tickets
prlt ticket view <id>        # View ticket details
prlt ticket edit <id>        # Edit ticket
prlt ticket move <id> <status>  # Move to status
prlt ticket delete <id>      # Delete ticket
```

### Work

```bash
prlt work spawn <ticket> <agent>  # Start agent on ticket
prlt work start <ticket>          # Start work (auto-select agent)
prlt work list                    # List active work
prlt work logs <ticket>           # View agent output
prlt work ready <ticket>          # Mark work ready for review
prlt work complete <ticket>       # Mark work complete
```

### Board

```bash
prlt board                   # Show kanban board
prlt board watch             # Watch board for changes
```

### Pull Requests

```bash
prlt pr create               # Create PR for current branch
prlt pr status <ticket>      # Check PR status
prlt pr link <ticket> <url>  # Link PR to ticket
```

### Specs & Epics

```bash
prlt spec create             # Create specification
prlt spec list               # List all specs
prlt epic create             # Create epic
prlt epic list               # List all epics
```

Run `prlt --help` for full command reference, or see [Command Reference](docs/commands/README.md).

## Features

### Ticket Management
- Create, edit, view, and delete tickets
- Move tickets through workflow statuses
- Link tickets to specs and epics
- Bulk operations for managing multiple tickets

### Agent Orchestration
- Add and configure AI coding agents
- Billionaire-themed naming (altman, bezos, musk, gates...)
- Isolated Docker containers for each agent
- Git worktrees for branch isolation
- Support for Claude Code, Cursor, and more

### Board Visualization
- Kanban board view in terminal
- Real-time updates with watch mode
- Markdown export for Obsidian compatibility

### GitHub Integration
- Create PRs from CLI
- Link tickets to PRs
- Track PR status

### Project Organization
- Multiple projects within one workspace
- Epics for grouping related tickets
- Specs for detailed requirements

See [Features](docs/features.md) for detailed documentation.

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Step-by-step onboarding guide |
| [Features](docs/features.md) | Feature overview and capabilities |
| [Concepts](docs/concepts.md) | Core concepts and architecture |
| [Command Reference](docs/commands/README.md) | All commands with examples |

## Environment Variables

- `PRLT_HQ_PATH` - Override workspace location
- `DEVCONTAINER` - Set to "true" when running inside devcontainer

## Development

```bash
# Clone the repo
git clone https://github.com/proletariat-ai/proletariat.git
cd proletariat

# Install dependencies
pnpm install

# Build
pnpm build

# Run locally
./bin/run.js <command>

# Run tests
pnpm test
```

## Roadmap

Key upcoming features:

- GitHub Issues integration
- Linear integration
- Multi-provider support (Codex, Gemini CLI)
- MCP server for meta-orchestration
- Plugin system for custom integrations

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

## Support

- [GitHub Issues](https://github.com/proletariat-ai/proletariat/issues) - Report bugs and request features

---

Built with the vision of making AI coding assistants more productive and manageable.
