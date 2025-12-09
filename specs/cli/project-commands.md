---
title: PMO Project Commands Specification
created: 2024-11-28
---

# PMO Project Commands Specification

> **Note**: For architecture decisions, see [pmo-architecture.md](pmo-architecture.md)

## Overview

Project commands handle the creation and management of projects. Each project has exactly one board and can contain many tickets and specs.

**Entity Relationships**:
- Workspace → PMO (optional, one-time setup)
- PMO → Projects (1:many)
- Project → Board (1:1, auto-created with project)
- Board → Tickets (1:many)

## Command Overview

| Command                      | Purpose                                | Status         |
| ---------------------------- | -------------------------------------- | -------------- |
| `prlt pmo init`              | Initialize PMO system (one-time)       | ✅ Implemented |
| `prlt project create`        | Create new project                     | ✅ Implemented |
| `prlt project list`          | List all projects                      | ✅ Implemented |
| `prlt project view [id]`     | View project details                   | ✅ Implemented |
| `prlt project delete [id]`   | Delete project                         | ✅ Implemented |

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

### `prlt project list`
**Purpose**: List all projects in the PMO

**Options**:
- `--format <format>`: Output format (table, json, markdown)

**Example**:
```bash
prlt project list
prlt project list --format json
```

**Output**:
```
📁 Projects (3)

ID           Name                     Tickets   Created
───────────  ───────────────────────  ────────  ────────────
default      Default Project          12        2024-11-26
mobile-app   Mobile Application       6         2024-11-27
web-app      Web Application          8         2024-11-28

Commands:
  prlt project view <id>     View project details
  prlt project create        Create new project
  prlt board view            View current project board
```

**Behavior**:
- Shows all projects in the workspace
- Displays ticket counts
- Shows creation dates
- Outputs in multiple formats (table, json, markdown)

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

## Design Principles

### One Board Per Project
- Each project automatically gets a board
- Board is created when project is created
- Board cannot exist without a project
- Board is deleted when project is deleted

### Default Project
- Every workspace has a "default" project
- Default project cannot be deleted
- Used when no specific project is specified
- Useful for personal or single-project workspaces

### Multi-Project Support
- Support for multiple projects in one workspace
- `--project` flag available on all commands
- Default project detection from current directory
- Cross-project operations supported

### Storage Abstraction
- Commands remain identical regardless of storage backend
- SQLite, Git, or Hosted DB - same CLI interface
- `prlt board sync` handles synchronization

---

## Future Enhancements

### Project Archiving
```bash
prlt project archive mobile-app
prlt project unarchive mobile-app
prlt project list --archived
```

### Project Metadata
```bash
prlt project update mobile-app --description "New description"
prlt project update mobile-app --name "Mobile App v2"
```

### Project Templates
```bash
prlt project create --template mobile-app
prlt project create --template web-app
prlt project create --template library
```

### Project Statistics
```bash
prlt project stats mobile-app
# Shows:
# - Total tickets
# - Tickets by status
# - Tickets by assignee
# - Average completion time
# - Burndown chart
```
