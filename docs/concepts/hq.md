# HQ (Headquarters)

The HQ is your central command center for orchestrating AI coding agents. It provides a structured workspace that keeps your repositories, agents, and project management organized in one place.

## What is an HQ?

An HQ is a directory structure that contains:

- **Configuration** - Settings for your workspace
- **Database** - SQLite database tracking tickets, agents, and work
- **Repositories** - Your code repositories (cloned or linked)
- **Agents** - Workspaces for AI coding assistants
- **PMO** - Project Management Org with tickets and specs

## Directory Structure

```
my-project-hq/
├── .proletariat/
│   ├── config.json      # Workspace configuration
│   └── workspace.db     # SQLite database
├── repos/
│   ├── frontend/        # Cloned repositories
│   └── backend/
└── agents/
    ├── staff/           # Named (permanent) agents
    │   ├── alice/       # Agent worktree
    │   └── bob/
    └── temp/            # Ephemeral agents
```

## Creating an HQ

Initialize a new HQ with:

```bash
prlt init
```

The `init` command:
1. Creates the `.proletariat/` directory
2. Initializes the SQLite database
3. Sets up default project and workflow statuses

## Configuration

The configuration file (`.proletariat/config.json`) contains:

```json
{
  "version": "1.0.0",
  "schemaVersion": 1,
  "type": "hq",
  "name": "my-project"
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DEVCONTAINER` | Automatically "true" when running inside a devcontainer |

## Working with Repositories

### Adding Repositories

```bash
# Clone from URL
prlt repo add https://github.com/org/repo.git

# Add existing local repo
prlt repo add /path/to/repo
```

### Listing Repositories

```bash
prlt repo list
```

### Removing Repositories

```bash
prlt repo remove <repo-name>
```

## Database

The `workspace.db` SQLite database stores:

- **Projects** - Organizational containers for tickets
- **Tickets** - Work items with status, priority, assignments
- **Agents** - Registered AI assistants
- **Work executions** - History of agent work sessions
- **Specs** - Detailed specifications linked to tickets
- **Epics** - Groups of related tickets

You can inspect the database directly:

```bash
sqlite3 .proletariat/workspace.db ".tables"
```

## Multiple Workspaces

You can have multiple HQs for different projects or teams. Proletariat discovers workspaces by walking up the directory tree looking for `.proletariat/`.

List discovered workspaces:

```bash
prlt workspace list
```

## Best Practices

### One HQ per Workstream

An HQ represents a workstream—keep related repositories together. This allows:
- Shared ticket tracking across repos
- Agents that can work across multiple repos
- Unified project management view

### Don't Commit .proletariat

The `.proletariat/` directory contains local state (database, config) and should typically be in `.gitignore`.

### Agent Names

Agent names are auto-generated from your selected theme (e.g., `swift-lynch-1`, `steady-knight-1`). Choose a theme that fits your style:

```bash
prlt agent themes list
prlt agent themes set <theme-name>
```

## Related Concepts

- [PMO (Project Management Org)](./pmo.md) - Managing tickets and specs
- [Agents](./agents.md) - AI coding assistants
- [Work](./work.md) - Spawning and executing agent work
