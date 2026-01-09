# Retro: TKT-055 - Update work commands to use new status model

**Category:** retro
**Links:** TKT-055

## What the Spec Asked For

Original requirements from TKT-055:
- Remove ticket.column field, use ticket.status_id only
- Replace moveTicket(id, columnName) with updateStatus(id, statusId)
- Remove fuzzy column name matching
- Update filtering logic (currently checks both status AND column)
- Board columns become views of statuses, not separate tracking

## What Was Actually Built

Updated 4 work commands (start.ts, complete.ts, ready.ts, claim.ts):
- Replaced deprecated `status` field usage with `statusCategory` for filtering
- Kept `moveTicket()` for status transitions (discovered it already handles status_id updates internally)
- Updated filtering from deprecated `status` values ('backlog', 'in_progress') to `statusCategory` values ('backlog', 'unstarted', 'started')
- Removed redundant `updateTicket({ status: '...' })` calls that were being silently ignored
- Added warning log when column not found in claim.ts

## Iterations Required

| Round | Type | Description |
|-------|------|-------------|
| 1 | Initial Implementation | Updated all 4 work commands |
| 2 | Branch Cleanup | Branch had contamination from TKT-044 commits; required cherry-picking to clean branch |
| 3 | PR Feedback | claim.ts opened a separate database connection instead of using `this.storage.getDatabase()` |

**Total: 3 iterations (2 required rework)**

## Spec Gaps That Caused Rework

### 1. Database access pattern not specified
Spec didn't mention that commands should use `this.storage.getDatabase()` rather than opening new connections. This is a codebase convention that wasn't documented.

### 2. moveTicket behavior unclear
Spec said "replace moveTicket with updateStatus" but investigation revealed moveTicket already handles status_id updates internally via name matching. The correct approach was to keep moveTicket, not replace it.

### 3. Missing context about deprecated fields
Spec didn't mention that `updateTicket({ status: '...' })` calls were being silently ignored. This critical context was discovered during implementation.

### 4. No warning/logging requirements
Spec didn't specify error handling behavior (e.g., warning when column not found).

## Spec Improvements for One-Shot Completion

### 1. Add code pattern requirements
```
Database access: Use `this.storage.getDatabase()` - never open separate connections
```

### 2. Clarify existing behavior before prescribing changes
```
Current state: moveTicket() already updates status_id via column-status name matching
Required change: Keep using moveTicket(), remove redundant status field updates
```

### 3. Include before/after code examples
```typescript
// BEFORE (remove this):
await this.storage.updateTicket(id, { status: 'in_progress' })

// AFTER (keep this, it handles status_id):
await this.storage.moveTicket(id, columnName)
```

### 4. Specify error handling
```
When column lookup fails, log warning: "Could not find X column, ticket column unchanged"
```

### 5. Document deprecated fields explicitly
```
Note: The `status` field on tickets is deprecated and updates are silently ignored.
Use `statusCategory` for filtering and `moveTicket()` for transitions.
```

## Patterns Learned

1. **Investigate before implementing**: When spec says "replace X with Y", verify X's actual behavior first. X may already do what Y is supposed to do.

2. **Check for silently-ignored operations**: Deprecated fields that accept writes but don't persist are a source of subtle bugs.

3. **Follow existing patterns**: Look at similar commands (e.g., start.ts) for database access patterns before implementing.

4. **Spec should include codebase conventions**: Database access, error handling, and logging patterns should be explicit in specs.

5. **Branch hygiene**: Always verify branch is clean from main before starting work on a ticket.

## Key Takeaway

The spec prescribed solutions ("replace moveTicket with updateStatus") without first documenting the current behavior. A better spec would have:
1. Documented what each function currently does
2. Identified what was broken (status field updates silently ignored)
3. Prescribed minimal changes to fix the actual problem
4. Included codebase conventions (database access patterns, error handling)

This would have enabled one-shot completion instead of 3 iterations.
