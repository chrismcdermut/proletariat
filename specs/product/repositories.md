---
title: Repositories
domain: repositories
---

# Repositories

## Overview

Repository management within a workspace. Repositories are cloned or moved into the HQ's `repos/` directory and made available to all agents via git worktrees.

## Abilities

| Ability | Storage | CLI |
|---------|---------|-----|
| Add repository | `addRepository()` | `prlt repo add` |
| Remove repository | `removeRepository()` | `prlt repo remove` |
| List repositories | `getWorkspaceRepoInfo()` | `prlt repos list` |
| View repository | - | `prlt repo view` |

## Data Model

### Repository Info

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | ✓ | Repository name |
| path | string | ✓ | Path within HQ repos/ |
| url | string | | Git remote URL |
| branch | string | | Current branch |
| status | enum | | clean, dirty, error |
| commitsAhead | number | | Commits ahead of remote |
| commitsBehind | number | | Commits behind remote |

### Repository Structure

```
{hq}/
├── repos/
│   ├── proletariat/          # Main repo (bare or worktree parent)
│   │   └── .git/
│   │       └── worktrees/    # Agent worktrees reference here
│   └── other-repo/
└── agents/
    └── staff/
        └── {agent}/
            └── proletariat-{agent}/  # Worktree of repos/proletariat
```

## CLI Commands

### Add Repository

```bash
# Interactive mode
prlt repo add

# From local path (clone)
prlt repo add /path/to/repo

# From local path (move)
prlt repo add /path/to/repo --action move

# From Git URL
prlt repo add git@github.com:user/repo.git
prlt repo add https://github.com/user/repo.git
```

### Remove Repository

```bash
# Interactive mode
prlt repo remove

# Specific repo
prlt repo remove repo-name
```

### List Repositories

```bash
# Table format (default)
prlt repos list

# Compact format
prlt repos list --format compact

# JSON format
prlt repos list --format json
```

### View Repository

```bash
# View repo details
prlt repo view repo-name
```

## Business Rules

- **Repos directory**: All repos live in `{hq}/repos/`
- **Clone vs move**: URLs always clone, local paths can clone or move
- **Worktree integration**: Repos are shared via git worktrees to agents
- **Status tracking**: Repos track dirty/clean state and commits ahead/behind

## Related Domains

- [Workspace](workspace.md) - Repos are part of workspace structure
- [Agents](agents.md) - Agents get worktrees of repos
