---
name: proletariat
description: AI agent orchestration CLI — spawn, monitor, and manage coding agents in isolated git worktrees
version: 0.3.105
requires:
  bins:
    - prlt
tags:
  - orchestration
  - agents
  - devops
  - git
  - docker
---

# Proletariat (`prlt`)

Proletariat is an AI agent orchestration CLI. Use it to spawn, monitor, and manage coding agents that work on tickets in isolated git worktrees or Docker containers.

## Core Commands

### Work — Agent Lifecycle

| Command | Description |
|---------|-------------|
| `prlt work start <ticket>` | Spawn an agent on a ticket |
| `prlt work ship <ticket>` | Merge PR and close ticket |
| `prlt work propose <ticket>` | Create PR and move ticket to Review |
| `prlt work complete <ticket>` | Mark ticket as complete |
| `prlt work stop <ticket>` | Stop a running agent |
| `prlt work status <ticket>` | Check agent status for a ticket |

### Session — Monitor Agents

| Command | Description |
|---------|-------------|
| `prlt session list` | List all active agent sessions |
| `prlt session peek <agent>` | View agent output (read-only) |
| `prlt session poke <agent> "<message>"` | Send a message to a running agent |
| `prlt session attach <agent>` | Attach to an agent session interactively |
| `prlt session health` | Check health of all sessions |

### Ticket — Manage Board

| Command | Description |
|---------|-------------|
| `prlt ticket list` | List tickets on the board |
| `prlt ticket create` | Create a new ticket |
| `prlt ticket show <id>` | View full ticket details |
| `prlt ticket move <id> <status>` | Move ticket to a new status |
| `prlt ticket edit <id> [flags]` | Update ticket fields |

### PR — Pull Request Operations

| Command | Description |
|---------|-------------|
| `prlt pr checks` | Check CI status of current PR |
| `prlt pr create` | Create a PR with ticket context |
| `prlt pr status` | View PR status |

## Common Workflows

### Start work on a ticket

```bash
prlt work start PRLT-123 --skip-permissions --create-pr --yes
```

This spawns an agent in an isolated environment, checks out a new branch, and begins implementation. The `--create-pr` flag auto-creates a draft PR when the agent pushes its first commit.

### Check agent progress

```bash
prlt session peek <agent-name>
```

View the agent's recent output without interrupting it. Use `prlt session list` first to find the agent name.

### Send instructions to a running agent

```bash
prlt session poke <agent-name> "focus on the unit tests next"
```

### Ship when CI passes

```bash
prlt work ship <ticket> --when-green
```

Waits for CI checks to pass, then merges the PR and moves the ticket to Done.

### Monitor all agents

```bash
prlt session list
prlt session health
```

### Create and assign a ticket

```bash
prlt ticket create --title "Fix login bug" --priority P1
prlt ticket move TKT-456 "In Progress"
```

## Tips

- Use `prlt work start` instead of manually cloning and branching — it handles worktree isolation automatically.
- Agents run in Docker containers by default for full isolation.
- Use `prlt work propose <ticket>` instead of `gh pr create` — it keeps ticket state in sync.
- Use `prlt commit "message"` instead of `git commit` — it prefixes the ticket ID automatically.
