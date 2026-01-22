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

### Session Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `docker` | Isolated container | Safety, consistency |
| `devcontainer` | VS Code integration | IDE workflow |
| `tmux` | Tmux session | Multiple agents, attach/detach |
| `terminal` | New terminal window | Single agent |
| `foreground` | Current terminal | Debugging |
| `host` | Direct on machine | Speed |

```bash
# Run in Docker (isolated)
prlt work start TKT-001 --mode docker

# Run in tmux (can attach/detach)
prlt work start TKT-001 --mode tmux

# Run directly on host
prlt work start TKT-001 --run-on-host
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
{type}/{ticket-id}-{slug}
```

Examples:
- `feat/TKT-001-add-user-auth`
- `fix/TKT-042-login-bug`
- `docs/TKT-100-api-docs`

## Execution Providers

Agents can use different AI providers:

| Provider | Description |
|----------|-------------|
| `claude-code` | Anthropic's Claude Code (default) |
| `codex` | OpenAI Codex |
| `aider` | Aider coding assistant |
| `custom` | Custom execution script |

```bash
prlt work start TKT-001 --executor claude-code
```

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

Ephemeral agents are cleaned up automatically, but you can force cleanup:

```bash
prlt agent temp cleanup
```

## Related Concepts

- [Work Execution](./work.md) - Spawning details
- [Docker Setup](../workflows/docker-setup.md) - Container configuration
- [Multi-Agent Workflows](../workflows/multi-agent.md) - Parallel development
