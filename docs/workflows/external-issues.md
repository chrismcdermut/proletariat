# External Issue Integration (Linear / Jira)

Proletariat supports pulling issues from Linear and Jira, optionally mirroring them into PMO tickets, and spawning agent work against them.

## Quick Start

### Single issue (work start)

```bash
# Linear — unified shorthand
prlt work start --from linear:ENG-123

# Jira — unified shorthand
prlt work start --from jira:PROJ-456

# Legacy flag style (equivalent)
prlt work start --from-issue --source linear --key ENG-123
prlt work start --from-issue --source jira --key PROJ-456 --mirror-to-pmo
```

### Batch spawn (work spawn)

```bash
# Pull all active Linear issues from team ENG → mirror to PMO → spawn agents
prlt work spawn --from linear:ENG

# Pull specific Jira issues → mirror to PMO → spawn agents
prlt work spawn --from jira:PROJ PROJ-123 PROJ-456

# Use Jira with custom JQL
prlt work spawn --from jira --jira-jql 'assignee = currentUser() AND status = "To Do"'
```

## Source Resolution

When you run `work start --from-issue` or `work spawn` without specifying a source, prlt resolves the source in this order:

1. **Explicit flag**: `--from provider:key` or `--source provider`
2. **Persisted active source**: Set with `prlt work source set`
3. **Interactive prompt**: When multiple sources are registered and no default is saved

### Setting a default source

```bash
# Set Linear as the default
prlt work source set linear:ENG

# Set Jira as the default
prlt work source set jira:PROJ

# Reset to PMO (internal tickets)
prlt work source set pmo

# View current source
prlt work source
```

Once a default is set, you can omit `--from`:

```bash
# After: prlt work source set linear:ENG
prlt work spawn    # Automatically uses Linear (team ENG)

# After: prlt work source set jira:PROJ
prlt work start --from-issue --key PROJ-789   # Uses Jira from active source
```

## Mirror-to-PMO Behavior

When working with external issues, prlt can create/update a linked PMO ticket. This is controlled by `--mirror-to-pmo`:

| Precedence | Source | Example |
|-----------|--------|---------|
| 1 | Flag | `--mirror-to-pmo` or `--no-mirror-to-pmo` |
| 2 | Environment | `PRLT_MIRROR_TO_PMO_DEFAULT=true\|false` |
| 3 | Workspace config | `execution.mirror_to_pmo_default` |
| 4 | Default | `true` (enabled) |

```bash
# Enable mirror (default)
prlt work start --from linear:ENG-123 --mirror-to-pmo

# Disable mirror (requires existing linked ticket)
prlt work start --from jira:PROJ-456 --no-mirror-to-pmo
```

When `work spawn` pulls from an external source, mirroring is always enabled (batch mode creates PMO tickets for all imported issues).

## JSON Mode (for AI Agents)

All commands support `--json` for machine-readable output:

```bash
# JSON mode outputs structured prompts instead of interactive menus
prlt work start --from-issue --json

# Example JSON output when source selection is needed:
# {
#   "type": "prompt",
#   "prompt": {
#     "type": "list",
#     "name": "source",
#     "message": "Select external issue source:",
#     "choices": [
#       { "name": "Linear", "value": "linear", "command": "prlt work start --from linear:ISSUE-KEY --json" },
#       { "name": "Jira", "value": "jira", "command": "prlt work start --from jira:ISSUE-KEY --json" }
#     ]
#   },
#   "metadata": {
#     "command": "work start",
#     "sourceResolution": { "method": "interactive", "provider": "linear" }
#   }
# }
```

The `metadata.sourceResolution` field tells agents how the source was resolved:
- `method: "flag"` — Explicit `--from` or `--source` flag
- `method: "active-source"` — Loaded from persisted workspace default
- `method: "interactive"` — User selected from prompt

## Configuration

### Linear

```bash
prlt linear auth                    # Interactive authentication
# Or set environment variables:
export PRLT_LINEAR_API_KEY=lin_api_xxx
export PRLT_LINEAR_TEAM=ENG         # Default team
```

### Jira

```bash
# Set environment variables:
export PRLT_JIRA_BASE_URL=https://myorg.atlassian.net
export PRLT_JIRA_API_TOKEN=your_api_token
export PRLT_JIRA_EMAIL=user@example.com       # For Basic auth
export PRLT_JIRA_PROJECT=PROJ                 # Default project key

# Or use flags:
prlt work jira --host https://myorg.atlassian.net --project-key PROJ
```

## Related Commands

| Command | Description |
|---------|-------------|
| `prlt work start --from provider:key` | Start work from external issue |
| `prlt work spawn --from provider[:context]` | Batch spawn from external source |
| `prlt work source` | View/set active work source |
| `prlt work source set provider[:context]` | Persist default source |
| `prlt work linear` | Interactive Linear issue picker |
| `prlt work jira` | Interactive Jira issue picker |
