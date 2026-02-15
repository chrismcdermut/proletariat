---
sidebar_position: 1
title: Environment Variables
---

# Environment Variables

Configuration options via environment variables.

## Required Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `GITHUB_TOKEN` | GitHub API operations | `ghp_xxxxxxxxxxxx` |

## Optional Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PRLT_HOME` | Override workspace location | Current directory |
| `PRLT_DEBUG` | Enable debug output | `false` |
| `PRLT_LOG_LEVEL` | Log verbosity | `info` |

## GitHub Authentication

### Option 1: Environment Variable

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

Add to your shell profile for persistence:

```bash
# ~/.bashrc or ~/.zshrc
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Option 2: GitHub CLI

```bash
gh auth login
```

The CLI will use `gh` for operations when available.

## Claude Code Authentication

Claude Code manages its own authentication:

```bash
claude login
```

Credentials stored in `~/.claude/`.

## Docker Container Variables

Pass variables to containers via devcontainer.json:

```json
{
  "containerEnv": {
    "GITHUB_TOKEN": "${localEnv:GITHUB_TOKEN}",
    "NODE_ENV": "development"
  }
}
```

## Debug Mode

Enable verbose logging:

```bash
PRLT_DEBUG=true prlt work spawn
```

Or for all commands:

```bash
export PRLT_DEBUG=true
```

## Custom Workspace Location

Override default workspace detection:

```bash
PRLT_HOME=/path/to/workspace prlt ticket list
```

## Shell Configuration

### Bash

```bash
# ~/.bashrc
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
export PRLT_DEBUG=false
```

### Zsh

```bash
# ~/.zshrc
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
export PRLT_DEBUG=false
```

### Fish

```fish
# ~/.config/fish/config.fish
set -x GITHUB_TOKEN ghp_xxxxxxxxxxxx
set -x PRLT_DEBUG false
```

## CI/CD Usage

In GitHub Actions:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @proletariat/cli
      - run: prlt ticket list --json
```

## Security Notes

- Never commit tokens to version control
- Use secrets managers in CI/CD
- Rotate tokens regularly
- Use minimal scope tokens

## Next Steps

- [Troubleshooting](/reference/troubleshooting) - Common issues
- [Installation](/getting-started/installation) - Setup guide
