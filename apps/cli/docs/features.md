# Features

Proletariat provides comprehensive tools for managing AI coding agents and orchestrating development work. This document covers all major features and command namespaces.

## Table of Contents

- [Ticket Management](#ticket-management)
- [Work Commands](#work-commands)
- [Agent Management](#agent-management)
- [Board Visualization](#board-visualization)
- [Pull Request Integration](#pull-request-integration)
- [Specification Management](#specification-management)
- [Epic Management](#epic-management)
- [Project Organization](#project-organization)
- [Docker Management](#docker-management)
- [GitHub Integration](#github-integration)
- [Branch Management](#branch-management)
- [Status and Workflow](#status-and-workflow)

---

## Ticket Management

Tickets are the core work items in Proletariat. They flow through workflow statuses and can be assigned to agents for completion.

### Creating Tickets

```bash
# Interactive creation
prlt ticket create

# With flags
prlt ticket create --title "Add authentication" --priority P1

# Full example
prlt ticket create \
  --title "Implement user login" \
  --description "Create login endpoint with JWT tokens" \
  --priority P0 \
  --category feature
```

### Viewing and Listing

```bash
# List all tickets
prlt ticket list

# Filter by status
prlt ticket list --status in-progress

# View specific ticket
prlt ticket view TKT-001
```

### Editing and Moving

```bash
# Edit ticket details
prlt ticket edit TKT-001

# Move to different status
prlt ticket move TKT-001 in-progress

# Change priority
prlt ticket edit TKT-001 --priority P0
```

### Bulk Operations

```bash
# Bulk operations on multiple tickets
prlt ticket --bulk

# Move multiple tickets
prlt ticket move --bulk
```

### Linking Tickets

```bash
# Block relationship
prlt ticket link block TKT-001 TKT-002  # TKT-001 blocks TKT-002

# Duplicate relationship
prlt ticket link duplicates TKT-001 TKT-002

# Related tickets
prlt ticket link relates TKT-001 TKT-002

# Remove link
prlt ticket link remove TKT-001 TKT-002
```

### Ticket Properties

| Property | Description | Values |
|----------|-------------|--------|
| ID | Unique identifier | TKT-001, TKT-002, etc. |
| Title | Short description | Free text |
| Description | Detailed requirements | Markdown text |
| Priority | Urgency level | P0, P1, P2, P3 |
| Category | Type of work | feature, bug, docs, refactor, test, chore |
| Status | Workflow state | backlog, planned, in-progress, in-review, done, canceled |

---

## Work Commands

Work commands manage the execution of tickets by agents.

### Starting Work

```bash
# Spawn work in Docker container
prlt work spawn TKT-001 altman

# Start work (auto-select agent)
prlt work start TKT-001

# Spawn all planned tickets
prlt work spawn-all
```

### Monitoring Work

```bash
# List active work
prlt work list

# View real-time logs
prlt work logs TKT-001

# Watch work progress
prlt work watch TKT-001
```

### Work Lifecycle

```bash
# Claim ticket (assign to self)
prlt work claim TKT-001

# Mark as ready for review
prlt work ready TKT-001

# Create PR when marking ready
prlt work ready TKT-001 --pr

# Mark as complete
prlt work complete TKT-001

# Request revisions
prlt work revise TKT-001
```

### Work Flow

```
prlt work start TKT-001
       ↓
   [Agent works]
       ↓
prlt work ready TKT-001 --pr
       ↓
   [Review PR]
       ↓
prlt work complete TKT-001
```

---

## Agent Management

Agents are AI coding assistants that work in isolated environments. They use fun billionaire-themed names by default!

### Adding and Removing

```bash
# Add single agent
prlt agent add altman

# Add multiple agents
prlt agent add altman bezos musk gates

# Remove agent
prlt agent remove altman
```

### Listing and Status

```bash
# List all agents
prlt agent list

# View agent status
prlt agent status altman
```

### Agent Interaction

```bash
# Open shell in agent workspace
prlt agent shell altman

# Visit agent directory
prlt agent visit altman

# Rebuild agent environment
prlt agent rebuild altman

# Restart agent
prlt agent restart altman
```

### Agent Themes

Customize agent names with themes:

```bash
# List available themes
prlt agent themes list

# Set a theme (billionaires is default)
prlt agent themes set billionaires

# Create custom theme
prlt agent themes create --name "my-theme"

# Add names to theme
prlt agent themes add-names my-theme alice bob carol
```

**Default billionaire names:** altman, bezos, musk, gates, zuck, nadella, pichai, cook, brin, page, ellison, ballmer...

---

## Board Visualization

The board provides a kanban-style view of all tickets.

### Viewing the Board

```bash
# Show board (interactive menu)
prlt board
```

### Watching for Changes

```bash
# Real-time board updates
prlt board watch
```

### Board Output

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│   Backlog    │   Planned    │ In Progress  │  In Review   │     Done     │
├──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ TKT-003      │ TKT-002      │ TKT-001      │              │              │
│ P2 feature   │ P1 bug       │ altman       │              │              │
│              │              │ P0 feature   │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

The board also syncs to `pmo/board.md` for Obsidian compatibility.

---

## Pull Request Integration

Create and manage pull requests directly from the CLI.

### Creating PRs

```bash
# Create PR for current branch
prlt pr create

# Create PR interactively
prlt pr create --interactive
```

### Linking and Status

```bash
# Link PR to ticket
prlt pr link TKT-001 https://github.com/org/repo/pull/123

# Check PR status
prlt pr status TKT-001
```

---

## Specification Management

Specs provide detailed requirements that can be linked to tickets.

### Creating Specs

```bash
# Create spec interactively
prlt spec create

# View spec
prlt spec view SPEC-001

# List all specs
prlt spec list
```

### Spec Relationships

```bash
# Add dependency
prlt spec link depends SPEC-001 SPEC-002

# Mark as duplicate
prlt spec link duplicates SPEC-001 SPEC-002

# Add related spec
prlt spec link relates SPEC-001 SPEC-002

# Remove relationship
prlt spec link remove SPEC-001 SPEC-002
```

### Generating Tickets from Specs

```bash
# Generate tickets from spec
prlt spec ticket SPEC-001

# Generate implementation plan
prlt spec plan SPEC-001
```

---

## Epic Management

Epics group related tickets for larger features.

### Creating and Managing

```bash
# Create epic
prlt epic create --name "User Authentication" --description "Complete auth system"

# List epics
prlt epic list

# View epic details
prlt epic view EPIC-001
```

### Epic Organization

```bash
# Activate epic
prlt epic activate EPIC-001

# Archive epic
prlt epic archive EPIC-001

# Move epic
prlt epic move EPIC-001 --project PROJ-002

# Reorder epics
prlt epic reorder EPIC-001 --position 1
```

### Epic Relationships

```bash
# Link ticket to epic
prlt epic ticket EPIC-001 TKT-001

# Link spec to epic
prlt epic spec EPIC-001 SPEC-001

# View epic progress
prlt epic progress EPIC-001
```

---

## Project Organization

Projects organize tickets, epics, and specs into logical groups.

### Managing Projects

```bash
# Create project
prlt project create --name "My Project"

# List projects
prlt project list

# View project
prlt project view PROJ-001

# Delete project
prlt project delete PROJ-001
```

### Project Lifecycle

```bash
# Archive project
prlt project archive PROJ-001

# Unarchive project
prlt project unarchive PROJ-001
```

---

## Docker Management

Manage Docker containers used by agents.

### Container Operations

```bash
# List containers
prlt docker list

# Start container
prlt docker start <container-id>

# Stop container
prlt docker stop <container-id>

# Restart container
prlt docker restart <container-id>
```

### Container Access

```bash
# Open shell in container
prlt docker shell <container-id>

# View container logs
prlt docker logs <container-id>
```

### Cleanup

```bash
# Clean orphaned containers
prlt docker clean

# Prune unused containers
prlt docker prune
```

---

## GitHub Integration

Authenticate and interact with GitHub.

### Authentication

```bash
# Login to GitHub
prlt gh login

# Check auth status
prlt gh status

# Get token
prlt gh token
```

---

## Branch Management

Manage git branches for agent work.

### Creating Branches

```bash
# Create branch for ticket
prlt branch create TKT-001

# Create with options
prlt branch create TKT-001 --from-origin --force
```

### Branch Operations

```bash
# List branches
prlt branch list

# Validate branch naming
prlt branch validate feature/TKT-001-add-login
```

---

## Status and Workflow

Manage workflow statuses for tickets.

### Viewing Statuses

```bash
# List statuses
prlt status list

# Create custom status
prlt status create --name "QA Testing"
```

### Status Operations

```bash
# Update status
prlt status update --id 5 --name "Testing"

# Move status position
prlt status move --id 5 --position 3

# Delete status
prlt status delete --id 5
```

### Status Templates

```bash
# List templates
prlt status template list

# Apply template
prlt status template apply --name "agile"

# Create template
prlt status template create --name "my-workflow"
```

---

## Command Namespaces Summary

| Namespace | Description |
|-----------|-------------|
| `ticket` | Ticket CRUD and lifecycle |
| `work` | Agent work execution |
| `agent` | Agent management |
| `board` | Board visualization |
| `pr` | Pull request integration |
| `spec` | Specification management |
| `epic` | Epic management |
| `project` | Project organization |
| `docker` | Container management |
| `gh` | GitHub integration |
| `branch` | Git branch management |
| `status` | Workflow status management |
| `action` | Custom actions |
| `phase` | Roadmap phases |

---

See also:
- [Getting Started](getting-started.md) - Quick start guide
- [Concepts](concepts.md) - Core architecture concepts
- [Command Reference](commands/README.md) - Detailed command documentation
- [README](../README.md) - Project overview
