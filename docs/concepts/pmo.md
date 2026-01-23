# PMO (Project Management Org)

The PMO is Proletariat's built-in project management system. It provides ticket tracking, specifications, and workflow management designed specifically for AI agent orchestration.

## Core Entities

### Projects

Projects are organizational containers that group related tickets. Projects reference shared workflow templates and have their own board view.

```bash
# Create a project
prlt project create

# List projects
prlt project list

# View project details
prlt project view <project-id>
```

### Tickets

Tickets are individual work items that agents implement. They follow a structured workflow from creation to completion.

#### Ticket Fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (e.g., TKT-001) |
| `title` | Brief description of the work |
| `description` | Detailed requirements and context |
| `status` | Current workflow state |
| `priority` | P0 (critical), P1 (high), P2 (medium), P3 (low) |
| `category` | feature, bug, refactor, docs, test, chore, etc. |
| `owner` | Human responsible for the ticket |
| `subtasks` | Checklist of smaller tasks |
| `acceptanceCriteria` | Testable completion criteria |
| `labels` | Flexible tags (e.g., complexity:M, ready) |

#### Creating Tickets

```bash
# Interactive creation
prlt ticket create

# With flags
prlt ticket create \
  --title "Add user authentication" \
  --description "Implement JWT-based auth with refresh tokens" \
  --priority P1 \
  --category feature \
  --add-subtask "Create login endpoint" \
  --add-subtask "Create logout endpoint" \
  --add-ac "Users can log in with email/password" \
  --add-ac "JWT tokens expire after 1 hour"
```

#### Managing Tickets

```bash
# List tickets
prlt ticket list
prlt ticket list --status "In Progress"
prlt ticket list --priority P0

# View ticket details
prlt ticket view TKT-001

# Edit ticket
prlt ticket edit TKT-001 --priority P0 --add-label "urgent"

# Move ticket status
prlt ticket move TKT-001 "In Progress"

# Assign to agent
prlt ticket assign TKT-001 alice
```

### Workflow Statuses

Tickets flow through workflow statuses. Default statuses follow Linear-style categories:

| Status | Category | Description |
|--------|----------|-------------|
| Backlog | backlog | Not yet planned |
| Planned | planned | Ready to be worked on |
| In Progress | started | Currently being worked |
| In Review | started | PR created, awaiting review |
| Done | completed | Work finished |
| Canceled | canceled | No longer needed |

```bash
# List statuses
prlt status list

# Create custom status
prlt status create --name "QA Testing" --category started

# Move ticket to status
prlt ticket move TKT-001 "QA Testing"
```

### Specs (Specifications)

Specs are detailed requirements documents that can be linked to tickets. They provide more context than a ticket description.

```bash
# Create a spec
prlt spec create

# List specs
prlt spec list

# Link spec to ticket
prlt ticket link TKT-001 SPEC-001
```

#### Spec Types

| Type | Purpose |
|------|---------|
| `product` | Product requirements and user stories |
| `platform` | Platform/architecture specifications |
| `infra` | Infrastructure and deployment specs |
| `integration` | API and integration specifications |

### Epics

Epics group related tickets into larger initiatives:

```bash
# Create an epic
prlt epic create --title "User Management System"

# Add tickets to epic
prlt epic ticket EPIC-001 TKT-001 TKT-002 TKT-003

# View epic progress
prlt epic progress EPIC-001
```

## Board View

The board provides a Kanban-style visualization of tickets:

```bash
# View the board
prlt board

# Watch board in real-time
prlt board watch
```

The board shows tickets organized by status columns with:
- Ticket ID and title
- Priority indicator
- Assignee
- Labels

### Board File

The `pmo/board.md` file is a markdown representation of the board, compatible with Obsidian and other markdown tools:

```markdown
# Board

## Backlog
- [ ] TKT-001: Add user authentication (P1)
- [ ] TKT-002: Fix login bug (P0)

## In Progress
- [ ] TKT-003: Update API docs (P2) @alice

## Done
- [x] TKT-004: Setup CI/CD (P1)
```

## Ticket Lifecycle

A typical ticket flows through these stages:

```
Created → Backlog → Planned → In Progress → In Review → Done
                                    ↓
                                Canceled
```

### Status Transitions

| From | To | Trigger |
|------|-----|---------|
| Backlog | Planned | Manual move or sprint planning |
| Planned | In Progress | `prlt work start` begins |
| In Progress | In Review | Agent creates PR |
| In Review | Done | PR merged |
| Any | Canceled | Manual cancellation |

## Labels and Organization

Labels provide flexible categorization:

```bash
# Add labels
prlt ticket edit TKT-001 --add-label "complexity:L" --add-label "ready"

# Remove labels
prlt ticket edit TKT-001 --remove-label "needs-clarification"
```

### Common Label Conventions

| Label | Purpose |
|-------|---------|
| `complexity:S/M/L/XL` | Effort estimate |
| `ready` | Ticket is ready to work |
| `needs-clarification` | Missing information |
| `blocked` | Waiting on dependency |
| `quick-win` | Easy, high-value task |

## Acceptance Criteria

Acceptance criteria define testable completion conditions:

```bash
prlt ticket edit TKT-001 \
  --add-ac "Users can log in with valid credentials" \
  --add-ac "Invalid credentials show error message" \
  --add-ac "Session persists across page reloads"
```

Well-written acceptance criteria:
- Start with a subject ("Users can...", "System should...")
- Are testable/verifiable
- Are specific and measurable
- Cover edge cases

## Subtasks

Subtasks break down tickets into smaller steps:

```bash
prlt ticket edit TKT-001 \
  --add-subtask "Create database schema" \
  --add-subtask "Implement API endpoints" \
  --add-subtask "Add frontend forms" \
  --add-subtask "Write tests"
```

## Related Concepts

- [HQ](./hq.md) - Workspace structure
- [Agents](./agents.md) - AI coding assistants
- [Ticket Lifecycle Workflow](../workflows/ticket-lifecycle.md) - End-to-end workflow
