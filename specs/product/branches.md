---
title: Branches
domain: branches
---

# Branches

## Overview

Git branch management with conventional naming conventions. Branches follow a structured format: `{type}/{coder}/{description}` to enable consistent naming, filtering, and automation.

## Abilities

| Ability | Storage | CLI |
|---------|---------|-----|
| Create branch | - | `prlt branch create` |
| List branches | - | `prlt branch list` |
| Validate branch | - | `prlt branch validate` |

## Branch Naming Convention

Format: `{type}/{coder}/{description}` or `{type}/{description}`

### Branch Types

| Type | Purpose | Example |
|------|---------|---------|
| feat | New feature | `feat/chris/add-auth` |
| fix | Bug fix | `fix/login-error` |
| docs | Documentation | `docs/api-guide` |
| style | Code style | `style/formatting` |
| refactor | Code refactoring | `refactor/user-service` |
| test | Tests | `test/auth-unit` |
| chore | Maintenance | `chore/deps-update` |
| ci | CI/CD changes | `ci/github-actions` |
| perf | Performance | `perf/query-optimization` |
| build | Build system | `build/webpack-config` |

### Development vs Business Types

| Category | Types |
|----------|-------|
| Development | feat, fix, refactor, test, perf |
| Business | docs, style, chore, ci, build |

## Data Model

### Branch Info

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | ✓ | Full branch name |
| type | enum | | Extracted branch type |
| coder | string | | Coder/agent identifier |
| description | string | | Branch description |
| valid | boolean | | Follows convention |

## CLI Commands

### Create Branch

```bash
# Interactive wizard
prlt branch create

# Direct name
prlt branch create feat/chris/add-user-auth

# With flags
prlt branch create -t feat -c chris -d add-user-auth

# From origin/main
prlt branch create -t feat -d feature --from-origin

# With empty commit (seeds PR title)
prlt branch create -t feat -d feature --empty-commit

# Non-interactive (force)
prlt branch create feat/branch --force
```

### List Branches

```bash
# List local branches
prlt branch list

# Include remote branches
prlt branch list --all

# Filter by type
prlt branch list --type feat

# Output formats
prlt branch list --format table|compact|json
```

### Validate Branch

```bash
# Validate current branch
prlt branch validate

# Validate specific branch
prlt branch validate feat/chris/add-auth
```

## Business Rules

- **Kebab-case required**: Description must be lowercase with hyphens
- **Coder optional**: Can omit coder segment for solo work
- **Type required**: Must use valid branch type prefix
- **Main protected**: Cannot create branches named main/master
- **Force mode**: `--force` skips prompts, switches to existing branch

## Related Domains

- [Work](work.md) - Work execution creates branches for tickets
- [Agents](agents.md) - Agents use coder identifier in branch names
