# Work Spawning and Execution

Work in Proletariat refers to an agent session where an AI coding assistant works on a ticket. This document explains how to spawn, monitor, and manage agent work.

## Starting Work

### Single Ticket

Start work on a specific ticket:

```bash
# Interactive (prompts for options)
prlt work start

# With ticket ID
prlt work start TKT-001

# With all options
prlt work start TKT-001 \
  --agent alice \
  --mode docker \
  --action implement
```

### Batch Operations

Spawn work on multiple tickets:

```bash
# Spawn all tickets in a column
prlt work spawn --all --column Backlog

# Spawn specific tickets
prlt work spawn TKT-001 TKT-002 TKT-003

# Multi-select interactively
prlt work spawn --many

# Dry run (preview without executing)
prlt work spawn --all --dry-run
```

## Execution Options

All sessions run in tmux—close the window, agent keeps working.

### Environment

Where the agent runs:

| Environment | Flag | Best For |
|-------------|------|----------|
| Docker | (default if devcontainer exists) | Safety—fully isolated container |
| Host | `--run-on-host` | Speed—no container overhead |

### Permissions

Agent access level:

| Mode | Flag | Description |
|------|------|-------------|
| Safe | (default) | Agent prompts for permissions |
| YOLO | `--skip-permissions` | No prompts, full access. Use with Docker for safe autonomy. |

### Display

How you see it:

| Display | Flag | Best For |
|---------|------|----------|
| Terminal | `--display terminal` | Watch in new terminal tab |
| Background | `--display background` | Detached, reattach later |

### Examples

```bash
# Default: Docker + terminal (if devcontainer exists)
prlt work start TKT-001

# Docker + background
prlt work start TKT-001 --display background

# Host + background (fast, no container)
prlt work start TKT-001 --run-on-host --display background

# Docker + YOLO (full autonomy, safely sandboxed)
prlt work start TKT-001 --skip-permissions
```

## Actions

Specify what the agent should do:

| Action | Description |
|--------|-------------|
| `implement` | Write code to implement the ticket |
| `groom` | Refine ticket with requirements and acceptance criteria |
| `review` | Review code changes and provide feedback |
| `test` | Write or run tests |
| `refactor` | Improve existing code |
| `custom` | Custom action with provided prompt |

```bash
# Implement the ticket
prlt work start TKT-001 --action implement

# Groom the ticket
prlt work start TKT-001 --action groom

# Custom prompt
prlt work start TKT-001 --prompt "Review the code for security issues"
```

## Monitoring Work

### List Active Work

```bash
prlt work list
```

Shows running agent sessions with:
- Ticket ID
- Agent name
- Status
- Duration

### View Logs

```bash
# View logs for a ticket's work
prlt execution logs

# Follow logs in real-time
prlt execution logs --follow
```

### Check Execution Status

```bash
prlt execution list
```

## Work Lifecycle

```
prlt work start TKT-001
        │
        ▼
┌───────────────────┐
│  Agent Starting   │  Create worktree, checkout branch
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Agent Working    │  AI reads ticket, writes code
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Creating PR      │  Commits, pushes, creates PR
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Work Complete    │  Agent session ends
└───────────────────┘
```

### Status Transitions

When work starts:
1. Ticket moves to "In Progress"
2. Agent is assigned to ticket
3. Branch is created
4. Container starts (if Docker mode)

When work completes:
1. Changes are committed
2. PR is created (if `--create-pr`)
3. Ticket moves to "In Review"
4. Container stops

## Stopping Work

```bash
# Stop work on a specific execution
prlt execution stop <execution-id>

# Kill all work for a ticket
prlt work stop TKT-001
```

## Pull Requests

Control PR creation:

```bash
# Create PR when work is done
prlt work start TKT-001 --create-pr

# Don't create PR (just commit)
prlt work start TKT-001 --no-pr
```

### Checking PR Status

```bash
# View PR status
prlt pr status TKT-001

# Link existing PR to ticket
prlt pr link TKT-001 https://github.com/org/repo/pull/123
```

## Advanced Options

### Skip Confirmation

```bash
prlt work start TKT-001 --yes
```

### Skip Permission Prompts

For automated/CI use (dangerous):

```bash
prlt work spawn --all --skip-permissions
```

### Force Start

Start even if work is already in progress:

```bash
prlt work start TKT-001 --force
```

### Agent Selection Strategy

For batch operations, choose how agents are assigned:

```bash
# Round-robin (default)
prlt work spawn --all --strategy round-robin

# Least busy
prlt work spawn --all --strategy least-busy

# Random
prlt work spawn --all --strategy random
```

### Limit Batch Size

```bash
prlt work spawn --all --limit 5
```

## Session Management

Inside containers, agents run in tmux sessions by default:

```bash
# Attach to agent's tmux session
prlt docker shell alice
# Then: tmux attach

# Run without tmux (direct)
prlt work start TKT-001 --session direct
```

## JSON Output

For scripting and AI agents:

```bash
prlt work start --json
```

Returns structured JSON with prompt configuration.

## Best Practices

### Use Docker for Production Work

```bash
prlt work start TKT-001 --mode docker
```

Isolation prevents accidental changes to your host system.

### Preview Before Batch Operations

```bash
prlt work spawn --all --dry-run
```

### Monitor Long-Running Work

```bash
prlt board watch  # Watch board changes
prlt execution logs --follow  # Follow logs
```

### Clean Up After Batch Operations

```bash
prlt agent temp cleanup  # Remove ephemeral agents
prlt docker prune  # Remove unused containers
```

## Related Concepts

- [Agents](./agents.md) - AI coding assistants
- [PMO](./pmo.md) - Tickets and workflow
- [Docker Setup](../workflows/docker-setup.md) - Container configuration
- [Multi-Agent Workflows](../workflows/multi-agent.md) - Running multiple agents
