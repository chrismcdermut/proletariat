---
title: PMO Board Commands Specification
created: 2024-11-28
---

# PMO Board Commands Specification

> **Note**: For architecture decisions, see [pmo-architecture.md](pmo-architecture.md)
> For work commands (assign, own, claim), see [pmo-work-commands.md](pmo-work-commands.md)

## Overview

Board commands handle viewing and managing kanban boards. Each project has exactly one board, which displays tickets organized in columns.

## File Structure

### Standard Location
```
pmo/projects/{projectId}/kanban.md
```

### Board File Format
```markdown
---
kanban-plugin: basic
---

# Project Name

## 📥 Backlog

- [ ] **ticket-id** [[ticket-id]] Ticket title
      **Priority:** high
      **Category:** feature

## 🚀 In Progress

## ✅ Done
```

### Requirements
- **Filename**: `kanban.md` (standard) - legacy `board.md` supported for backward compatibility
- **Title**: `# Project Name` line after frontmatter - parsed as board name
- **Frontmatter**: Required `kanban-plugin: basic` for Obsidian Kanban plugin compatibility

## Command Overview

| Command                      | Purpose                                |
| ---------------------------- | -------------------------------------- |
| `prlt board`                 | Interactive menu for board operations  |
| `prlt board view`            | View kanban board in terminal          |
| `prlt board open`            | Open board in Obsidian                 |
| `prlt board markdown`        | Show board as markdown                 |
| `prlt board export`          | Export board to file                   |
| `prlt board sync`            | Sync between SQLite and kanban.md      |
| `prlt board watch`           | Watch kanban.md for changes            |

---

## Command Specifications

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
**Purpose**: Bidirectional sync between SQLite and kanban.md

**Direction**:
- Reads kanban.md if newer than SQLite
- Exports SQLite to kanban.md if DB is newer
- Auto-detects which direction to sync

**Options**:
- `--direction <direction>`: Force sync direction (import, export, auto)
- `--project, -p <id>`: Sync specific project (default: current)
- `--force, -f`: Skip confirmation prompt
- `--dry-run`: Show changes without applying them

**Output**:
```
📊 Changes detected in kanban.md (to sync to database):

  + 1 ticket(s) to add:
    + TICK-007: New feature (Backlog)

  ~ 2 ticket(s) to update:
    ~ TICK-001: Add login screen
        column: Ready → In Progress

  - 0 ticket(s) to remove:

? Apply these changes to the database?
  ❯ Yes, apply changes
    No, cancel

🔄 Syncing from kanban.md...

✅ Database synced from kanban.md!
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
**Purpose**: Open kanban.md in Obsidian or default markdown editor

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
   File: pmo/projects/mobile-app/kanban.md
```

**Behavior**:
- Detects Obsidian installation
- Falls back to system default markdown editor
- Opens the kanban.md file for editing
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

- [ ] **pmo-tickets-001** [[pmo-tickets-001]] Add login screen
      **Priority:** high
      **Category:** BUILD
      ***
      Add login screen

## In Progress

- [ ] **pmo-tickets-002** [[pmo-tickets-002]] Implement navigation
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
**Purpose**: Watch kanban.md for changes and auto-sync to SQLite

**Options**:
- `--project, -p <id>`: Watch specific project (default: current)
- `--interval <ms>`: Poll interval in milliseconds (default: 1000)

**Output**:
```
👀 Watching kanban.md for changes...
   Project: mobile-app
   File: pmo/projects/mobile-app/kanban.md
   Press Ctrl+C to stop

[12:34:56] Change detected
[12:34:56] Syncing... 2 tickets updated
[12:34:56] ✅ Sync complete
```

**Behavior**:
- File system watcher on kanban.md
- Debounced sync (waits for write to finish)
- Runs in foreground (blocks terminal)
- Clean shutdown on Ctrl+C

---

## Design Principles

### Bidirectional Sync
- kanban.md and SQLite are always in sync
- Timestamp-based conflict detection
- Last-write-wins strategy
- Manual `prlt board sync` for control
- Automatic `prlt board watch` for real-time sync

### Visual Clarity
- Color-coded priorities and statuses
- Emoji icons for columns
- Ticket counts in headers
- Clear column separators

### Export Flexibility
- Multiple formats (markdown, json, csv)
- Stdout or file output
- Useful for automation, backups, integrations

---

## Future Enhancements

### Advanced Filtering
```bash
prlt board view --assignee alice
prlt board view --priority high
prlt board view --column "In Progress"
```

### Custom Views
```bash
prlt board view --group-by assignee
prlt board view --group-by priority
prlt board view --sort-by updated
```

### Board Templates
```bash
prlt board template kanban
prlt board template scrum
prlt board template founder-mode
```
