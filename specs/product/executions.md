---
title: Executions
domain: executions
---

# Executions

## Overview

Execution tracking for agent work sessions. An execution represents an agent working on a ticket - tracking the process, environment, logs, and lifecycle from start to completion.

## Abilities

| Ability | Storage | CLI |
|---------|---------|-----|
| List executions | `listExecutions()` | `prlt executions list` |
| View logs | - | `prlt execution logs` |
| Stop execution | `updateStatus()` | `prlt execution stop` |

## Data Model

### Execution

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | | Execution ID (e.g., WORK-001) |
| ticket_id | ref | ✓ | | Associated ticket |
| agent_name | string | ✓ | | Agent performing work |
| executor | enum | | claude-code | Execution engine |
| mode | enum | | devcontainer | Runtime mode |
| environment | enum | | devcontainer | host, devcontainer |
| display_mode | enum | | terminal | terminal, tmux, background, foreground |
| sandboxed | boolean | | true | Running with permission restrictions |
| branch | string | | | Git branch for this work |
| status | enum | auto | starting | starting, running, completed, failed, stopped |
| pid | number | | | Process ID |
| container_id | string | | | Docker container ID |
| session_id | string | | | tmux session ID |
| log_path | string | | | Path to log file |
| started_at | timestamp | auto | now | Start time |
| completed_at | timestamp | | | End time |

### Execution Statuses

| Status | Description |
|--------|-------------|
| starting | Execution initializing |
| running | Agent actively working |
| completed | Work finished successfully |
| failed | Execution errored |
| stopped | Manually stopped |

### Runtime Modes

| Mode | Description |
|------|-------------|
| devcontainer | Run in Docker devcontainer (sandboxed) |
| terminal | Run directly on host in new terminal |
| tmux | Run in tmux pane |
| background | Run detached with log output |
| foreground | Run in current terminal |

## CLI Commands

### List Executions

```bash
# List all executions
prlt executions list

# Filter by status
prlt executions list --status running

# Filter by agent
prlt executions list --agent damodei

# Output formats
prlt executions list --format table|compact|json
```

### View Logs

```bash
# View logs (interactive)
prlt execution logs

# View specific execution
prlt execution logs WORK-001

# Stream logs in real-time
prlt execution logs WORK-001 --follow

# Show last N lines
prlt execution logs WORK-001 --tail 50
```

### Stop Execution

```bash
# Stop execution (interactive)
prlt execution stop

# Stop specific execution
prlt execution stop WORK-001

# Force kill (SIGKILL)
prlt execution stop WORK-001 --force
```

## Business Rules

- **One execution per agent**: An agent can only run one execution at a time
- **Log persistence**: Logs saved to `.proletariat/logs/{execution-id}.log`
- **Container cleanup**: Stopped executions should cleanup containers
- **Status tracking**: Status updates stored in workspace.db

## Related Domains

- [Work](work.md) - Work start creates executions
- [Agents](agents.md) - Executions run on agents
- [Tickets](tickets.md) - Executions are for tickets
