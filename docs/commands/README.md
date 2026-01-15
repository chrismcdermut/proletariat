# Command Reference

Complete reference for all `prlt` commands organized by namespace.

## Quick Reference

| Namespace | Description | Common Commands |
|-----------|-------------|-----------------|
| [ticket](#ticket) | Ticket management | `create`, `list`, `view`, `move` |
| [work](#work) | Agent work execution | `spawn`, `start`, `ready`, `complete` |
| [agent](#agent) | Agent management | `add`, `list`, `remove`, `shell` |
| [board](#board) | Board visualization | `show`, `watch` |
| [pr](#pr) | Pull request integration | `create`, `status`, `link` |
| [spec](#spec) | Specification management | `create`, `list`, `view`, `plan` |
| [epic](#epic) | Epic management | `create`, `list`, `view`, `progress` |
| [project](#project) | Project organization | `create`, `list`, `view`, `archive` |
| [docker](#docker) | Container management | `list`, `start`, `stop`, `logs` |
| [gh](#gh) | GitHub integration | `login`, `status`, `token` |
| [branch](#branch) | Branch management | `create`, `list`, `validate` |
| [status](#status) | Workflow statuses | `list`, `create`, `move` |
| [action](#action) | Custom actions | `create`, `list`, `run` |
| [phase](#phase) | Roadmap phases | `create`, `list`, `move` |

## Global Commands

```bash
prlt init                # Initialize new HQ
prlt commit <message>    # Commit with ticket ID prefix
prlt whoami              # Show current user
prlt --help              # Show help
prlt --version           # Show version
```

---

## ticket

Manage work tickets - the core unit of work in Proletariat.

### Commands

| Command | Description |
|---------|-------------|
| `ticket create` | Create a new ticket |
| `ticket list` | List all tickets |
| `ticket view <id>` | View ticket details |
| `ticket edit <id>` | Edit ticket |
| `ticket move <id> <status>` | Move ticket to status |
| `ticket delete <id>` | Delete ticket |
| `ticket complete <id>` | Mark ticket complete |
| `ticket --bulk` | Bulk ticket operations |

### Examples

```bash
# Create ticket interactively
prlt ticket create

# Create with flags
prlt ticket create --title "Add login" --priority P1 --category feature

# List tickets
prlt ticket list

# Filter by status
prlt ticket list --status in-progress

# View ticket
prlt ticket view TKT-001

# Move to status
prlt ticket move TKT-001 in-progress

# Edit ticket
prlt ticket edit TKT-001 --priority P0
```

### Link Subcommands

```bash
# Create blocker relationship
prlt ticket link block TKT-001 TKT-002

# Mark as duplicate
prlt ticket link duplicates TKT-001 TKT-002

# Add related ticket
prlt ticket link relates TKT-001 TKT-002

# Remove link
prlt ticket link remove TKT-001 TKT-002
```

### Template Subcommands

```bash
# List ticket templates
prlt ticket template list

# Create template
prlt ticket template create --name "bug-report"

# Apply template
prlt ticket template apply --name "bug-report"

# Save ticket as template
prlt ticket template save TKT-001 --name "my-template"
```

---

## work

Manage agent work on tickets.

### Commands

| Command | Description |
|---------|-------------|
| `work spawn <ticket> <agent>` | Start agent work in Docker |
| `work start <ticket>` | Start work on ticket |
| `work list` | List active work |
| `work logs <ticket>` | View work logs |
| `work watch <ticket>` | Watch work progress |
| `work ready <ticket>` | Mark work ready for review |
| `work complete <ticket>` | Mark work complete |
| `work revise <ticket>` | Request revisions |
| `work claim <ticket>` | Claim ticket for self |
| `work assign <ticket> <agent>` | Assign ticket to agent |
| `work spawn-all` | Spawn work for all planned tickets |

### Examples

```bash
# Spawn work for agent
prlt work spawn TKT-001 alice

# Start work (auto-select agent)
prlt work start TKT-001

# List active work
prlt work list

# View logs in real-time
prlt work logs TKT-001

# Watch work progress
prlt work watch TKT-001

# Mark ready and create PR
prlt work ready TKT-001 --pr

# Mark complete
prlt work complete TKT-001

# Spawn all planned tickets
prlt work spawn-all
```

---

## agent

Manage AI coding agents.

### Commands

| Command | Description |
|---------|-------------|
| `agent add <names...>` | Add new agents |
| `agent list` | List all agents |
| `agent remove <name>` | Remove an agent |
| `agent shell <name>` | Open shell in agent workspace |
| `agent visit <name>` | Visit agent directory |
| `agent status <name>` | View agent status |
| `agent rebuild <name>` | Rebuild agent environment |
| `agent restart <name>` | Restart agent |
| `agent login <name>` | Login to agent container |

### Examples

```bash
# Add agents
prlt agent add alice bob carol

# List agents
prlt agent list

# Open shell in agent workspace
prlt agent shell alice

# Remove agent
prlt agent remove bob
```

### Theme Subcommands

```bash
# List available themes
prlt agent themes list

# Set theme
prlt agent themes set billionaires

# Create custom theme
prlt agent themes create --name "my-team"

# Add names to theme
prlt agent themes add-names my-team alice bob carol
```

---

## board

Visualize tickets in a kanban board.

### Commands

| Command | Description |
|---------|-------------|
| `board` | Interactive board menu |
| `board watch` | Watch board for changes |

### Examples

```bash
# Show board (interactive menu)
prlt board

# Watch for real-time updates
prlt board watch
```

---

## pr

Create and manage pull requests.

### Commands

| Command | Description |
|---------|-------------|
| `pr create` | Create pull request |
| `pr status <ticket>` | Check PR status |
| `pr link <ticket> <url>` | Link PR to ticket |

### Examples

```bash
# Create PR for current branch
prlt pr create

# Check PR status for ticket
prlt pr status TKT-001

# Link existing PR to ticket
prlt pr link TKT-001 https://github.com/org/repo/pull/123
```

---

## spec

Manage specifications.

### Commands

| Command | Description |
|---------|-------------|
| `spec create` | Create specification |
| `spec list` | List specifications |
| `spec view <id>` | View specification |
| `spec plan <id>` | Generate implementation plan |
| `spec ticket <id>` | Generate tickets from spec |

### Examples

```bash
# Create spec
prlt spec create

# List specs
prlt spec list

# View spec
prlt spec view SPEC-001

# Generate tickets from spec
prlt spec ticket SPEC-001

# Generate implementation plan
prlt spec plan SPEC-001
```

### Link Subcommands

```bash
# Add dependency
prlt spec link depends SPEC-001 SPEC-002

# Mark duplicate
prlt spec link duplicates SPEC-001 SPEC-002

# Add related spec
prlt spec link relates SPEC-001 SPEC-002

# Remove link
prlt spec link remove SPEC-001 SPEC-002
```

---

## epic

Manage epics (groups of related tickets).

### Commands

| Command | Description |
|---------|-------------|
| `epic create` | Create epic |
| `epic list` | List epics |
| `epic view <id>` | View epic |
| `epic activate <id>` | Activate epic |
| `epic archive <id>` | Archive epic |
| `epic move <id>` | Move epic |
| `epic reorder <id>` | Reorder epic |
| `epic progress <id>` | View epic progress |
| `epic ticket <epic> <ticket>` | Add ticket to epic |
| `epic spec <epic> <spec>` | Add spec to epic |
| `epic project <epic> <project>` | Move epic to project |

### Examples

```bash
# Create epic
prlt epic create --name "User Authentication"

# List epics
prlt epic list

# View epic
prlt epic view EPIC-001

# Add ticket to epic
prlt epic ticket EPIC-001 TKT-001

# View progress
prlt epic progress EPIC-001
```

### Link Subcommands

```bash
# Add blocker
prlt epic link block EPIC-001 EPIC-002

# Mark duplicate
prlt epic link duplicates EPIC-001 EPIC-002

# Add related epic
prlt epic link relates EPIC-001 EPIC-002

# Remove link
prlt epic link remove EPIC-001 EPIC-002
```

---

## project

Manage projects.

### Commands

| Command | Description |
|---------|-------------|
| `project create` | Create project |
| `project list` | List projects |
| `project view <id>` | View project |
| `project delete <id>` | Delete project |
| `project archive <id>` | Archive project |
| `project unarchive <id>` | Unarchive project |
| `project spec <project> <spec>` | Add spec to project |

### Examples

```bash
# Create project
prlt project create --name "Backend API"

# List projects
prlt project list

# View project
prlt project view PROJ-001

# Archive project
prlt project archive PROJ-001
```

---

## docker

Manage Docker containers for agents.

### Commands

| Command | Description |
|---------|-------------|
| `docker list` | List containers |
| `docker start <id>` | Start container |
| `docker stop <id>` | Stop container |
| `docker restart <id>` | Restart container |
| `docker shell <id>` | Open shell in container |
| `docker logs <id>` | View container logs |
| `docker status` | View container status |
| `docker sync` | Sync container state |
| `docker clean` | Clean orphaned containers |
| `docker prune` | Prune unused containers |

### Examples

```bash
# List containers
prlt docker list

# View logs
prlt docker logs abc123

# Open shell
prlt docker shell abc123

# Clean up
prlt docker clean
prlt docker prune
```

---

## gh

GitHub integration.

### Commands

| Command | Description |
|---------|-------------|
| `gh login` | Login to GitHub |
| `gh status` | Check auth status |
| `gh token` | Get auth token |

### Examples

```bash
# Login to GitHub
prlt gh login

# Check status
prlt gh status
```

---

## branch

Manage git branches.

### Commands

| Command | Description |
|---------|-------------|
| `branch create <ticket>` | Create branch for ticket |
| `branch list` | List branches |
| `branch validate <name>` | Validate branch naming |

### Examples

```bash
# Create branch for ticket
prlt branch create TKT-001

# Create from origin main
prlt branch create TKT-001 --from-origin

# Force create (overwrite existing)
prlt branch create TKT-001 --force

# List branches
prlt branch list

# Validate branch name
prlt branch validate feature/TKT-001-add-login
```

---

## status

Manage workflow statuses.

### Commands

| Command | Description |
|---------|-------------|
| `status list` | List statuses |
| `status create` | Create status |
| `status update <id>` | Update status |
| `status move <id>` | Move status position |
| `status delete <id>` | Delete status |

### Examples

```bash
# List statuses
prlt status list

# Create status
prlt status create --name "QA Testing"

# Move status
prlt status move --id 5 --position 3

# Delete status
prlt status delete --id 5
```

### Template Subcommands

```bash
# List templates
prlt status template list

# Apply template
prlt status template apply --name "agile"

# Create template
prlt status template create --name "my-workflow"

# Save current as template
prlt status template save --name "my-workflow"

# Delete template
prlt status template delete --name "my-workflow"
```

---

## action

Manage custom workflow actions.

### Commands

| Command | Description |
|---------|-------------|
| `action create` | Create action |
| `action list` | List actions |
| `action show <name>` | Show action details |
| `action run <name>` | Run action |
| `action update <name>` | Update action |
| `action delete <name>` | Delete action |

### Examples

```bash
# Create action
prlt action create --name "deploy"

# List actions
prlt action list

# Run action
prlt action run deploy

# Show details
prlt action show deploy
```

---

## phase

Manage roadmap phases.

### Commands

| Command | Description |
|---------|-------------|
| `phase create` | Create phase |
| `phase list` | List phases |
| `phase update <id>` | Update phase |
| `phase move <id>` | Move phase position |
| `phase delete <id>` | Delete phase |

### Examples

```bash
# Create phase
prlt phase create --name "MVP Launch"

# List phases
prlt phase list

# Move phase
prlt phase move --id 1 --position 2
```

### Template Subcommands

```bash
# List templates
prlt phase template list

# Apply template
prlt phase template apply --name "quarterly"

# Create template
prlt phase template create --name "my-phases"
```

---

## Additional Commands

### commit

Smart commit with ticket ID prefix:

```bash
prlt commit "add user authentication"
# Output: feat(TKT-001): add user authentication
```

### whoami

Show current user:

```bash
prlt whoami
```

### autocomplete

Set up shell autocomplete:

```bash
prlt autocomplete setup
```

### execution

View execution logs:

```bash
prlt execution logs <execution-id>
```

---

## Getting Help

```bash
# General help
prlt --help

# Command-specific help
prlt ticket --help
prlt ticket create --help

# Show version
prlt --version
```

---

See also:
- [Getting Started](../getting-started.md) - Quick start guide
- [Features](../features.md) - Feature overview
- [Concepts](../concepts.md) - Core architecture concepts
- [README](../../README.md) - Project overview
