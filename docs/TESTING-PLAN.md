# PMO Manual Testing Plan

## Testing Order (Prioritized)

### ✅ Phase 0: Foundation (DONE)
- [x] pmo-schema-refactor - Database schema complete

### 🧪 Phase 1: Core CRUD (TEST THESE FIRST)

#### 1. pmo-ticket-commands (Priority: CRITICAL)
**Status**: 2/6 implemented, 4 need implementation + testing

**Implemented (verify these work)**:
- [ ] `prlt ticket create` - Create tickets
  - [ ] With all flags (--title, --priority, --column)
  - [ ] Interactive mode (no args)
  - [ ] Verify appears in database
  - [ ] Verify appears in board.md
- [ ] `prlt ticket move` - Move between columns
  - [ ] Interactive mode (dropdowns)
  - [ ] With args (ticket ID + column name)
  - [ ] Verify database updated
  - [ ] Verify board.md updated
- [ ] `prlt ticket delete` - Delete tickets
  - [ ] Interactive mode
  - [ ] With confirmation
  - [ ] With --force flag
  - [ ] Verify removed from database
  - [ ] Verify removed from board.md

**Not Implemented (need to build)**:
- [ ] `prlt ticket list` - List all tickets
  - [ ] Basic list (all tickets)
  - [ ] Filter by column
  - [ ] Filter by priority
  - [ ] Filter by assignee
  - [ ] Table format output
- [ ] `prlt ticket view` - View ticket details
  - [ ] Interactive selection
  - [ ] Direct ID lookup
  - [ ] Show all metadata
  - [ ] Show description
  - [ ] Show spec link

#### 2. pmo-board-commands (Priority: HIGH)
**Status**: Mostly implemented, verify functionality

- [ ] `prlt board view` - Terminal view
  - [ ] Shows all columns
  - [ ] Shows ticket counts
  - [ ] Color coding by priority
  - [ ] Assignee display
- [ ] `prlt board sync` - Sync DB ↔ board.md
  - [ ] Export (DB → board.md)
  - [ ] Import (board.md → DB)
  - [ ] Auto-detect direction
  - [ ] Show diff before applying
  - [ ] --dry-run mode
- [ ] `prlt board open` - Open in Obsidian
  - [ ] Opens correct file
  - [ ] Works on macOS
- [ ] `prlt board markdown` - Raw markdown output
  - [ ] Valid Obsidian format
  - [ ] Pipeable to file
- [ ] `prlt board watch` - Auto-sync on changes
  - [ ] Detects file changes
  - [ ] Syncs automatically
  - [ ] Ctrl+C to stop

**Not Implemented**:
- [ ] `prlt board export` - Export to JSON/CSV

#### 3. pmo-spec-commands (Priority: MEDIUM)
**Status**: Implemented, verify functionality

- [ ] `prlt spec create` - Create new spec
  - [ ] Creates file with frontmatter
  - [ ] Registers in database
  - [ ] Sets correct status
- [ ] `prlt spec list` - List all specs
  - [ ] Shows all specs
  - [ ] Shows status
  - [ ] Shows ticket counts
- [ ] `prlt spec view` - View spec details
  - [ ] Shows spec content
  - [ ] Shows linked tickets
- [ ] `prlt spec generate-tickets` - Generate from YAML
  - [ ] Creates tickets from frontmatter
  - [ ] Handles existing tickets (skip/update)
  - [ ] --dry-run mode
  - [ ] Sets spec_id correctly

### 📋 Phase 2: Bulk Operations (IMPLEMENT LATER)

#### 4. pmo-ticket-commands (Bulk) (Priority: MEDIUM)
**Status**: 0/4 implemented

- [ ] `prlt ticket bulk move` - Move multiple tickets
- [ ] `prlt ticket bulk delete` - Delete multiple tickets
- [ ] `prlt ticket bulk reassign` - Change spec for multiple
- [ ] `prlt ticket bulk update` - Update priority/category

### 🔍 Phase 3: Views & Filtering (IMPLEMENT LATER)

#### 5. pmo-board-views (Priority: LOW)
**Status**: 0/8 implemented

- [ ] `prlt board view --assignee` - Filter by assignee
- [ ] `prlt board view --priority` - Filter by priority
- [ ] `prlt board view --column` - Show specific columns
- [ ] `prlt board view --status` - Filter by status
- [ ] `prlt board view --group-by` - Group tickets
- [ ] `prlt board view --sort-by` - Sort tickets
- [ ] Combined filters
- [ ] Empty state handling

### 🚀 Phase 4: Future Work (MOVE TO BACKLOG)

#### 6. work-commands (Priority: FUTURE)
**File**: `specs/cli/execute-commands.md`
- `prlt work start` - Start work on a ticket (agent execution)
- `prlt work ready` - Mark work as ready for review
- `prlt work complete` - Mark work as done
- `prlt work own` - Take ownership of a ticket
- `prlt work claim` - Claim and assign to self/agent
- `prlt work assign` - Assign work to an agent
- Depends on all CRUD being complete

#### 7. pmo-local-sync (Priority: FUTURE)
**File**: `pmo/projects/proletariat-kanban/specs/future/pmo-local-sync.md`
- Git integration for board.md
- Version control for tickets
- Depends on all CRUD being complete

## Testing Script

Create `scripts/manual-test.sh`:

```bash
#!/bin/bash

echo "🧪 PMO Manual Testing"
echo "===================="
echo ""

# Test ticket create
echo "1. Testing ticket create..."
cd repos/proletariat
./apps/cli/bin/run.js ticket create --title "Test ticket" --priority HIGH --column "BUILD BL"

# Test ticket list (will fail if not implemented)
echo ""
echo "2. Testing ticket list..."
./apps/cli/bin/run.js ticket list || echo "❌ Not implemented yet"

# Test board view
echo ""
echo "3. Testing board view..."
./apps/cli/bin/run.js board view

# Test board sync
echo ""
echo "4. Testing board sync..."
./apps/cli/bin/run.js board sync --dry-run

echo ""
echo "✅ Manual tests complete!"
```

## Quick Start Testing

### 1. Test the basics RIGHT NOW:
```bash
cd /Users/chrismcdermut/Projects/proletariat-hq/repos/proletariat

# Create a test ticket
./apps/cli/bin/run.js ticket create --title "Manual test" --priority HIGH

# View the board
./apps/cli/bin/run.js board view

# Try to list (will fail - not implemented)
./apps/cli/bin/run.js ticket list
```

### 2. Start with highest priority:
Focus on **pmo-ticket-commands-001** and **pmo-ticket-commands-002** (list and view).

These are critical and blocking everything else!

## Progress Tracking

### Current Status Summary
```
pmo-schema-refactor:      12/12 ✅ (100% complete)
pmo-ticket-commands:       2/6  ⚠️  (33% complete) <- WORK ON THIS
pmo-board-commands:        6/7  🟡 (86% complete)
pmo-spec-commands:         6/6  ✅ (needs testing)
pmo-project-commands:      0/0  ⏸️  (no tickets yet)

Bulk operations:           0/4  ❌ (not started)
Board views:               0/8  ❌ (not started)
Work commands:             6/6  ✅ (implemented, needs testing)
Local sync:                0/?  ⏸️  (future)
```

## Recommendation

**START HERE** (this weekend):
1. Test `prlt ticket create`, `move`, `delete` (verify they work)
2. Implement `prlt ticket list` (pmo-ticket-commands-001)
3. Implement `prlt ticket view` (pmo-ticket-commands-002)

**NEXT WEEK**:
4. Test all `prlt spec` commands
5. Test all `prlt board` commands

**LATER** (when CRUD is solid):
6. Bulk operations
7. Board filtering/views
8. Test work commands (`prlt work start/ready/complete/own/claim/assign`)
9. Local sync (git integration)

---

## Notes

- Don't worry about future specs (work-commands, local-sync) until CRUD is done
- Focus on making basic operations rock-solid first
- E2E tests will help catch regressions
- Manual testing builds confidence before automation
