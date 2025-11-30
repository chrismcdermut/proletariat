---
title: PMO Local Sync - Bidirectional Sync Between Spec, DB, and Board
created: 2024-11-30T00:45:00.000Z
status: design
tickets:
  - id: SYNC-001
    title: Implement auto-sync pre-hook
    description: oclif init hook that detects board.md changes and syncs to DB before every command
    priority: HIGH
    category: sync
  - id: SYNC-002
    title: Add last sync timestamp tracking
    description: Store last board sync time in pmo_settings table to detect changes
    priority: HIGH
    category: sync
  - id: SYNC-003
    title: Implement conflict detection
    description: Compare last_synced_from_spec vs last_synced_from_board to detect conflicting edits
    priority: HIGH
    category: sync
  - id: SYNC-004
    title: Build interactive conflict resolution
    description: Field-by-field prompts when both spec and board have been edited
    priority: MEDIUM
    category: sync
  - id: SYNC-005
    title: Update spec generate-tickets to set sync timestamp
    description: Set last_synced_from_spec when syncing tickets from spec frontmatter
    priority: HIGH
    category: sync
  - id: SYNC-006
    title: Implement board.md parser with sync timestamp
    description: Parse board.md and set last_synced_from_board on tickets
    priority: HIGH
    category: sync
  - id: SYNC-007
    title: Add prlt board sync command
    description: Manual command to sync board.md changes (fallback if hook doesn't run)
    priority: MEDIUM
    category: commands
  - id: SYNC-008
    title: Implement spec file location sync
    description: Auto-sync spec status with file location (active/ vs complete/ vs draft/)
    priority: LOW
    category: sync
  - id: SYNC-009
    title: Add spec status detection in pre-hook
    description: Detect when spec file is moved manually and update database status
    priority: LOW
    category: sync
---

# PMO Local Sync

## Overview

Implement bidirectional sync between three representations of ticket data:
- **Spec frontmatter** (YAML in .md files) - design-time ticket definitions
- **Database** (SQLite) - source of truth
- **Board.md** (Markdown kanban) - visual workflow view

Users should be able to edit tickets in any location and have changes propagate automatically.

## Goals

- [ ] Auto-sync board.md changes before every command
- [ ] Detect conflicts when both spec and board edited
- [ ] Interactive conflict resolution (field-by-field)
- [ ] Track sync timestamps to know which source is newer
- [ ] Preserve field ownership (spec owns design fields, board owns workflow fields)

## Sync Model

### Field Ownership

| Field | Spec Frontmatter | Board.md | CLI | Authority |
|-------|-----------------|----------|-----|-----------|
| title | ✅ Edit | ✅ Display | ✅ Edit | Both (conflict detection) |
| description | ✅ Edit | ✅ Display | ✅ Edit | Both (conflict detection) |
| priority | ✅ Edit | ✅ Display | ✅ Edit | Both (conflict detection) |
| category | ✅ Edit | ✅ Display | ✅ Edit | Both (conflict detection) |
| status | ❌ N/A | ❌ Derived | ✅ Edit | DB only |
| owner | ❌ N/A | ⚠️ Display? | ✅ Edit | DB only |
| assignee | ❌ N/A | ⚠️ Display? | ✅ Edit | DB only |
| column | ❌ N/A | ✅ Implicit | ✅ Edit | Board.md |
| position | ❌ N/A | ✅ Implicit | ❌ N/A | Board.md |

### Sync Flow

**1. Spec → DB (Manual)**
```bash
prlt spec generate-tickets <spec>
# Prompts for conflicts if ticket exists
# Updates: title, description, priority, category
# Sets: last_synced_from_spec = now
# Preserves: status, owner, assignee, column, position
```

**2. Board → DB (Automatic via Hook)**
```bash
# Any command triggers pre-hook
prlt <any-command>
# Pre-hook checks: board.md mtime > last_board_sync
# If changed: parse board.md, sync to DB
# Updates: column, position, title/desc/priority/category (if no conflict)
# Sets: last_synced_from_board = now
```

**3. DB → Board (Automatic)**
```bash
# After any DB change
await autoExportToBoard()
# Regenerates board.md from current DB state
```

### Conflict Detection

**Conflict occurs when:**
1. Ticket synced from spec (sets `last_synced_from_spec`)
2. THEN board.md edited (different value for same field)
3. Hook runs and detects: `board value != db value` AND `last_synced_from_spec > last_synced_from_board`

**Resolution:**
```
⚠️  Ticket WORK-001 has conflicting edits

title:
  Spec:  New Title A (synced 2024-11-30 10:00)
  Board: New Title B (edited 2024-11-30 10:05)

Which title to use?
  1) Spec: New Title A
  2) Board: New Title B
  3) Edit manually
```

## Implementation

### Phase 1: Hook Infrastructure
```typescript
// apps/cli/src/hooks/init/auto-sync-board.ts
import { Hook } from '@oclif/core'

const hook: Hook<'init'> = async function (opts) {
  const pmoPath = findPMO()
  if (!pmoPath) return

  const boardMtime = getBoardMtime()
  const lastSync = await getLastBoardSync()

  if (boardMtime > lastSync) {
    await syncBoardToDatabase()
    await setLastBoardSync(boardMtime)
  }
}
```

### Phase 2: Conflict Detection
```typescript
function detectConflict(dbTicket, boardTicket) {
  const conflicts = []
  const fields = ['title', 'description', 'priority', 'category']

  for (const field of fields) {
    if (dbTicket[field] !== boardTicket[field]) {
      if (dbTicket.lastSyncedFromSpec > dbTicket.lastSyncedFromBoard) {
        conflicts.push({ field, specValue, boardValue, ... })
      }
    }
  }

  return conflicts.length > 0 ? conflicts : null
}
```

### Phase 3: Interactive Resolution
```typescript
async function resolveConflicts(conflicts) {
  for (const { dbTicket, boardTicket, conflict } of conflicts) {
    const choice = await inquirer.prompt([{
      type: 'list',
      message: 'Conflicting edits detected.',
      choices: [
        'Use board.md version',
        'Use spec version',
        'Review field-by-field',
        'Skip for now'
      ]
    }])

    // Handle resolution...
  }
}
```

## Success Criteria

- [ ] Hook runs before every command
- [ ] Board.md edits sync to DB automatically
- [ ] Conflicts detected and presented to user
- [ ] Field-by-field resolution works
- [ ] Sync timestamps tracked correctly
- [ ] No data loss from overwrites

## Spec Status Syncing

### Overview
The database tracks spec status (`active`, `complete`, `draft`, `dropped`) in the `pmo_specs.status` field, while the filesystem organizes specs by folder (`specs/active/`, `specs/complete/`, `specs/draft/`, `specs/dropped/`). These two representations should stay in sync.

### File Location → Status Mapping

```
specs/active/     → status = 'active'
specs/complete/   → status = 'complete'
specs/draft/      → status = 'draft'
specs/dropped/    → status = 'dropped'
specs/future/     → status = 'future'
```

### Sync Approach

**Option A: Command-Driven (Recommended)**
- Use `prlt spec archive` and `prlt spec activate` commands
- Commands move file AND update database atomically
- User explicitly controls status transitions
- No automatic sync needed

**Option B: Auto-Sync in Pre-Hook (Future)**
- Pre-hook detects when spec file location doesn't match database status
- Updates database status to match file location
- Warns user about manual file moves
- Allows manual file organization to work

### Implementation (Option B)

```typescript
// apps/cli/src/hooks/init/auto-sync-specs.ts
const hook: Hook<'init'> = async function (opts) {
  const pmoPath = findPMO()
  if (!pmoPath) return

  // Get all specs from database
  const specs = storage.getAllSpecs()

  for (const spec of specs) {
    // Detect file location
    const filePath = spec.file_path
    const expectedStatus = getStatusFromPath(filePath)

    // If mismatch, update database
    if (spec.status !== expectedStatus) {
      this.warn(`Spec "${spec.id}" moved: ${spec.status} → ${expectedStatus}`)
      storage.updateSpec(spec.id, { status: expectedStatus })
    }
  }
}

function getStatusFromPath(filePath: string): SpecStatus {
  if (filePath.includes('/active/')) return 'active'
  if (filePath.includes('/complete/')) return 'complete'
  if (filePath.includes('/draft/')) return 'draft'
  if (filePath.includes('/dropped/')) return 'dropped'
  if (filePath.includes('/future/')) return 'future'
  return 'active' // default
}
```

### Validation Rules

**Moving to `complete/`:**
- Should verify all linked tickets are in "Merged" or "Published" columns
- Warn if tickets incomplete (but allow with confirmation)

**Moving from `complete/` back to `active/`:**
- Warn user that spec was previously completed
- Ask for confirmation to reactivate

### Database Schema

The `pmo_specs` table already supports this:
```sql
CREATE TABLE pmo_specs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT CHECK(status IN ('active', 'complete', 'draft', 'dropped', 'future')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id)
);
```

### User Experience

**With Commands (Recommended)**:
```bash
# Archive a completed spec
prlt spec archive pmo-schema-refactor
# ✅ Archived spec "pmo-schema-refactor"
#   Moved: specs/active/pmo-schema-refactor.md → specs/complete/pmo-schema-refactor.md
#   Status: active → complete

# Reactivate a spec
prlt spec activate pmo-schema-refactor
# ⚠️  This spec was previously completed (12/12 tickets done)
# ? Reactivate this spec? (y/N)
```

**With Manual File Move + Auto-Sync (Future)**:
```bash
# User manually moves file
mv specs/active/my-spec.md specs/complete/

# Next command auto-syncs
prlt ticket list
# ⚠️  Spec "my-spec" moved: active → complete
# Database status updated to match file location
```

### Priority

Spec status syncing is **LOW priority** because:
1. Users can manually move files and update database with SQL (works today)
2. `prlt spec archive` and `prlt spec activate` commands provide better UX
3. Auto-sync adds complexity for limited benefit
4. Focus should be on ticket syncing first (higher impact)

### Related Commands

See [pmo-spec-commands.md](../active/pmo-spec-commands.md) for:
- `prlt spec archive [spec]` - Move to complete/ folder
- `prlt spec activate [spec]` - Move to active/ folder
- `prlt spec progress [spec]` - Check completion status

---

## Future Enhancements (Out of Scope)

- File watcher for background sync
- Git hooks for commit-time sync
- Sync conflict history/audit log
- Automatic conflict resolution strategies
- Sync from board.md → spec frontmatter (currently one-way)

## Notes

- Requires schema refactor (REFACTOR-005 ticket) for sync tracking fields
- Pre-hook approach means no watcher process needed
- Only syncs when PMO exists (graceful for non-PMO repos)
- Silent sync unless conflicts or --verbose flag
