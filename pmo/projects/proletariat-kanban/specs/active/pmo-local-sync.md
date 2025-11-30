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
