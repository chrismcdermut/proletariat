---
title: Workflow
domain: workflow
---

# Workflow

## Overview

Workflow defines how tickets move through states from creation to completion. The system uses a two-tier model inspired by Linear: fixed **state categories** with customizable **statuses** within each category. Each project has its own status configuration, typically seeded from a template.

## Concepts

### State Categories

Five fixed categories that cannot be added, removed, or reordered:

| Category | Meaning | Position |
|----------|---------|----------|
| backlog | Not yet scheduled for work | 0 |
| unstarted | Scheduled but work hasn't begun | 1 |
| started | Work is actively in progress | 2 |
| completed | Work finished successfully | 3 |
| canceled | Work won't be done | 4 |

Categories provide semantic meaning for:
- Filtering ("show all started work")
- Metrics ("what % is completed?")
- Automations ("when moved to any completed status, close PR")
- Board ordering (backlog columns always before started columns)

### Statuses

Customizable values within each category. Each status:
- Belongs to exactly one category
- Has a position (order) within its category
- Has a globally unique name within the project
- Can have a color and description

Example configuration:
```
category=backlog     │ Backlog (pos=0), Icebox (pos=1)
category=unstarted   │ Ready (pos=0)
category=started     │ In Progress (pos=0), In Review (pos=1)
category=completed   │ Done (pos=0)
category=canceled    │ Canceled (pos=0), Duplicate (pos=1)
```

### Templates

Templates are preset status configurations. When creating a project, selecting a template copies its statuses to the project.

Built-in templates:

**kanban** (default)
```
backlog:    Backlog
unstarted:  Ready
started:    In Progress
completed:  Done
canceled:   Canceled
```

**linear**
```
backlog:    Backlog, Triage
unstarted:  Todo
started:    In Progress, In Review
completed:  Done
canceled:   Canceled, Duplicate
```

**bug-smash**
```
backlog:    Triage
unstarted:  Confirmed
started:    Reproducing, Fixing, Verifying
completed:  Resolved
canceled:   Won't Fix, Duplicate
```

**5-tool-founder**
```
backlog:    SHIP BL, GROW BL, SUPPORT BL, BIZOPS BL, STRATEGY BL
unstarted:  Planned
started:    In Progress
completed:  Done
canceled:   Dropped
```

**gtm**
```
backlog:    Leads
unstarted:  Qualified
started:    Proposal, Negotiation
completed:  Closed Won
canceled:   Closed Lost
```

### Project Lifecycle

Projects themselves have a fixed status (not customizable):

| Status | Meaning |
|--------|---------|
| draft | Planning phase, not yet active |
| active | Work is happening |
| completed | Project finished |
| archived | Soft-deleted, hidden from default views |

This is separate from the ticket status configuration.

## Abilities

### Status Management

| Ability | Description | storage | cli |
|---------|-------------|---------|-----|
| List statuses | List all statuses for a project | `listStatuses()` | `prlt status list` |
| Create status | Add a new status to a category | `createStatus()` | `prlt status create` |
| Update status | Change name, color, description, or position | `updateStatus()` | `prlt status update` |
| Delete status | Remove a status (must reassign tickets first) | `deleteStatus()` | `prlt status delete` |
| Reorder status | Change position within category | `reorderStatus()` | `prlt status move` |

### Template Management

| Ability | Description | storage | cli |
|---------|-------------|---------|-----|
| List templates | List available templates | `listTemplates()` | `prlt template list` |
| Apply template | Apply a template to a project (replaces statuses) | `applyTemplate()` | `prlt template apply` |
| Save as template | Save project's status config as custom template | `saveTemplate()` | `prlt template save` |

## Data Model

### StateCategory (enum)

```typescript
type StateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
```

Fixed, not stored in database.

### Status

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | UUID or slug |
| project_id | ref | required | - | Parent project |
| name | string | required | - | Display name (unique within project) |
| category | enum | required | - | StateCategory this belongs to |
| position | number | auto | - | Order within category (0-indexed) |
| color | string | | null | Hex color for UI |
| description | string | | null | Tooltip/help text |
| is_default | boolean | | false | Default status for new tickets |
| created_at | timestamp | auto | now | Creation time |

### Template

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | Template identifier (slug) |
| name | string | required | - | Display name |
| description | string | | null | What this template is for |
| is_builtin | boolean | | false | System-provided vs user-created |
| statuses | json | required | - | Array of {name, category, position, color} |
| created_at | timestamp | auto | now | Creation time |

### ProjectStatus (enum)

```typescript
type ProjectStatus = 'draft' | 'active' | 'completed' | 'archived'
```

Fixed lifecycle for projects themselves.

## Business Rules

### Status Rules
- **Unique names**: Status names must be unique within a project (globally, not just within category)
- **Ordered within category**: Statuses have a position within their category
- **Category immutable**: Cannot change a status's category after creation (delete and recreate)
- **One default**: Exactly one status should be marked as default (typically first backlog status)
- **No orphan tickets**: Cannot delete a status that has tickets; must reassign first

### Category Rules
- **Fixed set**: Cannot add, remove, or reorder categories
- **Fixed order**: backlog < unstarted < started < completed < canceled
- **At least one**: Each project must have at least one status in each category (enforced on template application)

### Template Rules
- **Copy on apply**: Applying a template copies statuses, doesn't reference them
- **Builtin immutable**: Cannot modify built-in templates
- **Custom templates**: Users can save their project's config as a new template

### Board Integration
- Board columns = statuses (one column per status)
- Column order follows: all backlog statuses (by position), then unstarted, then started, etc.
- Moving a ticket to a column updates its status

## Related Domains

- [Tickets](tickets.md) - Tickets have a status from the project's configuration
- [Board](board.md) - Board columns map to statuses
- [Projects](projects.md) - Projects own status configurations and have their own lifecycle
