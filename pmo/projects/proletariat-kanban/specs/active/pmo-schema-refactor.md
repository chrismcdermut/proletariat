---
title: PMO Schema Refactor - Normalize Board View & Add Sync Support
created: 2024-11-30T00:30:00.000Z
status: design
tickets:
  - id: REFACTOR-001
    title: Remove epic_id and pmo_epics table
    description: Epics are replaced by specs - remove epic concept entirely
    priority: HIGH
    category: schema
  - id: REFACTOR-002
    title: Add status field to pmo_tickets
    description: Add lifecycle status separate from column position (backlog, ready, in_progress, blocked, review, done, cancelled)
    priority: HIGH
    category: schema
  - id: REFACTOR-003
    title: Add owner and assignee fields to pmo_tickets
    description: Add owner (human responsible) and assignee (executor - human or agent) fields
    priority: HIGH
    category: schema
  - id: REFACTOR-004
    title: Create pmo_board_tickets table
    description: Normalize board view state into separate table (column_id, position)
    priority: HIGH
    category: schema
  - id: REFACTOR-005
    title: Add sync tracking fields
    description: Add last_synced_from_spec and last_synced_from_board timestamps for conflict detection
    priority: HIGH
    category: schema
  - id: REFACTOR-006
    title: Update Ticket TypeScript interface
    description: Update types.ts to match new schema (remove epicId/column/position, add status/owner/assignee/sync fields)
    priority: HIGH
    category: types
  - id: REFACTOR-007
    title: Create BoardTicket interface
    description: Add new interface for board view state
    priority: MEDIUM
    category: types
  - id: REFACTOR-008
    title: Refactor storage-sqlite.ts schema creation
    description: Update ensurePMOTables() with new schema
    priority: HIGH
    category: storage
  - id: REFACTOR-009
    title: Update createTicket to use new schema
    description: Create ticket in pmo_tickets, then create board position in pmo_board_tickets
    priority: HIGH
    category: storage
  - id: REFACTOR-010
    title: Update getBoard to join pmo_board_tickets
    description: Query must join tickets with board_tickets to get column/position
    priority: HIGH
    category: storage
  - id: REFACTOR-011
    title: Add updateBoardPosition method
    description: New method to update ticket position on board without touching ticket data
    priority: MEDIUM
    category: storage
  - id: REFACTOR-012
    title: Test ticket creation flow
    description: Verify prlt spec generate-tickets works with new schema
    priority: HIGH
    category: testing
---

# PMO Schema Refactor

## Overview

Refactor the PMO database schema to:
1. Remove epics (replaced by specs)
2. Add status/owner/assignee for agent orchestration
3. Normalize board view state into separate table
4. Add sync tracking for conflict detection

This sets the foundation for bidirectional sync between spec frontmatter, database, and board.md.

## Goals

- [x] Remove epic concept (specs replace epics)
- [ ] Clean separation between ticket data and board layout
- [ ] Support for lifecycle status tracking
- [ ] Support for owner/assignee workflow
- [ ] Foundation for conflict detection in sync

## Current Schema Problems

1. **Epic redundancy**: Both `pmo_epics` table and `pmo_specs` exist - specs should replace epics
2. **Denormalized board state**: `column_id` and `position` on ticket table couples data to view
3. **Missing workflow fields**: No `status`, `owner`, or `assignee` for orchestration
4. **No sync tracking**: Can't detect conflicts between spec/board/DB edits

## New Schema Design

### Core Entities

#### pmo_tickets (Pure ticket data)
```sql
CREATE TABLE pmo_tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  owner TEXT,
  assignee TEXT,
  spec_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced_from_spec TIMESTAMP,
  last_synced_from_board TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
);
```

#### pmo_board_tickets (Board view state)
```sql
CREATE TABLE pmo_board_tickets (
  project_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, ticket_id),
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
);
```

### Removed

- `pmo_epics` table - deleted entirely
- `pmo_ticket_specs` many-to-many table - simplified to `spec_id` on ticket
- `epic_id` column from `pmo_tickets`
- `column_id`, `position` columns from `pmo_tickets`

### Added

- `status` column to `pmo_tickets`
- `owner` column to `pmo_tickets`
- `assignee` column to `pmo_tickets`
- `last_synced_from_spec` column to `pmo_tickets`
- `last_synced_from_board` column to `pmo_tickets`
- Entire `pmo_board_tickets` table

## TypeScript Interface Changes

### Before
```typescript
interface Ticket {
  id: string
  title: string
  column: string           // ❌ Remove
  position: number         // ❌ Remove
  epicId?: string          // ❌ Remove
  specs: string[]
  // ...
}
```

### After
```typescript
interface Ticket {
  id: string
  title: string
  description?: string
  priority?: string
  category?: string
  status: TicketStatus     // ✅ Add
  owner?: string           // ✅ Add
  assignee?: string        // ✅ Add
  specId?: string          // ✅ Changed from epicId
  subtasks: Subtask[]
  metadata: Record<string, string>
  createdAt: Date
  updatedAt: Date
  lastSyncedFromSpec?: Date  // ✅ Add
  lastSyncedFromBoard?: Date // ✅ Add
}

interface BoardTicket {    // ✅ New interface
  projectId: string
  ticketId: string
  columnId: string
  position: number
}

type TicketStatus =        // ✅ New type
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled'
```

## Implementation Plan

### Phase 1: Schema Changes
1. Update `storage-sqlite.ts` - `ensurePMOTables()` with new schema
2. Delete existing workspace.db (fresh start)
3. Run `prlt pmo init` to create new schema

### Phase 2: Type Updates
1. Update `types.ts` - modify `Ticket` interface
2. Add `BoardTicket` interface
3. Add `TicketStatus` type

### Phase 3: Storage Layer
1. Update `createTicket()` - create in both tables
2. Update `getBoard()` - join with `pmo_board_tickets`
3. Add `updateBoardPosition()` method
4. Update `moveTicket()` - update board_tickets table
5. Update all ticket queries to join board_tickets when needed

### Phase 4: Testing
1. Test `prlt pmo init`
2. Test `prlt spec create`
3. Test `prlt spec generate-tickets`
4. Test `prlt board`
5. Verify board.md export works

## Success Criteria

- [ ] `pmo_epics` table removed
- [ ] `pmo_board_tickets` table created and functional
- [ ] Tickets have status, owner, assignee fields
- [ ] Tickets have sync tracking timestamps
- [ ] `prlt spec generate-tickets` works with new schema
- [ ] Board export includes all tickets with correct positions
- [ ] No references to `epicId` in codebase

## Migration Notes

**No migration needed** - fresh start since project is unpublished.

Users should:
1. Backup existing workspace.db if needed
2. Delete workspace.db
3. Run `prlt pmo init` to recreate with new schema
4. Re-run `prlt spec generate-tickets` for existing specs

## Future Work (Not in this refactor)

- Implement auto-sync hook
- Implement conflict detection
- Implement field-by-field conflict resolution
- Add `prlt ticket assign/own/execute` commands
