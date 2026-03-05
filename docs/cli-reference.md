# CLI Reference

Complete command reference for the Proletariat CLI (`prlt`).

## Global Options

All commands support these options:

| Option | Description |
|--------|-------------|
| `--help` | Show help for command |
| `--version` | Show CLI version |
| `--json` | Output as JSON (for scripting) |

## Command Namespaces

### Integrations

#### `prlt asana connect`

Authenticate with Asana and optionally save default workspace/project.

```bash
prlt asana connect
prlt asana connect --check
prlt asana connect --workspace "Product Team" --project "Roadmap"
```

#### `prlt asana sync`

Sync PMO tickets to Asana tasks.

```bash
prlt asana sync --ticket TKT-001 --task 1234567890
prlt asana sync --ticket TKT-001 --create-missing --project 987654321
prlt asana sync --dry-run
```

### Workspace Management

#### `prlt init`

Initialize a new HQ workspace.

```bash
prlt init
```

#### `prlt workspace list`

List discovered workspaces.

```bash
prlt workspace list
```

---

### Agent Management

#### `prlt agent staff add`

Add named (staff) agents.

```bash
prlt agent staff add <names...>

# Examples
prlt agent staff add alice bob
prlt agent staff add frontend-dev backend-dev
```

#### `prlt agent staff list`

List staff agents.

```bash
prlt agent staff list
```

#### `prlt agent staff remove`

Remove a staff agent.

```bash
prlt agent staff remove <name>
```

#### `prlt agent list`

List all active agents.

```bash
prlt agent list
```

#### `prlt agent status`

Check agent status.

```bash
prlt agent status <name>
```

#### `prlt agent shell`

Open shell in agent's workspace.

```bash
prlt agent shell <name>
```

#### `prlt agent visit`

Navigate to agent's workspace.

```bash
prlt agent visit <name>
```

#### `prlt agent rebuild`

Rebuild agent's workspace.

```bash
prlt agent rebuild <name>
```

#### `prlt agent temp list`

List ephemeral agents.

```bash
prlt agent temp list
```

#### `prlt agent temp cleanup`

Remove ephemeral agents.

```bash
prlt agent temp cleanup
```

---

### Agent Themes

#### `prlt agent themes list`

List available themes.

```bash
prlt agent themes list
```

#### `prlt agent themes set`

Set active theme.

```bash
prlt agent themes set <theme-name>
```

#### `prlt agent themes create`

Create custom theme.

```bash
prlt agent themes create <theme-name>
```

#### `prlt agent themes add-names`

Add names to a theme.

```bash
prlt agent themes add-names <theme> <names...>
```

---

### Ticket Management

#### `prlt ticket create`

Create a new ticket.

```bash
prlt ticket create [options]

Options:
  --title <text>          Ticket title
  --description <text>    Detailed description
  --priority <P0-P3>      Priority level
  --category <type>       Category (feature, bug, etc.)
  --add-subtask <text>    Add subtask (repeatable)
  --add-ac <text>         Add acceptance criteria (repeatable)
  --add-label <text>      Add label (repeatable)

# Examples
prlt ticket create
prlt ticket create --title "Add login" --priority P1 --category feature
```

#### `prlt ticket list`

List tickets.

```bash
prlt ticket list [options]

Options:
  --project <id>      Filter by project
  --status <name>     Filter by status
  --priority <P0-P3>  Filter by priority
  --assignee <name>   Filter by assignee

# Examples
prlt ticket list
prlt ticket list --status "In Progress"
prlt ticket list --priority P0
```

#### `prlt ticket view`

View ticket details.

```bash
prlt ticket view <ticket-id>
```

#### `prlt ticket edit`

Edit a ticket.

```bash
prlt ticket edit <ticket-id> [options]

Options:
  --title <text>           Update title
  --description <text>     Update description
  --priority <P0-P3>       Update priority
  --category <type>        Update category
  --add-subtask <text>     Add subtask
  --clear-subtasks         Clear all subtasks
  --add-ac <text>          Add acceptance criteria
  --clear-ac               Clear acceptance criteria
  --add-label <text>       Add label
  --remove-label <text>    Remove label

# Examples
prlt ticket edit TKT-001 --priority P0
prlt ticket edit TKT-001 --add-label "ready" --add-ac "Tests pass"
```

#### `prlt ticket move`

Move ticket to a status.

```bash
prlt ticket move <ticket-id> <status>

# Examples
prlt ticket move TKT-001 "In Progress"
prlt ticket move TKT-001 Done
```

#### `prlt ticket assign`

Assign ticket to an agent.

```bash
prlt ticket assign <ticket-id> <agent-name>
```

#### `prlt ticket link`

Link spec to ticket.

```bash
prlt ticket link <ticket-id> <spec-id>
```

---

### Work Management

#### `prlt work start`

Start work on a ticket.

```bash
prlt work start [ticket-id] [options]

Options:
  --agent <name>         Assign specific agent
  --mode <mode>          Execution mode (docker, terminal, tmux, etc.)
  --action <action>      Action (implement, groom, review)
  --prompt <text>        Custom prompt
  --from-issue           Resolve ticket from external issue source
  --source <source>      External source: linear | jira (with --from-issue)
  --key <key>            External issue key (with --from-issue)
  --mirror-to-pmo        Create/update linked PMO ticket from external issue
  --no-mirror-to-pmo     Require existing linked PMO ticket (no mirror write)
  --force                Start even if work in progress
  --create-pr            Create PR when done (overrides workspace default)
  --no-pr                [deprecated] Don't create PR (omit --create-pr instead)
  --run-on-host          Run on host (not container)
  --ephemeral            Use ephemeral agent

# PR mode resolution order:
# 1. --create-pr / --no-pr flags (explicit)
# 2. Workspace config: execution.create_pr_default
# 3. Interactive prompt (or default in --json --yes mode)

# Examples
prlt work start TKT-001
prlt work start TKT-001 --mode docker --action implement
prlt work start TKT-001 --create-pr        # Explicitly create PR
prlt work start --from-issue --source linear --key ENG-123
prlt work start --from-issue --source jira --key PROJ-123 --mirror-to-pmo
```

#### `prlt work spawn`

Spawn work on multiple tickets (batch mode).

```bash
prlt work spawn [ticket-ids...] [options]

Options:
  --all                  Spawn all tickets in column
  --column <name>        Column to spawn from
  --many                 Multi-select tickets
  --limit <n>            Max tickets to spawn
  --strategy <type>      Agent selection (round-robin, least-busy, random)
  --dry-run              Preview without executing
  --mode <mode>          Execution mode
  --skip-permissions     Skip confirmation prompts
  --create-pr            Create PRs when done (overrides workspace default)
  --no-pr                [deprecated] Don't create PRs
  --from <source>        Source override (provider[:context], e.g., pmo, linear:PRO)

# Examples
prlt work spawn --all --column Planned
prlt work spawn TKT-001 TKT-002 TKT-003
prlt work spawn --all --dry-run
prlt work spawn TKT-001 TKT-002 --create-pr   # Ensure PRs are created
prlt work spawn --from linear:PRO              # Pull from active Linear team context
```

#### `prlt work source`

Show or set the active source that `work spawn` uses by default when `--from` is omitted.

```bash
prlt work source
prlt work source set linear:PRO
prlt work source set pmo
```

#### `prlt work jira`

List/select Jira issues, create or update linked internal ticket context, and spawn work using `work start`.

```bash
prlt work jira [options]

Options:
  --host <url>           Jira host URL (fallback: PRLT_JIRA_HOST or JIRA_HOST)
  --email <email>        Jira account email (fallback: PRLT_JIRA_EMAIL or JIRA_EMAIL)
  --token <token>        Jira API token (fallback: PRLT_JIRA_API_TOKEN or JIRA_API_TOKEN)
  --project-key <key>    Jira project key (fallback: PRLT_JIRA_PROJECT or JIRA_PROJECT_KEY)
  --jql <query>          Custom JQL for listing issues
  --issue <key>          Jira issue key (e.g., PROJ-123)
  --limit <n>            Number of issues to fetch (default: 20)
  --action <action>      Work action for spawn (default: implement)
  --display <mode>       terminal | background | foreground
  --skip-permissions     Use danger mode
  --create-pr            Create PR when work is ready
  --yes                  Skip downstream confirmation prompts

# Examples
prlt work jira --host https://myorg.atlassian.net --project-key PROJ
prlt work jira --host https://myorg.atlassian.net --issue PROJ-123 --yes --display terminal --skip-permissions
```

> **Operator guide:** For setup, troubleshooting, and fallback modes when spawning from external issue sources (Linear/Jira), see the [External Issue Spawn Runbook](runbook-external-issue-spawn.md).

#### `prlt work list`

List active work.

```bash
prlt work list
```

---

### Execution Management

#### `prlt execution list`

List executions.

```bash
prlt execution list
```

#### `prlt execution logs`

View execution logs.

```bash
prlt execution logs [execution-id] [options]

Options:
  --follow    Follow logs in real-time
```

#### `prlt execution stop`

Stop an execution.

```bash
prlt execution stop <execution-id>
```

---

### Docker Management

#### `prlt docker list`

List Docker containers.

```bash
prlt docker list
```

#### `prlt docker status`

Check Docker status.

```bash
prlt docker status
```

#### `prlt docker start`

Start a container.

```bash
prlt docker start <agent-name>
```

#### `prlt docker stop`

Stop a container.

```bash
prlt docker stop <agent-name>
```

#### `prlt docker restart`

Restart a container.

```bash
prlt docker restart <agent-name>
```

#### `prlt docker logs`

View container logs.

```bash
prlt docker logs <agent-name>
```

#### `prlt docker shell`

Shell into container.

```bash
prlt docker shell <agent-name>
```

#### `prlt docker clean`

Remove stopped containers.

```bash
prlt docker clean
```

#### `prlt docker prune`

Remove unused Docker resources.

```bash
prlt docker prune
```

---

### Board and Status

#### `prlt board`

Display kanban board.

```bash
prlt board
```

#### `prlt board watch`

Watch board in real-time.

```bash
prlt board watch
```

#### `prlt status list`

List workflow statuses.

```bash
prlt status list
```

#### `prlt status create`

Create custom status.

```bash
prlt status create --name <name> --category <category>
```

---

### Project Management

#### `prlt project create`

Create a project.

```bash
prlt project create
```

#### `prlt project list`

List projects.

```bash
prlt project list
```

#### `prlt project view`

View project details.

```bash
prlt project view <project-id>
```

#### `prlt project archive`

Archive a project.

```bash
prlt project archive <project-id>
```

---

### Repository Management

#### `prlt repo add`

Add a repository.

```bash
prlt repo add <url-or-path>

# Examples
prlt repo add https://github.com/org/repo.git
prlt repo add /path/to/local/repo
```

#### `prlt repo list`

List repositories.

```bash
prlt repo list
```

#### `prlt repo remove`

Remove a repository.

```bash
prlt repo remove <repo-name>
```

---

### Specs

#### `prlt spec create`

Create a specification.

```bash
prlt spec create
```

#### `prlt spec list`

List specifications.

```bash
prlt spec list
```

#### `prlt spec show`

View specification.

```bash
prlt spec show <spec-id>
```

---

### Epics

#### `prlt epic create`

Create an epic.

```bash
prlt epic create --title <title>
```

#### `prlt epic list`

List epics.

```bash
prlt epic list
```

#### `prlt epic view`

View epic details.

```bash
prlt epic view <epic-id>
```

#### `prlt epic ticket`

Add tickets to epic.

```bash
prlt epic ticket <epic-id> <ticket-ids...>
```

#### `prlt epic progress`

View epic progress.

```bash
prlt epic progress <epic-id>
```

---

### Pull Requests

#### `prlt pr create`

Create a pull request.

```bash
prlt pr create
```

#### `prlt pr status`

Check PR status for ticket.

```bash
prlt pr status <ticket-id>
```

#### `prlt pr link`

Link PR to ticket.

```bash
prlt pr link <ticket-id> <pr-url>
```

---

### GitHub Integration

#### `prlt gh login`

Login to GitHub.

```bash
prlt gh login
```

#### `prlt gh status`

Check GitHub auth status.

```bash
prlt gh status
```

#### `prlt gh token`

Get GitHub token.

```bash
prlt gh token
```

---

### Monday.com Integration

#### `prlt monday connect`

Connect Monday.com and configure default board.

```bash
prlt monday connect --board <board-id>
prlt monday connect --check
prlt monday connect --disconnect
```

#### `prlt monday sync`

Sync PMO tickets to Monday board items.

```bash
prlt monday sync -P <project-id>
prlt monday sync --ticket <ticket-id>
prlt monday sync --dry-run
```

---

### Utility Commands

#### `prlt whoami`

Show current user/context.

```bash
prlt whoami
```

#### `prlt commit`

Create a commit with conventional format.

```bash
prlt commit
```

#### `prlt autocomplete setup`

Set up shell autocomplete.

```bash
prlt autocomplete setup
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PRLT_HQ_PATH` | Override workspace location |
| `GITHUB_TOKEN` | GitHub authentication |
| `ANTHROPIC_API_KEY` | Claude API key |
| `DEVCONTAINER` | Set when in devcontainer |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Command not found |

## Getting Help

```bash
# General help
prlt --help

# Command help
prlt ticket --help
prlt work start --help
```
