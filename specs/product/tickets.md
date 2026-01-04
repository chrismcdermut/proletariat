---
title: Tickets
domain: tickets
---

# Tickets

## Overview

Tickets are the fundamental unit of work in the PMO system. They represent individual tasks that can be tracked on a kanban board, assigned to agents or humans, and linked to epics.

## Abilities

### Core CRUD

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Create ticket | Create a new ticket with title and optional metadata | `createTicket()` | `prlt ticket create` | `POST /api/tickets` | `CreateTicketModal` | `new markdown file` |
| List tickets | List all tickets with optional filtering | `listTickets()` | `prlt ticket list` | `GET /api/tickets` | `TicketList` | `board.md` |
| View ticket | View a single ticket's details including subtasks | `getTicket()` | `prlt ticket view` | `GET /api/tickets/:id` | `/tickets/:id` | `TKT-001.md` |
| Update ticket | Update ticket fields like title, description, priority | `updateTicket()` | `prlt ticket edit` | `PATCH /api/tickets/:id` | `EditTicketModal` | `edit frontmatter` |
| Move ticket | Move a ticket to a different column on the board | `moveTicket()` | `prlt ticket move` | `PATCH /api/tickets/:id` | `DragDrop` | `move in board.md` |
| Delete ticket | Delete a ticket and its associated subtasks | `deleteTicket()` | `prlt ticket delete` | `DELETE /api/tickets/:id` | `DeleteButton` | `delete file` |
| Link to epic | Associate a ticket with an epic | `updateTicket()` | `prlt ticket link` | `PATCH /api/tickets/:id` | `EpicDropdown` | `epic_id frontmatter` |

### Filtering

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Search tickets | Search tickets by title or description text | `listTickets()` | `prlt ticket list --search` | `GET /api/tickets?q=` | `SearchBar` | `Obsidian search` |
| Filter by column | Filter tickets to only those in a specific column | `listTickets()` | `prlt ticket list --column` | `GET /api/tickets?column=` | `ColumnTabs` | `board sections` |
| Filter by priority | Filter tickets by priority level | `listTickets()` | `prlt ticket list --priority` | `GET /api/tickets?priority=` | `FilterDropdown` | `dataview query` |

### Bulk Operations

| Ability | Description | storage | cli | api | web |
|---------|-------------|---------|-----|-----|-----|
| Bulk move | Move multiple tickets at once to a new column | `moveTickets()` | `prlt tickets move` | `POST /api/tickets/bulk` | `BulkActions` |
| Bulk delete | Delete multiple tickets at once | `deleteTickets()` | `prlt tickets delete` | `POST /api/tickets/bulk` | `BulkActions` |
| Bulk update | Update multiple tickets at once with the same changes | `updateTickets()` | `prlt tickets update` | `POST /api/tickets/bulk` | `BulkActions` |

### Dependencies

| Ability | Description | storage | cli | api | web |
|---------|-------------|---------|-----|-----|-----|
| Add dependency | Add a blocking dependency between tickets | `addTicketDependency()` | `prlt ticket block [id] --by [blocker-id]` | `POST /api/tickets/:id/dependencies` | `DependencyPicker` |
| Remove dependency | Remove a blocking dependency between tickets | `removeTicketDependency()` | `prlt ticket unblock [id] --from [blocker-id]` | `DELETE /api/tickets/:id/dependencies/:blockerId` | `DependencyList` |
| List dependencies | Get tickets that block or are blocked by a ticket | `getTicketDependencies()` | `prlt ticket deps [id]` | `GET /api/tickets/:id/dependencies` | `DependencyGraph` |

### Agent Execution Support

| Ability | Description | storage | cli | api | web |
|---------|-------------|---------|-----|-----|-----|
| Add affected path | Add a file/directory scope hint for agent context | `addTicketAffectedPath()` | `prlt ticket scope [id] --path [pattern]` | `POST /api/tickets/:id/paths` | `PathPicker` |
| Remove affected path | Remove a scope hint from a ticket | `removeTicketAffectedPath()` | `prlt ticket unscope [id] --path [pattern]` | `DELETE /api/tickets/:id/paths/:pathId` | `PathList` |
| Add acceptance criterion | Add a structured acceptance criterion | `addAcceptanceCriterion()` | `prlt ticket criteria add [id] [text]` | `POST /api/tickets/:id/criteria` | `CriteriaEditor` |
| Verify acceptance criterion | Mark an acceptance criterion as verified | `verifyAcceptanceCriterion()` | `prlt ticket criteria verify [id] [criterion-id]` | `PATCH /api/tickets/:id/criteria/:criterionId` | `CriteriaCheckbox` |
| Remove acceptance criterion | Remove an acceptance criterion from a ticket | `removeAcceptanceCriterion()` | `prlt ticket criteria remove [id] [criterion-id]` | `DELETE /api/tickets/:id/criteria/:criterionId` | `CriteriaList` |

## Data Model

### Core Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | TKT-001 format, auto-generated |
| project_id | string | ✓ | "default" | Parent project |
| title | string | ✓ | - | Ticket title |
| description | string | | "" | Structured markdown (see format below) |
| priority | enum | | MEDIUM | URGENT, HIGH, MEDIUM, LOW |
| category | string | | "feature" | feature, bug, infra, docs |
| status_id | ref | | default | Reference to Status from project's workflow config (see [Workflow](workflow.md)) |
| owner | string | | null | Human accountable |
| assignee | string | | null | Agent/human doing work (e.g., "agent:dorsey") |
| spec_id | ref | | null | Link to defining spec |
| epic_id | ref | | null | Link to epic |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

### Agent Execution Fields (Related Tables)

These fields support agent orchestration and are stored in separate tables for normalization.

#### Dependencies (`pmo_ticket_dependencies`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ticket_id | ref | ✓ | The blocked ticket |
| blocked_by_ticket_id | ref | ✓ | The blocking ticket |
| created_at | timestamp | auto | When dependency was created |

#### Affected Paths (`pmo_ticket_affected_paths`)

Scope hints for agent context injection. Tells agents which files/directories are relevant.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | integer | auto | - | Auto-increment ID |
| ticket_id | ref | ✓ | - | Parent ticket |
| path_pattern | string | ✓ | - | File path or glob (e.g., "src/lib/pmo/*.ts") |
| path_type | enum | | "file" | file, directory, glob |
| created_at | timestamp | auto | now | When added |

#### Acceptance Criteria (`pmo_ticket_acceptance_criteria`)

Structured, verifiable criteria separate from description markdown.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | ✓ | - | Criterion ID (e.g., "ac-1") |
| ticket_id | ref | ✓ | - | Parent ticket |
| criterion | string | ✓ | - | The acceptance criterion text |
| verifiable | boolean | | true | Can this be auto-verified? |
| verified | boolean | | false | Has it been verified? |
| verified_at | timestamp | | null | When verified |
| verified_by | string | | null | Who verified (e.g., "agent:dorsey", "human:chris", "test:unit") |
| position | integer | | 0 | Display order |

## Description Format

Ticket descriptions use structured markdown for agent-friendly execution:

```markdown
## What
[One sentence describing the concrete outcome]

## Done when
- [ ] First acceptance criterion
- [ ] Second acceptance criterion

## Context
[Where to look, patterns to follow, relevant files]

## Not in scope
[Explicit exclusions to prevent scope creep - optional]
```

### Section Guidelines

| Section | Purpose | Required |
|---------|---------|----------|
| What | Single sentence outcome - what success looks like | ✓ |
| Done when | Testable acceptance criteria as checklist | ✓ |
| Context | Files, patterns, hints to guide implementation | Optional |
| Not in scope | Explicit boundaries to prevent scope creep | Optional |

### Examples

**Good ticket:**
```markdown
## What
Add --json flag to ticket list command for piping to other tools.

## Done when
- [ ] `prlt ticket list --json` outputs valid JSON array
- [ ] JSON includes: id, title, status, assignee, column
- [ ] Empty list returns `[]`
- [ ] Works with existing filters (--status, --assignee)

## Context
See existing --json pattern in `prlt agent list` command.
Output should go to stdout without log styling.
```

**Too vague:**
```markdown
Improve the authentication system
```

**Too broad:**
```markdown
## What
Add user auth with OAuth, session management, and admin panel.

## Done when
- [ ] Users can log in
- [ ] Admin can manage users
- [ ] Sessions persist
```
(This should be 3+ separate tickets)

## Business Rules

### Core Rules
- **Title required**: Cannot create ticket without title
- **Auto-ID**: IDs generated as `TKT-XXX` (sequential, zero-padded)
- **Default column**: New tickets start in Backlog
- **Single epic**: A ticket belongs to at most one epic
- **Cascade delete**: Deleting ticket removes subtasks, metadata, dependencies, paths, and criteria
- **Owner vs Assignee**: Owner is accountable (human), Assignee does the work (agent or human)

### Status Lifecycle

Ticket status is determined by the project's workflow configuration. See [Workflow](workflow.md) for full details.

Status belongs to one of five fixed categories:
- **backlog**: Not yet scheduled
- **unstarted**: Scheduled but not started
- **started**: Actively being worked on
- **completed**: Finished successfully
- **canceled**: Won't be done

Typical transitions (actual statuses depend on project's configuration):
- Backlog status → Unstarted status (when scheduled/assigned)
- Unstarted status → Started status (when `prlt work start` is run)
- Started status → Completed status (when `prlt work ready` is run)
- Any → Canceled status (when ticket is abandoned)

### Dependency Rules
- **No self-dependency**: A ticket cannot depend on itself
- **No circular dependencies**: Dependency graph must be acyclic (DAG)
- **Dependencies block work**: Tickets with unresolved dependencies should remain in Planned until blockers are resolved
- **Scheduling**: Agent orchestrator should not start tickets with unresolved dependencies

### Acceptance Criteria Rules
- **Verification tracking**: Track who/what verified and when
- **Verifier types**: `human:name`, `agent:name`, `test:suite`, `ci:job`
- **Completion gate**: All criteria must be verified for ticket to be `done`

## Related Domains

- [Workflow](workflow.md) - Status configuration and state categories
- [Projects](projects.md) - Tickets belong to projects
- [Epics](epics.md) - Tickets can belong to epics (deprecated - use Projects)
- [Agents](agents.md) - Tickets can be assigned to agents
- [Board](board.md) - Tickets displayed on kanban board
