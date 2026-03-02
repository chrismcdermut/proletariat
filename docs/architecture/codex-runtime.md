# Codex Runtime Adapter

How proletariat maps its execution settings to Codex CLI invocations.

## Two Dimensions

The adapter resolves two dimensions to decide how to invoke Codex:

### 1. Permission Mode

| proletariat setting | Codex flag | Meaning |
|---------------------|------------|---------|
| `sandboxed: false` (danger) | `--yolo` | Codex runs commands autonomously — no approval prompts |
| `sandboxed: true` (safe) | *(none)* | Codex prompts the user before running each command |

### 2. Execution Context

The execution context is derived from how the agent is displayed and whether output is interactive:

| Display Mode | Output Mode | Codex Context | TTY Available? |
|-------------|------------|---------------|----------------|
| terminal | interactive | **interactive** | Yes |
| foreground | interactive | **interactive** | Yes |
| background | any | **background** | No |
| terminal | print | **non-tty** | No |
| foreground | print | **non-tty** | No |

## Supported Combinations

| Permission | Context | Supported | Codex Invocation |
|-----------|---------|-----------|-----------------|
| danger | interactive | Yes | `codex --yolo --prompt "..."` |
| danger | background | Yes | `codex --yolo --prompt "..."` |
| danger | non-tty | Yes | `codex --yolo --prompt "..."` |
| safe | interactive | Yes | `codex --prompt "..."` |
| safe | background | **No** | Error: needs TTY for approval prompts |
| safe | non-tty | **No** | Error: needs TTY for approval prompts |

**Why safe mode requires interactive:** Codex in safe mode prompts the user for
approval before executing each command. Without a TTY, there's no way for the user
to respond, so the process would hang or fail silently.

## Error Handling

When an unsupported combination is requested, the adapter throws a `CodexModeError`
with an actionable message suggesting alternatives:

- Use danger mode (`--yolo`) for background/non-interactive execution
- Run in a terminal where the user can interact with Codex

## Per-Runner Behavior

Each runner validates the Codex mode before execution:

| Runner | Default Context | Notes |
|--------|----------------|-------|
| **Host** | Derived from displayMode + outputMode | Terminal tab = interactive; background tmux = background |
| **Devcontainer** | Derived from displayMode + outputMode | Same as host, but inside Docker container |
| **Docker** | Always non-tty | Runs detached (`docker run -d`), no TTY |
| **VM** | Always non-tty | Runs via SSH + nohup, no TTY |

## Source

- Adapter: `apps/cli/src/lib/execution/codex-adapter.ts`
- Tests: `apps/cli/test/unit/codex-adapter.test.ts`
