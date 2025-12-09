# Proletariat CLI

> Multi-agent development orchestration for distributed AI teams

## Installation

```bash
npm install -g @proletariat/cli
```

## Quick Start

```bash
# Initialize a new HQ
prlt init my-company-hq

# Add some agents
cd my-company-hq
prlt agent add alice bob charlie

# Create and assign work
prlt ticket create
prlt ticket assign T0001 alice

# Check status
prlt agent list
prlt ticket list
```

## Core Concepts

### 🏢 HQ (Headquarters)
Your central command center. Contains the PMO (Project Management Office) and configuration.

### 👥 Agents
Git worktrees representing individual development environments. Each agent works independently in their own branch.

### 🎫 Tickets
Work items tracked through the PMO. Tickets flow through: todo → in-progress → done.

## Command Reference

```bash
prlt --help           # See all commands
prlt <command> --help # Get help for any command
```

### Quick Command List
- `prlt init <name>` - Initialize a new HQ
- `prlt agent add [names...]` - Add agents to workspace
- `prlt agent list` - List all agents and status
- `prlt agent remove [names...]` - Remove agents
- `prlt ticket create` - Create new ticket
- `prlt ticket list` - List all tickets
- `prlt ticket assign [id] [agent]` - Assign ticket to agent
- `prlt ticket claim [id]` - Claim ticket (from agent worktree)
- `prlt ticket complete [id]` - Mark ticket as done

📚 **[See SYSTEM.md](./SYSTEM.md#4-complete-command-reference) for complete command reference with all options and examples**

## Architecture

```
workspace/
├── my-company-hq/        # HQ directory
│   ├── .proletariat/     # Config
│   ├── pmo/              # Tickets and kanban
│   └── README.md
└── garage/               # Agent worktrees
    ├── alice/
    ├── bob/
    └── charlie/
```

## Development

```bash
# Build from source
npm install
npm run build

# Run tests
npm test

# Use locally
./bin/run.js --help
```

## Documentation

- [SYSTEM.md](./SYSTEM.md) - Technical architecture and decisions
- Command help - Run any command with `--help` for details
- Tests - See `test/` for usage examples

## Future: Cloud Mode 🚀

Coming soon: Docker-based agents running in the cloud with web dashboard.

## License

MIT
