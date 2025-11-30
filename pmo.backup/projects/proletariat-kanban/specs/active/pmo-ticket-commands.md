---
title: PMO Ticket Commands Specification
created: 2024-11-28
tickets:
  - id: pmo-ticket-commands-001
    title: Implement prlt ticket list command
    description: Create command to list all tickets with filtering by column, priority, category, and assignee
    priority: HIGH
    category: feature
  - id: pmo-ticket-commands-002
    title: Implement prlt ticket view command
    description: Create command to view detailed ticket information including metadata, subtasks, and linked specs
    priority: HIGH
    category: feature
  - id: pmo-ticket-commands-003
    title: Implement prlt ticket bulk move command
    description: Multi-select tickets and move them to a different column
    priority: MEDIUM
    category: feature
  - id: pmo-ticket-commands-004
    title: Implement prlt ticket bulk delete command
    description: Multi-select tickets and delete them
    priority: MEDIUM
    category: feature
  - id: pmo-ticket-commands-005
    title: Implement prlt ticket bulk reassign command
    description: Multi-select tickets and reassign to different spec
    priority: MEDIUM
    category: feature
  - id: pmo-ticket-commands-006
    title: Implement prlt ticket bulk update command
    description: Multi-select tickets and update priority/category
    priority: LOW
    category: feature
---

# PMO Ticket Commands Specification

> **Note**: For architecture decisions, see [pmo-architecture.md](pmo-architecture.md)
> For work commands (assign, own, claim), see [pmo-work-commands.md](pmo-work-commands.md)

## Overview

Ticket commands handle CRUD operations on work items. Tickets are the fundamental unit of work in the PMO system.

**Core Concepts**:
- Tickets belong to exactly one project
- Tickets have metadata (priority, category, status, owner, assignee)
- Tickets can be linked to specs
- Tickets can have subtasks
- Tickets are positioned on a board in columns

## Command Overview

### Core Commands
| Command                           | Purpose                                | Status            |
| --------------------------------- | -------------------------------------- | ----------------- |
| `prlt ticket`                     | Interactive menu for ticket operations | ✅ Implemented     |
| `prlt ticket create [title]`      | Create new ticket                      | ✅ Implemented     |
| `prlt ticket list`                | List all tickets                       | ❌ Not Implemented |
| `prlt ticket view [id]`           | View ticket details                    | ❌ Not Implemented |
| `prlt ticket move [id] [column]`  | Move ticket to column                  | ✅ Implemented     |
| `prlt ticket delete [id]`         | Delete ticket                          | ✅ Implemented     |

### Bulk Commands
| Command                           | Purpose                                | Status            |
| --------------------------------- | -------------------------------------- | ----------------- |
| `prlt ticket bulk move`           | Move multiple tickets to column        | ❌ Not Implemented |
| `prlt ticket bulk delete`         | Delete multiple tickets                | ❌ Not Implemented |
| `prlt ticket bulk reassign`       | Reassign tickets to different spec     | ❌ Not Implemented |
| `prlt ticket bulk update`         | Update priority/category for multiple  | ❌ Not Implemented |

> **Note**: Work commands (assign, own, claim, execute) are in [pmo-work-commands.md](pmo-work-commands.md)

---

## Command Specifications

### `prlt ticket`
**Purpose**: Interactive menu for ticket operations

**Interactive Flow**:
```
🎫 Ticket Operations

? What would you like to do?
  ❯ Create new ticket
    List all tickets
    View ticket details
    Move ticket
    Delete ticket
    ────────────
    Bulk operations →
    ────────────
    Cancel
```

When selecting "Bulk operations →":
```
📋 Bulk Ticket Operations

? Select bulk operation:
  ❯ Move tickets (change column)
    Delete tickets
    Reassign tickets (change spec)
    Update tickets (priority/category/assignee)
    ────────────
    ← Back
    Cancel
```

**Behavior**:
- Shows all available ticket operations
- Arrow keys to navigate
- Enter to select
- Runs selected command
- Bulk operations submenu provides multi-select interfaces
- Returns to menu after command completes (optional)

---

### `prlt ticket create [title]`
**Purpose**: Create new ticket with specification

**Arguments**:
- `title` (optional): Ticket title (prompts if not provided)

**Options**:
- `--project, -p <id>`: Project to create ticket in
- `--title, -t <title>`: Ticket title
- `--description, -d <desc>`: Ticket description
- `--priority <priority>`: Priority (high, medium, low)
- `--column <column>`: Initial column (default: Backlog)
- `--assignee <assignee>`: Assign to user/agent

**Interactive Flow** (if title not provided):
```
? Ticket title: Add login screen
? Description: Implement user authentication UI
? Priority: ❯ High   Medium   Low
? Assign to: ❯ Unassigned   alice   bob

✅ Created ticket TICK-007
   Title: Add login screen
   Project: mobile-app
   Column: Backlog
   Priority: high

   View board: prlt board view
```

**Output**:
- Creates ticket in SQLite
- Exports to board.md
- Auto-generates ticket ID (TICK-NNN)
- Returns ticket ID

---

### `prlt ticket list` (Not Implemented)
**Purpose**: List all tickets with filtering

**Proposed Options**:
- `--project, -p <id>`: Filter by project
- `--status <status>`: Filter by status/column
- `--assignee <assignee>`: Filter by assignee
- `--priority <priority>`: Filter by priority
- `--format <format>`: Output format (table, json, markdown)

**Proposed Output**:
```
🎫 Tickets (6 total)

ID         Title                    Project      Status        Assignee   Priority
─────────  ───────────────────────  ───────────  ────────────  ─────────  ────────
TICK-001   Add login screen         mobile-app   Backlog       -          high
TICK-002   Setup CI/CD              mobile-app   Backlog       -          medium
TICK-003   Implement navigation     mobile-app   In Progress   alice      high
TICK-004   Project setup            mobile-app   Done          bob        high
TICK-005   Configure linting        mobile-app   Done          alice      low
TICK-006   Add README               mobile-app   Done          bob        low
```

---

### `prlt ticket view [id]` (Not Implemented)
**Purpose**: View detailed ticket information

**Arguments**:
- `id` (optional): Ticket ID to view - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to view:
  ❯ TICK-001 - Add login screen (Backlog)
    TICK-002 - Setup CI/CD (Backlog)
    TICK-003 - Implement navigation (In Progress)

📄 Ticket TICK-001

Title:       Add login screen
Project:     mobile-app
Status:      Backlog
Priority:    high
Assignee:    unassigned
Created:     2024-11-26 10:30:00
Updated:     2024-11-26 10:30:00

Description:
  Implement user authentication UI with email/password login.
  Should include "forgot password" link.

Subtasks:
  ☐ Design login form
  ☐ Add form validation
  ☐ Implement auth API calls
  ☐ Add loading states
```

**Example**:
```bash
prlt ticket view TICK-001
prlt ticket view  # Interactive mode
```

**Behavior**:
- If no argument provided, shows interactive dropdown

---

### `prlt ticket move [id] [column]`
**Purpose**: Move ticket to different column

**Arguments**:
- `id` (optional): Ticket ID (e.g., TICK-001) - prompts with dropdown if not provided
- `column` (optional): Target column name - prompts with dropdown if not provided

**Interactive Flow** (if arguments not provided):
```
? Select ticket to move:
  ❯ TICK-001 - Add login screen (Backlog)
    TICK-002 - Setup CI/CD (Backlog)
    TICK-003 - Implement navigation (In Progress)

? Move to column:
  ❯ Backlog
    In Progress (current)
    Review
    Done

✅ Moved TICK-001 to In Progress
   Title: Add login screen
   Board updated
```

**Note**: Column names are sourced from the database for accuracy, not from config.json

**Example**:
```bash
prlt ticket move TICK-001 "In Progress"
prlt ticket move  # Interactive mode
```

**Output**:
```
✅ Moved TICK-001 to In Progress
   Title: Add login screen
   Board updated
```

**Behavior**:
- If no arguments provided, shows interactive dropdowns
- Updates ticket column in SQLite
- Exports to board.md
- Validates column exists
- Updates timestamps

---

### `prlt ticket delete [id]`
**Purpose**: Delete ticket permanently

**Arguments**:
- `id` (optional): Ticket ID to delete - prompts with dropdown if not provided

**Options**:
- `--force, -f`: Skip confirmation prompt

**Interactive Flow** (if id not provided):
```
? Select ticket to delete:
  ❯ TICK-001 - Add login screen (Backlog)
    TICK-002 - Setup CI/CD (Backlog)
    TICK-003 - Implement navigation (In Progress)

Delete ticket TICK-001?
  Title: Add login screen
  Project: mobile-app
  Status: Backlog

? Are you sure?
  ❯ No, cancel
    Yes, delete

✅ Ticket TICK-001 deleted
   Removed from database and board
```

**Example**:
```bash
prlt ticket delete TICK-001
prlt ticket delete  # Interactive mode
```

**Output**:
```
✅ Ticket TICK-001 deleted
   Removed from database and board
```

**Behavior**:
- If no argument provided, shows interactive dropdown
- Removes from SQLite
- Removes from board.md
- No archive (permanent deletion)
- Requires confirmation unless --force

---

## Design Principles

### Interactive Defaults
- All commands prompt for missing arguments
- Dropdowns with arrow key navigation
- No typing required for common operations
- Safe defaults for destructive operations

### Ticket Lifecycle
- Tickets start in Backlog by default
- Can be moved between columns (workflow states)
- Status field tracks lifecycle (backlog, ready, in_progress, blocked, review, done, cancelled)
- Column position is separate from status

### Data Integrity
- Auto-generated ticket IDs (sequential)
- Timestamps tracked (created_at, updated_at)
- Sync timestamps (last_synced_from_spec, last_synced_from_board)
- Foreign key constraints (project_id, spec_id)

---

## Future Enhancements

### Batch Operations
```bash
prlt ticket move TICK-001,TICK-002,TICK-003 "In Progress"
prlt ticket delete TICK-001,TICK-002 --force
```

### Ticket Templates
```bash
prlt ticket create --template bug-report
prlt ticket create --template feature-request
```

### Advanced Filtering
```bash
prlt ticket list --priority high --status "In Progress"
prlt ticket list --assignee alice --column Backlog
```

### Subtask Management
```bash
prlt ticket subtask add TICK-001 "Design login form"
prlt ticket subtask complete TICK-001 1
prlt ticket subtask list TICK-001
```

---

## Bulk Operations

### `prlt ticket bulk move`
**Purpose**: Move multiple tickets to a different column

**Interactive Flow**:
```
📋 Bulk Move Tickets

? Select tickets to move: (Use space to select, enter to confirm)
  ❯ ◯ pmo-tickets-001  Add login screen              [Backlog]       P:high
    ◯ pmo-tickets-002  Setup CI/CD                    [Backlog]       P:medium
    ◉ pmo-tickets-003  Implement navigation           [In Progress]   P:high
    ◯ pmo-tickets-004  Project setup                  [Done]          P:high
    ◉ pmo-tickets-005  Configure linting              [Done]          P:low

Selected 2 tickets

? Move to which column?
  ❯ Backlog
    Ready
    In Progress
    In Review
    Done

🔄 Moving 2 tickets to "Ready"...

✅ Moved 2 tickets to "Ready"
```

**Options**:
- `--project, -p <id>`: Target project (default: current)
- `--from <column>`: Filter tickets by source column
- `--priority <priority>`: Filter by priority
- `--assignee <assignee>`: Filter by assignee

**Behavior**:
- Multi-select checkbox interface
- Shows current column and priority for each ticket
- Preserves ticket order within new column
- Updates board.md automatically

---

### `prlt ticket bulk delete`
**Purpose**: Delete multiple tickets

**Interactive Flow**:
```
📋 Bulk Delete Tickets

? Select tickets to delete: (Use space to select, enter to confirm)
  ❯ ◯ pmo-tickets-001  Add login screen              [Backlog]       P:high
    ◯ pmo-tickets-002  Setup CI/CD                    [Backlog]       P:medium
    ◉ pmo-tickets-003  Old feature (cancelled)        [Dropped]       P:low
    ◉ pmo-tickets-004  Duplicate ticket               [Dropped]       P:low

Selected 2 tickets

⚠️  You are about to delete 2 tickets. This cannot be undone.

? Are you sure?
  ❯ Yes, delete tickets
    No, cancel

🗑️  Deleting 2 tickets...

✅ Deleted 2 tickets
```

**Options**:
- `--project, -p <id>`: Target project (default: current)
- `--column <column>`: Filter by column (e.g., "Dropped")
- `--force, -f`: Skip confirmation prompt

**Behavior**:
- Multi-select checkbox interface
- Shows warning before deletion
- Requires confirmation unless `--force` used
- Removes from database and board.md
- Cascade deletes subtasks and metadata

---

### `prlt ticket bulk reassign`
**Purpose**: Reassign multiple tickets to a different spec

**Interactive Flow**:
```
📋 Bulk Reassign Tickets to Different Spec

? Select tickets to reassign:
  ❯ ◯ pmo-tickets-001  Add login screen              Spec: auth-system
    ◉ pmo-tickets-002  Add logout                     Spec: auth-system
    ◉ pmo-tickets-003  Password reset                 Spec: auth-system
    ◯ pmo-tickets-004  User profile                   Spec: user-management

Selected 2 tickets

? Reassign to which spec?
  ❯ auth-system (current)
    user-management
    api-design
    deployment

📝 Reassigning 2 tickets to "user-management"...

✅ Reassigned 2 tickets to "user-management"
```

**Options**:
- `--project, -p <id>`: Target project (default: current)
- `--from-spec <spec>`: Filter tickets by current spec
- `--to-spec <spec>`: Target spec (skip interactive prompt)

**Behavior**:
- Multi-select checkbox interface
- Shows current spec for each ticket
- Updates ticket.spec_id in database
- Updates spec wikilink in board.md
- Preserves all other ticket metadata

---

### `prlt ticket bulk update`
**Purpose**: Update priority/category for multiple tickets

**Interactive Flow**:
```
📋 Bulk Update Tickets

? Select tickets to update:
  ❯ ◉ pmo-tickets-001  Add login screen              P:medium  C:feature
    ◉ pmo-tickets-002  Setup CI/CD                    P:medium  C:infra
    ◯ pmo-tickets-003  Implement navigation           P:high    C:feature

Selected 2 tickets

? What to update?
  ❯ Priority
    Category
    Both

? Set priority to:
  ❯ HIGH
    MEDIUM
    LOW
    (Keep existing)

🔄 Updating 2 tickets...

✅ Updated priority for 2 tickets
```

**Options**:
- `--project, -p <id>`: Target project (default: current)
- `--priority <priority>`: Set priority (skip interactive prompt)
- `--category <category>`: Set category (skip interactive prompt)
- `--assignee <assignee>`: Set assignee (skip interactive prompt)
- `--owner <owner>`: Set owner (skip interactive prompt)

**Behavior**:
- Multi-select checkbox interface
- Shows current values for each ticket
- Can update one or multiple fields
- Updates database and board.md
- Preserves other ticket metadata

---

## Bulk Operations Design Principles

### Multi-Select Interface
All bulk commands use inquirer's checkbox interface:
- Spacebar to toggle selection
- Arrow keys to navigate
- Enter to confirm selection
- Shows current state (column, priority, etc.)

### Safety and Confirmation
- Destructive operations (delete) require confirmation
- Shows preview of what will be changed
- `--force` flag to skip confirmations (for scripts)
- Clear success/error messages

### Filtering Support
All bulk commands support filtering to narrow down ticket selection:
- By column (e.g., only show "Dropped" tickets)
- By priority (e.g., only show "LOW" priority)
- By assignee (e.g., only show unassigned)
- By spec (e.g., only show tickets from specific spec)

### Database Transactions
All bulk operations should use SQLite transactions for atomicity:
```typescript
storage.db.transaction(() => {
  for (const ticket of selectedTickets) {
    // Perform operation
  }
})();
```
