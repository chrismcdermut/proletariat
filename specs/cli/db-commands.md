# Database Commands Specification

## Overview

Commands for inspecting and debugging the SQLite database. These are developer/power-user tools for understanding the database state, running ad-hoc queries, and troubleshooting issues.

## Command Overview

| Command                 | Purpose                           | Status             |
| ----------------------- | --------------------------------- | ------------------ |
| `prlt db`               | Interactive database menu         | ⬜ Not Implemented |
| `prlt db tables`        | List all tables with row counts   | ⬜ Not Implemented |
| `prlt db schema [table]`| Show table structure              | ⬜ Not Implemented |
| `prlt db query <sql>`   | Run SQL query (read-only default) | ⬜ Not Implemented |
| `prlt db stats`         | Database size and health info     | ⬜ Not Implemented |

---

## Commands

### `prlt db`

Interactive menu for database operations.

```
$ prlt db

? What would you like to do?
❯ 📋 List tables
  🔍 View table schema
  💾 Run SQL query
  📊 Database stats
  ──────────────
  ❌ Cancel
```

### `prlt db tables`

List all tables in the database.

```
$ prlt db tables

📋 Database Tables

PMO Tables:
  pmo_projects          3 rows
  pmo_initiatives       1 row
  pmo_columns          12 rows
  pmo_tickets          47 rows
  pmo_board_tickets    47 rows
  pmo_subtasks         23 rows
  pmo_ticket_metadata   8 rows
  pmo_specs            15 rows
  pmo_ticket_specs      5 rows
  pmo_ticket_assignments 12 rows
  pmo_epics             4 rows
  pmo_cache_metadata    2 rows
  pmo_settings          3 rows

System Tables:
  init_marker           1 row

Total: 14 tables
```

#### Flags

| Flag | Description |
|------|-------------|
| `--counts` | Show row counts (default: true) |
| `--system` | Include system/internal tables |
| `--json` | Output as JSON |

### `prlt db schema [table]`

Show table structure. If no table specified, shows all tables.

```
$ prlt db schema pmo_tickets

📋 Table: pmo_tickets

Columns:
  id                    TEXT      PRIMARY KEY
  project_id            TEXT      NOT NULL DEFAULT 'default'
  title                 TEXT      NOT NULL
  description           TEXT
  priority              TEXT
  category              TEXT
  status                TEXT      NOT NULL DEFAULT 'backlog'
  owner                 TEXT
  assignee              TEXT
  spec_id               TEXT      → pmo_specs(id) ON DELETE SET NULL
  epic_id               TEXT      → pmo_epics(id) ON DELETE SET NULL
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  last_synced_from_spec TIMESTAMP
  last_synced_from_board TIMESTAMP

Indexes:
  idx_pmo_tickets_project   (project_id)
  idx_pmo_tickets_status    (status)
  idx_pmo_tickets_owner     (owner)
  idx_pmo_tickets_assignee  (assignee)
  idx_pmo_tickets_spec      (spec_id)
  idx_pmo_tickets_epic      (epic_id)
  idx_pmo_tickets_priority  (priority)
  idx_pmo_tickets_category  (category)

Foreign Keys:
  project_id → pmo_projects(id) ON DELETE CASCADE
  spec_id    → pmo_specs(id) ON DELETE SET NULL
  epic_id    → pmo_epics(id) ON DELETE SET NULL

Row Count: 47
```

#### All Tables Mode

```
$ prlt db schema

📋 Database Schema

## pmo_projects
  id            TEXT PRIMARY KEY
  name          TEXT NOT NULL
  template      TEXT
  description   TEXT
  initiative_id TEXT
  created_at    TIMESTAMP
  updated_at    TIMESTAMP

## pmo_tickets
  id          TEXT PRIMARY KEY
  project_id  TEXT NOT NULL
  title       TEXT NOT NULL
  ...

[continues for all tables]
```

#### Flags

| Flag | Description |
|------|-------------|
| `--raw` | Show raw SQL CREATE statement |
| `--json` | Output as JSON |
| `--indexes` | Include index definitions (default: true) |
| `--fk` | Include foreign key info (default: true) |

### `prlt db query <sql>`

Run a SQL query against the database. **Read-only by default** for safety.

```
$ prlt db query "SELECT id, title, status FROM pmo_tickets WHERE priority = 'HIGH'"

┌─────────────────┬───────────────────────────┬─────────────┐
│ id              │ title                     │ status      │
├─────────────────┼───────────────────────────┼─────────────┤
│ fix-auth-bug    │ Fix authentication bug    │ in-progress │
│ add-dark-mode   │ Add dark mode support     │ backlog     │
│ perf-optimize   │ Optimize query performance│ review      │
└─────────────────┴───────────────────────────┴─────────────┘

3 rows returned
```

#### Write Mode

For mutations, require explicit `--write` flag:

```
$ prlt db query "UPDATE pmo_tickets SET priority = 'URGENT' WHERE id = 'fix-auth-bug'"

⚠️  This query would modify data. Use --write to execute.

$ prlt db query --write "UPDATE pmo_tickets SET priority = 'URGENT' WHERE id = 'fix-auth-bug'"

⚠️  Warning: This will modify the database.
   Query: UPDATE pmo_tickets SET priority = 'URGENT' WHERE id = 'fix-auth-bug'

? Continue? (y/N) y

✓ 1 row affected
```

#### Flags

| Flag | Description |
|------|-------------|
| `--write` | Allow write operations (UPDATE, INSERT, DELETE) |
| `--force, -f` | Skip confirmation for write operations |
| `--json` | Output as JSON |
| `--csv` | Output as CSV |
| `--limit <n>` | Limit results (default: 100) |
| `--no-limit` | Remove result limit |

#### Safety Features

1. **Read-only by default** - SELECT queries only without `--write`
2. **Confirmation required** - Write operations require confirmation unless `--force`
3. **Result limit** - Default limit of 100 rows to prevent overwhelming output
4. **Query logging** - All queries logged for audit (optional)

### `prlt db stats`

Show database statistics and health info.

```
$ prlt db stats

📊 Database Statistics

Location: /Users/chris/.proletariat/workspace.db
Size: 2.4 MB
WAL Mode: enabled
Journal Mode: wal

Tables: 14
Total Rows: 183

Largest Tables:
  pmo_tickets          47 rows (25%)
  pmo_board_tickets    47 rows (25%)
  pmo_subtasks         23 rows (13%)

Recent Activity:
  Last modified: 2 minutes ago
  Last vacuum: 3 days ago

Integrity Check: ✓ OK
```

## Implementation Notes

### Database Access

Use the existing `getDb()` pattern from storage:

```typescript
import Database from 'better-sqlite3';

function getWorkspaceDb(): Database.Database {
  const dbPath = path.join(getProletariatDir(), 'workspace.db');
  return new Database(dbPath, { readonly: true }); // Default read-only
}
```

### Query Parsing

For safety, detect query type:

```typescript
function getQueryType(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'other' {
  const normalized = sql.trim().toLowerCase();
  if (normalized.startsWith('select')) return 'select';
  if (normalized.startsWith('insert')) return 'insert';
  if (normalized.startsWith('update')) return 'update';
  if (normalized.startsWith('delete')) return 'delete';
  return 'other';
}
```

### Table Output

Use existing table formatting or add `cli-table3`:

```typescript
import Table from 'cli-table3';

function formatResults(rows: unknown[], columns: string[]): string {
  const table = new Table({ head: columns });
  for (const row of rows) {
    table.push(columns.map(c => String(row[c] ?? '')));
  }
  return table.toString();
}
```

## File Structure

```
apps/cli/src/commands/db/
├── index.ts      # Interactive menu
├── tables.ts     # List tables
├── schema.ts     # Show schema
├── query.ts      # Run queries
└── stats.ts      # Database stats
```

## Security Considerations

1. **No DROP/ALTER** - Block destructive DDL even with `--write`
2. **Parameterized queries** - When building queries internally
3. **Path validation** - Only access workspace.db, not arbitrary paths
4. **Audit logging** - Optional logging of all queries for debugging

## Future Enhancements

- `prlt db backup` - Create database backup
- `prlt db restore` - Restore from backup
- `prlt db migrate` - Run schema migrations
- `prlt db export` - Export to SQL/JSON
- `prlt db import` - Import from SQL/JSON
