---
title: PMO Epic Commands Specification
created: 2024-12-02
---

# PMO Epic Commands Specification

> **Note**: For static documentation (specs), see [pmo-spec-commands.md](pmo-spec-commands.md)

## Overview

Epic commands handle work containers that have **lifecycle status**. Epics group related tickets and track progress through statuses (active, draft, complete, dropped, future).

**Key Distinction**:
- **Specs** = static documents (design docs, requirements) - no lifecycle, no tickets
- **Epics** = work containers with status, tickets link to them via `epic_id`

**Core Concepts**:

- Epics have status (active, draft, complete, dropped, future)
- Tickets reference epics via `epic_id` in database (not frontmatter)
- Epics track progress based on ticket completion
- Epics are organized in folders by status
- Epics belong to projects

## ID Generation

Epic IDs use a prefixed sequential format: `EPIC-001`, `EPIC-002`, etc.

- **Prefix**: `EPIC`
- **Format**: `EPIC-XXX` (zero-padded to 3 digits, expands for 1000+)
- **Auto-generated**: IDs are assigned automatically on creation
- **Stable**: ID never changes, even if title changes
- **Counter**: Stored in `pmo_settings` table as `next_epic_id`

This matches the pattern used by other entities:
- Tickets: `TKT-001`
- Specs: `SPEC-001`
- Projects: `PROJ-001`

## Command Overview

| Command                           | Purpose                              |
| --------------------------------- | ------------------------------------ |
| `prlt epic`                       | Interactive menu for epic operations |
| `prlt epic create [title]`        | Create new epic                      |
| `prlt epic list`                  | List all epics                       |
| `prlt epic view [id]`             | View epic and linked tickets         |
| `prlt epic archive [id]`          | Move epic to complete/ folder        |
| `prlt epic activate [id]`         | Move epic to active/ folder          |
| `prlt epic move [id] [status]`    | Move epic between status folders     |
| `prlt epic progress [id]`         | Show completion percentage           |
| `prlt epic link [id] [tickets...]`| Link tickets to epic                 |

---

## Command Specifications

### `prlt epic`

**Purpose**: Interactive menu for epic operations

**Interactive Flow**:

```
? 🎯 Epic Operations - What would you like to do?
  ❯ Create new epic
    List all epics
    View epic
    Show progress
    ─────────
    Archive epic (complete)
    Activate epic
    Move epic
    ─────────
    Cancel
```

**Example**:

```bash
prlt epic
```

**Behavior**:

- Shows menu of all epic operations
- Runs selected command
- Returns to menu on completion

---

### `prlt epic create [title]`

**Purpose**: Create a new epic with initial status

**Arguments**:

- `title` (optional): Epic title (will prompt if not provided)

**Options**:

- `--title, -t <title>`: Epic title
- `--status, -s <status>`: Initial status (active, draft) [default: active]
- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Interactive Flow**:

```
? Epic title: User Authentication System
? Initial status:
  ❯ Active (currently working on)
    Draft (planning phase)

✅ Created epic EPIC-001 "User Authentication System"
  Project: proletariat
  Status: active
  File: pmo/projects/proletariat/epics/active/EPIC-001.md

Next steps:
  1. Create tickets linked to this epic:
     prlt ticket create --epic EPIC-001 "Design auth flow"
  2. View progress: prlt epic progress EPIC-001
```

**Example**:

```bash
prlt epic create "User Authentication"
prlt epic create --title "API Design" --status draft
```

**Behavior**:

- Generates sequential ID (EPIC-001, EPIC-002, etc.)
- Creates markdown file in epics/{status}/ directory using ID as filename
- Adds YAML frontmatter with metadata (id, title, status, created)
- Registers epic in database

**Template Structure**:

```markdown
---
id: EPIC-001
title: User Authentication System
status: active
created: 2025-12-02T...
---

# User Authentication System

## Overview
[Describe what this epic covers]

## Motivation
[Why this work matters - the problem being solved or opportunity being captured]

## Goals
- [ ] Goal 1
- [ ] Goal 2

## Success Criteria
- [ ] Criterion 1

## Tickets

_No tickets linked yet. Create tickets with:_
```bash
prlt ticket create --epic EPIC-001 "Task title"
```
```

**Note**: The `## Tickets` section is auto-updated when tickets are created with `--epic`. This is a one-way sync (database → markdown).

---

### `prlt epic list`

**Purpose**: List all epics across all statuses

**Options**:

- `--status, -s <status>`: Filter by status (active, draft, complete, dropped, future)
- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Example**:

```bash
prlt epic list
prlt epic list --status active
prlt epic list --project mobile-app
```

**Output**:

```
🎯 Epics - proletariat
═══════════════════════════════════════════════════

🟢 ACTIVE (3)
  EPIC-001  User Authentication System    ████████████░░░░░░░░  60% (6/10)
  EPIC-002  API Design                    ████████████████████ 100% (5/5) ← ready to archive!
  EPIC-003  Payment Integration           ░░░░░░░░░░░░░░░░░░░░   0% (0/3)

🟡 DRAFT (1)
  EPIC-004  Mobile App Redesign           ░░░░░░░░░░░░░░░░░░░░   0% (0/0)

✅ COMPLETE (2)
  EPIC-005  Initial Setup                 ████████████████████ 100% (8/8)
  EPIC-006  Auth V1                       ████████████████████ 100% (12/12)

═══════════════════════════════════════════════════
Total: 6 epics (3 active, 1 draft, 2 complete)

Commands:
  prlt epic progress EPIC-001    View detailed progress
  prlt epic archive EPIC-002     Archive completed epic
```

**Behavior**:

- Groups epics by status (active, draft, complete, dropped, future)
- Shows progress bar and ticket completion count
- Highlights epics ready to archive (100% complete)
- Supports filtering by status or project

---

### `prlt epic view [id]`

**Purpose**: View epic details and linked tickets

**Arguments**:

- `id` (optional): Epic ID - prompts if not provided

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--full, -f`: Show full epic content

**Example**:

```bash
prlt epic view EPIC-001
prlt epic view --full
```

**Output**:

```
🎯 Epic: EPIC-001 - User Authentication System
═══════════════════════════════════════════════════
ID: EPIC-001
Title: User Authentication System
Project: proletariat
Status: active
Created: 12/02/2025
File: pmo/projects/proletariat/epics/active/EPIC-001.md

Progress: 60% (6/10 tickets complete)
████████████░░░░░░░░

🎫 Tickets (10):
  ✅ TKT-001: Design auth flow [Done]
  ✅ TKT-002: Implement login [Done]
  ✅ TKT-003: Implement logout [Done]
  ✅ TKT-004: Session management [Done]
  ✅ TKT-005: Password reset flow [Done]
  ✅ TKT-006: Email verification [Done]
  🚧 TKT-007: OAuth2 integration [In Progress]
  📋 TKT-008: 2FA implementation [Ready]
  📋 TKT-009: Rate limiting [Backlog]
  📋 TKT-010: Security audit [Backlog]

═══════════════════════════════════════════════════
Commands:
  prlt epic progress EPIC-001
  prlt ticket create --epic EPIC-001 "New task"
```

**Behavior**:

- Shows epic metadata
- Displays progress bar
- Lists all tickets with `epic_id` = this epic
- Shows suggested commands

---

### `prlt epic archive [id]`

**Purpose**: Archive a completed epic by moving to complete/ folder

**Arguments**:

- `id` (optional): Epic ID - prompts if not provided

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--force, -f`: Skip ticket completion check

**Example**:

```bash
prlt epic archive EPIC-002
prlt epic archive --force
```

**Interactive Flow**:

```
? Select epic to archive:
  ❯ EPIC-002 API Design (active) [5/5 tickets complete] ✅
    EPIC-001 User Authentication System (active) [6/10 tickets complete]

Archiving: EPIC-002 "API Design"
Status: 5/5 tickets complete ✅

✅ Archived epic EPIC-002 "API Design"
  Moved: epics/active/EPIC-002.md → epics/complete/EPIC-002.md
  Status: active → complete

View archived epics:
  prlt epic list --status complete
```

**Behavior**:

- Checks all linked tickets are in "Done" column
- Warns if tickets are incomplete (requires --force)
- Moves file from `epics/active/` to `epics/complete/`
- Updates status in database

**Validation**:

```
⚠️  Not all tickets are complete (6/10 done)
? Continue archiving anyway? (y/N)
```

---

### `prlt epic activate [id]`

**Purpose**: Activate a draft or archived epic

**Arguments**:

- `id` (optional): Epic ID - prompts if not provided

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Example**:

```bash
prlt epic activate EPIC-004
```

**Interactive Flow**:

```
? Select epic to activate:
  ❯ EPIC-004 Mobile App Redesign (draft)
    EPIC-007 Old Feature (dropped)

Activating: EPIC-004 "Mobile App Redesign"
Current status: draft

✅ Activated epic EPIC-004 "Mobile App Redesign"
  Moved: epics/draft/EPIC-004.md → epics/active/EPIC-004.md
  Status: draft → active

Next steps:
  prlt epic view EPIC-004
  prlt ticket create --epic EPIC-004 "First task"
```

**Behavior**:

- Moves file to `epics/active/`
- Updates status in database
- Validates epic is not already active

**Warning for Complete Epics**:

```
⚠️  This epic was previously completed (12/12 tickets done)
? Reactivate this epic? (y/N)
```

---

### `prlt epic progress [id]`

**Purpose**: Show completion percentage based on linked tickets

**Arguments**:

- `id` (optional): Epic ID - prompts if not provided

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--all, -a`: Show progress for all epics

**Example**:

```bash
prlt epic progress EPIC-001
prlt epic progress --all
```

**Output** (single epic):

```
🎯 Epic Progress: EPIC-001 - User Authentication System
═══════════════════════════════════════════════════

Status: active
Tickets: 6/10 complete (60%)

████████████░░░░░░░░ 60%

Breakdown by column:
  ✅ Done:        6 tickets
  🚧 In Progress: 1 ticket
  📋 Ready:       1 ticket
  📥 Backlog:     2 tickets

Remaining work:
  TKT-007: OAuth2 integration [In Progress]
  TKT-008: 2FA implementation [Ready]
  TKT-009: Rate limiting [Backlog]
  TKT-010: Security audit [Backlog]
```

**Output** (--all):

```
📊 Epic Progress - All Epics
═══════════════════════════════════════════════════

🟢 ACTIVE (3)
  EPIC-002  API Design                    ████████████████████ 100% (5/5) ← ready to archive
  EPIC-001  User Authentication System    ████████████░░░░░░░░  60% (6/10)
  EPIC-003  Payment Integration           ░░░░░░░░░░░░░░░░░░░░   0% (0/3)

🟡 DRAFT (1)
  EPIC-004  Mobile App Redesign           ░░░░░░░░░░░░░░░░░░░░   0% (0/0)

Commands:
  prlt epic progress EPIC-001    View detailed progress
  prlt epic archive EPIC-002     Archive completed epic
```

**Behavior**:

- Counts tickets with `epic_id` = this epic
- Calculates completion based on "Done" column
- Shows visual progress bar (20 chars wide)
- Breaks down by column for detailed view
- Highlights epics ready to archive

---

### `prlt epic move [id] [status]`

**Purpose**: Move epic between any status folders

**Arguments**:

- `id` (optional): Epic ID - prompts if not provided
- `status` (optional): Target status - prompts if not provided

**Options**:

- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--force, -f`: Skip validation checks

**Example**:

```bash
prlt epic move EPIC-002 complete
prlt epic move --force
```

**Interactive Flow**:

```
? Select epic to move:
  ❯ EPIC-002 API Design (active) [5/5 complete]
    EPIC-001 User Authentication System (active) [6/10 complete]

? Move to which status?
  ❯ active (currently working on)
    draft (planning phase)
    complete (all work done)
    dropped (cancelled/won't do)
    future (backlog for later)

Moving: EPIC-002 "API Design"
From: active → complete

✅ Moved epic EPIC-002 "API Design" to complete
  File: epics/active/EPIC-002.md → epics/complete/EPIC-002.md
```

**Behavior**:

- Moves file between status folders
- Updates status in database
- Validates target status is different

**Status Descriptions**:

- `active`: Currently working on this epic
- `draft`: Planning phase, not started yet
- `complete`: All tickets done, work finished
- `dropped`: Cancelled or won't implement
- `future`: Backlog for future consideration

**Validation Rules**:

Moving to `complete`:
```
⚠️  Not all tickets are complete (6/10 done)
? Continue moving to complete anyway? (y/N)
```

Moving to `dropped`:
```
⚠️  This will mark the epic as dropped/cancelled
? Continue? (y/N)
```

**Relationship to Other Commands**:

- `prlt epic archive` is equivalent to `prlt epic move <id> complete`
- `prlt epic activate` is equivalent to `prlt epic move <id> active`
- `prlt epic move` is the general-purpose command for any status transition

---

### `prlt epic link [id] [tickets...]`

**Purpose**: Link one or more tickets to an epic from the epic namespace

**Status**: ✅ IMPLEMENTED

**Arguments**:

- `id` (optional): Epic ID - prompts if not provided
- `tickets` (optional): One or more ticket IDs to link - prompts with multi-select if not provided

**Options**:

- `--project, -P <id>`: Project ID (default: "default")
- `--unlink, -u`: Remove tickets from this epic instead of adding

**Interactive Flow**:

```
? Select epic to link tickets to:
  ❯ EPIC-001 User Authentication System (active) [6 tickets]
    EPIC-002 Payment Integration (active) [3 tickets]
    EPIC-003 Mobile Redesign (draft) [0 tickets]

? Select tickets to link to EPIC-001: (Use space to select, enter to confirm)
  ❯ ◯ TKT-007 OAuth2 integration [No epic]
    ◯ TKT-008 2FA implementation [No epic]
    ◉ TKT-009 Rate limiting [No epic]
    ◉ TKT-010 Security audit [No epic]
    ◯ TKT-011 API docs [EPIC-002]

Selected 2 tickets

✅ Linked 2 tickets to EPIC-001 "User Authentication System"
   TKT-009: Rate limiting
   TKT-010: Security audit

View epic: prlt epic view EPIC-001
```

**Example**:

```bash
prlt epic link EPIC-001 TKT-009 TKT-010    # Link specific tickets
prlt epic link EPIC-001                     # Interactive multi-select
prlt epic link                              # Full interactive mode
prlt epic link EPIC-001 --unlink TKT-009   # Remove ticket from epic
```

**Output**:

```
✅ Linked 2 tickets to EPIC-001 "User Authentication System"
   TKT-009: Rate limiting
   TKT-010: Security audit

View epic: prlt epic view EPIC-001
```

**Behavior**:

- If no arguments provided, shows interactive prompts
- Multi-select interface for choosing tickets (when no ticket IDs provided)
- Updates ticket.epic_id in database for each selected ticket
- Shows which tickets were already linked to other epics (requires confirmation to reassign)
- `--unlink` sets epic_id to NULL for specified tickets

**Difference from `prlt ticket link`**:

- `prlt epic link` starts from epic selection, then selects tickets (epic-centric workflow)
- `prlt ticket link` starts from ticket selection, then selects epic (ticket-centric workflow)
- `prlt epic link` supports multiple tickets in one command
- Both ultimately update the same `ticket.epic_id` field

**Difference from `prlt tickets link`**:

- `prlt epic link` is epic-centric (select epic first, then tickets)
- `prlt tickets link` is ticket-centric bulk operation (select tickets first, then epic)

---

## Linking Tickets to Epics

Tickets are linked to epics via the `--epic` flag on ticket create:

```bash
prlt ticket create --epic EPIC-001 "Design auth flow"
prlt ticket create --epic EPIC-001 "Implement login" --priority high
```

The `epic_id` field in the ticket database links it to the epic. This is a one-way reference (ticket → epic), no sync needed.

**Listing tickets for an epic**:

```bash
prlt ticket list --epic EPIC-001
```

---

## Design Principles

### Epic Lifecycle

```
draft → active → complete
          ↓
        dropped
          ↓
        future → active (re-prioritized)
```

### Progress Tracking

- Progress = tickets in "Done" / total tickets with `epic_id`
- Visual progress bars for quick scanning
- Breakdown by column for detailed view
- Highlights when ready to archive

### Folder Organization

```
pmo/projects/{projectId}/epics/
├── active/
│   ├── EPIC-001.md
│   └── EPIC-003.md
├── draft/
│   └── EPIC-004.md
├── complete/
│   ├── EPIC-005.md
│   └── EPIC-006.md
├── dropped/
└── future/
```

### Epic vs Spec

| Aspect | Spec | Epic |
|--------|------|------|
| Purpose | Documentation | Work container |
| Status | None (static) | active, draft, complete, dropped, future |
| Tickets | None | Tickets link via `epic_id` |
| Progress | N/A | Tracked via ticket completion |
| Lifecycle | Static | Moves through statuses |

---

## Database Schema

```sql
CREATE TABLE pmo_epics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- active, draft, complete, dropped, future
  file_path TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id)
);

-- Tickets link to epics via epic_id
ALTER TABLE pmo_tickets ADD COLUMN epic_id TEXT REFERENCES pmo_epics(id);
```

---

## Future Enhancements

### Epic Templates

```bash
prlt epic create --template feature
prlt epic create --template initiative
prlt epic create --template milestone
```

### Epic Dependencies

```yaml
---
depends_on:
  - EPIC-001
blocks:
  - EPIC-003
---
```

### Epic Metrics

```bash
prlt epic metrics EPIC-001
# Output: velocity, cycle time, burndown
```

### Bulk Epic Operations

```bash
prlt epics list
prlt epics archive  # Archive all 100% complete
prlt epics move --from draft --to active
```

### Bidirectional Ticket Sync

Currently, ticket sync is **one-directional** (database → markdown):
- When tickets are created/updated, the epic markdown `## Tickets` section is updated
- Changes to the markdown file are NOT synced back to the database

**Future enhancement**: Bidirectional sync would allow:
- Adding tickets by editing the epic markdown file
- Removing ticket links by deleting from the markdown
- Requires conflict detection when both sources change

```bash
# Manual sync command (future)
prlt epic sync EPIC-001           # Sync markdown → database
prlt epic sync --all              # Sync all epics
prlt epic sync --direction=both   # Full bidirectional sync
```

**Conflict resolution strategy** (TBD):
- Database wins (markdown is regenerated)
- Markdown wins (database is updated)
- Prompt user to resolve conflicts
- Use timestamps to detect which changed more recently
