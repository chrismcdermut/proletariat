# Ticket Commands Specification

## Overview

Ticket commands handle CRUD operations on work items. Tickets are the fundamental unit of work in the PMO system.

**Core Concepts**:
- Tickets belong to exactly one project
- Tickets have metadata (priority, category, column position)
- Tickets can be linked to epics via `epic_id`
- Tickets can have subtasks
- Tickets are positioned on a board in columns

## ID Generation

Ticket IDs use a prefixed sequential format: `TKT-001`, `TKT-002`, etc.

- **Prefix**: `TKT`
- **Format**: `TKT-XXX` (zero-padded to 3 digits, expands for 1000+)
- **Auto-generated**: IDs are assigned automatically on creation
- **Stable**: ID never changes, even if title changes
- **Counter**: Stored in `pmo_settings` table as `next_ticket_id`

This matches the pattern used by other entities:
- Epics: `EPIC-001`
- Specs: `SPEC-001`
- Projects: `PROJ-001`

## Command Overview

### Core Commands
| Command                           | Purpose                                | Status             |
| --------------------------------- | -------------------------------------- | ------------------ |
| `prlt ticket`                     | Interactive menu for ticket operations | ✅ Implemented     |
| `prlt ticket create [title]`      | Create new ticket                      | ✅ Implemented     |
| `prlt ticket list`                | List all tickets with filters          | ✅ Implemented     |
| `prlt ticket view [id]`           | View ticket details                    | ✅ Implemented     |
| `prlt ticket move [id] [column]`  | Move ticket to column                  | ✅ Implemented     |
| `prlt ticket delete [id]`         | Delete ticket                          | ✅ Implemented     |
| `prlt ticket complete [id]`       | Move ticket to Done                    | ✅ Implemented     |
| `prlt ticket review [id]`         | Move ticket to In Review               | ✅ Implemented     |
| `prlt ticket status [id]`         | Show ticket status                     | ✅ Implemented     |
| `prlt ticket link [id] [epic-id]` | Link ticket to epic                    | ✅ Implemented     |

### Ownership Commands
| Command                           | Purpose                                | Status             |
| --------------------------------- | -------------------------------------- | ------------------ |
| `prlt ticket own [id]`            | Take accountability for ticket         | ✅ Implemented     |
| `prlt ticket assign [id] [agent]` | Delegate work to human or agent        | ✅ Implemented     |
| `prlt ticket claim [id]`          | Interactive: own + assign + execute    | ✅ Implemented     |

> **Note**: For execution (spinning up agents, runtime modes), see [execute-commands.md](execute-commands.md)

### Bulk Commands (`prlt tickets`)
| Command                           | Purpose                                | Status         |
| --------------------------------- | -------------------------------------- | -------------- |
| `prlt tickets`                    | Interactive menu for bulk operations   | ✅ Implemented |
| `prlt tickets list`               | List all tickets with filtering        | ✅ Implemented |
| `prlt tickets move`               | Move multiple tickets to column        | ✅ Implemented |
| `prlt tickets delete`             | Delete multiple tickets                | ✅ Implemented |
| `prlt tickets complete`           | Complete multiple tickets              | ✅ Implemented |
| `prlt tickets reassign`           | Reassign tickets to different agent    | ✅ Implemented |
| `prlt tickets link`               | Link tickets to different epic         | ✅ Implemented |
| `prlt tickets update`             | Update priority/category for multiple  | ✅ Implemented |

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
- `--epic, -e <epic-id>`: Link to epic (optional)
- `--assignee <assignee>`: Assign to user/agent

**Interactive Flow** (if title not provided):
```
? Ticket title: Add login screen
? Description: Implement user authentication UI
? Priority: ❯ High   Medium   Low
? Link to epic:
  ❯ None (standalone ticket)
    EPIC-001 User Authentication System (active)
    EPIC-002 Payment Integration (active)
    EPIC-003 Mobile Redesign (draft)
? Assign to: ❯ Unassigned   alice   bob

✅ Created ticket TKT-007
   Title: Add login screen
   Project: mobile-app
   Column: Backlog
   Priority: high
   Epic: EPIC-001

   View board: prlt board view
```

**Output**:
- Creates ticket in SQLite
- Exports to board.md
- Auto-generates ticket ID (TKT-NNN)
- Returns ticket ID

---

### `prlt ticket list`
**Purpose**: List all tickets with filtering

**Options**:
- `--project, -P <id>`: Filter by project (default: "default")
- `--column, -c <column>`: Filter by column
- `--priority, -p <priority>`: Filter by priority (URGENT, HIGH, MEDIUM, LOW)
- `--category <category>`: Filter by category
- `--epic, -e <epic-id>`: Filter by epic
- `--search, -s <text>`: Search in title and description
- `--format, -f <format>`: Output format (table, compact, json)
- `--all, -a`: Show all columns including Done

**Output** (table format):
```
📥 Backlog (2)
──────────────────────────────────────────────────
  TKT-001 Add login screen P:high feature
     Implement user authentication UI...
  TKT-002 Setup CI/CD P:medium infra

🚧 In Progress (1)
──────────────────────────────────────────────────
  TKT-003 Implement navigation P:high feature
     Subtasks: 2/4

✅ Done (3)
──────────────────────────────────────────────────
  TKT-004 Project setup P:high feature
  TKT-005 Configure linting P:low infra
  TKT-006 Add README P:low docs

──────────────────────────────────────────────────
Total: 6 tickets
```

**Example**:
```bash
prlt ticket list
prlt ticket list --column Backlog
prlt ticket list --priority URGENT
prlt ticket list --epic EPIC-001
prlt ticket list --search "login"
prlt ticket list --format json
```

**Behavior**:
- Groups tickets by column
- Shows priority and category badges
- Truncates long descriptions
- Shows subtask progress if any
- JSON format outputs raw ticket data

---

### `prlt ticket view [id]`
**Purpose**: View detailed ticket information

**Arguments**:
- `id` (optional): Ticket ID to view - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to view:
  ❯ TKT-001 - Add login screen (Backlog)
    TKT-002 - Setup CI/CD (Backlog)
    TKT-003 - Implement navigation (In Progress)
```

**Output**:
```
📄 Ticket TKT-001

Title:       Add login screen
Project:     mobile-app
Status:      Backlog
Priority:    high
Category:    feature
Epic:        EPIC-001
Created:     11/26/2024, 10:30:00 AM
Updated:     11/26/2024, 10:30:00 AM

Description:
  Implement user authentication UI with email/password login.
  Should include "forgot password" link.
```

**Example**:
```bash
prlt ticket view TKT-001
prlt ticket view  # Interactive mode
```

**Behavior**:
- If no argument provided, shows interactive dropdown
- Displays all ticket metadata
- Shows formatted timestamps

---

### `prlt ticket review [id]`
**Purpose**: Mark a ticket as ready for review (move to In Review column)

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to mark for review:
  ❯ TKT-001 - Add login screen (In Progress)
    TKT-002 - Setup CI/CD (In Progress)
```

**Output**:
```
👀 Marked TKT-001 for review
   Title: Add login screen
   From: In Progress
   To: In Review
```

**Example**:
```bash
prlt ticket review TKT-001
prlt ticket review  # Interactive mode
```

**Behavior**:
- Finds the "In Review" column (case-insensitive)
- Moves ticket to In Review column
- Exports to board.md
- Only shows in-progress tickets in dropdown
- **Used by agents** when they finish their work

> **Note**: This is the command agents should run when they complete their assigned task.
> The workflow is: `prlt ticket execute` (moves to In Progress) → agent works → `prlt ticket review` (moves to In Review)

---

### `prlt ticket complete [id]`
**Purpose**: Mark a ticket as complete (move to Done column)

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to complete:
  ❯ TKT-001 - Add login screen (In Review)
    TKT-002 - Setup CI/CD (In Review)
```

**Output**:
```
✅ Completed TKT-001
   Title: Add login screen
   Moved to: Done
```

**Example**:
```bash
prlt ticket complete TKT-001
prlt ticket complete  # Interactive mode
```

**Behavior**:
- Finds the "Done" column (case-insensitive)
- Moves ticket to Done column
- Exports to board.md
- Only shows incomplete tickets in dropdown
- **Used by humans** to mark a reviewed ticket as fully complete

---

### `prlt ticket move [id] [column]`
**Purpose**: Move ticket to different column

**Arguments**:
- `id` (optional): Ticket ID (e.g., TKT-001) - prompts with dropdown if not provided
- `column` (optional): Target column name - prompts with dropdown if not provided

**Interactive Flow** (if arguments not provided):
```
? Select ticket to move:
  ❯ TKT-001 - Add login screen (Backlog)
    TKT-002 - Setup CI/CD (Backlog)
    TKT-003 - Implement navigation (In Progress)

? Move to column:
  ❯ Backlog
    In Progress (current)
    Review
    Done

✅ Moved TKT-001 to In Progress
   Title: Add login screen
   Board updated
```

**Note**: Column names are sourced from the database for accuracy, not from config.json

**Example**:
```bash
prlt ticket move TKT-001 "In Progress"
prlt ticket move  # Interactive mode
```

**Output**:
```
✅ Moved TKT-001 to In Progress
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
  ❯ TKT-001 - Add login screen (Backlog)
    TKT-002 - Setup CI/CD (Backlog)
    TKT-003 - Implement navigation (In Progress)

Delete ticket TKT-001?
  Title: Add login screen
  Project: mobile-app
  Status: Backlog

? Are you sure?
  ❯ No, cancel
    Yes, delete

✅ Ticket TKT-001 deleted
   Removed from database and board
```

**Example**:
```bash
prlt ticket delete TKT-001
prlt ticket delete  # Interactive mode
```

**Output**:
```
✅ Ticket TKT-001 deleted
   Removed from database and board
```

**Behavior**:
- If no argument provided, shows interactive dropdown
- Removes from SQLite
- Removes from board.md
- No archive (permanent deletion)
- Requires confirmation unless --force

---

### `prlt ticket link [id] [epic-id]`
**Purpose**: Link a single ticket to an epic (or unlink)

**Status**: ✅ IMPLEMENTED

**Arguments**:
- `id` (optional): Ticket ID to link - prompts with dropdown if not provided
- `epic-id` (optional): Epic ID to link to - prompts with dropdown if not provided

**Options**:
- `--project, -P <id>`: Project ID (default: "default")
- `--unlink, -u`: Remove epic link instead of adding

**Interactive Flow** (if arguments not provided):
```
? Select ticket to link:
  ❯ TKT-001 - Add login screen (Backlog) [No epic]
    TKT-002 - Setup CI/CD (Backlog) [EPIC-001]
    TKT-003 - Implement navigation (In Progress) [No epic]

? Link to which epic?
  ❯ EPIC-001 User Authentication System (active)
    EPIC-002 Payment Integration (active)
    EPIC-003 Mobile Redesign (draft)
    ────────────
    None (remove epic link)

✅ Linked TKT-001 to EPIC-001
   Title: Add login screen
   Epic: User Authentication System
```

**Example**:
```bash
prlt ticket link TKT-001 EPIC-001      # Link ticket to epic
prlt ticket link TKT-001 --unlink      # Remove epic link
prlt ticket link                        # Interactive mode
```

**Output**:
```
✅ Linked TKT-001 to EPIC-001
   Title: Add login screen
   Epic: User Authentication System
```

**Behavior**:
- If no arguments provided, shows interactive dropdowns
- Updates ticket.epic_id in database
- Validates epic exists
- Shows current epic link if any
- `--unlink` sets epic_id to NULL

**Difference from `prlt tickets link`**:
- `prlt ticket link` operates on a single ticket (direct arguments)
- `prlt tickets link` is bulk operation with multi-select checkbox interface

---

## Ownership Commands

### Core Concepts

- **Owner**: Human accountable for the ticket getting done
- **Assignee**: Person or agent who will execute the work
- **Claim**: Interactive workflow to take ownership and assign executor

### `prlt ticket own [id]`

**Purpose**: Take accountability for a ticket (you're responsible for it getting done)

**What it does**:
- Sets `owner` field to current user
- Does NOT set `assignee` (you may delegate execution)
- Does NOT move ticket or start work

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to own:
  ❯ TKT-001 - Add login screen (Backlog, unowned)
    TKT-002 - Setup CI/CD (Backlog, owner: alice)
    TKT-003 - Implement navigation (In Progress, owner: bob)

✅ You now own TKT-001
   Title: Add login screen
   Owner: chris
   Assignee: (unassigned)

Next steps:
  prlt ticket assign TKT-001 @claude   # Delegate to agent
  prlt ticket claim TKT-001            # Do it yourself
```

**Example**:
```bash
prlt ticket own TKT-001      # Own specific ticket
prlt ticket own              # Interactive mode
```

**Behavior**:
- Sets `owner` = current user (human accountable)
- Leaves `assignee` unchanged
- Use case: PM/lead takes responsibility, will delegate later

---

### `prlt ticket assign [id] [agent]`

**Purpose**: Delegate work to a human or agent (set executor)

**What it does**:
- Sets `assignee` field
- Does NOT set `owner` (unless --owner flag used)
- Does NOT start work or spin up agent

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided
- `agent` (optional): Agent/user name - prompts with dropdown if not provided

**Options**:
- `--owner <name>`: Also set the owner
- `--unassign, -u`: Remove current assignee

**Interactive Flow** (if arguments not provided):
```
? Select ticket to assign:
  ❯ TKT-001 - Add login screen (Backlog, unassigned)
    TKT-002 - Setup CI/CD (Backlog, assignee: alice)

? Assign TKT-001 to:
    ── Agents ──
  ❯ alice
    bob
    charlie
    ── Other ──
    Enter custom name...
    Unassign (remove assignee)

✅ Assigned TKT-001 to alice
   Title: Add login screen
   Assignee: alice

To start work: prlt ticket execute TKT-001
```

**Example**:
```bash
prlt ticket assign TKT-001 alice           # Assign to agent
prlt ticket assign TKT-001 alice --owner chris  # Also set owner
prlt ticket assign TKT-001 --unassign      # Remove assignee
prlt ticket assign                          # Interactive mode
```

**Behavior**:
- Sets `assignee` field only
- Does NOT spin up agent (use `execute` for that)
- Agents are listed from workspace theme configuration

---

### `prlt ticket claim [id]`

**Purpose**: Interactive workflow to take ownership and assign work (to yourself or an agent)

**What it does**:
- Sets `owner` to current user (you're accountable)
- Prompts to choose executor (yourself or an agent)
- If agent selected: sets `assignee` and triggers `execute`
- If self selected: sets `assignee` to self, moves to In Progress

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Options**:
- `--self`: Skip prompt, assign to yourself
- `--agent <name>`: Skip prompt, assign to specific agent and execute

**Interactive Flow** (if id not provided):
```
? Select ticket to claim:
  ❯ TKT-001 - Add login screen (Backlog, unassigned)
    TKT-002 - Setup CI/CD (Backlog, unassigned)

Claiming TKT-001: Add login screen
You will be the owner (accountable for completion).

? Who will do the work?
  ❯ Me (I'll work on it myself)
    ── Agents ──
    alice
    bob
    charlie
```

**If "Me" selected**:
```
✅ Claimed TKT-001
   Owner: chris
   Assignee: chris
   Status: In Progress

You're now working on this ticket.
```

**If agent selected**:
```
✅ Claimed TKT-001
   Owner: chris
   Assignee: alice

🚀 Starting agent alice...
   [execution output based on mode]
```

**Example**:
```bash
prlt ticket claim TKT-001              # Interactive
prlt ticket claim TKT-001 --self       # Claim and do it yourself
prlt ticket claim TKT-001 --agent alice  # Claim and delegate to agent
prlt ticket claim                       # Full interactive mode
```

**Behavior**:
- Always sets `owner` = current user
- Prompts for executor choice
- If self: sets `assignee` = self, moves to "In Progress"
- If agent: sets `assignee` = agent, calls `execute` internally

---

## Ownership Workflow Patterns

### Pattern 1: Solo Developer
```bash
prlt ticket claim TKT-001 --self
# owner=chris, assignee=chris, status=In Progress
# Work on it, then complete
prlt ticket complete TKT-001
```

### Pattern 2: Delegate to Agent
```bash
prlt ticket claim TKT-001
# Select agent from prompt
# owner=chris, assignee=alice
# Agent starts automatically
```

### Pattern 3: PM Assigns (No Execute Yet)
```bash
prlt ticket own TKT-001          # PM takes ownership
prlt ticket assign TKT-001 alice  # Assign but don't execute
# Later...
prlt ticket execute TKT-001       # Trigger execution
```

### Pattern 4: Reassignment
```bash
prlt ticket assign TKT-001 bob   # Move from alice to bob
prlt ticket execute TKT-001      # Start bob working
```

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
prlt ticket move TKT-001,TKT-002,TKT-003 "In Progress"
prlt ticket delete TKT-001,TKT-002 --force
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
prlt ticket subtask add TKT-001 "Design login form"
prlt ticket subtask complete TKT-001 1
prlt ticket subtask list TKT-001
```

---

## Bulk Operations

### `prlt tickets move`
**Purpose**: Move multiple tickets to a different column

**Interactive Flow**:
```
📋 Bulk Move Tickets

? Select tickets to move: (Use space to select, enter to confirm)
  ❯ ◯ TKT-001  Add login screen              [Backlog]       P:high
    ◯ TKT-002  Setup CI/CD                    [Backlog]       P:medium
    ◉ TKT-003  Implement navigation           [In Progress]   P:high
    ◯ TKT-004  Project setup                  [Done]          P:high
    ◉ TKT-005  Configure linting              [Done]          P:low

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

### `prlt tickets delete`
**Purpose**: Delete multiple tickets

**Interactive Flow**:
```
📋 Bulk Delete Tickets

? Select tickets to delete: (Use space to select, enter to confirm)
  ❯ ◯ TKT-001  Add login screen              [Backlog]       P:high
    ◯ TKT-002  Setup CI/CD                    [Backlog]       P:medium
    ◉ TKT-003  Old feature (cancelled)        [Dropped]       P:low
    ◉ TKT-004  Duplicate ticket               [Dropped]       P:low

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

### `prlt tickets reassign`
**Purpose**: Reassign multiple tickets to a different agent

**Interactive Flow**:
```
📋 Bulk Reassign Tickets

? Select tickets to reassign:
  ❯ ◯ TKT-001  Add login screen              Assignee: alice
    ◉ TKT-002  Add logout                     Assignee: alice
    ◉ TKT-003  Password reset                 Assignee: (none)
    ◯ TKT-004  User profile                   Assignee: bob

Selected 2 tickets

? Reassign to which agent?
  ❯ alice (current)
    bob
    charlie
    None (unassign)

📝 Reassigning 2 tickets to "bob"...

✅ Reassigned 2 tickets to "bob"
```

**Options**:
- `--project, -p <id>`: Target project (default: current)
- `--from <agent>`: Filter tickets by current assignee
- `--to <agent>`: Target agent (skip interactive prompt)

**Behavior**:
- Multi-select checkbox interface
- Shows current assignee for each ticket
- Updates ticket assignee in database
- Preserves all other ticket metadata

---

### `prlt tickets link`
**Purpose**: Link multiple tickets to a different epic

**Interactive Flow**:
```
📋 Bulk Link Tickets to Epic

? Select tickets to link:
  ❯ ◯ TKT-001  Add login screen              Epic: EPIC-001
    ◉ TKT-002  Add logout                     Epic: EPIC-001
    ◉ TKT-003  Password reset                 Epic: (none)
    ◯ TKT-004  User profile                   Epic: EPIC-002

Selected 2 tickets

? Link to which epic?
  ❯ EPIC-001 Auth System
    EPIC-002 User Management
    EPIC-003 Payment Integration
    None (remove epic link)

📝 Linking 2 tickets to EPIC-002...

✅ Linked 2 tickets to EPIC-002
```

**Options**:
- `--project, -p <id>`: Target project (default: current)
- `--from-epic <epic>`: Filter tickets by current epic
- `--to-epic <epic>`: Target epic (skip interactive prompt)

**Behavior**:
- Multi-select checkbox interface
- Shows current epic for each ticket
- Updates ticket.epic_id in database
- Preserves all other ticket metadata

---

### `prlt tickets update`
**Purpose**: Update priority/category for multiple tickets

**Interactive Flow**:
```
📋 Bulk Update Tickets

? Select tickets to update:
  ❯ ◉ TKT-001  Add login screen              P:medium  C:feature
    ◉ TKT-002  Setup CI/CD                    P:medium  C:infra
    ◯ TKT-003  Implement navigation           P:high    C:feature

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
