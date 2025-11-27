# PMO Command Specifications

> **Note**: This spec describes CLI command interfaces and behaviors.
> For architecture decisions, see [pmo-architecture.md](pmo-architecture.md)
> For data schemas, see [pmo-interface.md](../pmo-interface.md)

## Overview

The PMO (Project Management Orchestration) system uses a flat entity → action command structure:
- **Project**: Create and manage projects (each project has one board)
- **Board**: View and interact with project boards
- **Ticket**: Create and manage work items

**Entity Relationships:**
- Workspace → PMO (optional, one-time setup)
- PMO → Projects (1:many)
- Project → Board (1:1, auto-created with project)
- Board → Tickets (1:many)

## Command Overview

### PMO Commands

| Command                      | Purpose                                | Status            |
| ---------------------------- | -------------------------------------- | ----------------- |
| `prlt pmo init`              | Initialize PMO system (one-time)       | ✅ Implemented    |

### Project Commands

| Command                      | Purpose                                | Status            |
| ---------------------------- | -------------------------------------- | ----------------- |
| `prlt project create`        | Create new project                     | ✅ Implemented    |
| `prlt project list`          | List all projects                      | ✅ Implemented    |
| `prlt project view [id]`     | View project details                   | ✅ Implemented    |
| `prlt project delete [id]`   | Delete project                         | ✅ Implemented    |

### Board Commands

| Command                      | Purpose                                | Status            |
| ---------------------------- | -------------------------------------- | ----------------- |
| `prlt board`                 | Interactive menu for board operations  | ✅ Implemented    |
| `prlt board view`            | View kanban board in terminal          | ✅ Implemented    |
| `prlt board open`            | Open board in Obsidian                 | ✅ Implemented ✓  |
| `prlt board markdown`        | Show board as markdown                 | ✅ Implemented ✓  |
| `prlt board export`          | Export board to file                   | ✅ Implemented ✓  |
| `prlt board sync`            | Sync between SQLite and board.md       | ✅ Implemented    |
| `prlt board watch`           | Watch board.md for changes             | ✅ Implemented    |

### Ticket Commands

| Command                           | Purpose                                | Status            |
| --------------------------------- | -------------------------------------- | ----------------- |
| `prlt ticket`                     | Interactive menu for ticket operations | ✅ Implemented     |
| `prlt ticket create [title]`      | Create new ticket                      | ✅ Implemented     |
| `prlt ticket list`                | List all tickets                       | ❌ Not Implemented |
| `prlt ticket view [id]`           | View ticket details                    | ❌ Not Implemented |
| `prlt ticket move [id] [column]`  | Move ticket to column                  | ✅ Implemented     |
| `prlt ticket assign [id] [agent]` | Assign executor (human or agent)       | ❌ Not Implemented |
| `prlt ticket own [id]`            | Take ownership (responsibility)        | ❌ Not Implemented |
| `prlt ticket claim [id]`          | Claim ticket (own + execute)           | ❌ Not Implemented |
| `prlt ticket delete [id]`         | Delete ticket                          | ✅ Implemented     |

---

## Command Specifications

### `prlt pmo init`
**Purpose**: Initialize PMO system in workspace (one-time setup)

**Options**:
- `--storage <backend>`: Storage backend (sqlite, git-in-repo, git-separate, cloud)
- `--template <template>`: Default board template (kanban, scrum, founder)

**Interactive Flow** (default):
```
? Select PMO storage backend:
  ❯ SQLite (local database, simple)
    Git - In Repo (sync via git commits)
    Git - Separate Repo (dedicated PMO repo)
    Cloud Database (team sync - future)

? Default board template:
  ❯ Kanban (Backlog, In Progress, Review, Done)
    Scrum (Backlog, Sprint, In Progress, Review, Done)
    Founder Mode (Ideas, This Week, In Progress, Shipped)

? Initialize git repository for PMO?
  ❯ Yes
    No

? Add a git remote?
  ❯ No
    Yes

✅ PMO initialized
   Storage: SQLite
   Location: .proletariat/pmo/
   Database: .proletariat/workspace.db

   Next steps:
   1. Create your first project: prlt project create
   2. Or view the default board: prlt board view
```

**Output**:
- Creates `.proletariat/pmo/` directory
- Initializes storage backend (creates DB tables, Git repo, etc.)
- Sets PMO config in workspace database
- Creates default project (optional)

**Behavior**:
- Can only be run once per workspace
- Running again shows current PMO configuration
- Must run `prlt init` first (workspace must exist)

---

### `prlt project create`
**Purpose**: Create a new project in the PMO

**Arguments**:
- `name` (interactive or flag): Project name

**Options**:
- `--name, -n <name>`: Project name
- `--description, -d <desc>`: Project description

**Interactive Flow**:
```
? Project name: mobile-app
? Description (optional): iOS and Android mobile application

✅ Created project: mobile-app
   ID: mobile-app
   Board: .proletariat/pmo/mobile-app/board.md
```

**Output**:
- Creates project entry in SQLite
- Creates project folder structure
- Initializes empty board.md
- Returns project ID

---

### `prlt project view [id]`
**Purpose**: View a project's board

**Arguments**:
- `id` (optional): Project ID to view - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select project to view:
  ❯ default - Default Project
    mobile-app - iOS and Android mobile application
    web-app - Web application
```

**Example**:
```bash
prlt project view mobile-app
prlt project view  # Interactive mode
```

**Output**:
```
Mobile App Board

📥 Backlog (2)
    TICK-001 Add login screen P:high
    TICK-002 Setup CI/CD P:medium

🚧 In Progress (1)
    TICK-003 Implement navigation P:high

✅ Done (3)
    TICK-004 Project setup P:high
    TICK-005 Configure linting P:low
    TICK-006 Add README P:low
```

**Behavior**:
- If no id provided, shows interactive dropdown of available projects
- Reads from SQLite database
- Displays board in terminal with color-coded columns
- Shows ticket counts per column
- Displays priority and other metadata

---

### `prlt project delete [id]`
**Purpose**: Delete a project from the PMO

**Arguments**:
- `id` (optional): Project ID to delete - prompts with dropdown if not provided

**Options**:
- `--force, -f`: Skip confirmation prompt

**Interactive Flow** (if id not provided):
```
? Select project to delete:
  ❯ mobile-app - iOS and Android mobile application
    web-app - Web application
    (default project cannot be deleted)

? Delete project "mobile-app" and its 6 ticket(s)?
  ❯ No, cancel
    Yes, delete

✅ Deleted project "mobile-app"
   (6 ticket(s) removed)
```

**Example**:
```bash
prlt project delete mobile-app
prlt project delete mobile-app --force
prlt project delete  # Interactive mode
```

**Behavior**:
- If no id provided, shows interactive dropdown (excluding default project)
- Cannot delete the default project
- Confirms deletion with ticket count
- Deletes project entry from SQLite
- Deletes all tickets in the project
- Deletes board file if it exists

---

### `prlt board`
**Purpose**: Interactive menu for board operations

**Interactive Flow**:
```
📋 Board Operations

? What would you like to do?
  ❯ View board in terminal
    Open board in Obsidian
    Show as markdown
    Export board
    Sync board
    Watch for changes
    ────────────
    Cancel
```

**Behavior**:
- Shows all available board operations
- Arrow keys to navigate
- Enter to select
- Runs selected command
- Returns to menu after command completes (optional)

---

### `prlt board view`
**Purpose**: Display kanban board in terminal

**Options**:
- `--project, -p <id>`: View specific project board (default: current project)
- `--format <format>`: Output format (terminal, markdown, json)

**Sample Output**:
```
📋 Mobile App Board

## 📥 Backlog (2)
  TICK-001  Add login screen          @unassigned  P:high
  TICK-002  Setup CI/CD                @unassigned  P:medium

## 🚧 In Progress (1)
  TICK-003  Implement navigation       @alice      P:high

## ✅ Done (3)
  TICK-004  Project setup              @bob        P:high
  TICK-005  Configure linting          @alice      P:low
  TICK-006  Add README                 @bob        P:low

─────────────────────
Summary: 6 tickets | Backlog: 2 | In Progress: 1 | Done: 3
```

**Behavior**:
- Reads from SQLite database
- Color-codes tickets by priority
- Shows ticket count per column
- Displays assignees and metadata

---

### `prlt board sync`
**Purpose**: Bidirectional sync between SQLite and board.md

**Direction**:
- Reads board.md if newer than SQLite
- Exports SQLite to board.md if DB is newer
- Auto-detects which direction to sync

**Options**:
- `--direction <direction>`: Force sync direction (import, export, auto)
- `--project, -p <id>`: Sync specific project (default: current)
- `--force, -f`: Skip confirmation prompt
- `--dry-run`: Show changes without applying them

**Output**:
```
📊 Changes detected in board.md (to sync to database):

  + 1 ticket(s) to add:
    + TICK-007: New feature (Backlog)

  ~ 2 ticket(s) to update:
    ~ TICK-001: Add login screen
        column: Backlog → In Progress

  - 0 ticket(s) to remove:

? Apply these changes to the database?
  ❯ Yes, apply changes
    No, cancel

🔄 Syncing from board.md...

✅ Database synced from board.md!
```

**Behavior**:
- Compares timestamps
- Shows detailed change summary before applying
- Requires confirmation unless --force flag used
- Imports/exports as needed
- Preserves ticket IDs
- Handles conflicts (last-write-wins)

---

### `prlt board open`
**Purpose**: Open board.md in Obsidian or default markdown editor

**Options**:
- `--project, -p <id>`: Open specific project board (default: current)
- `--editor <editor>`: Override default editor (obsidian, vscode, etc.)

**Example**:
```bash
prlt board open
prlt board open --project mobile-app
```

**Output**:
```
📂 Opening board in Obsidian...
   File: .proletariat/pmo/board.md
```

**Behavior**:
- Detects Obsidian installation
- Falls back to system default markdown editor
- Opens the board.md file for editing
- Changes sync back to SQLite via `board watch` or `board sync`

---

### `prlt board markdown`
**Purpose**: Output board as raw markdown (useful for piping/scripting)

**Options**:
- `--project, -p <id>`: Show specific project board (default: current)

**Example**:
```bash
prlt board markdown
prlt board markdown > board-backup.md
prlt board markdown | pbcopy  # Copy to clipboard
```

**Output**:
```markdown
## Backlog

- [ ] [[TICK-001]]
      **Priority:** high
      **Category:** BUILD
      ***
      Add login screen

## In Progress

- [ ] [[TICK-002]]
      **Priority:** high
      ***
      Implement navigation
```

**Behavior**:
- Reads from SQLite database
- Outputs valid Obsidian Kanban markdown
- No colors or formatting (pure markdown)
- Useful for automation and backups

---

### `prlt board export`
**Purpose**: Export board to file in various formats

**Options**:
- `--project, -p <id>`: Export specific project (default: current)
- `--format <format>`: Output format (markdown, json, csv)
- `--output, -o <file>`: Output file path (default: stdout)

**Examples**:
```bash
prlt board export --format markdown -o backup.md
prlt board export --format json -o board.json
prlt board export --format csv -o tickets.csv
```

**Output (markdown)**:
```
✅ Exported board to backup.md
   Format: markdown
   Tickets: 6
```

**Output (json)**:
```json
{
  "project": "mobile-app",
  "columns": [
    {
      "name": "Backlog",
      "tickets": [
        {
          "id": "TICK-001",
          "title": "Add login screen",
          "priority": "high",
          "category": "BUILD"
        }
      ]
    }
  ]
}
```

**Behavior**:
- Exports current board state from SQLite
- Supports multiple output formats
- Can write to file or stdout
- Useful for backups, migrations, integrations

---

### `prlt board watch`
**Purpose**: Watch board.md for changes and auto-sync to SQLite

**Options**:
- `--project, -p <id>`: Watch specific project (default: current)
- `--interval <ms>`: Poll interval in milliseconds (default: 1000)

**Output**:
```
👀 Watching board.md for changes...
   Project: mobile-app
   File: .proletariat/pmo/mobile-app/board.md
   Press Ctrl+C to stop

[12:34:56] Change detected
[12:34:56] Syncing... 2 tickets updated
[12:34:56] ✅ Sync complete
```

**Behavior**:
- File system watcher on board.md
- Debounced sync (waits for write to finish)
- Runs in foreground (blocks terminal)
- Clean shutdown on Ctrl+C

---

### `prlt ticket`
**Purpose**: Interactive menu for ticket operations

**Interactive Flow**:
```
🎫 Ticket Operations

? What would you like to do?
  ❯ Create new ticket
    List all tickets
    View ticket details
    Claim ticket
    Move ticket
    Assign ticket
    Delete ticket
    ────────────
    Cancel
```

**Behavior**:
- Shows all available ticket operations
- Arrow keys to navigate
- Enter to select
- Runs selected command
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

## Missing Command Specs

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

### `prlt ticket assign [id] [agent]` (Not Implemented)
**Purpose**: Assign executor to ticket (human or agent)

**Ownership Model**:
- `owner`: Human responsible/accountable for the ticket
- `assignee`: Executor who will do the work (human OR agent)
- This command sets the `assignee` field
- Agents are always **assigned** by orchestrators (never claim autonomously)

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided
- `agent` (optional): Agent/user to assign - prompts with dropdown if not provided

**Options**:
- `--owner <name>`: Also set the owner (default: unchanged)

**Interactive Flow** (if arguments not provided):
```
? Select ticket to assign:
  ❯ TICK-001 - Add login screen (Backlog, unassigned)
    TICK-002 - Setup CI/CD (Backlog, unassigned)
    TICK-003 - Implement navigation (In Progress, @alice)

? Assign TICK-001 to:
    Unassign (remove assignee)
    ── Common Agents ──
  ❯ alice
    bob
    charlie
    ────────────────────
    Enter custom name...

✅ Assigned TICK-001 to alice
   Title: Add login screen
```

**Example**:
```bash
prlt ticket assign TICK-001 alice
prlt ticket assign TICK-001 claude      # Assign to AI agent
prlt ticket assign TICK-001 --owner chris  # Set owner too
prlt ticket assign  # Interactive mode
```

**Behavior**:
- If no arguments provided, shows interactive dropdowns
- Dropdown includes unassign option, common agents, and custom name entry
- Sets `assignee` field (executor)
- Optionally sets `owner` field with --owner flag
- Used by human orchestrators to delegate work to humans or agents

---

### `prlt ticket own [id]` (Not Implemented)
**Purpose**: Take ownership/responsibility for ticket (without necessarily executing)

**Ownership Model**:
- Sets `owner` field to current user (human takes responsibility)
- Leaves `assignee` unchanged (execution may be delegated)
- Use when you're accountable but delegating execution to others

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Interactive Flow** (if id not provided):
```
? Select ticket to own:
  ❯ TICK-001 - Add login screen (Backlog, unassigned)
    TICK-002 - Setup CI/CD (Backlog, @claude)
    TICK-003 - Implement navigation (In Progress, @alice)

✅ You now own TICK-001
   Owner: chris
   Assignee: unassigned (can delegate with 'prlt ticket assign')
```

**Example**:
```bash
prlt ticket own TICK-001
prlt ticket own  # Interactive mode
```

**Behavior**:
- Sets `owner` = current user (accountable)
- Leaves `assignee` unchanged
- Use case: Product owner takes responsibility, will assign to dev/agent later
- Complements `prlt ticket assign` for delegation workflow

---

### `prlt ticket claim [id]` (Not Implemented)
**Purpose**: Human claims ticket (takes ownership AND execution)

**Ownership Model**:
- CLI context: Human claims = sets BOTH `owner` and `assignee` to current user
- Agents never claim autonomously - they are always assigned by orchestrators
- Use `prlt ticket assign` to delegate to agents or other humans

**Arguments**:
- `id` (optional): Ticket ID (prompts to select if not provided)

**Interactive Flow** (no ID provided):
```
? Select ticket to claim:
  ❯ TICK-001 - Add login screen (high, unassigned)
    TICK-002 - Setup CI/CD (medium, @bob)

✅ Claimed TICK-001
   Owner: chris
   Assignee: chris
   Moved to: In Progress
```

**Example**:
```bash
prlt ticket claim TICK-001
prlt ticket claim  # Interactive mode
```

**Behavior**:
- Auto-detects current user from system
- Sets `owner` = current user (takes responsibility)
- Sets `assignee` = current user (will execute)
- Optionally moves to "In Progress"
- **Human-only command** - agents use assigned work queue instead

---

## Design Principles

### Consistent Interface
- All commands follow `entity action [arguments]` pattern
- Project-scoped operations default to current project
- Interactive prompts when arguments missing
- Arrow key navigation for all selections and confirmations (no typing required)
- Safe defaults for destructive operations (e.g., "No, cancel" is default)
- Color-coded output for readability

### Multi-Project Support
- `--project` flag available on all commands
- Default project detection from current directory
- Cross-project operations supported

### Storage Abstraction
- Commands remain identical regardless of storage backend
- SQLite, Git, or Hosted DB - same CLI interface
- `prlt board sync` handles synchronization

### Error Handling
- Validate inputs before execution
- Clear error messages with actionable guidance
- Graceful degradation (e.g., if board.md missing)
- Confirmation prompts for destructive operations

### Ownership & Assignment Model
- **Owner**: Human responsible/accountable for ticket completion
- **Assignee**: Executor (human or agent) who does the work
- **Human claiming** (`prlt ticket claim`): Sets both owner and assignee to current user
- **Orchestrator assigning** (`prlt ticket assign`): Delegates execution to human or agent
- **Agent workflow**: Agents never claim autonomously - always assigned by orchestrators
- **Agent SDK**: Agents poll for assigned tickets and report completion
- Supports both solo work (human owns + executes) and delegation (human owns, agent executes)

---

## Future Enhancements

### Batch Operations
```bash
prlt ticket move TICK-001,TICK-002,TICK-003 "In Progress"
prlt ticket assign --status Backlog --assignee alice
```

### Advanced Filtering
```bash
prlt ticket list --priority high --status "In Progress"
prlt board view --assignee alice
```

### Ticket Templates
```bash
prlt ticket create --template bug-report
prlt ticket create --template feature-request
```

### Epic Support
```bash
prlt epic create "Payment System"
prlt epic add-ticket EPIC-001 TICK-001
prlt epic view EPIC-001
```
