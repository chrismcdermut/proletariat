# Agents and Sessions

Agents are AI coding assistants that work on your tickets. Each agent session operates in isolation with its own git branch, preventing conflicts when multiple agents work simultaneously.

## How Agents Work

When you spawn work on a ticket:

1. An **ephemeral agent** is created on-demand
2. A new **git branch** is created for the work
3. An isolated **session** starts (Docker, tmux, terminal, or host)
4. The agent reads the ticket and begins coding
5. When complete, the agent commits and creates a PR
6. The session ends

```bash
prlt work start TKT-001
```

## Sessions

Sessions are running agent instances. They're like threads - you can:

- **Attach**: Connect to watch or interact
- **Detach**: Disconnect without stopping the agent
- **Close window**: Session keeps running in background
- **Kill**: Stop the agent

### Execution Options

**Environment** - where the agent runs:

| Environment | Flag | Best For |
|-------------|------|----------|
| Docker | (default if devcontainer exists) | Safety—fully isolated container |
| Host | `--run-on-host` | Speed—no container overhead |

**Display** - how you see it:

| Display | Flag | Best For |
|---------|------|----------|
| Terminal | `--display terminal` | Watch in new terminal tab |
| Background | `--display background` | Detached, reattach later |

**Permissions** - agent access level:

| Mode | Flag | Description |
|------|------|-------------|
| Safe | (default) | Agent prompts for permissions |
| YOLO | `--skip-permissions` | No prompts, full access. Use with Docker for safe autonomy. |

All sessions run in tmux under the hood—close the window, agent keeps working.

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

### Managing Sessions

```bash
# List active sessions
prlt execution list

# View session logs
prlt execution logs

# Stop a session
prlt execution stop <execution-id>
```

### Tmux Sessions

With tmux mode, use standard tmux commands:

```bash
# List sessions
tmux list-sessions

# Attach to session
tmux attach -t <session-name>

# Detach (inside tmux)
Ctrl+b d
```

## Git Worktrees

Each agent works in a separate git worktree - a linked working directory with its own branch:

```
agents/
└── temp/
    └── agent-abc123/      # Ephemeral agent worktree
        └── my-repo/       # Working copy on agent's branch
```

### Branch Naming

Agent branches follow a convention:

```
{ticket-id}/{type}/{human}/{agent}/{slug}
```

Examples:
- `TKT-001/feat/chrismcdermut/swift-lynch-1/add-user-auth`
- `TKT-042/fix/chrismcdermut/steady-knight-1/login-bug`
- `TKT-100/docs/chrismcdermut/rapid-omidyar-1/api-docs`

## Execution Provider

Currently supports **Claude Code** (Anthropic's coding agent). Additional providers coming soon.

Agents authenticate via `claude login`—no API keys needed.

## Spawning Multiple Agents

Work on multiple tickets in parallel:

```bash
# Spawn all planned tickets
prlt work spawn --all --column Planned

# Spawn specific tickets
prlt work spawn TKT-001 TKT-002 TKT-003

# Preview without executing
prlt work spawn --all --dry-run

# Limit concurrent spawns
prlt work spawn --all --limit 3
```

### Agent Selection Strategies

For batch operations:

```bash
# Round-robin (default)
prlt work spawn --all --strategy round-robin

# Least busy
prlt work spawn --all --strategy least-busy

# Random
prlt work spawn --all --strategy random
```

## Container-Based Execution

Docker mode provides complete isolation:

```bash
prlt work start TKT-001 --mode docker
```

Benefits:
- Can't affect your host system
- Consistent environment
- Easy cleanup
- Safe for untrusted code

See [Docker Setup](../workflows/docker-setup.md) for configuration details.

## Monitoring Agents

```bash
# Board view
prlt board
prlt board watch

# Active executions
prlt execution list

# Logs
prlt execution logs
```

## Best Practices

### Use Appropriate Isolation

- **docker** or **devcontainer** for safety
- **tmux** for managing multiple agents
- **host** only when you trust the code

### Monitor Active Sessions

```bash
prlt execution list
```

Don't spawn too many agents at once - monitor resource usage.

### Clean Up

Ephemeral agents persist after completion for debugging and review. Clean them up manually:

```bash
prlt agent temp cleanup
```

## Related Concepts

- [Work Execution](./work.md) - Spawning details
- [Docker Setup](../workflows/docker-setup.md) - Container configuration
- [Multi-Agent Workflows](../workflows/multi-agent.md) - Parallel development
