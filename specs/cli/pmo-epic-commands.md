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

## Command Overview

| Command                           | Purpose                              |
| --------------------------------- | ------------------------------------ |
| `prlt epic`                       | Interactive menu for epic operations |
| `prlt epic create [name]`         | Create new epic                      |
| `prlt epic list`                  | List all epics                       |
| `prlt epic view [id]`             | View epic and linked tickets         |
| `prlt epic archive [id]`          | Move epic to complete/ folder        |
| `prlt epic activate [id]`         | Move epic to active/ folder          |
| `prlt epic move [id] [status]`    | Move epic between status folders     |
| `prlt epic progress [id]`         | Show completion percentage           |

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

### `prlt epic create [name]`

**Purpose**: Create a new epic with initial status

**Arguments**:

- `name` (optional): Epic name (will prompt if not provided)

**Options**:

- `--name, -n <name>`: Epic name
- `--status, -s <status>`: Initial status (active, draft) [default: active]
- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Interactive Flow**:

```
? Epic name: User Authentication System
? Initial status:
  ❯ Active (currently working on)
    Draft (planning phase)

✅ Created epic "User Authentication System"
  Project: proletariat
  Status: active
  File: pmo/projects/proletariat/epics/active/user-authentication-system.md

Next steps:
  1. Create tickets linked to this epic:
     prlt ticket create --epic user-authentication-system "Design auth flow"
  2. View progress: prlt epic progress user-authentication-system
```

**Example**:

```bash
prlt epic create "User Authentication"
prlt epic create --name "API Design" --status draft
```

**Behavior**:

- Creates markdown file in epics/{status}/ directory
- Adds YAML frontmatter with metadata (title, status, created)
- Registers epic in database
- Auto-slugifies filename from epic name

**Template Structure**:

```markdown
---
title: User Authentication System
status: active
created: 2025-12-02T...
---

# User Authentication System

## Overview
[Describe what this epic covers]

## Goals
- [ ] Goal 1
- [ ] Goal 2

## Success Criteria
- [ ] Criterion 1
```

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
  user-authentication-system   ████████████░░░░░░░░  60% (6/10)
     User Authentication System
  api-design                   ████████████████████ 100% (5/5)
     API Design - ready to archive!
  payment-integration          ░░░░░░░░░░░░░░░░░░░░   0% (0/3)
     Payment Integration

🟡 DRAFT (1)
  mobile-redesign              ░░░░░░░░░░░░░░░░░░░░   0% (0/0)
     Mobile App Redesign

✅ COMPLETE (2)
  initial-setup                ████████████████████ 100% (8/8)
  auth-v1                      ████████████████████ 100% (12/12)

═══════════════════════════════════════════════════
Total: 6 epics (3 active, 1 draft, 2 complete)

Commands:
  prlt epic progress <id>    View detailed progress
  prlt epic archive <id>     Archive completed epic
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
prlt epic view user-authentication-system
prlt epic view --full
```

**Output**:

```
🎯 Epic: User Authentication System
═══════════════════════════════════════════════════
ID: user-authentication-system
Project: proletariat
Status: active
Created: 12/02/2025
File: pmo/projects/proletariat/epics/active/user-authentication-system.md

Progress: 60% (6/10 tickets complete)
████████████░░░░░░░░

🎫 Tickets (10):
  ✅ AUTH-001: Design auth flow [Done]
  ✅ AUTH-002: Implement login [Done]
  ✅ AUTH-003: Implement logout [Done]
  ✅ AUTH-004: Session management [Done]
  ✅ AUTH-005: Password reset flow [Done]
  ✅ AUTH-006: Email verification [Done]
  🚧 AUTH-007: OAuth2 integration [In Progress]
  📋 AUTH-008: 2FA implementation [Ready]
  📋 AUTH-009: Rate limiting [Backlog]
  📋 AUTH-010: Security audit [Backlog]

═══════════════════════════════════════════════════
Commands:
  prlt epic progress user-authentication-system
  prlt ticket create --epic user-authentication-system "New task"
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
prlt epic archive api-design
prlt epic archive --force
```

**Interactive Flow**:

```
? Select epic to archive:
  ❯ api-design (active) [5/5 tickets complete] ✅
    user-authentication-system (active) [6/10 tickets complete]

Archiving: api-design
Status: 5/5 tickets complete ✅

✅ Archived epic "api-design"
  Moved: epics/active/api-design.md → epics/complete/api-design.md
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
prlt epic activate mobile-redesign
```

**Interactive Flow**:

```
? Select epic to activate:
  ❯ mobile-redesign (draft)
    old-feature (dropped)

Activating: mobile-redesign
Current status: draft

✅ Activated epic "mobile-redesign"
  Moved: epics/draft/mobile-redesign.md → epics/active/mobile-redesign.md
  Status: draft → active

Next steps:
  prlt epic view mobile-redesign
  prlt ticket create --epic mobile-redesign "First task"
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
prlt epic progress user-authentication-system
prlt epic progress --all
```

**Output** (single epic):

```
🎯 Epic Progress: user-authentication-system
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
  AUTH-007: OAuth2 integration [In Progress]
  AUTH-008: 2FA implementation [Ready]
  AUTH-009: Rate limiting [Backlog]
  AUTH-010: Security audit [Backlog]
```

**Output** (--all):

```
📊 Epic Progress - All Epics
═══════════════════════════════════════════════════

🟢 ACTIVE (3)
  api-design                   ████████████████████ 100% (5/5) ← ready to archive
  user-authentication-system   ████████████░░░░░░░░  60% (6/10)
  payment-integration          ░░░░░░░░░░░░░░░░░░░░   0% (0/3)

🟡 DRAFT (1)
  mobile-redesign              ░░░░░░░░░░░░░░░░░░░░   0% (0/0)

Commands:
  prlt epic progress <id>    View detailed progress
  prlt epic archive <id>     Archive completed epic
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
prlt epic move api-design complete
prlt epic move --force
```

**Interactive Flow**:

```
? Select epic to move:
  ❯ api-design (active) [5/5 complete]
    user-authentication-system (active) [6/10 complete]

? Move to which status?
  ❯ active (currently working on)
    draft (planning phase)
    complete (all work done)
    dropped (cancelled/won't do)
    future (backlog for later)

Moving: api-design
From: active → complete

✅ Moved epic "api-design" to complete
  File: epics/active/api-design.md → epics/complete/api-design.md
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

## Linking Tickets to Epics

Tickets are linked to epics via the `--epic` flag on ticket create:

```bash
prlt ticket create --epic user-authentication-system "Design auth flow"
prlt ticket create --epic user-authentication-system "Implement login" --priority high
```

The `epic_id` field in the ticket database links it to the epic. This is a one-way reference (ticket → epic), no sync needed.

**Listing tickets for an epic**:

```bash
prlt ticket list --epic user-authentication-system
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
│   ├── user-authentication-system.md
│   └── payment-integration.md
├── draft/
│   └── mobile-redesign.md
├── complete/
│   ├── initial-setup.md
│   └── auth-v1.md
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
  - user-authentication-system
blocks:
  - payment-integration
---
```

### Epic Metrics

```bash
prlt epic metrics user-authentication-system
# Output: velocity, cycle time, burndown
```

### Bulk Epic Operations

```bash
prlt epics list
prlt epics archive  # Archive all 100% complete
prlt epics move --from draft --to active
```
