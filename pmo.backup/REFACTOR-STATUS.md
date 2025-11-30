# PMO Schema Refactor Status

**Last Updated:** 2024-11-30
**Status:** ✅ COMPLETE - Schema refactor finished, builds successfully

## Specs Created

1. **pmo-schema-refactor.md** - Main refactor (12 tickets)
   - Path: `pmo/projects/proletariat-kanban/specs/active/pmo-schema-refactor.md`

2. **pmo-local-sync.md** - Bidirectional sync (7 tickets)
   - Path: `pmo/projects/proletariat-kanban/specs/active/pmo-local-sync.md`

## Completed ✅

### 1. Types Updated (types.ts)
- ✅ Removed `Epic` interface
- ✅ Added `TicketStatus` type
- ✅ Updated `Ticket` interface:
  - Removed: `column`, `position`, `epicId` as required fields
  - Added: `status`, `owner`, `assignee`, `specId`, `lastSyncedFromSpec`, `lastSyncedFromBoard`
  - Kept deprecated: `column?`, `position?`, `specs?` for backward compatibility
- ✅ Added `BoardTicket` interface
- ✅ Updated `TicketFilter` (removed `column`, added `status`, `owner`, `assignee`)

**File:** `apps/cli/src/lib/pmo/types.ts`

### 2. Storage Layer (storage-sqlite.ts) ✅

**Completed all updates:**

#### Schema Changes
- ✅ Removed `pmo_epics` table from constants
- ✅ Removed `pmo_ticket_specs` many-to-many table
- ✅ Added `pmo_board_tickets` table
- ✅ Updated `pmo_tickets` schema:
  - Removed: `column_id`, `position`, `epic_id`
  - Added: `status`, `owner`, `assignee`, `last_synced_from_spec`, `last_synced_from_board`
- ✅ Updated indexes for new schema

#### Method Updates
- ✅ `createTicket()` - Inserts into both pmo_tickets and pmo_board_tickets
- ✅ `updateTicket()` - Handles all new fields (status, owner, assignee, sync timestamps)
- ✅ `moveTicket()` - Updates pmo_board_tickets instead of tickets table
- ✅ `deleteTicket()` - Cleans up board_tickets and shifts positions
- ✅ `listTickets()` - JOINs with board_tickets, filters by new fields
- ✅ `getTicketsForColumn()` - JOINs with board_tickets
- ✅ `getTicketById()` - JOINs with board_tickets
- ✅ `rowToTicket()` - Populates new fields + deprecated fields for compat
- ✅ `getMaxTicketPosition()` - Queries board_tickets table
- ✅ `rebuildFromBoard()` - Inserts into both tables
- ✅ `linkTicketToSpec()` - Updates spec_id (one-to-many)
- ✅ `unlinkTicketFromSpec()` - Clears spec_id
- ✅ `getSpecsForTicket()` - Returns single spec based on specId

**File:** `apps/cli/src/lib/pmo/storage-sqlite.ts`

### 3. Markdown Parser (markdown.ts) ✅
- ✅ Updated `parseBoard()` to include required `status` field with default value
- ✅ Parser maintains backward compat with deprecated fields

**File:** `apps/cli/src/lib/pmo/markdown.ts`

### 4. Command Files ✅
- ✅ Fixed type annotations in ticket commands (assign, complete, delete, move, status, view)
- ✅ Added null guards for optional `column` field
- ✅ Added null guards for optional `specs` array
- ✅ Added null guards for optional `position` field in sort calls
- ✅ All commands compile successfully

**Files affected:**
- `commands/board/index.ts`
- `commands/spec/generate-tickets.ts`, `link.ts`, `view.ts`
- `commands/ticket/assign.ts`, `complete.ts`, `create.ts`, `delete.ts`, `list.ts`, `move.ts`, `status.ts`, `view.ts`

## Build Status

**TypeScript Compilation:** ✅ 0 errors
**Build:** ✅ Successful

```bash
$ pnpm run build
apps/cli build: Done
apps/cli-old build: Done
```

## Testing Checklist (Next Steps)

- [ ] Delete existing workspace.db
- [ ] `prlt pmo init` creates new schema
- [ ] `prlt spec create foo` works
- [ ] `prlt spec generate-tickets foo` creates tickets
- [ ] `prlt board` displays board
- [ ] Tickets appear in correct columns
- [ ] Board.md exports correctly
- [ ] Verify board_tickets table is populated
- [ ] Test ticket move operations
- [ ] Test ticket status updates
- [ ] No references to `epic` anywhere

## How to Test

### Quick Start
```bash
cd /Users/chrismcdermut/Projects/proletariat-hq/repos/proletariat

# Delete old database (fresh start)
rm workspace.db

# Initialize with new schema
./apps/cli/bin/run.js pmo init

# Verify tables were created
sqlite3 workspace.db ".schema pmo_board_tickets"
sqlite3 workspace.db ".schema pmo_tickets"

# Create a spec and generate tickets
./apps/cli/bin/run.js spec create test-feature
./apps/cli/bin/run.js spec generate-tickets test-feature

# View board
./apps/cli/bin/run.js board
```

## Key Design Decisions Made

1. ✅ Remove epics (specs replace them)
2. ✅ Normalize board view to separate `pmo_board_tickets` table
3. ✅ Add `status` field for lifecycle tracking
4. ✅ Add `owner`/`assignee` for orchestration
5. ✅ Changed from many-to-many (ticket_specs) to one-to-many (specId)
6. ✅ Kept deprecated fields (`column`, `position`, `specs`) on Ticket interface for backward compat
7. ✅ Ready for bidirectional sync (timestamps in place)

## Migration Strategy

**Fresh start** - No migration script needed since project unpublished
- ✅ Schema changes implemented
- ✅ Code refactored
- ✅ Builds successfully
- 🔨 Next: Delete workspace.db and test with new schema

## Summary

The schema refactor is **complete** and the codebase **builds successfully**. All 12 tickets from the pmo-schema-refactor.md spec have been implemented:

- REFACTOR-001 through REFACTOR-005: Schema changes ✅
- REFACTOR-006 through REFACTOR-007: Type updates ✅
- REFACTOR-008 through REFACTOR-011: Storage layer updates ✅
- REFACTOR-012: Ready for testing 🔨

**Next step:** Test the implementation with a fresh database to verify everything works correctly.
