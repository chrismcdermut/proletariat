---
title: Workspace
domain: workspace
---

# Workspace

## Overview

Workspace initialization and context management. A workspace (HQ) is the root directory containing agents, repositories, and project management. The `init` command creates the workspace structure, and `whoami` shows current context.

## Abilities

| Ability | Storage | CLI |
|---------|---------|-----|
| Initialize HQ | `initializeHQ()` | `prlt init` |
| Create workspace only | `createWorkspaceOnly()` | `prlt init` (workspace-only mode) |
| Show context | - | `prlt whoami` |

## Data Model

### Workspace Config

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | ✓ | | Workspace/HQ name |
| path | string | auto | | Absolute path to workspace root |
| theme | enum | | proletariat | Agent naming theme |
| type | enum | | full | full, workspace-only |
| created_at | timestamp | auto | now | Creation time |

### Workspace Structure

```
{hq-name}/
├── .proletariat/
│   └── workspace.db       # SQLite database
├── agents/
│   └── staff/             # Agent worktrees
├── repos/                 # Shared repositories
└── pmo/                   # Project management
    └── projects/
```

## Themes

| Theme | Description | Example Agents |
|-------|-------------|----------------|
| proletariat | Business leaders | buffett, bezos, musk |
| custom | User-defined names | agent-1, agent-2 |

## Business Rules

- **One workspace per directory**: Cannot init inside existing workspace
- **Agent isolation**: Each agent gets own worktree of repos
- **PMO optional**: Can create workspace without PMO setup
- **Theme affects agent names**: Selected theme determines available agent names

## Related Domains

- [Agents](agents.md) - Agents live within workspace
- [Projects](projects.md) - PMO projects managed in workspace
- [Settings](settings.md) - Workspace configuration
