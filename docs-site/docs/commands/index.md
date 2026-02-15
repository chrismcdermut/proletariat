---
sidebar_position: 1
title: Command Reference
slug: /commands
---

# Command Reference

Complete reference for all prlt commands.

## Global Options

All commands support these options:

| Flag | Description |
|------|-------------|
| `--help` | Show command help |
| `--version` | Show CLI version |
| `--json` | Output in JSON format (for AI agents) |

## Command Categories

### Core Commands

| Command | Description |
|---------|-------------|
| [`prlt init`](/commands/other/init) | Initialize a new workspace |
| [`prlt whoami`](/commands/other/whoami) | Show current context |
| [`prlt commit`](/commands/other/commit) | Create conventional commit |
| [`prlt claude`](/commands/other/claude) | Quick ad-hoc Claude session |

### Ticket Management

| Command | Description |
|---------|-------------|
| [`prlt ticket create`](/commands/ticket/create) | Create a new ticket |
| [`prlt ticket list`](/commands/ticket/list) | List all tickets |
| [`prlt ticket view`](/commands/ticket/view) | View ticket details |
| [`prlt ticket edit`](/commands/ticket/edit) | Edit a ticket |
| [`prlt ticket move`](/commands/ticket/move) | Change ticket status |
| [`prlt ticket delete`](/commands/ticket/delete) | Delete a ticket |
| [`prlt ticket complete`](/commands/ticket/complete) | Mark ticket complete |
| [`prlt ticket bulk`](/commands/ticket/bulk) | Bulk ticket operations |

### Work & Execution

| Command | Description |
|---------|-------------|
| [`prlt work start`](/commands/work/start) | Start agent on ticket |
| [`prlt work spawn`](/commands/work/spawn) | Batch spawn agents |
| [`prlt work spawn-all`](/commands/work/spawn-all) | Spawn all planned tickets |
| [`prlt work complete`](/commands/work/complete) | Mark work done |
| [`prlt work ready`](/commands/work/ready) | Mark ready for review |
| [`prlt work revise`](/commands/work/revise) | Request revision |
| [`prlt work watch`](/commands/work/watch) | Watch work progress |

### Agent Management

| Command | Description |
|---------|-------------|
| [`prlt agent list`](/commands/agent/list) | List all agents |
| [`prlt agent status`](/commands/agent/status) | Check agent status |
| [`prlt agent shell`](/commands/agent/shell) | Shell into workspace |
| [`prlt agent visit`](/commands/agent/visit) | Navigate to workspace |
| [`prlt agent login`](/commands/agent/login) | Auth Claude in container |
| [`prlt agent rebuild`](/commands/agent/rebuild) | Rebuild workspace |
| [`prlt agent restart`](/commands/agent/restart) | Restart agent |
| [`prlt agent cleanup`](/commands/agent/cleanup) | Remove old agents |

### Project & Epic

| Command | Description |
|---------|-------------|
| [`prlt project create`](/commands/project/create) | Create project |
| [`prlt project list`](/commands/project/list) | List projects |
| [`prlt project view`](/commands/project/view) | View project |
| [`prlt epic create`](/commands/epic/create) | Create epic |
| [`prlt epic list`](/commands/epic/list) | List epics |
| [`prlt epic view`](/commands/epic/view) | View epic |
| [`prlt epic ticket`](/commands/epic/ticket) | Manage epic tickets |

### Execution Monitoring

| Command | Description |
|---------|-------------|
| [`prlt execution list`](/commands/execution/list) | List running agents |
| [`prlt execution logs`](/commands/execution/logs) | View agent output |
| [`prlt execution stop`](/commands/execution/stop) | Stop an agent |
| [`prlt execution view`](/commands/execution/view) | View execution details |

### Docker Management

| Command | Description |
|---------|-------------|
| [`prlt docker list`](/commands/docker/list) | List containers |
| [`prlt docker status`](/commands/docker/status) | Check Docker status |
| [`prlt docker start`](/commands/docker/start) | Start container |
| [`prlt docker stop`](/commands/docker/stop) | Stop container |
| [`prlt docker shell`](/commands/docker/shell) | Shell into container |
| [`prlt docker logs`](/commands/docker/logs) | View container logs |
| [`prlt docker sync`](/commands/docker/sync) | Sync container files |
| [`prlt docker clean`](/commands/docker/clean) | Remove stopped containers |
| [`prlt docker prune`](/commands/docker/prune) | Remove unused resources |

### Other Commands

See [Other Commands](/commands/other/init) for:
- Board viewing
- Session management
- PR operations
- GitHub integration
- Workflow configuration
- Template management
- Action configuration
- Theme management
- Staff management

## JSON Mode

All commands support `--json` for machine-readable output:

```bash
prlt ticket list --json
```

Returns structured data for programmatic parsing.

## Interactive Mode

Run commands without flags for interactive prompts:

```bash
prlt ticket create
# Guided through all options
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |

## Getting Help

```bash
# General help
prlt --help

# Command-specific help
prlt ticket create --help
prlt work spawn --help
```
