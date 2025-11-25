# PMO Storage: SQLite

## Overview

SQLite-based storage for PMO boards. Data is stored in relational tables and markdown board view is generated on demand. Best for solo developers on a single machine.

## When to Use

| Setup | Recommendation |
|-------|----------------|
| Solo Mono Solo | ✅ Simple, fast, no setup |
| Solo Multi Solo | ✅ Works across repos |
| Solo Mono Wrkrs | ✅ WAL mode for concurrency |
| Solo Multi Wrkrs | ✅ WAL mode for concurrency |
| Solo Mono Swarm | ✅ WAL mode handles 10+ workers |
| Solo Multi Swarm | ✅ WAL mode handles 10+ workers |
| Solo Distributed | ❌ Can't sync across machines |
| Team * | ❌ Can't share local DB |
| Enterprise * | ❌ Not scalable for teams |

## File Structure

```
~/.pmo/
├── pmo.db                # SQLite database
├── pmo.db-wal            # WAL file (when WAL mode enabled)
├── pmo.db-shm            # Shared memory file (WAL mode)
└── config.yaml           # PMO configuration
```

Or project-local:

```
your-project/
├── .pmo/
│   ├── pmo.db
│   └── config.yaml
├── src/
└── ...
```

## Configuration

### config.yaml

```yaml
# PMO Configuration
version: 1

storage:
  type: sqlite
  path: ~/.pmo/pmo.db     # or .pmo/pmo.db for project-local
  wal_mode: true          # enable for 2+ workers

board:
  name: "Project Board"
  columns:
    - Backlog
    - In Progress
    - Review
    - Done
```

## Database Schema

### Tables

```sql
-- Board metadata
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Columns
CREATE TABLE columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(board_id, position)
);

-- Tickets
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES columns(id),
  title TEXT NOT NULL,
  priority TEXT,
  category TEXT,
  description TEXT,
  position INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subtasks
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  position INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Custom metadata fields
CREATE TABLE ticket_metadata (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (ticket_id, key)
);

-- Specs
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active',  -- draft, active, deprecated
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ticket-Spec relationship (many-to-many)
CREATE TABLE ticket_specs (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  spec_id TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, spec_id)
);

-- Indexes
CREATE INDEX idx_tickets_column ON tickets(column_id);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_ticket_specs_spec ON ticket_specs(spec_id);
CREATE INDEX idx_tickets_category ON tickets(category);
CREATE INDEX idx_subtasks_ticket ON subtasks(ticket_id);
```

## Implementation

### init()

```typescript
async function init(config: BoardConfig): Promise<Board> {
  // 1. Create directory
  await fs.mkdir(path.dirname(config.path), { recursive: true })

  // 2. Open database
  const db = new Database(config.path)

  // 3. Enable WAL mode if configured
  if (config.wal_mode) {
    db.pragma('journal_mode = WAL')
  }

  // 4. Create tables
  db.exec(SCHEMA_SQL)

  // 5. Create board
  const boardId = 'default'
  db.prepare(`
    INSERT INTO boards (id, name) VALUES (?, ?)
  `).run(boardId, config.name || 'Project Board')

  // 6. Create default columns
  const columns = config.columns || ['Backlog', 'In Progress', 'Review', 'Done']
  const insertColumn = db.prepare(`
    INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)
  `)

  for (let i = 0; i < columns.length; i++) {
    insertColumn.run(slugify(columns[i]), boardId, columns[i], i)
  }

  // 7. Save config
  await fs.writeFile(configPath, yaml.stringify(config))

  return getBoard()
}
```

### getBoard()

```typescript
async function getBoard(): Promise<Board> {
  const db = getDb()

  // Get board
  const boardRow = db.prepare(`SELECT * FROM boards WHERE id = ?`).get('default')

  // Get columns with tickets
  const columns = db.prepare(`
    SELECT * FROM columns WHERE board_id = ? ORDER BY position
  `).all(boardRow.id)

  const result: Board = {
    id: boardRow.id,
    name: boardRow.name,
    columns: [],
    updatedAt: new Date(boardRow.updated_at)
  }

  for (const col of columns) {
    const tickets = db.prepare(`
      SELECT * FROM tickets WHERE column_id = ? ORDER BY position
    `).all(col.id)

    const columnTickets: Ticket[] = []

    for (const t of tickets) {
      // Get subtasks
      const subtasks = db.prepare(`
        SELECT * FROM subtasks WHERE ticket_id = ? ORDER BY position
      `).all(t.id)

      // Get custom metadata
      const metadata = db.prepare(`
        SELECT key, value FROM ticket_metadata WHERE ticket_id = ?
      `).all(t.id)

      columnTickets.push({
        id: t.id,
        title: t.title,
        column: col.name,
        position: t.position,
        priority: t.priority,
        category: t.category,
        description: t.description,
        subtasks: subtasks.map(s => ({
          id: s.id,
          title: s.title,
          done: s.done === 1
        })),
        metadata: Object.fromEntries(metadata.map(m => [m.key, m.value])),
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.updated_at)
      })
    }

    result.columns.push({
      id: col.id,
      name: col.name,
      position: col.position,
      tickets: columnTickets
    })
  }

  return result
}
```

### getBoardMarkdown()

```typescript
async function getBoardMarkdown(): Promise<string> {
  const board = await getBoard()
  return generateBoardMarkdown(board)
}

function generateBoardMarkdown(board: Board): string {
  const lines: string[] = []

  for (const column of board.columns) {
    lines.push(`## ${column.name}`)
    lines.push('')

    for (const ticket of column.tickets) {
      // Ticket header
      lines.push(`- [ ] [[${ticket.id}]]`)

      // Metadata
      if (ticket.priority) {
        lines.push(`      **Priority:** ${ticket.priority}`)
      }
      if (ticket.category) {
        lines.push(`      **Category:** ${ticket.category}`)
      }
      for (const [key, value] of Object.entries(ticket.metadata)) {
        lines.push(`      **${key}:** ${value}`)
      }

      // Separator and description
      if (ticket.description || ticket.subtasks.length > 0) {
        lines.push(`      ***`)
      }

      if (ticket.description) {
        lines.push(`      ${ticket.description}`)
      }

      // Subtasks
      for (const subtask of ticket.subtasks) {
        const checkbox = subtask.done ? '[x]' : '[ ]'
        lines.push(`      - ${checkbox} ${subtask.title}`)
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}
```

### createTicket()

```typescript
async function createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
  const db = getDb()

  // Generate id if not provided
  const id = ticket.id || slugify(ticket.title)

  // Get column
  const columnName = ticket.column || 'Backlog'
  const column = db.prepare(`
    SELECT * FROM columns WHERE name = ?
  `).get(columnName)

  if (!column) throw new PMOError('NOT_FOUND', `Column not found: ${columnName}`)

  // Get next position
  const maxPos = db.prepare(`
    SELECT MAX(position) as max FROM tickets WHERE column_id = ?
  `).get(column.id)
  const position = ticket.position ?? (maxPos.max ?? -1) + 1

  // Insert ticket
  db.prepare(`
    INSERT INTO tickets (id, column_id, title, priority, category, description, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, column.id, ticket.title || id, ticket.priority, ticket.category, ticket.description, position)

  // Insert subtasks
  if (ticket.subtasks) {
    const insertSubtask = db.prepare(`
      INSERT INTO subtasks (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < ticket.subtasks.length; i++) {
      const st = ticket.subtasks[i]
      insertSubtask.run(st.id || `${id}-${i}`, id, st.title, st.done ? 1 : 0, i)
    }
  }

  // Insert custom metadata
  if (ticket.metadata) {
    const insertMeta = db.prepare(`
      INSERT INTO ticket_metadata (ticket_id, key, value) VALUES (?, ?, ?)
    `)
    for (const [key, value] of Object.entries(ticket.metadata)) {
      insertMeta.run(id, key, value)
    }
  }

  // Update board timestamp
  db.prepare(`UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'`).run()

  return getTicket(id)
}
```

### updateTicket()

```typescript
async function updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
  const db = getDb()

  // Check ticket exists
  const existing = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id)
  if (!existing) throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)

  // Build update
  const updates: string[] = []
  const params: any[] = []

  if (changes.title !== undefined) {
    updates.push('title = ?')
    params.push(changes.title)
  }
  if (changes.priority !== undefined) {
    updates.push('priority = ?')
    params.push(changes.priority)
  }
  if (changes.category !== undefined) {
    updates.push('category = ?')
    params.push(changes.category)
  }
  if (changes.description !== undefined) {
    updates.push('description = ?')
    params.push(changes.description)
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)
    db.prepare(`
      UPDATE tickets SET ${updates.join(', ')} WHERE id = ?
    `).run(...params)
  }

  // Update subtasks if provided
  if (changes.subtasks) {
    // Delete existing
    db.prepare(`DELETE FROM subtasks WHERE ticket_id = ?`).run(id)

    // Insert new
    const insertSubtask = db.prepare(`
      INSERT INTO subtasks (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < changes.subtasks.length; i++) {
      const st = changes.subtasks[i]
      insertSubtask.run(st.id || `${id}-${i}`, id, st.title, st.done ? 1 : 0, i)
    }
  }

  // Update custom metadata if provided
  if (changes.metadata) {
    db.prepare(`DELETE FROM ticket_metadata WHERE ticket_id = ?`).run(id)
    const insertMeta = db.prepare(`
      INSERT INTO ticket_metadata (ticket_id, key, value) VALUES (?, ?, ?)
    `)
    for (const [key, value] of Object.entries(changes.metadata)) {
      insertMeta.run(id, key, value)
    }
  }

  // Update board timestamp
  db.prepare(`UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'`).run()

  return getTicket(id)
}
```

### moveTicket()

```typescript
async function moveTicket(id: string, columnName: string, position?: number): Promise<Ticket> {
  const db = getDb()

  // Get ticket
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id)
  if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)

  // Get target column
  const column = db.prepare(`SELECT * FROM columns WHERE name = ?`).get(columnName)
  if (!column) throw new PMOError('NOT_FOUND', `Column not found: ${columnName}`)

  // Get position
  const maxPos = db.prepare(`
    SELECT MAX(position) as max FROM tickets WHERE column_id = ?
  `).get(column.id)
  const newPosition = position ?? (maxPos.max ?? -1) + 1

  // Update positions in target column to make room
  db.prepare(`
    UPDATE tickets SET position = position + 1
    WHERE column_id = ? AND position >= ?
  `).run(column.id, newPosition)

  // Move ticket
  db.prepare(`
    UPDATE tickets SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(column.id, newPosition, id)

  // Reorder old column
  db.prepare(`
    UPDATE tickets SET position = position - 1
    WHERE column_id = ? AND position > ?
  `).run(ticket.column_id, ticket.position)

  // Update board timestamp
  db.prepare(`UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'`).run()

  return getTicket(id)
}
```

### deleteTicket()

```typescript
async function deleteTicket(id: string): Promise<void> {
  const db = getDb()

  // Get ticket for position reordering
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id)
  if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)

  // Delete (cascades to subtasks and metadata)
  db.prepare(`DELETE FROM tickets WHERE id = ?`).run(id)

  // Reorder remaining tickets in column
  db.prepare(`
    UPDATE tickets SET position = position - 1
    WHERE column_id = ? AND position > ?
  `).run(ticket.column_id, ticket.position)

  // Update board timestamp
  db.prepare(`UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = 'default'`).run()
}
```

### listTickets()

```typescript
async function listTickets(filter?: TicketFilter): Promise<Ticket[]> {
  const db = getDb()

  let sql = `
    SELECT t.*, c.name as column_name
    FROM tickets t
    JOIN columns c ON t.column_id = c.id
    WHERE 1=1
  `
  const params: any[] = []

  if (filter?.column) {
    sql += ` AND c.name = ?`
    params.push(filter.column)
  }
  if (filter?.priority) {
    sql += ` AND t.priority = ?`
    params.push(filter.priority)
  }
  if (filter?.category) {
    sql += ` AND t.category = ?`
    params.push(filter.category)
  }
  if (filter?.search) {
    sql += ` AND (t.title LIKE ? OR t.description LIKE ?)`
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  sql += ` ORDER BY c.position, t.position`

  const rows = db.prepare(sql).all(...params)

  // Enrich with subtasks and metadata
  return Promise.all(rows.map(async (t) => {
    const subtasks = db.prepare(`
      SELECT * FROM subtasks WHERE ticket_id = ? ORDER BY position
    `).all(t.id)

    const metadata = db.prepare(`
      SELECT key, value FROM ticket_metadata WHERE ticket_id = ?
    `).all(t.id)

    return {
      id: t.id,
      title: t.title,
      column: t.column_name,
      position: t.position,
      priority: t.priority,
      category: t.category,
      description: t.description,
      subtasks: subtasks.map(s => ({
        id: s.id,
        title: s.title,
        done: s.done === 1
      })),
      metadata: Object.fromEntries(metadata.map(m => [m.key, m.value])),
      createdAt: new Date(t.created_at),
      updatedAt: new Date(t.updated_at)
    }
  }))
}
```

### getTicket()

```typescript
async function getTicket(id: string): Promise<Ticket | null> {
  const db = getDb()

  const t = db.prepare(`
    SELECT t.*, c.name as column_name
    FROM tickets t
    JOIN columns c ON t.column_id = c.id
    WHERE t.id = ?
  `).get(id)

  if (!t) return null

  const subtasks = db.prepare(`
    SELECT * FROM subtasks WHERE ticket_id = ? ORDER BY position
  `).all(t.id)

  const metadata = db.prepare(`
    SELECT key, value FROM ticket_metadata WHERE ticket_id = ?
  `).all(t.id)

  return {
    id: t.id,
    title: t.title,
    column: t.column_name,
    position: t.position,
    priority: t.priority,
    category: t.category,
    description: t.description,
    subtasks: subtasks.map(s => ({
      id: s.id,
      title: s.title,
      done: s.done === 1
    })),
    metadata: Object.fromEntries(metadata.map(m => [m.key, m.value])),
    createdAt: new Date(t.created_at),
    updatedAt: new Date(t.updated_at)
  }
}
```

## Sync Operations

SQLite is local-only. Sync operations are no-ops or return appropriate status.

### pull()

```typescript
async function pull(): Promise<SyncResult> {
  // No-op for SQLite - it's local only
  return {
    success: true,
    changes: 0
  }
}
```

### push()

```typescript
async function push(): Promise<SyncResult> {
  // No-op for SQLite - it's local only
  return {
    success: true,
    changes: 0
  }
}
```

### status()

```typescript
async function status(): Promise<SyncStatus> {
  // Always in sync with itself
  return {
    ahead: 0,
    behind: 0,
    conflicts: false
  }
}
```

## WAL Mode

For multiple workers (2+), enable WAL (Write-Ahead Logging) mode:

```typescript
// On database open
db.pragma('journal_mode = WAL')

// Optional: tune for concurrent access
db.pragma('busy_timeout = 5000')      // Wait up to 5s for locks
db.pragma('synchronous = NORMAL')      // Balance durability/speed
```

### Why WAL?

- **Default mode**: Only one writer at a time, readers block
- **WAL mode**: Writers don't block readers, concurrent reads

### Limitations

- WAL files must be on same filesystem as DB
- Not safe for network filesystems (NFS, SMB)
- Still only one writer at a time (but faster)

## CLI Examples

```bash
# Initialize SQLite PMO
prlt board init --storage sqlite

# Initialize with WAL mode (for multiple workers)
prlt board init --storage sqlite --wal

# View board (generates markdown)
prlt board view

# Create ticket
prlt ticket create --title "Fix bug" --column "Backlog"

# Query tickets
prlt ticket list --priority IMPORTANT
prlt ticket list --column "In Progress"
prlt ticket list --search "authentication"

# Sync commands are no-ops but don't error
prlt board status   # "Local SQLite database - always in sync"
```

## Backup

```bash
# Simple file copy (when no writes happening)
cp ~/.pmo/pmo.db ~/.pmo/pmo.db.backup

# Online backup (safe during writes)
sqlite3 ~/.pmo/pmo.db ".backup ~/.pmo/pmo.db.backup"

# Export to SQL
sqlite3 ~/.pmo/pmo.db .dump > backup.sql
```

## Migration

See [pmo-migrate.md](./pmo-migrate.md) for migrating to/from SQLite storage.

### Quick Export to Git

```typescript
// Export SQLite to markdown, init git repo
async function exportToGit(gitPath: string) {
  const board = await getBoard()
  const markdown = generateBoardMarkdown(board)

  await fs.mkdir(gitPath, { recursive: true })
  await fs.writeFile(path.join(gitPath, 'board.md'), markdown)

  // Then: git init, git add, git commit
}
```
