# PMO Storage: Cloud Database

## Overview

Cloud database storage for PMO boards. Data is stored in a hosted relational database (Postgres, MySQL, PlanetScale, etc.) accessible by all nodes. Markdown board view is generated on demand.

## When to Use

| Setup | Recommendation |
|-------|----------------|
| Solo * | ❌ Overkill, use SQLite or Git |
| Team Mono Wrkrs | ⚠️ Separate Repo usually sufficient |
| Team Multi Wrkrs | ⚠️ Separate Repo usually sufficient |
| Team Any Scale | ✅ Good for 5-10 nodes |
| Enterprise Mono Wrkrs | ✅ Good choice |
| Enterprise Multi Wrkrs | ✅ Good choice |
| Enterprise Any Scale | ✅ Best choice for high concurrency |

## Why Cloud DB?

- **Real-time sync** - No pull/push, all nodes see same state
- **Concurrent writes** - Multiple workers can update simultaneously
- **Scalability** - Handles enterprise workloads
- **Transactions** - ACID guarantees for complex operations

## Supported Databases

| Database | Connection String Example |
|----------|---------------------------|
| Postgres | `postgresql://user:pass@host:5432/pmo` |
| MySQL | `mysql://user:pass@host:3306/pmo` |
| PlanetScale | `mysql://user:pass@host.psdb.cloud/pmo?ssl=true` |
| Neon | `postgresql://user:pass@host.neon.tech/pmo?sslmode=require` |
| Supabase | `postgresql://user:pass@host.supabase.co:5432/pmo` |

## Configuration

### config.yaml

```yaml
# PMO Configuration
version: 1

storage:
  type: cloud
  driver: postgres          # postgres, mysql
  connection: env:PMO_DATABASE_URL  # or literal connection string
  pool:
    min: 2
    max: 10
  ssl: true

board:
  name: "Project Board"
  columns:
    - Backlog
    - In Progress
    - Review
    - Done
```

### Environment Variable

```bash
export PMO_DATABASE_URL="postgresql://user:pass@host:5432/pmo"
```

## Database Schema

### Postgres

```sql
-- Board metadata
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columns
CREATE TABLE columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(board_id, position)
);

-- Tickets
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  priority TEXT,
  category TEXT,
  description TEXT,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subtasks
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
CREATE INDEX idx_tickets_category ON tickets(category);
CREATE INDEX idx_subtasks_ticket ON subtasks(ticket_id);
CREATE INDEX idx_ticket_specs_spec ON ticket_specs(spec_id);

-- Full-text search (Postgres)
CREATE INDEX idx_tickets_search ON tickets USING GIN (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);
```

### MySQL

```sql
-- Board metadata
CREATE TABLE boards (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Columns
CREATE TABLE columns (
  id VARCHAR(255) PRIMARY KEY,
  board_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  position INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  UNIQUE KEY unique_board_position (board_id, position)
);

-- Tickets
CREATE TABLE tickets (
  id VARCHAR(255) PRIMARY KEY,
  column_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  priority VARCHAR(50),
  category VARCHAR(100),
  description TEXT,
  position INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
);

-- Subtasks
CREATE TABLE subtasks (
  id VARCHAR(255) PRIMARY KEY,
  ticket_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  position INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

-- Custom metadata fields
CREATE TABLE ticket_metadata (
  ticket_id VARCHAR(255) NOT NULL,
  `key` VARCHAR(255) NOT NULL,
  value TEXT,
  PRIMARY KEY (ticket_id, `key`),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

-- Specs
CREATE TABLE specs (
  id VARCHAR(255) PRIMARY KEY,
  path VARCHAR(500) NOT NULL,
  title VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Ticket-Spec relationship (many-to-many)
CREATE TABLE ticket_specs (
  ticket_id VARCHAR(255) NOT NULL,
  spec_id VARCHAR(255) NOT NULL,
  PRIMARY KEY (ticket_id, spec_id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_tickets_column ON tickets(column_id);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_category ON tickets(category);
CREATE INDEX idx_subtasks_ticket ON subtasks(ticket_id);
CREATE INDEX idx_ticket_specs_spec ON ticket_specs(spec_id);

-- Full-text search (MySQL)
CREATE FULLTEXT INDEX idx_tickets_search ON tickets(title, description);
```

## Implementation

### Database Connection

```typescript
import { Pool } from 'pg'  // or mysql2

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const config = loadConfig()
    const connectionString = config.storage.connection.startsWith('env:')
      ? process.env[config.storage.connection.slice(4)]
      : config.storage.connection

    pool = new Pool({
      connectionString,
      min: config.storage.pool?.min || 2,
      max: config.storage.pool?.max || 10,
      ssl: config.storage.ssl ? { rejectUnauthorized: false } : undefined
    })
  }
  return pool
}
```

### init()

```typescript
async function init(config: BoardConfig): Promise<Board> {
  const pool = getPool()

  // Run migrations/create tables
  await pool.query(SCHEMA_SQL)

  // Create board
  const boardId = 'default'
  await pool.query(`
    INSERT INTO boards (id, name) VALUES ($1, $2)
    ON CONFLICT (id) DO NOTHING
  `, [boardId, config.name || 'Project Board'])

  // Create default columns
  const columns = config.columns || ['Backlog', 'In Progress', 'Review', 'Done']

  for (let i = 0; i < columns.length; i++) {
    await pool.query(`
      INSERT INTO columns (id, board_id, name, position)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
    `, [slugify(columns[i]), boardId, columns[i], i])
  }

  // Save config locally
  await fs.writeFile(configPath, yaml.stringify(config))

  return getBoard()
}
```

### getBoard()

```typescript
async function getBoard(): Promise<Board> {
  const pool = getPool()

  // Get board
  const boardResult = await pool.query(`SELECT * FROM boards WHERE id = $1`, ['default'])
  const boardRow = boardResult.rows[0]

  // Get columns
  const columnsResult = await pool.query(`
    SELECT * FROM columns WHERE board_id = $1 ORDER BY position
  `, [boardRow.id])

  const result: Board = {
    id: boardRow.id,
    name: boardRow.name,
    columns: [],
    updatedAt: new Date(boardRow.updated_at)
  }

  for (const col of columnsResult.rows) {
    // Get tickets for column
    const ticketsResult = await pool.query(`
      SELECT * FROM tickets WHERE column_id = $1 ORDER BY position
    `, [col.id])

    const columnTickets: Ticket[] = []

    for (const t of ticketsResult.rows) {
      // Get subtasks
      const subtasksResult = await pool.query(`
        SELECT * FROM subtasks WHERE ticket_id = $1 ORDER BY position
      `, [t.id])

      // Get custom metadata
      const metadataResult = await pool.query(`
        SELECT key, value FROM ticket_metadata WHERE ticket_id = $1
      `, [t.id])

      columnTickets.push({
        id: t.id,
        title: t.title,
        column: col.name,
        position: t.position,
        priority: t.priority,
        category: t.category,
        description: t.description,
        subtasks: subtasksResult.rows.map(s => ({
          id: s.id,
          title: s.title,
          done: s.done
        })),
        metadata: Object.fromEntries(metadataResult.rows.map(m => [m.key, m.value])),
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

### createTicket()

```typescript
async function createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Generate id if not provided
    const id = ticket.id || slugify(ticket.title)

    // Get column
    const columnName = ticket.column || 'Backlog'
    const columnResult = await client.query(`
      SELECT * FROM columns WHERE name = $1
    `, [columnName])

    if (columnResult.rows.length === 0) {
      throw new PMOError('NOT_FOUND', `Column not found: ${columnName}`)
    }
    const column = columnResult.rows[0]

    // Get next position
    const posResult = await client.query(`
      SELECT COALESCE(MAX(position), -1) + 1 as next_pos
      FROM tickets WHERE column_id = $1
    `, [column.id])
    const position = ticket.position ?? posResult.rows[0].next_pos

    // Insert ticket
    await client.query(`
      INSERT INTO tickets (id, column_id, title, priority, category, description, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, column.id, ticket.title || id, ticket.priority, ticket.category, ticket.description, position])

    // Insert subtasks
    if (ticket.subtasks) {
      for (let i = 0; i < ticket.subtasks.length; i++) {
        const st = ticket.subtasks[i]
        await client.query(`
          INSERT INTO subtasks (id, ticket_id, title, done, position)
          VALUES ($1, $2, $3, $4, $5)
        `, [st.id || `${id}-${i}`, id, st.title, st.done || false, i])
      }
    }

    // Insert custom metadata
    if (ticket.metadata) {
      for (const [key, value] of Object.entries(ticket.metadata)) {
        await client.query(`
          INSERT INTO ticket_metadata (ticket_id, key, value) VALUES ($1, $2, $3)
        `, [id, key, value])
      }
    }

    // Update board timestamp
    await client.query(`
      UPDATE boards SET updated_at = NOW() WHERE id = 'default'
    `)

    await client.query('COMMIT')

    return getTicket(id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
```

### updateTicket()

```typescript
async function updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Check ticket exists
    const existing = await client.query(`SELECT * FROM tickets WHERE id = $1`, [id])
    if (existing.rows.length === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)
    }

    // Build update
    const updates: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (changes.title !== undefined) {
      updates.push(`title = $${paramIndex++}`)
      params.push(changes.title)
    }
    if (changes.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`)
      params.push(changes.priority)
    }
    if (changes.category !== undefined) {
      updates.push(`category = $${paramIndex++}`)
      params.push(changes.category)
    }
    if (changes.description !== undefined) {
      updates.push(`description = $${paramIndex++}`)
      params.push(changes.description)
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()')
      params.push(id)
      await client.query(`
        UPDATE tickets SET ${updates.join(', ')} WHERE id = $${paramIndex}
      `, params)
    }

    // Update subtasks if provided
    if (changes.subtasks) {
      await client.query(`DELETE FROM subtasks WHERE ticket_id = $1`, [id])

      for (let i = 0; i < changes.subtasks.length; i++) {
        const st = changes.subtasks[i]
        await client.query(`
          INSERT INTO subtasks (id, ticket_id, title, done, position)
          VALUES ($1, $2, $3, $4, $5)
        `, [st.id || `${id}-${i}`, id, st.title, st.done || false, i])
      }
    }

    // Update custom metadata if provided
    if (changes.metadata) {
      await client.query(`DELETE FROM ticket_metadata WHERE ticket_id = $1`, [id])
      for (const [key, value] of Object.entries(changes.metadata)) {
        await client.query(`
          INSERT INTO ticket_metadata (ticket_id, key, value) VALUES ($1, $2, $3)
        `, [id, key, value])
      }
    }

    // Update board timestamp
    await client.query(`UPDATE boards SET updated_at = NOW() WHERE id = 'default'`)

    await client.query('COMMIT')

    return getTicket(id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
```

### moveTicket()

```typescript
async function moveTicket(id: string, columnName: string, position?: number): Promise<Ticket> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Get ticket
    const ticketResult = await client.query(`SELECT * FROM tickets WHERE id = $1`, [id])
    if (ticketResult.rows.length === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)
    }
    const ticket = ticketResult.rows[0]

    // Get target column
    const columnResult = await client.query(`SELECT * FROM columns WHERE name = $1`, [columnName])
    if (columnResult.rows.length === 0) {
      throw new PMOError('NOT_FOUND', `Column not found: ${columnName}`)
    }
    const column = columnResult.rows[0]

    // Get position
    const posResult = await client.query(`
      SELECT COALESCE(MAX(position), -1) + 1 as next_pos
      FROM tickets WHERE column_id = $1
    `, [column.id])
    const newPosition = position ?? posResult.rows[0].next_pos

    // Make room in target column
    await client.query(`
      UPDATE tickets SET position = position + 1
      WHERE column_id = $1 AND position >= $2
    `, [column.id, newPosition])

    // Move ticket
    await client.query(`
      UPDATE tickets SET column_id = $1, position = $2, updated_at = NOW()
      WHERE id = $3
    `, [column.id, newPosition, id])

    // Reorder old column
    await client.query(`
      UPDATE tickets SET position = position - 1
      WHERE column_id = $1 AND position > $2
    `, [ticket.column_id, ticket.position])

    // Update board timestamp
    await client.query(`UPDATE boards SET updated_at = NOW() WHERE id = 'default'`)

    await client.query('COMMIT')

    return getTicket(id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
```

### deleteTicket()

```typescript
async function deleteTicket(id: string): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Get ticket for position reordering
    const ticketResult = await client.query(`SELECT * FROM tickets WHERE id = $1`, [id])
    if (ticketResult.rows.length === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)
    }
    const ticket = ticketResult.rows[0]

    // Delete (cascades to subtasks and metadata)
    await client.query(`DELETE FROM tickets WHERE id = $1`, [id])

    // Reorder remaining tickets
    await client.query(`
      UPDATE tickets SET position = position - 1
      WHERE column_id = $1 AND position > $2
    `, [ticket.column_id, ticket.position])

    // Update board timestamp
    await client.query(`UPDATE boards SET updated_at = NOW() WHERE id = 'default'`)

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
```

### listTickets()

```typescript
async function listTickets(filter?: TicketFilter): Promise<Ticket[]> {
  const pool = getPool()

  let sql = `
    SELECT t.*, c.name as column_name
    FROM tickets t
    JOIN columns c ON t.column_id = c.id
    WHERE 1=1
  `
  const params: any[] = []
  let paramIndex = 1

  if (filter?.column) {
    sql += ` AND c.name = $${paramIndex++}`
    params.push(filter.column)
  }
  if (filter?.priority) {
    sql += ` AND t.priority = $${paramIndex++}`
    params.push(filter.priority)
  }
  if (filter?.category) {
    sql += ` AND t.category = $${paramIndex++}`
    params.push(filter.category)
  }
  if (filter?.search) {
    // Postgres full-text search
    sql += ` AND to_tsvector('english', coalesce(t.title, '') || ' ' || coalesce(t.description, '')) @@ plainto_tsquery('english', $${paramIndex++})`
    params.push(filter.search)
  }

  sql += ` ORDER BY c.position, t.position`

  const result = await pool.query(sql, params)

  // Enrich with subtasks and metadata
  return Promise.all(result.rows.map(async (t) => {
    const subtasksResult = await pool.query(`
      SELECT * FROM subtasks WHERE ticket_id = $1 ORDER BY position
    `, [t.id])

    const metadataResult = await pool.query(`
      SELECT key, value FROM ticket_metadata WHERE ticket_id = $1
    `, [t.id])

    return {
      id: t.id,
      title: t.title,
      column: t.column_name,
      position: t.position,
      priority: t.priority,
      category: t.category,
      description: t.description,
      subtasks: subtasksResult.rows.map(s => ({
        id: s.id,
        title: s.title,
        done: s.done
      })),
      metadata: Object.fromEntries(metadataResult.rows.map(m => [m.key, m.value])),
      createdAt: new Date(t.created_at),
      updatedAt: new Date(t.updated_at)
    }
  }))
}
```

## Sync Operations

Cloud DB is inherently synced - all nodes connect to same database.

### pull()

```typescript
async function pull(): Promise<SyncResult> {
  // No-op - cloud DB is always current
  // Could trigger a cache refresh if we implement local caching
  return {
    success: true,
    changes: 0
  }
}
```

### push()

```typescript
async function push(): Promise<SyncResult> {
  // No-op - writes go directly to cloud DB
  return {
    success: true,
    changes: 0
  }
}
```

### status()

```typescript
async function status(): Promise<SyncStatus> {
  // Always in sync
  return {
    ahead: 0,
    behind: 0,
    conflicts: false
  }
}
```

## Connection Pooling

### Why Pool?

- **Reuse connections** - Avoid connection overhead per query
- **Limit connections** - Don't overwhelm database
- **Handle concurrency** - Multiple workers share pool

### Configuration

```yaml
storage:
  pool:
    min: 2      # Minimum idle connections
    max: 10     # Maximum connections
```

### Per-Node Considerations

Each node has its own pool. With 10 nodes × 10 max connections = 100 connections to DB.

Most hosted databases have limits:
- Neon free: 100 connections
- Supabase free: 60 connections
- PlanetScale: varies by plan

Adjust `max` accordingly.

## CLI Examples

```bash
# Initialize with cloud DB
prlt board init --storage cloud --connection "postgresql://user:pass@host/db"

# Or use environment variable
export PMO_DATABASE_URL="postgresql://user:pass@host/db"
prlt board init --storage cloud

# View board
prlt board view

# Create ticket (writes directly to cloud)
prlt ticket create --title "New feature" --column "Backlog"

# Status always shows synced
prlt board status   # "Cloud database - always in sync"
```

## Security

### Connection String

Never commit connection strings to git:

```yaml
# Good - use environment variable
storage:
  connection: env:PMO_DATABASE_URL

# Bad - hardcoded credentials
storage:
  connection: postgresql://user:password@host/db
```

### SSL

Always enable SSL for production:

```yaml
storage:
  ssl: true
```

### Row-Level Security (Postgres)

For multi-tenant setups:

```sql
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_policy ON tickets
  USING (board_id IN (SELECT board_id FROM user_boards WHERE user_id = current_user_id()));
```

## Migration

See [pmo-migrate.md](./pmo-migrate.md) for migrating to/from cloud storage.
