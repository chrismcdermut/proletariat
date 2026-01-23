# Multi-Agent Workflows

This guide explains how to run multiple AI agents in parallel, maximizing throughput while avoiding conflicts.

## Overview

Proletariat enables parallel development by giving each agent:
- Its own git worktree (isolated working directory)
- Its own branch (no merge conflicts during work)
- Optional container isolation (no system conflicts)

## Setting Up Multiple Agents

### Add Staff Agents

```bash
# Add multiple named agents
prlt agent staff add alice bob charlie diana

# Or use a theme for memorable names
prlt agent themes set billionaires
prlt agent staff add  # Adds with themed names
```

### Verify Agent Setup

```bash
prlt agent staff list
```

## Spawning Parallel Work

### Batch Spawn by Column

Spawn all planned tickets to available agents:

```bash
# Preview first
prlt work spawn --all --column Planned --dry-run

# Execute
prlt work spawn --all --column Planned
```

### Spawn Specific Tickets

```bash
prlt work spawn TKT-001 TKT-002 TKT-003 TKT-004
```

### Multi-Select Interactive

```bash
prlt work spawn --many
# Select tickets from interactive list
```

## Agent Selection Strategies

Control how agents are assigned to tickets:

### Round-Robin (Default)

Distributes tickets evenly across agents:

```bash
prlt work spawn --all --strategy round-robin
```

Result with 4 agents, 8 tickets:
- Alice: TKT-001, TKT-005
- Bob: TKT-002, TKT-006
- Charlie: TKT-003, TKT-007
- Diana: TKT-004, TKT-008

### Least Busy

Assigns to agent with fewest active tasks:

```bash
prlt work spawn --all --strategy least-busy
```

### Random

Random assignment:

```bash
prlt work spawn --all --strategy random
```

## Execution Modes for Multi-Agent

### Tmux (Recommended for Parallel)

Run all agents in tmux sessions:

```bash
prlt work spawn --all --mode tmux
```

Benefits:
- All agents visible in one terminal
- Easy to switch between sessions
- Works over SSH

Access sessions:

```bash
tmux list-sessions
tmux attach -t <session-name>
```

### Docker

Run each agent in isolated container:

```bash
prlt work spawn --all --mode docker
```

Benefits:
- Complete isolation
- Consistent environments
- Safe execution

### Terminal Tabs

Open new terminal for each agent (macOS):

```bash
prlt work spawn --all --mode terminal
```

## Monitoring Multiple Agents

### Board View

Watch the board for real-time status:

```bash
prlt board watch
```

### Execution List

See all active executions:

```bash
prlt execution list
```

### Agent-Specific Logs

```bash
prlt docker logs alice
# or
prlt execution logs <execution-id>
```

## Limiting Parallel Work

### Set Maximum Agents

Limit concurrent spawns:

```bash
prlt work spawn --all --limit 3
```

### Per-Agent Work

Use single-ticket spawning for controlled rollout:

```bash
prlt work start TKT-001 --agent alice
prlt work start TKT-002 --agent bob
# Wait for review...
prlt work start TKT-003 --agent charlie
```

## Coordinating Agent Output

### PR Workflow

Each agent creates its own PR:

```bash
# Check all PRs
prlt pr status

# Or use GitHub CLI
gh pr list
```

### Branch Strategy

Branches are namespaced by agent:

```
feat/alice/TKT-001-user-auth
feat/bob/TKT-002-payment-api
feat/charlie/TKT-003-email-service
```

No branch conflicts even for related work.

## Example: Sprint Execution

### 1. Prepare Sprint Tickets

```bash
# Move tickets to Planned
prlt ticket move TKT-001 Planned
prlt ticket move TKT-002 Planned
prlt ticket move TKT-003 Planned
prlt ticket move TKT-004 Planned
```

### 2. Verify Board State

```bash
prlt board
```

### 3. Spawn All Planned Work

```bash
# Preview
prlt work spawn --all --column Planned --dry-run

# Execute with Docker isolation
prlt work spawn --all --column Planned --mode docker
```

### 4. Monitor Progress

```bash
# Watch board
prlt board watch

# Check executions
prlt execution list
```

### 5. Review PRs

```bash
# List PRs
gh pr list

# Review each
gh pr view 1
gh pr review 1 --approve
gh pr merge 1
```

## Handling Conflicts

### Dependent Tickets

If tickets have dependencies, spawn sequentially:

```bash
# First ticket
prlt work start TKT-001 --agent alice
# Wait for completion...

# Dependent ticket
prlt work start TKT-002 --agent bob
```

### Same File Modifications

If multiple tickets modify the same files:

1. **Best**: Refactor tickets to be independent
2. **Alternative**: Spawn sequentially
3. **Fallback**: Resolve merge conflicts manually

### Merge Conflict Resolution

If PRs have conflicts:

```bash
# Checkout agent's branch
git checkout feat/alice/TKT-001-feature

# Merge main
git merge main

# Resolve conflicts, commit, push
git push

# Continue with PR
gh pr merge
```

## Resource Management

### Docker Container Cleanup

```bash
# Remove stopped containers
prlt docker prune

# Clean specific containers
prlt docker clean
```

### Ephemeral Agent Cleanup

```bash
prlt agent temp cleanup
```

### Worktree Cleanup

```bash
# Remove unused worktrees
git worktree prune
```

## Best Practices

### Start Small

Begin with 2-3 agents, scale up as you learn the workflow.

### Independent Tickets

Design tickets to be independent when possible - different files, different modules.

### Consistent Execution Mode

Use the same mode for all agents in a batch:

```bash
# Good - all Docker
prlt work spawn --all --mode docker

# Avoid mixing modes in same batch
```

### Review Promptly

Don't let PRs pile up - review and merge regularly.

### Monitor Resources

Watch system resources when running many agents:

```bash
docker stats  # Container resources
htop          # System resources
```

## Troubleshooting

### Agent Not Starting

```bash
# Check agent status
prlt agent status alice

# Rebuild if needed
prlt agent rebuild alice
```

### Container Issues

```bash
# Restart container
prlt docker restart alice

# View container logs
prlt docker logs alice
```

### Branch Conflicts

```bash
# Check branch status
git branch -a | grep alice

# Clean up stale branches
git fetch --prune
```

## Related Guides

- [Docker Setup](./docker-setup.md) - Container configuration
- [Ticket Lifecycle](./ticket-lifecycle.md) - End-to-end workflow
- [Troubleshooting](../troubleshooting.md) - Common issues
