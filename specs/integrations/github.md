---
title: GitHub Integration
domain: github
---

# GitHub Integration

## Overview

GitHub CLI (`gh`) integration for authentication and token management. Enables PR creation and GitHub API access from both host and devcontainer environments.

## Abilities

| Ability | Storage | CLI |
|---------|---------|-----|
| Login to GitHub | - | `prlt gh login` |
| Check status | - | `prlt gh status` |
| Setup token | - | `prlt gh token` |

## CLI Commands

### Login

```bash
# Interactive GitHub login
prlt gh login
```

Wraps `gh auth login` with pre/post checks and guidance.

### Status

```bash
# Check GitHub CLI status
prlt gh status
```

Displays:
- gh CLI installation status
- Authentication status and username
- GH_TOKEN availability for devcontainers
- Token workflow scope status (required for CI file changes)

### Token Setup

```bash
# Show token setup instructions
prlt gh token
```

Provides shell-specific instructions for setting `GH_TOKEN` environment variable for devcontainer use.

## Authentication Flow

```
1. Install gh CLI:     brew install gh
2. Authenticate:       prlt gh login
3. Setup token:        prlt gh token  (follow instructions)
4. Verify:             prlt gh status
```

## Environment Variables

| Variable | Purpose | Required For |
|----------|---------|--------------|
| GH_TOKEN | GitHub personal access token | Devcontainer PR creation |
| GITHUB_TOKEN | Alternative token name | Some integrations |

## Token Scopes

The GitHub token must have the **`workflow`** scope for agents to push changes to `.github/workflows/` files. Without this scope, agents will fail when tickets require CI/CD changes.

### Required Scopes

| Scope | Purpose |
|-------|---------|
| `repo` | Push code, create PRs |
| `workflow` | Push changes to `.github/workflows/` files |

### Checking Scopes

```bash
# Check current token scopes
gh auth status

# If workflow scope is missing, add it
gh auth refresh -h github.com -s workflow
```

### How It Works

When spawning a Docker agent, `prlt` automatically:
1. Checks if the token has the `workflow` scope
2. Attempts `gh auth refresh -s workflow` if the scope is missing
3. Warns if the scope cannot be added (e.g., non-interactive environment)

New logins via `prlt gh login` automatically request the `workflow` scope.

## Token Setup by Shell

### Zsh (~/.zshrc)
```bash
export GH_TOKEN=$(gh auth token)
```

### Bash (~/.bashrc)
```bash
export GH_TOKEN=$(gh auth token)
```

## Business Rules

- **gh CLI required**: All GitHub operations require gh CLI installed
- **Host auth sufficient**: `gh auth login` works for host operations
- **Token for containers**: `GH_TOKEN` must be exported for devcontainer access
- **Token refresh**: Token is dynamically fetched from gh CLI, stays current
- **Workflow scope required**: Token must have `workflow` scope for CI file changes (PRLT-1095)

## Related Domains

- [Pull Requests](pull-requests.md) - PR creation uses GitHub auth
- [Agents](agents.md) - Agents in devcontainers need GH_TOKEN
