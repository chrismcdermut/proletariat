---
title: Tickets
domain: tickets
---

# Tickets

## Overview

Tickets are the fundamental unit of work in the PMO system. They represent individual tasks that can be tracked on a kanban board, assigned to agents or humans, and linked to epics.

## Abilities

### Create ticket

Create a new ticket with title and optional metadata.

| Modality | Signature |
|----------|-----------|
| storage | `createTicket()` |
| cli | `prlt ticket create` |
| api | `POST /api/tickets` |
| web | `CreateTicketModal` |
| obsidian | `new markdown file` |

### List tickets

List all tickets with optional filtering by status, priority, column, etc.

| Modality | Signature |
|----------|-----------|
| storage | `listTickets()` |
| cli | `prlt ticket list` |
| api | `GET /api/tickets` |
| web | `TicketList` |
| obsidian | `board.md` |

### View ticket

View a single ticket's details including subtasks and metadata.

| Modality | Signature |
|----------|-----------|
| storage | `getTicket()` |
| cli | `prlt ticket view` |
| api | `GET /api/tickets/:id` |
| web | `/tickets/:id` |
| obsidian | `TKT-001.md` |

### Update ticket

Update ticket fields like title, description, priority, status.

| Modality | Signature |
|----------|-----------|
| storage | `updateTicket()` |
| cli | `prlt ticket edit` |
| api | `PATCH /api/tickets/:id` |
| web | `EditTicketModal` |
| obsidian | `edit frontmatter` |

### Move ticket

Move a ticket to a different column on the board.

| Modality | Signature |
|----------|-----------|
| storage | `moveTicket()` |
| cli | `prlt ticket move` |
| api | `PATCH /api/tickets/:id` |
| web | `DragDrop` |
| obsidian | `move in board.md` |

### Delete ticket

Delete a ticket and its associated subtasks and metadata.

| Modality | Signature |
|----------|-----------|
| storage | `deleteTicket()` |
| cli | `prlt ticket delete` |
| api | `DELETE /api/tickets/:id` |
| web | `DeleteButton` |
| obsidian | `delete file` |

### Link to epic

Associate a ticket with an epic for grouping related work.

| Modality | Signature |
|----------|-----------|
| storage | `updateTicket()` |
| cli | `prlt ticket link` |
| api | `PATCH /api/tickets/:id` |
| web | `EpicDropdown` |
| obsidian | `epic_id frontmatter` |

### Search tickets

Search tickets by title or description text.

| Modality | Signature |
|----------|-----------|
| storage | `listTickets()` |
| cli | `prlt ticket list --search` |
| api | `GET /api/tickets?q=` |
| web | `SearchBar` |
| obsidian | `Obsidian search` |

### Filter by column

Filter tickets to only those in a specific board column.

| Modality | Signature |
|----------|-----------|
| storage | `listTickets()` |
| cli | `prlt ticket list --column` |
| api | `GET /api/tickets?column=` |
| web | `ColumnTabs` |
| obsidian | `board sections` |

### Filter by priority

Filter tickets by priority level.

| Modality | Signature |
|----------|-----------|
| storage | `listTickets()` |
| cli | `prlt ticket list --priority` |
| api | `GET /api/tickets?priority=` |
| web | `FilterDropdown` |
| obsidian | `dataview query` |

### Bulk move

Move multiple tickets at once to a new column.

| Modality | Signature |
|----------|-----------|
| storage | `moveTickets()` |
| cli | `prlt tickets move` |
| api | `POST /api/tickets/bulk` |
| web | `BulkActions` |

### Bulk delete

Delete multiple tickets at once.

| Modality | Signature |
|----------|-----------|
| storage | `deleteTickets()` |
| cli | `prlt tickets delete` |
| api | `POST /api/tickets/bulk` |
| web | `BulkActions` |

### Bulk update

Update multiple tickets at once with the same changes.

| Modality | Signature |
|----------|-----------|
| storage | `updateTickets()` |
| cli | `prlt tickets update` |
| api | `POST /api/tickets/bulk` |
| web | `BulkActions` |

### Add dependency

Add a blocking dependency between tickets (ticket A blocked by ticket B).

| Modality | Signature |
|----------|-----------|
| storage | `addTicketDependency()` |
| cli | `prlt ticket block [id] --by [blocker-id]` |
| api | `POST /api/tickets/:id/dependencies` |
| web | `DependencyPicker` |

### Remove dependency

Remove a blocking dependency between tickets.

| Modality | Signature |
|----------|-----------|
| storage | `removeTicketDependency()` |
| cli | `prlt ticket unblock [id] --from [blocker-id]` |
| api | `DELETE /api/tickets/:id/dependencies/:blockerId` |
| web | `DependencyList` |

### List dependencies

Get tickets that block or are blocked by a given ticket.

| Modality | Signature |
|----------|-----------|
| storage | `getTicketDependencies()` |
| cli | `prlt ticket deps [id]` |
| api | `GET /api/tickets/:id/dependencies` |
| web | `DependencyGraph` |

### Add affected path

Add a file/directory scope hint to a ticket for agent context.

| Modality | Signature |
|----------|-----------|
| storage | `addTicketAffectedPath()` |
| cli | `prlt ticket scope [id] --path [pattern]` |
| api | `POST /api/tickets/:id/paths` |
| web | `PathPicker` |

### Remove affected path

Remove a scope hint from a ticket.

| Modality | Signature |
|----------|-----------|
| storage | `removeTicketAffectedPath()` |
| cli | `prlt ticket unscope [id] --path [pattern]` |
| api | `DELETE /api/tickets/:id/paths/:pathId` |
| web | `PathList` |

### Add acceptance criterion

Add a structured acceptance criterion to a ticket.

| Modality | Signature |
|----------|-----------|
| storage | `addAcceptanceCriterion()` |
| cli | `prlt ticket criteria add [id] [text]` |
| api | `POST /api/tickets/:id/criteria` |
| web | `CriteriaEditor` |

### Verify acceptance criterion

Mark an acceptance criterion as verified.

| Modality | Signature |
|----------|-----------|
| storage | `verifyAcceptanceCriterion()` |
| cli | `prlt ticket criteria verify [id] [criterion-id]` |
| api | `PATCH /api/tickets/:id/criteria/:criterionId` |
| web | `CriteriaCheckbox` |

### Remove acceptance criterion

Remove an acceptance criterion from a ticket.

| Modality | Signature |
|----------|-----------|
| storage | `removeAcceptanceCriterion()` |
| cli | `prlt ticket criteria remove [id] [criterion-id]` |
| api | `DELETE /api/tickets/:id/criteria/:criterionId` |
| web | `CriteriaList` |

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
| status | enum | | backlog | backlog, ready, in_progress, blocked, review, done, cancelled |
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

### Dependency Rules
- **No self-dependency**: A ticket cannot depend on itself
- **No circular dependencies**: Dependency graph must be acyclic (DAG)
- **Blocked status**: Tickets with unresolved dependencies should be marked `blocked`
- **Scheduling**: Agent orchestrator should not start tickets with unresolved dependencies

### Acceptance Criteria Rules
- **Verification tracking**: Track who/what verified and when
- **Verifier types**: `human:name`, `agent:name`, `test:suite`, `ci:job`
- **Completion gate**: All criteria must be verified for ticket to be `done`

## Related Domains

- [Epics](epics.md) - Tickets belong to epics
- [Agents](agents.md) - Tickets can be assigned to agents
- [Board](board.md) - Tickets displayed on kanban board
