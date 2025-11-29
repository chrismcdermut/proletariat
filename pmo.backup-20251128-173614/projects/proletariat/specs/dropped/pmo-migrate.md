# PMO Migration

## Overview

This spec covers migrating PMO data between storage backends. All migrations go through a common intermediate format (markdown or JSON) to enable any-to-any migration.

## Migration Paths

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  SQLite  │────▶│ Standard │────▶│   Git    │
└──────────┘     │  Format  │     └──────────┘
                 │(md/json) │
┌──────────┐     │          │     ┌──────────┐
│   Git    │────▶│          │────▶│ Cloud DB │
└──────────┘     │          │     └──────────┘
                 │          │
┌──────────┐     │          │     ┌──────────┐
│ Cloud DB │────▶│          │────▶│ Adapter  │
└──────────┘     │          │     └──────────┘
                 │          │
┌──────────┐     │          │     ┌──────────┐
│ Adapter  │────▶│          │────▶│  SQLite  │
└──────────┘     └──────────┘     └──────────┘
```

## Standard Export Format

### Markdown (Primary)

The Obsidian Kanban format is the standard export:

```markdown
## Backlog

- [ ] [[ticket-1]]
      **Priority:** IMPORTANT
      **Category:** BUILD/Infra
      ***
      Description text
      - [ ] Subtask 1
      - [x] Subtask 2

## In Progress

- [ ] [[ticket-2]]
      **Priority:** URGENT
      ***
      Another ticket

## Done

- [ ] [[ticket-3]]
      ***
      Completed work
```

### JSON (Alternative)

For programmatic use:

```json
{
  "version": 1,
  "exportedAt": "2024-01-15T10:30:00Z",
  "board": {
    "id": "default",
    "name": "Project Board",
    "columns": [
      {
        "id": "backlog",
        "name": "Backlog",
        "position": 0,
        "tickets": [
          {
            "id": "ticket-1",
            "title": "ticket-1",
            "priority": "IMPORTANT",
            "category": "BUILD/Infra",
            "description": "Description text",
            "subtasks": [
              { "id": "st-1", "title": "Subtask 1", "done": false },
              { "id": "st-2", "title": "Subtask 2", "done": true }
            ],
            "metadata": {},
            "createdAt": "2024-01-10T08:00:00Z",
            "updatedAt": "2024-01-14T15:30:00Z"
          }
        ]
      }
    ]
  }
}
```

## CLI Commands

### Export

```bash
# Export to markdown (default)
prlt board export > board.md
prlt board export --format markdown > board.md

# Export to JSON
prlt board export --format json > board.json

# Export specific columns
prlt board export --columns "Backlog,In Progress" > active.md
```

### Import

```bash
# Import from markdown
prlt board import board.md

# Import from JSON
prlt board import board.json

# Import with merge strategy
prlt board import board.md --strategy merge    # Add new, update existing
prlt board import board.md --strategy replace  # Delete all, import fresh
prlt board import board.md --strategy skip     # Only add new, don't update
```

### Migrate

One-step migration between backends:

```bash
# SQLite → Git
prlt board migrate --to git --repo .

# Git → Cloud DB
prlt board migrate --to cloud --connection "postgresql://..."

# Cloud DB → Jira
prlt board migrate --to adapter --adapter jira --project PMO

# Any → SQLite (local backup)
prlt board migrate --to sqlite --path ./backup.db
```

## Migration Implementation

### Export Functions

```typescript
// Export to markdown
async function exportMarkdown(storage: PMOStorage): Promise<string> {
  const board = await storage.getBoard()
  return generateBoardMarkdown(board)
}

// Export to JSON
async function exportJSON(storage: PMOStorage): Promise<string> {
  const board = await storage.getBoard()
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    board
  }, null, 2)
}
```

### Import Functions

```typescript
// Import from markdown
async function importMarkdown(
  storage: PMOStorage,
  markdown: string,
  strategy: 'merge' | 'replace' | 'skip'
): Promise<ImportResult> {
  const importedBoard = parseBoard(markdown)

  if (strategy === 'replace') {
    // Delete all existing tickets
    const existing = await storage.listTickets()
    for (const ticket of existing) {
      await storage.deleteTicket(ticket.id)
    }
  }

  const results: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: []
  }

  for (const column of importedBoard.columns) {
    // Ensure column exists
    try {
      await storage.createColumn(column.name, column.position)
    } catch (e) {
      // Column already exists
    }

    for (const ticket of column.tickets) {
      try {
        const existing = await storage.getTicket(ticket.id)

        if (existing) {
          if (strategy === 'skip') {
            results.skipped++
            continue
          }
          // Update existing
          await storage.updateTicket(ticket.id, ticket)
          results.updated++
        } else {
          // Create new
          await storage.createTicket(ticket)
          results.created++
        }
      } catch (e) {
        results.errors.push({ ticketId: ticket.id, error: e.message })
      }
    }
  }

  return results
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ ticketId: string; error: string }>
}
```

### Migrate Function

```typescript
async function migrate(
  from: PMOStorage,
  to: PMOStorage,
  options?: MigrateOptions
): Promise<MigrateResult> {
  // 1. Export from source
  const board = await from.getBoard()

  // 2. Initialize target if needed
  if (options?.initTarget) {
    await to.init({
      name: board.name,
      columns: board.columns.map(c => c.name)
    })
  }

  // 3. Import to target
  const markdown = generateBoardMarkdown(board)
  const importResult = await importMarkdown(to, markdown, options?.strategy || 'replace')

  // 4. Verify
  const targetBoard = await to.getBoard()
  const sourceCount = board.columns.reduce((sum, c) => sum + c.tickets.length, 0)
  const targetCount = targetBoard.columns.reduce((sum, c) => sum + c.tickets.length, 0)

  return {
    ...importResult,
    verified: sourceCount === targetCount,
    sourceCount,
    targetCount
  }
}

interface MigrateOptions {
  strategy?: 'merge' | 'replace' | 'skip'
  initTarget?: boolean
}

interface MigrateResult extends ImportResult {
  verified: boolean
  sourceCount: number
  targetCount: number
}
```

## Migration Triggers

From the architecture matrix, these events trigger migrations:

| Trigger | From | To | Reason |
|---------|------|-----|--------|
| Add second host node | SQLite | Git | SQLite can't sync across machines |
| Team growth | In-Repo Git | Separate Repo Git | PR conflicts become problematic |
| Organization mandate | Any | Adapter (Jira/Linear) | Standardize on company tool |
| Scale requirements | Git | Cloud DB | Git struggles with high activity |
| Simplify setup | Cloud DB | SQLite | Team shrunk, overhead not needed |

## Special Considerations

### SQLite → Git

```bash
# 1. Export current state
prlt board export > board.md

# 2. Initialize git storage
prlt board init --storage git --mode separate-repo --repo ./pmo

# 3. Import (replace since new repo)
cd pmo
prlt board import ../board.md --strategy replace

# 4. Push to remote
git remote add origin git@github.com:user/pmo.git
git push -u origin main

# 5. Update config to use new storage
prlt config set storage.type git
prlt config set storage.repo ./pmo
```

### Git → Cloud DB

```bash
# 1. Export current state
prlt board export --format json > board.json

# 2. Initialize cloud DB
export PMO_DATABASE_URL="postgresql://..."
prlt board init --storage cloud

# 3. Import
prlt board import board.json --strategy replace

# 4. Update config
prlt config set storage.type cloud
prlt config set storage.connection env:PMO_DATABASE_URL

# 5. Git repo becomes backup/archive
```

### Any → Adapter (Jira/Linear)

```bash
# 1. Export current state
prlt board export --format json > board.json

# 2. Initialize adapter
export JIRA_API_TOKEN="..."
prlt board init --storage adapter --adapter jira --project PMO

# 3. Import (creates issues in Jira)
prlt board import board.json --strategy replace

# Note: Ticket IDs will change (PMO-1, PMO-2, etc.)
# Old IDs stored in metadata for reference
```

### Adapter → Local (Backup/Offline)

```bash
# Export from Jira to local backup
prlt board export --format json > jira-backup-$(date +%Y%m%d).json

# For offline work, import to SQLite
prlt board init --storage sqlite --path ./offline.db
prlt board import jira-backup-*.json

# When back online, export changes and manually reconcile
prlt board export > offline-changes.md
# Review and apply changes in Jira
```

## ID Mapping

When migrating to adapters, ticket IDs change:

```typescript
interface IDMapping {
  [oldId: string]: string  // old ID → new ID (e.g., "my-ticket" → "PMO-123")
}

async function migrateWithMapping(
  from: PMOStorage,
  to: PMOStorage
): Promise<{ result: MigrateResult; mapping: IDMapping }> {
  const board = await from.getBoard()
  const mapping: IDMapping = {}

  for (const column of board.columns) {
    for (const ticket of column.tickets) {
      const created = await to.createTicket({
        ...ticket,
        id: undefined,  // Let adapter assign ID
        metadata: {
          ...ticket.metadata,
          _originalId: ticket.id  // Preserve for reference
        }
      })
      mapping[ticket.id] = created.id
    }
  }

  return {
    result: { created: Object.keys(mapping).length, updated: 0, skipped: 0, errors: [] },
    mapping
  }
}
```

## Rollback

### Keep Backup

Always export before migrating:

```bash
# Before any migration
prlt board export --format json > backup-$(date +%Y%m%d-%H%M%S).json
```

### Restore

```bash
# If migration fails, restore from backup
prlt board import backup-*.json --strategy replace
```

## Validation

### Pre-Migration Check

```typescript
async function validateMigration(from: PMOStorage, to: PMOStorage): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const board = await from.getBoard()

  // Check column compatibility
  if (to.type === 'adapter') {
    const adapterColumns = to.config.mapping.columns.map(c => c.name)
    for (const col of board.columns) {
      if (!adapterColumns.includes(col.name)) {
        warnings.push(`Column "${col.name}" not mapped - tickets will go to default column`)
      }
    }
  }

  // Check ticket count
  const ticketCount = board.columns.reduce((sum, c) => sum + c.tickets.length, 0)
  if (ticketCount > 1000 && to.type === 'adapter') {
    warnings.push(`Large migration (${ticketCount} tickets) - may hit API rate limits`)
  }

  // Check for special characters in IDs
  for (const col of board.columns) {
    for (const ticket of col.tickets) {
      if (to.type === 'adapter' && /[^a-z0-9-]/.test(ticket.id)) {
        warnings.push(`Ticket "${ticket.id}" has special characters - ID will change`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}
```

### Post-Migration Verification

```typescript
async function verifyMigration(from: PMOStorage, to: PMOStorage): Promise<boolean> {
  const sourceBoard = await from.getBoard()
  const targetBoard = await to.getBoard()

  const sourceTickets = sourceBoard.columns.flatMap(c => c.tickets)
  const targetTickets = targetBoard.columns.flatMap(c => c.tickets)

  // Check counts
  if (sourceTickets.length !== targetTickets.length) {
    console.error(`Count mismatch: ${sourceTickets.length} source, ${targetTickets.length} target`)
    return false
  }

  // Check content (by title since IDs may differ)
  const sourceTitles = new Set(sourceTickets.map(t => t.title))
  const targetTitles = new Set(targetTickets.map(t => t.title))

  for (const title of sourceTitles) {
    if (!targetTitles.has(title)) {
      console.error(`Missing ticket: ${title}`)
      return false
    }
  }

  return true
}
```

## CLI Examples

```bash
# Full migration workflow

# 1. Check current storage
prlt board status
# Output: Storage: sqlite, Tickets: 45

# 2. Backup
prlt board export --format json > backup.json

# 3. Validate migration
prlt board migrate --to git --repo ./pmo --dry-run
# Output:
#   ✓ 45 tickets will be migrated
#   ⚠ 2 tickets have long descriptions (may wrap oddly in markdown)
#   Ready to migrate

# 4. Migrate
prlt board migrate --to git --repo ./pmo
# Output:
#   Creating git repository at ./pmo
#   Migrating 45 tickets...
#   ✓ 45 created, 0 updated, 0 skipped
#   Verifying...
#   ✓ Migration complete

# 5. Verify
prlt board view
# Shows board from new git storage

# 6. Update config to use new storage permanently
prlt config set storage.type git
prlt config set storage.path ./pmo
```
