---
sidebar_position: 1
title: Installation
---

# Installation

## Requirements

Before installing prlt, make sure you have these prerequisites:

| Requirement | Purpose |
|------------|---------|
| **Node.js 18+** | Runtime environment |
| **Git** | Version control |
| **Claude Code** | AI coding agent (`claude login` to authenticate) |
| **SQLite** | Local database |
| **Tmux** | Session persistence |
| **Docker** | Optional - for isolated container execution |

## Install from NPM

```bash
npm install -g @proletariat/cli
```

Or with other package managers:

```bash
# pnpm
pnpm add -g @proletariat/cli

# yarn
yarn global add @proletariat/cli
```

## Verify Installation

```bash
prlt --version
```

## Claude Code Authentication

prlt uses Claude Code as the AI agent. Authenticate before using:

```bash
claude login
```

This opens a browser for Anthropic authentication. Once complete, Claude Code is ready to use.

## GitHub CLI (Optional)

For PR creation and GitHub operations:

```bash
# Install gh CLI
brew install gh  # macOS
# or see https://github.com/cli/cli#installation

# Authenticate
gh auth login
```

Or set `GITHUB_TOKEN` environment variable:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

## Shell Autocomplete

Set up shell autocompletion for faster command entry:

```bash
prlt autocomplete setup
```

Follow the instructions to add the completion script to your shell config.

## Next Steps

Once installed, proceed to [Quick Start](/getting-started/quick-start) to initialize your first workspace.
