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

```bash
# Install
npm install -g @proletariat/cli

# Initialize a new HQ (headquarters)
prlt init

# Create your first ticket
prlt ticket create

# Add agents to work on tickets
prlt agent add alice bob

# Spawn work for an agent
prlt work spawn TKT-001 alice

# Check progress
prlt board
prlt ticket list
```

## How It Works

### 1. Create an HQ

Your HQ (headquarters) is the central command center:

```
my-project-hq/
├── .proletariat/        # Config and workspace database
├── repos/               # Your repositories
├── agents/              # Agent worktrees
└── pmo/                 # Tickets, specs, and board
```

### 2. Define Work as Tickets

```bash
prlt ticket create
# Enter title: Add user authentication
# Enter description: Implement JWT-based auth with refresh tokens...
```

### 3. Assign to Agents

```bash
prlt agent add alice
prlt ticket assign TKT-001 alice
```

### 4. Spawn Work

```bash
prlt work spawn TKT-001 alice
# Starts Docker container with Claude Code
# Agent reads ticket, writes code, creates PR
```

### 5. Review and Merge

```bash
prlt work logs TKT-001      # Watch agent progress
prlt pr status TKT-001      # Check PR status
# Review PR in GitHub, merge when ready
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **HQ** | Your workspace root with repos, agents, and PMO |
| **Agent** | An AI assistant with its own git branch and container |
| **PMO** | Project Management Office - tickets, specs, board |
| **Ticket** | A work item flowing through backlog → in-progress → done |
| **Spec** | Detailed requirements that can be linked to tickets |

## Commands

```bash
# Workspace
prlt init                    # Create new HQ
prlt workspace list          # List discovered workspaces

# Agents
prlt agent add <names...>    # Add agents
prlt agent list              # List agents
prlt agent shell <name>      # Shell into agent workspace

# Tickets
prlt ticket create           # Create ticket
prlt ticket list             # List tickets
prlt ticket assign <id> <agent>
prlt ticket move <id> <status>

# Work
prlt work spawn <ticket> <agent>
prlt work list
prlt work logs <ticket>

# Board
prlt board                   # Show kanban board
```

Run `prlt --help` for full command reference.

## Requirements

- Node.js 18+
- Docker (optional, for containerized agents)
- Git

## Documentation

### Getting Started
- [Getting Started Guide](docs/getting-started.md) - Install to first agent walkthrough
- [CLI Reference](docs/cli-reference.md) - Complete command documentation

### Core Concepts
- [HQ (Headquarters)](docs/concepts/hq.md) - Workspace structure and setup
- [PMO (Project Management)](docs/concepts/pmo.md) - Tickets, specs, and board
- [Agents](docs/concepts/agents.md) - AI assistants, worktrees, and themes
- [Work](docs/concepts/work.md) - Spawning and executing agent work

### Workflow Guides
- [Ticket Lifecycle](docs/workflows/ticket-lifecycle.md) - End-to-end ticket flow
- [Multi-Agent Workflows](docs/workflows/multi-agent.md) - Running agents in parallel
- [Docker Setup](docs/workflows/docker-setup.md) - Container isolation guide

### Reference
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions
- [CLI README](apps/cli/README.md) - Additional CLI details
- [ROADMAP.md](ROADMAP.md) - Feature roadmap

## Project Structure

```
proletariat/
├── apps/
│   └── cli/           # Main CLI application (oclif)
├── packages/          # Shared packages (coming soon)
├── ROADMAP.md         # Feature roadmap
└── CONTRIBUTING.md    # Development guidelines
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build:cli

# Run locally
pnpm prlt <command>

# Run with isolated test database
pnpm prlt:isolated <command>
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full roadmap. Key upcoming features:

- GitHub Issues integration
- Linear integration
- Multi-provider support (Codex, Gemini CLI)
- MCP server for meta-orchestration
- Plugin system for custom integrations

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

Built with the vision of making AI coding assistants more productive and manageable.
