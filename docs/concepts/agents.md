# Agents

Agents are AI coding assistants that work on your tickets. Each agent operates in an isolated environment with its own git branch, preventing conflicts when multiple agents work simultaneously.

## Agent Types

### Staff Agents

Staff agents are named, persistent agents that you add to your team:

```bash
# Add staff agents
prlt agent staff add alice bob charlie

# List staff agents
prlt agent staff list

# Remove a staff agent
prlt agent staff remove alice
```

Staff agents:
- Have permanent names
- Can be assigned to multiple tickets over time
- Have dedicated worktree directories
- Persist between sessions

### Ephemeral Agents

Ephemeral agents are created on-demand for specific work:

```bash
# Spawn with ephemeral agent (auto-generated name)
prlt work start TKT-001 --ephemeral
```

Ephemeral agents:
- Auto-generated names (from theme or random)
- Created for a single work session
- Cleaned up after work completes
- Useful for parallel batch operations

## Git Worktrees

Each agent works in a separate git worktree - a linked working directory that shares the repository's git history but has its own branch and working tree.

```
agents/
├── staff/
│   ├── alice/          # Alice's worktree
│   │   └── my-repo/    # Working copy on alice's branch
│   └── bob/            # Bob's worktree
│       └── my-repo/    # Working copy on bob's branch
└── temp/
    └── agent-xyz/      # Ephemeral agent worktree
```

### Benefits of Worktrees

- **Isolation**: Each agent's changes don't affect others
- **Parallelism**: Multiple agents can work on different features simultaneously
- **Safety**: Experimental changes are contained
- **Easy cleanup**: Remove worktree to discard all changes

### Branch Naming

Agent branches follow a convention:

```
{type}/{agent-name}/{ticket-id}-{slug}
```

Examples:
- `feat/alice/TKT-001-add-user-auth`
- `fix/bob/TKT-042-login-bug`
- `docs/charlie/TKT-100-api-docs`

## Agent Themes

Themes provide fun, memorable agent names instead of generic identifiers:

```bash
# List available themes
prlt agent themes list

# Set a theme
prlt agent themes set billionaires

# Add agents (names from theme)
prlt agent staff add
# → Adds agents with names like "musk", "bezos", "gates"
```

### Built-in Themes

| Theme | Description |
|-------|-------------|
| `billionaires` | Tech billionaire names |
| `philosophers` | Famous philosophers |
| `scientists` | Notable scientists |
| `default` | Simple alphabetic names |

### Custom Themes

Create your own theme:

```bash
# Create a theme
prlt agent themes create mythical

# Add names to theme
prlt agent themes add-names mythical zeus apollo athena hermes
```

## Agent Management

### Listing Agents

```bash
# List all active agents
prlt agent list

# List staff agents
prlt agent staff list

# List ephemeral agents
prlt agent temp list
```

### Agent Status

```bash
# Check agent status
prlt agent status alice
```

Status shows:
- Current assignment (ticket)
- Worktree location
- Branch name
- Container status (if using Docker)

### Accessing Agent Workspace

```bash
# Open shell in agent's workspace
prlt agent shell alice

# Visit agent's workspace in terminal
prlt agent visit alice
```

### Rebuilding Agents

If an agent's worktree becomes corrupted:

```bash
# Rebuild agent's workspace
prlt agent rebuild alice
```

### Cleaning Up

```bash
# Remove ephemeral agents
prlt agent temp cleanup

# Remove specific staff agent
prlt agent staff remove alice
```

## Agent Execution Providers

Agents can use different AI providers for code generation:

| Provider | Description |
|----------|-------------|
| `claude-code` | Anthropic's Claude Code (default) |
| `codex` | OpenAI Codex |
| `aider` | Aider coding assistant |
| `custom` | Custom execution script |

Specify provider when starting work:

```bash
prlt work start TKT-001 --executor claude-code
```

## Container-Based Agents

When using Docker mode, each agent runs in an isolated container:

```bash
prlt work start TKT-001 --mode docker
```

Container benefits:
- Complete environment isolation
- Consistent dependencies
- Safe execution (can't affect host)
- Easy to reset/rebuild

See [Docker Setup](../workflows/docker-setup.md) for details.

## Best Practices

### Use Meaningful Names

Choose names that help identify agents in logs and branches:

```bash
prlt agent staff add frontend-dev backend-dev infra-bot
```

### Match Agents to Work Types

Assign agents consistently to similar work:
- `frontend-agent` → UI tickets
- `api-agent` → Backend tickets
- `test-agent` → Test coverage tickets

### Clean Up Regularly

Remove ephemeral agents after batch operations:

```bash
prlt agent temp cleanup
```

### Monitor Active Agents

Check what agents are working on:

```bash
prlt work list
prlt execution list
```

## Related Concepts

- [HQ](./hq.md) - Workspace structure
- [Work](./work.md) - Spawning and executing work
- [Multi-Agent Workflows](../workflows/multi-agent.md) - Running multiple agents
