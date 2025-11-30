---
title: PMO Board Views & Filtering Specification
created: 2024-11-29
tickets:
  - id: pmo-board-views-001
    title: Add assignee filter to board view
    description: Filter board by assignee with --assignee flag
    priority: MEDIUM
    category: feature
  - id: pmo-board-views-002
    title: Add priority filter to board view
    description: Filter board by priority with --priority flag
    priority: MEDIUM
    category: feature
  - id: pmo-board-views-003
    title: Add column filter to board view
    description: Show only specific columns with --column flag
    priority: LOW
    category: feature
  - id: pmo-board-views-004
    title: Add status filter to board view
    description: Filter by ticket status (backlog, in_progress, etc)
    priority: LOW
    category: feature
  - id: pmo-board-views-005
    title: Add combined filters support
    description: Allow multiple filters at once (e.g., --assignee alice --priority HIGH)
    priority: MEDIUM
    category: feature
  - id: pmo-board-views-006
    title: Implement board grouping by assignee
    description: Group tickets by assignee instead of column
    priority: LOW
    category: feature
  - id: pmo-board-views-007
    title: Implement board grouping by priority
    description: Group tickets by priority level
    priority: LOW
    category: feature
  - id: pmo-board-views-008
    title: Add board sorting options
    description: Sort tickets within columns by updated, created, priority
    priority: LOW
    category: feature
---

# PMO Board Views & Filtering Specification

## Overview

Board views and filtering allow users to focus on specific subsets of tickets and visualize them in different ways. This is essential for:
- Viewing only your assigned tickets
- Focusing on high-priority work
- Seeing work grouped by different dimensions
- Customizing board layouts for different workflows

## Command Overview

| Command                              | Purpose                                | Status            |
| ------------------------------------ | -------------------------------------- | ----------------- |
| `prlt board view --assignee <name>`  | Filter by assignee                     | ❌ Not Implemented |
| `prlt board view --priority <level>` | Filter by priority                     | ❌ Not Implemented |
| `prlt board view --column <name>`    | Show only specific columns             | ❌ Not Implemented |
| `prlt board view --status <status>`  | Filter by lifecycle status             | ❌ Not Implemented |
| `prlt board view --group-by <field>` | Group tickets by field                 | ❌ Not Implemented |
| `prlt board view --sort-by <field>`  | Sort tickets within columns            | ❌ Not Implemented |

---

## Filtering

### By Assignee

**Command**: `prlt board view --assignee <name>`

**Purpose**: Show only tickets assigned to a specific person or agent

**Examples**:
```bash
prlt board view --assignee alice
prlt board view --assignee agent:developer
prlt board view --assignee unassigned
```

**Output**:
```
📋 Mobile App Board (filtered: assignee=alice)

## 📥 Backlog (1)
  pmo-tickets-001  Add login screen          @alice  P:high

## 🚧 In Progress (2)
  pmo-tickets-003  Implement navigation       @alice  P:high
  pmo-tickets-007  Add forms                  @alice  P:medium

## ✅ Done (3)
  pmo-tickets-005  Configure linting          @alice  P:low
  pmo-tickets-009  Add tests                  @alice  P:medium
  pmo-tickets-012  Documentation              @alice  P:low

─────────────────────
Showing 6 of 20 total tickets
```

**Behavior**:
- Shows only tickets where `assignee` matches the given name
- Empty columns are hidden
- Shows count of filtered vs total tickets
- Special value `unassigned` shows tickets with no assignee

---

### By Priority

**Command**: `prlt board view --priority <level>`

**Purpose**: Show only tickets of a specific priority level

**Examples**:
```bash
prlt board view --priority HIGH
prlt board view --priority MEDIUM
prlt board view --priority LOW
```

**Output**:
```
📋 Mobile App Board (filtered: priority=HIGH)

## 📥 Backlog (2)
  pmo-tickets-001  Add login screen          @alice  P:high
  pmo-tickets-002  Setup CI/CD                @bob    P:high

## 🚧 In Progress (1)
  pmo-tickets-003  Implement navigation       @alice  P:high

─────────────────────
Showing 3 of 20 total tickets
```

**Behavior**:
- Shows only tickets matching the priority level
- Priority is case-insensitive (high, HIGH, High all work)
- Empty columns are hidden

---

### By Column

**Command**: `prlt board view --column <name>`

**Purpose**: Show only specific column(s)

**Examples**:
```bash
prlt board view --column "In Progress"
prlt board view --column Backlog --column Ready
```

**Output**:
```
📋 Mobile App Board (showing: In Progress)

## 🚧 In Progress (3)
  pmo-tickets-003  Implement navigation       @alice  P:high
  pmo-tickets-008  Add authentication         @bob    P:high
  pmo-tickets-011  Setup database             @charlie P:medium

─────────────────────
Showing 3 tickets
```

**Behavior**:
- Shows only the specified column(s)
- Can specify multiple columns
- Useful for focusing on active work

---

### By Status

**Command**: `prlt board view --status <status>`

**Purpose**: Filter by lifecycle status (separate from board column)

**Examples**:
```bash
prlt board view --status in_progress
prlt board view --status blocked
prlt board view --status review
```

**Valid Status Values**:
- `backlog` - Not started
- `ready` - Ready to start
- `in_progress` - Being worked on
- `blocked` - Can't proceed
- `review` - Needs review
- `done` - Completed
- `cancelled` - Won't do

**Output**:
```
📋 Mobile App Board (filtered: status=blocked)

## 🚧 In Progress (2)
  pmo-tickets-015  API integration            @alice  P:high   [BLOCKED]
  pmo-tickets-019  Database migration         @bob    P:medium [BLOCKED]

─────────────────────
Showing 2 blocked tickets
```

**Behavior**:
- Filters by the `status` field, not the board column
- Tickets can have status `blocked` while in "In Progress" column
- Shows status badge in output

---

### Combined Filters

**Command**: `prlt board view --assignee <name> --priority <level> --status <status>`

**Purpose**: Apply multiple filters simultaneously

**Examples**:
```bash
prlt board view --assignee alice --priority HIGH
prlt board view --priority HIGH --status in_progress
prlt board view --assignee unassigned --column Backlog
```

**Output**:
```
📋 Mobile App Board (filtered: assignee=alice, priority=HIGH)

## 📥 Backlog (1)
  pmo-tickets-001  Add login screen          @alice  P:high

## 🚧 In Progress (1)
  pmo-tickets-003  Implement navigation       @alice  P:high

─────────────────────
Showing 2 of 20 total tickets
```

**Behavior**:
- All filters are AND'ed together
- Useful for finding specific subsets (e.g., "my high priority tasks")
- Shows all active filters in header

---

## Grouping

### By Assignee

**Command**: `prlt board view --group-by assignee`

**Purpose**: Group tickets by who they're assigned to instead of by column

**Output**:
```
📋 Mobile App Board (grouped by: assignee)

## 👤 alice (5 tickets)
  pmo-tickets-001  Add login screen          [Backlog]       P:high
  pmo-tickets-003  Implement navigation       [In Progress]   P:high
  pmo-tickets-007  Add forms                  [In Progress]   P:medium
  pmo-tickets-005  Configure linting          [Done]          P:low
  pmo-tickets-009  Add tests                  [Done]          P:medium

## 👤 bob (3 tickets)
  pmo-tickets-002  Setup CI/CD                [Backlog]       P:high
  pmo-tickets-008  Add authentication         [In Progress]   P:high
  pmo-tickets-004  Project setup              [Done]          P:high

## 👤 unassigned (2 tickets)
  pmo-tickets-012  Documentation              [Backlog]       P:low
  pmo-tickets-015  API docs                   [Backlog]       P:low

─────────────────────
Summary: 10 tickets | 3 assignees
```

**Behavior**:
- Organizes tickets by assignee
- Shows column in ticket details
- Useful for workload distribution
- `unassigned` group shows tickets needing assignment

---

### By Priority

**Command**: `prlt board view --group-by priority`

**Purpose**: Group tickets by priority level

**Output**:
```
📋 Mobile App Board (grouped by: priority)

## 🔴 HIGH (4 tickets)
  pmo-tickets-001  Add login screen          [Backlog]       @alice
  pmo-tickets-002  Setup CI/CD                [Backlog]       @bob
  pmo-tickets-003  Implement navigation       [In Progress]   @alice
  pmo-tickets-008  Add authentication         [In Progress]   @bob

## 🟡 MEDIUM (3 tickets)
  pmo-tickets-007  Add forms                  [In Progress]   @alice
  pmo-tickets-009  Add tests                  [Done]          @alice
  pmo-tickets-011  Setup database             [In Progress]   @charlie

## 🟢 LOW (3 tickets)
  pmo-tickets-005  Configure linting          [Done]          @alice
  pmo-tickets-012  Documentation              [Backlog]       @unassigned
  pmo-tickets-015  API docs                   [Backlog]       @unassigned

─────────────────────
Summary: 10 tickets | HIGH: 4, MEDIUM: 3, LOW: 3
```

**Behavior**:
- Organizes by priority level
- Color-coded priorities (🔴 HIGH, 🟡 MEDIUM, 🟢 LOW)
- Shows column and assignee in details
- Useful for prioritization planning

---

## Sorting

### Within Columns

**Command**: `prlt board view --sort-by <field>`

**Purpose**: Change the order of tickets within each column

**Sort Fields**:
- `updated` - Most recently updated first (default)
- `created` - Newest tickets first
- `priority` - Highest priority first
- `title` - Alphabetical by title
- `assignee` - Alphabetical by assignee name

**Examples**:
```bash
prlt board view --sort-by priority
prlt board view --sort-by created
prlt board view --sort-by assignee
```

**Output (sorted by priority)**:
```
📋 Mobile App Board (sorted by: priority)

## 📥 Backlog
  pmo-tickets-001  Add login screen          @alice  P:high
  pmo-tickets-002  Setup CI/CD                @bob    P:high
  pmo-tickets-007  Add forms                  @alice  P:medium
  pmo-tickets-012  Documentation              @bob    P:low

## 🚧 In Progress
  pmo-tickets-003  Implement navigation       @alice  P:high
  pmo-tickets-008  Add authentication         @bob    P:high
  pmo-tickets-011  Setup database             @charlie P:medium
```

**Behavior**:
- Sorts within each column
- Column order stays the same
- Can combine with filters
- Useful for focusing on most important work first

---

## Design Principles

### Progressive Filtering
- Start with full board view
- Add filters to narrow down
- Combine multiple filters for precision
- Clear indication of what's filtered

### Empty State Handling
- Hide empty columns when filtering
- Show "No tickets match filters" if nothing found
- Suggest removing filters if results are empty

### Filter Persistence
- Filters are per-command, not saved
- Future: Save custom views (e.g., `prlt board view --preset my-work`)

### Performance
- Filtering happens at database query level
- Efficient even with thousands of tickets
- No need to load all tickets first

---

## Implementation Notes

### Database Queries

Filters translate to SQL WHERE clauses:

```typescript
// Filter by assignee
WHERE assignee = 'alice'

// Filter by priority
WHERE priority = 'HIGH'

// Combined filters
WHERE assignee = 'alice' AND priority = 'HIGH' AND status = 'in_progress'

// Group by assignee
SELECT assignee, COUNT(*) as count, ...
FROM pmo_tickets
GROUP BY assignee
ORDER BY assignee
```

### CLI Interface

All filters are optional flags on `prlt board view`:

```typescript
static flags = {
  assignee: Flags.string({ description: 'Filter by assignee' }),
  priority: Flags.string({ description: 'Filter by priority' }),
  column: Flags.string({ description: 'Show only specific column', multiple: true }),
  status: Flags.string({ description: 'Filter by status' }),
  'group-by': Flags.string({ description: 'Group tickets by field (assignee, priority)' }),
  'sort-by': Flags.string({ description: 'Sort tickets by field (updated, created, priority)' }),
}
```

---

## Future Enhancements

### Saved Views
```bash
prlt board view --save my-work --assignee alice --priority HIGH
prlt board view --preset my-work
```

### Custom Filters
```bash
prlt board view --where "created_at > '2024-11-01'"
prlt board view --search "login"
```

### View Templates
```bash
prlt board view --template sprint-planning
prlt board view --template release-checklist
```

### Export Filtered Views
```bash
prlt board view --assignee alice --format json > my-work.json
prlt board view --priority HIGH --format csv > high-priority.csv
```
