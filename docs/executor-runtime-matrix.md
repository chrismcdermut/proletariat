# Executor & Runtime Support Matrix

This document describes the supported combinations of executors, runtime environments, display modes, and session managers, along with setup requirements for each.

## Executors

An **executor** is the AI coding tool that the agent uses to work on a ticket.

| Executor | CLI Flag | Command | Status |
|----------|----------|---------|--------|
| Claude Code | `--executor claude-code` | `claude` | Primary, fully supported |
| Codex | `--executor codex` | `codex --prompt <prompt>` | Supported |
| Aider | `--executor aider` | `aider --message <prompt>` | Supported |
| Custom | `--executor custom` | User-configured | Placeholder |

### Default

The default executor is `claude-code`. Change it per-workspace:

```bash
prlt config set execution.default_executor codex
```

Or override per-invocation:

```bash
prlt work start TKT-001 --executor codex
```

## Runtime Environments

A **runtime environment** controls where the agent process runs.

| Environment | CLI Flag | Isolation | Best For |
|-------------|----------|-----------|----------|
| Devcontainer | `--mode devcontainer` (default when `.devcontainer/` exists) | Full (Docker) | Production work, safety |
| Host | `--run-on-host` | None | Speed, debugging |
| Docker | `--mode docker` | Full (Docker) | Raw container execution |
| VM | `--mode vm` | Full (SSH) | Remote execution |

### Default

If the agent directory contains a `.devcontainer/` folder, `devcontainer` is used automatically. Otherwise, `host` is the default.

## Display Modes

A **display mode** controls how the agent's output is presented.

| Display Mode | CLI Flag | Behavior |
|--------------|----------|----------|
| Terminal | `--display terminal` (default) | Opens a new terminal tab attached to the tmux session |
| Background | `--display background` | Runs detached; reattach with `prlt session attach` |
| Foreground | `--display foreground` | Attaches tmux in current terminal (blocking) |

## Session Managers

A **session manager** controls how the agent process is supervised inside the runtime.

| Session Manager | CLI Flag | Behavior |
|-----------------|----------|----------|
| tmux | `--session tmux` (default) | Runs inside tmux for session persistence; can detach/reattach |
| direct | `--session direct` | Runs process directly; no session management |

## Supported Combinations

### Executor x Environment

All executors work in all environments:

| | Devcontainer | Host | Docker | VM |
|------|:---:|:---:|:---:|:---:|
| Claude Code | Yes | Yes | Yes | Yes |
| Codex | Yes | Yes | Yes | Yes |
| Aider | Yes | Yes | Yes | Yes |
| Custom | Yes | Yes | Yes | Yes |

### Environment x Display Mode

| | Terminal | Background | Foreground |
|------|:---:|:---:|:---:|
| Devcontainer | Yes | Yes | Yes |
| Host | Yes | Yes | Yes |
| Docker | Yes (logs) | Yes | - |
| VM | - | Yes | - |

### Environment x Session Manager

| | tmux | direct |
|------|:---:|:---:|
| Devcontainer | Yes (default) | Yes |
| Host | Yes (default) | - |
| Docker | - | Yes |
| VM | - | Yes |

## Permission Modes

| Mode | CLI Flag | Description |
|------|----------|-------------|
| Safe | (default) | Agent asks before risky operations |
| Danger | `--skip-permissions` | Skip permission checks. Use inside Docker for safe autonomy. |

```bash
# Safe (default)
prlt work start TKT-001

# Danger mode (safe when sandboxed in Docker)
prlt work start TKT-001 --skip-permissions
```

## Output Modes

| Mode | Behavior |
|------|----------|
| Interactive | Streaming UI with real-time tool calls (default) |
| Print | Final result only (`-p` flag); better for logs and automation |

## Setup Requirements

### Claude Code (Primary Executor)

1. **Install Claude Code**: `npm install -g @anthropic-ai/claude-code`
2. **Authenticate**: Run `claude` once to complete OAuth or set `ANTHROPIC_API_KEY`
3. **Docker (for devcontainer)**: Docker Desktop running

### Codex

1. **Install Codex**: Follow [OpenAI Codex](https://github.com/openai/codex) setup instructions
2. **Authenticate**: Set `OPENAI_API_KEY` environment variable
3. **Docker (for devcontainer)**: Docker Desktop running

### Aider

1. **Install Aider**: `pip install aider-chat`
2. **Authenticate**: Set appropriate API key (e.g. `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
3. **Docker (for devcontainer)**: Docker Desktop running

### Devcontainer Environment

1. **Docker Desktop** installed and running
2. **Agent setup**: Run `prlt agent add <name>` to generate `.devcontainer/` config
3. **Auth in container**: Run `prlt agent auth` to set up credentials in Docker volume

### Host Environment

1. **Executor CLI** installed globally (e.g., `claude`, `codex`, or `aider`)
2. **tmux** installed for session persistence
3. **gh CLI** authenticated for git push operations

### VM Environment

1. **SSH access** to the target host
2. **Executor CLI** installed on the VM
3. **rsync** or **git** for code synchronization

## Examples

```bash
# Claude Code in devcontainer (recommended for production)
prlt work start TKT-001 --executor claude-code

# Codex on host (fast iteration)
prlt work start TKT-001 --executor codex --run-on-host

# Aider in background mode
prlt work start TKT-001 --executor aider --display background

# Batch spawn with Codex
prlt work spawn --all --executor codex --skip-permissions

# Revise PR feedback with specific executor
prlt work revise TKT-001 --executor codex
```

## Related Docs

- [Work Spawning](concepts/work.md) - Work lifecycle and commands
- [Docker Setup](workflows/docker-setup.md) - Container configuration
- [Multi-Agent](workflows/multi-agent.md) - Running multiple agents
- [Agents](concepts/agents.md) - Agent model and lifecycle
