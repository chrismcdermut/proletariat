---
title: PMO Spec Commands Specification
created: 2024-11-28
tickets:
  - id: pmo-spec-commands-001
    title: Implement prlt spec archive command
    description: Move spec to complete/ folder and update status to 'complete' in database
    priority: MEDIUM
    category: feature
  - id: pmo-spec-commands-002
    title: Implement prlt spec activate command
    description: Move spec to active/ folder and update status to 'active' in database
    priority: LOW
    category: feature
  - id: pmo-spec-commands-003
    title: Add spec progress tracking
    description: Show completion percentage based on linked tickets (X/Y done)
    priority: LOW
    category: feature
  - id: pmo-spec-commands-004
    title: Implement prlt spec move command
    description: Move spec between any status folders (active, draft, complete, dropped, future)
    priority: LOW
    category: feature
---

# PMO Spec Commands Specification

> **Note**: For architecture decisions, see [pmo-architecture.md](pmo-architecture.md)

## Overview

Spec commands handle specification documents. Specs are markdown files that describe features, designs, or work to be done. They can define tickets in YAML frontmatter that can be generated as actual tickets in the PMO system.

**Core Concepts**:
- Specs are markdown files with YAML frontmatter
- Specs can define tickets in frontmatter
- Tickets can be linked to specs (one-to-many)
- Specs have statuses (active, draft, archived)
- Specs belong to projects

## Command Overview

| Command                               | Purpose                                | Status            |
| ------------------------------------- | -------------------------------------- | ----------------- |
| `prlt spec`                          | Interactive menu for spec operations   | ✅ Implemented    |
| `prlt spec create [name]`            | Create new spec document               | ✅ Implemented    |
| `prlt spec list`                     | List all specs                         | ✅ Implemented    |
| `prlt spec view [id]`                | View spec and linked tickets           | ✅ Implemented    |
| `prlt spec generate-tickets [spec]`  | Generate tickets from spec frontmatter | ✅ Implemented    |
| `prlt spec link [ticket] [spec]`     | Link existing ticket to spec           | ✅ Implemented    |
| `prlt spec archive [spec]`           | Move spec to complete/ folder          | ❌ Not Implemented |
| `prlt spec activate [spec]`          | Move spec to active/ folder            | ❌ Not Implemented |
| `prlt spec move [spec] [status]`     | Move spec between status folders       | ❌ Not Implemented |
| `prlt spec progress [spec]`          | Show completion percentage             | ❌ Not Implemented |

---

## Command Specifications

### `prlt spec`
**Purpose**: Interactive menu for spec document operations

**Interactive Flow**:
```
? 📄 Spec Operations - What would you like to do?
  ❯ Create new spec
    List all specs
    View spec
    Generate tickets from spec
    Link ticket to spec
    ─────────
    Cancel
```

**Example**:
```bash
prlt spec
```

**Behavior**:
- Shows menu of all spec operations
- Runs selected command
- Returns to menu on completion

---

### `prlt spec create [name]`
**Purpose**: Create a new spec document with template

**Arguments**:
- `name` (optional): Spec name (will prompt if not provided)

**Options**:
- `--name, -n <name>`: Spec name
- `--status, -s <status>`: Spec status (active, draft, archived) [default: active]
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--interactive, -i`: Interactive mode

**Interactive Flow**:
```
? Spec name: User Authentication System
? Spec status:
  ❯ Active (currently working on)
    Draft (planning phase)
    Archived (completed/deprecated)

✅ Created spec "User Authentication System"
  Project: proletariat
  Status: active
  File: pmo/projects/proletariat/specs/active/user-authentication-system.md

Next steps:
  1. Edit the spec file to add details
  2. Add ticket definitions in the frontmatter
  3. Run: prlt spec generate-tickets user-authentication-system
```

**Example**:
```bash
prlt spec create "User Authentication"
prlt spec create --name "API Design" --status draft
prlt spec create -i
```

**Behavior**:
- Creates markdown file in specs/{status}/ directory
- Adds YAML frontmatter with metadata
- Includes template sections (Overview, Goals, Design, Success Criteria)
- Auto-slugifies filename from spec name
- Checks for existing spec before creating

**Template Structure**:
```markdown
---
title: User Authentication System
project: proletariat
created: 2025-11-28T...
status: design
tickets:
  - id: AUTH-001
    title: Design auth flow
    description: Plan OAuth2 implementation
    column: Ready
    priority: high
  - id: AUTH-002
    title: Implement login endpoint
    column: Ready
---

# User Authentication System

## Overview
[Describe what this spec covers and why it's important]

## Goals
- [ ] Goal 1
- [ ] Goal 2

## Design
[Describe the approach, architecture, or implementation plan]

## Tickets
This spec defines tickets (see frontmatter above).
Use `prlt spec generate-tickets user-authentication-system` to create them.

## Success Criteria
- [ ] Criterion 1
```

---

### `prlt spec list`
**Purpose**: List all spec documents across all statuses

**Options**:
- `--status, -s <status>`: Filter by status (active, draft, archived)
- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Example**:
```bash
prlt spec list
prlt spec list --status active
prlt spec list --project mobile-app
```

**Output**:
```
📄 Specs - proletariat
═══════════════════════════════════════════════════

🟢 ACTIVE (3)
  user-authentication-system: User Authentication System [2 tickets]
     pmo/projects/proletariat/specs/active/user-authentication-system.md
  api-design: API Design [5 tickets]
     pmo/projects/proletariat/specs/active/api-design.md
  payment-integration: Payment Integration
     pmo/projects/proletariat/specs/active/payment-integration.md

🟡 DRAFT (1)
  mobile-redesign: Mobile App Redesign
     pmo/projects/proletariat/specs/draft/mobile-redesign.md

═══════════════════════════════════════════════════
Total: 4 specs

Commands:
  prlt spec create           Create a new spec
  prlt spec view <id>        View spec details
  prlt spec generate-tickets Generate tickets from spec
```

**Behavior**:
- Groups specs by status (active, draft, archived)
- Shows ticket count if defined in frontmatter
- Displays relative file paths
- Supports filtering by status or project

---

### `prlt spec view [id]`
**Purpose**: View spec document and its linked tickets

**Arguments**:
- `id` (optional): Spec ID (filename without .md) - prompts if not provided

**Options**:
- `--spec, -s <id>`: Spec ID
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--full, -f`: Show full spec content

**Example**:
```bash
prlt spec view user-authentication-system
prlt spec view --spec api-design --full
```

**Output** (without --full):
```
📄 Spec: User Authentication System
═══════════════════════════════════════════════════
ID: user-authentication-system
Project: proletariat
Status: active
Created: 11/28/2025
File: pmo/projects/proletariat/specs/active/user-authentication-system.md

🎫 Linked Tickets (2):
  AUTH-001: Design auth flow [Ready]
  AUTH-002: Implement login endpoint [In Progress]

📋 Ticket Definitions in Spec (2):
  AUTH-001: Design auth flow [Ready]
  AUTH-002: Implement login endpoint [Ready]

Generate these tickets:
  prlt spec generate-tickets user-authentication-system

═══════════════════════════════════════════════════
To view full content, add --full flag
```

**Output** (with --full):
```
[Same header as above]

═══════════════════════════════════════════════════

📝 Content:

[Full markdown content of the spec file]
```

**Behavior**:
- Shows spec metadata from frontmatter
- Lists tickets already linked to this spec (from database)
- Lists ticket definitions in frontmatter (not yet created)
- Optionally displays full spec content with --full flag

---

### `prlt spec generate-tickets [spec]`
**Purpose**: Generate tickets from spec frontmatter definitions

**Arguments**:
- `spec` (optional): Spec ID - prompts if not provided

**Options**:
- `--spec, -s <id>`: Spec ID
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--dry-run`: Show what would be created without creating tickets

**Example**:
```bash
prlt spec generate-tickets user-authentication-system
prlt spec generate-tickets --dry-run
```

**Output**:
```
📄 Generate Tickets from Spec: user-authentication-system
Project: proletariat
═══════════════════════════════════════════════════

Found 2 tickets to create:

  AUTH-001: Design auth flow [high] {BUILD}
     Column: Ready
     Plan OAuth2 implementation approach

  AUTH-002: Implement login endpoint
     Column: Ready

? Create these tickets? (Y/n) Yes

✅ Created 2 tickets from spec "user-authentication-system"

View the board:
  prlt board
  prlt ticket list
```

**Behavior**:
- Parses YAML frontmatter `tickets:` section
- Validates column names against project board
- Shows preview of tickets to create
- Requires confirmation unless --force
- Creates tickets with spec linkage (sets `specs: [spec-id]`)
- Auto-exports to board.md
- Supports dry-run mode

**Frontmatter Format**:
```yaml
---
tickets:
  - id: AUTH-001
    title: Design auth flow
    description: Plan OAuth2 implementation
    column: Ready
    priority: high
    category: BUILD
  - id: AUTH-002
    title: Implement login endpoint
    column: Ready
---
```

---

### `prlt spec link [ticket] [spec]`
**Purpose**: Link an existing ticket to a spec document

**Arguments**:
- `ticket` (optional): Ticket ID - prompts if not provided
- `spec` (optional): Spec ID - prompts if not provided

**Options**:
- `--ticket, -t <id>`: Ticket ID
- `--spec, -s <id>`: Spec ID
- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Example**:
```bash
prlt spec link AUTH-003 user-authentication-system
prlt spec link --ticket AUTH-003 --spec api-design
prlt spec link  # Interactive mode
```

**Interactive Flow** (no arguments):
```
? Select ticket to link:
  ❯ AUTH-003: Add session management (Ready)
    AUTH-004: Implement logout (Ready)

? Select spec to link:
  ❯ user-authentication-system (active)
    api-design (active)
    payment-integration (draft)

✅ Linked ticket "AUTH-003" to spec "user-authentication-system"

View ticket:
  prlt ticket view AUTH-003
```

**Behavior**:
- Adds spec ID to ticket's `spec_id` field (one-to-many)
- Checks if already linked (warns and skips)
- Validates that both ticket and spec exist
- Auto-exports to board.md after linking

---

### `prlt spec archive [spec]`
**Purpose**: Archive a completed spec by moving it to complete/ folder and updating database status

**Arguments**:
- `spec` (optional): Spec ID - prompts if not provided

**Options**:
- `--spec, -s <id>`: Spec ID
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--force, -f`: Skip ticket completion check

**Example**:
```bash
prlt spec archive pmo-schema-refactor
prlt spec archive --spec user-auth --force
prlt spec archive  # Interactive mode
```

**Interactive Flow** (no spec provided):
```
? Select spec to archive:
  ❯ pmo-schema-refactor (active) [12/12 tickets complete]
    user-authentication-system (active) [2/5 tickets complete]
    api-design (active) [0 tickets]

Archiving: pmo-schema-refactor
Status: 12/12 tickets complete ✅

✅ Archived spec "pmo-schema-refactor"
  Moved: specs/active/pmo-schema-refactor.md → specs/complete/pmo-schema-refactor.md
  Status: active → complete

View archived specs:
  prlt spec list --status complete
```

**Behavior**:
- Checks all linked tickets are in "Merged" or "Published" columns
- Warns if tickets are incomplete (requires --force to continue)
- Moves file from `specs/active/` to `specs/complete/`
- Updates `pmo_specs.file_path` in database
- Updates `pmo_specs.status` to 'complete'
- Validates spec exists and is currently 'active'

**Validation**:
```
⚠️  Not all tickets are complete (2/5 done)
? Continue archiving anyway? (y/N)
```

---

### `prlt spec activate [spec]`
**Purpose**: Activate a draft or completed spec by moving it to active/ folder

**Arguments**:
- `spec` (optional): Spec ID - prompts if not provided

**Options**:
- `--spec, -s <id>`: Spec ID
- `--project, -p <id>`: Project ID (prompts if multiple exist)

**Example**:
```bash
prlt spec activate user-authentication-system
prlt spec activate --spec api-design
prlt spec activate  # Interactive mode
```

**Interactive Flow** (no spec provided):
```
? Select spec to activate:
  ❯ mobile-redesign (draft)
    pmo-schema-refactor (complete) [12 tickets]
    old-feature (dropped)

Activating: mobile-redesign
Current status: draft

✅ Activated spec "mobile-redesign"
  Moved: specs/draft/mobile-redesign.md → specs/active/mobile-redesign.md
  Status: draft → active

Next steps:
  prlt spec view mobile-redesign
  prlt spec generate-tickets mobile-redesign
```

**Behavior**:
- Moves file from `specs/draft/` or `specs/complete/` to `specs/active/`
- Updates `pmo_specs.file_path` in database
- Updates `pmo_specs.status` to 'active'
- Validates spec exists and is not already 'active'
- Shows next steps based on spec state (tickets defined, etc.)

**Warning for Complete Specs**:
```
⚠️  This spec was previously completed (12/12 tickets done)
? Reactivate this spec? (y/N)
```

---

### `prlt spec progress [spec]`
**Purpose**: Show completion percentage based on linked tickets

**Arguments**:
- `spec` (optional): Spec ID - prompts if not provided

**Options**:
- `--spec, -s <id>`: Spec ID
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--all, -a`: Show progress for all specs

**Example**:
```bash
prlt spec progress pmo-schema-refactor
prlt spec progress --all
```

**Output** (single spec):
```
📄 Spec Progress: pmo-schema-refactor
═══════════════════════════════════════════════════

Status: active
Tickets: 12/12 complete (100%)

█████████████████████ 100%

Breakdown:
  ✅ Merged:    12 tickets
  ⏸️  Blocked:   0 tickets
  🏗️  BUILD BL:  0 tickets
  📋 Ready:     0 tickets

All tickets complete! Ready to archive.
  prlt spec archive pmo-schema-refactor
```

**Output** (--all):
```
📊 Spec Progress - All Specs
═══════════════════════════════════════════════════

🟢 ACTIVE (3)
  pmo-schema-refactor        ████████████████████ 100% (12/12)
  user-authentication-system ████████░░░░░░░░░░░░  40% (2/5)
  api-design                 ░░░░░░░░░░░░░░░░░░░░   0% (0/3)

🟡 DRAFT (1)
  mobile-redesign            ░░░░░░░░░░░░░░░░░░░░   0% (0/0)

Commands:
  prlt spec progress <id>    View detailed progress
  prlt spec archive <id>     Archive completed spec
```

**Behavior**:
- Counts tickets linked to spec (`spec_id` field)
- Calculates completion based on "Merged" or "Published" column
- Shows visual progress bar (20 chars wide)
- Breaks down by column for detailed view
- Suggests archiving if 100% complete

---

### `prlt spec move [spec] [status]`
**Purpose**: Move spec between any status folders (general-purpose alternative to archive/activate)

**Arguments**:
- `spec` (optional): Spec ID - prompts if not provided
- `status` (optional): Target status (active, draft, complete, dropped, future) - prompts if not provided

**Options**:
- `--spec, -s <id>`: Spec ID
- `--status, -t <status>`: Target status
- `--project, -p <id>`: Project ID (prompts if multiple exist)
- `--force, -f`: Skip validation checks

**Example**:
```bash
prlt spec move pmo-schema-refactor complete
prlt spec move --spec my-feature --status draft
prlt spec move  # Interactive mode
```

**Interactive Flow** (no arguments):
```
? Select spec to move:
  ❯ pmo-schema-refactor (active) [12/12 tickets complete]
    user-authentication-system (active) [2/5 tickets complete]
    api-design (draft) [0 tickets]

? Move to which status?
  ❯ active (currently working on)
    draft (planning phase)
    complete (all work done)
    dropped (cancelled/won't do)
    future (backlog for later)

Moving: pmo-schema-refactor
From: active → complete

✅ Moved spec "pmo-schema-refactor" to complete
  File: specs/active/pmo-schema-refactor.md → specs/complete/pmo-schema-refactor.md
  Status: active → complete

Commands:
  prlt spec list --status complete
  prlt spec view pmo-schema-refactor
```

**Behavior**:
- Moves file from source folder to target folder (e.g., `specs/active/` → `specs/complete/`)
- Updates `pmo_specs.file_path` in database
- Updates `pmo_specs.status` in database
- Validates spec exists
- Validates target status is different from current status
- Shows confirmation before moving

**Validation Rules**:

**Moving to `complete`:**
```
⚠️  Not all tickets are complete (2/5 done)
? Continue moving to complete anyway? (y/N)
```

**Moving from `complete` to `active`:**
```
⚠️  This spec was previously completed (12/12 tickets done)
? Reactivate this spec? (y/N)
```

**Moving to `dropped`:**
```
⚠️  This will mark the spec as dropped/cancelled
? Continue? (y/N)
```

**Status Descriptions**:
- `active`: Currently working on this spec
- `draft`: Planning phase, not started yet
- `complete`: All tickets done, work finished
- `dropped`: Cancelled or won't implement
- `future`: Backlog for future consideration

**Relationship to Other Commands**:
- `prlt spec archive` is equivalent to `prlt spec move <spec> complete`
- `prlt spec activate` is equivalent to `prlt spec move <spec> active`
- `prlt spec move` is the general-purpose command for any status transition

---

## Design Principles

### Spec-Driven Development
- Specs define the "what" and "why"
- Tickets define the "how" (implementation tasks)
- Specs can generate multiple tickets
- Tickets track back to their spec

### YAML Frontmatter
- Metadata in frontmatter (title, project, created, status)
- Ticket definitions in frontmatter (tickets array)
- Allows programmatic ticket generation
- Keeps spec and tickets in sync

### Status Organization
- Specs organized by status (active, draft, archived)
- Active: Currently working on
- Draft: Planning phase
- Archived: Completed or deprecated

### One-to-Many Relationship
- Changed from many-to-many (pmo_ticket_specs) to one-to-many
- Each ticket linked to one spec (spec_id)
- Simpler model, clearer ownership

---

## Future Enhancements

### Spec Templates
```bash
prlt spec create --template feature
prlt spec create --template bug-fix
prlt spec create --template refactor
```

### Spec Status Transitions
```bash
prlt spec activate user-authentication-system  # draft → active
prlt spec archive user-authentication-system   # active → archived
prlt spec draft api-design                     # active → draft
```

### Spec Dependencies
```yaml
---
depends_on:
  - user-authentication-system
  - api-design
---
```

### Auto-Linking
```bash
# Automatically link tickets mentioned in spec content
prlt spec auto-link user-authentication-system
```

### Spec Completion Tracking
```bash
# Show spec progress based on linked ticket completion
prlt spec progress user-authentication-system
# Output: 2/5 tickets complete (40%)
```
