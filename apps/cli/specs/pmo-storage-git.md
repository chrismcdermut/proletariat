# PMO Storage: Git

## Overview

Git-based storage for PMO boards. The markdown board file is the source of truth for **distribution and sync**. A local SQLite cache provides fast queries and filtering.

This spec covers both:
- **In-Repo** - PMO lives in the same repo as the code
- **Separate Repo** - PMO lives in a dedicated repo

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Git Repository                        │
│  ┌─────────────┐                                            │
│  │  board.md   │ ◄── Source of truth for sync/distribution  │
│  │  (markdown) │                                            │
│  └──────┬──────┘                                            │
└─────────┼───────────────────────────────────────────────────┘
          │
          │ parse on cache miss
          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Local Machine                            │
│  ┌─────────────┐                                            │
│  │  cache.db   │ ◄── SQLite cache for queries/filtering     │
│  │  (SQLite)   │                                            │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

**Why SQLite cache?**
- Markdown isn't queryable (filtering by priority, category, search)
- Parse once, query many times
- Works at any scale (even small boards benefit from indexed queries)
- Enables complex queries without re-parsing

## When to Use

| Setup | Recommendation |
|-------|----------------|
| Solo Mono Solo | ✅ In-Repo works great |
| Solo Multi Solo | ✅ Separate Repo (no single repo for PMO) |
| Solo Mono Wrkrs | ✅ In-Repo works great |
| Solo Multi Wrkrs | ✅ Separate Repo |
| Team Mono Wrkrs | ✅ Separate Repo (avoid PR conflicts) |
| Team Multi Wrkrs | ✅ Separate Repo |
| Enterprise | ⚠️ Consider Cloud DB or PMO Tool instead |

## File Structure

### In-Repo Layout

```
your-project/
├── .pmo/
│   ├── board.md          # Kanban board (Obsidian format)
│   └── config.yaml       # PMO configuration
├── src/
└── ...
```

### Separate Repo Layout

```
pmo-repo/
├── board.md              # Kanban board (Obsidian format)
├── config.yaml           # PMO configuration
└── .gitignore
```

## Configuration

### config.yaml

```yaml
# PMO Configuration
version: 1

storage:
  type: git
  mode: in-repo           # or "separate-repo"
  repo: .                 # path or URL for separate-repo mode
  branch: main            # branch to use
  path: .pmo              # directory within repo (in-repo mode)

board:
  name: "Project Board"
  columns:
    - Backlog
    - In Progress
    - Review
    - Done

sync:
  auto_pull: true         # pull before operations
  auto_push: false        # push after operations (manual by default)
  conflict_strategy: manual  # or "theirs", "ours"
```

## SQLite Cache

The SQLite cache is **always used** for git storage - it's not optional. The cache lives alongside the board file.

### Cache Location

```
# In-Repo
your-project/.pmo/
├── board.md              # Git-tracked
├── config.yaml           # Git-tracked
└── .cache.db             # .gitignore'd (local only)

# Separate Repo
pmo-repo/
├── board.md              # Git-tracked
├── config.yaml           # Git-tracked
└── .cache.db             # .gitignore'd (local only)
```

### Cache Schema

See [pmo-storage-sqlite.md](./pmo-storage-sqlite.md) for full schema. The cache uses the same SQLite schema.

### Cache Invalidation (mtime)

The cache uses **mtime (modification time)** to detect when `board.md` has changed locally:

```typescript
interface CacheMetadata {
  boardMtime: number      // board.md mtime when cache was built
  cacheBuiltAt: number    // timestamp of cache build
}

async function isCacheValid(): Promise<boolean> {
  const boardStat = await fs.stat(boardPath)
  const cacheMeta = await getCacheMetadata()

  // Cache is valid if board.md hasn't changed since cache was built
  return boardStat.mtimeMs <= cacheMeta.boardMtime
}

async function ensureCache(): Promise<void> {
  if (await isCacheValid()) {
    return // Cache is fresh
  }

  // Rebuild cache from markdown
  const markdown = await fs.readFile(boardPath, 'utf-8')
  const board = parseBoard(markdown)
  await rebuildCache(board)

  // Update cache metadata
  const boardStat = await fs.stat(boardPath)
  await setCacheMetadata({
    boardMtime: boardStat.mtimeMs,
    cacheBuiltAt: Date.now()
  })
}
```

**Important:** mtime is local only - it cannot detect remote changes. See Sync Strategy below.

## Sync Strategy (MVP)

For MVP, we use **pull-before-write** - no long-running processes or webhooks needed.

### Pull-Before-Write

Before any mutation (create, update, move, delete), pull from remote:

```typescript
async function withSync<T>(operation: () => Promise<T>): Promise<T> {
  // 1. Pull latest from remote (catches remote changes)
  await pull()

  // 2. Rebuild cache if board.md changed
  await ensureCache()

  // 3. Perform operation (reads from cache, writes to markdown)
  const result = await operation()

  // 4. Commit changes
  await git.add([boardPath])
  await git.commit(`PMO: ${operationDescription}`)

  // 5. Push if auto_push enabled
  if (config.sync.auto_push) {
    await push()
  }

  return result
}
```

### Read Operations

Read operations (list, view, filter) don't need to pull:

```typescript
async function listTickets(filter?: TicketFilter): Promise<Ticket[]> {
  // Just ensure local cache is valid
  await ensureCache()

  // Query from SQLite cache
  return queryTickets(filter)
}
```

### oclif Lifecycle Hooks

Using oclif's `init` hook to validate cache on every command:

```typescript
// src/hooks/init/cache.ts
import { Hook } from '@oclif/core'

const hook: Hook<'init'> = async function (opts) {
  // Skip for non-PMO commands
  if (!opts.id?.startsWith('board') && !opts.id?.startsWith('ticket')) {
    return
  }

  const storage = await getStorage()
  if (storage.type !== 'git') {
    return
  }

  // Check if local cache needs rebuild
  await storage.ensureCache()
}

export default hook
```

### When to Pull

| Operation | Pull First? | Why |
|-----------|-------------|-----|
| `prlt board view` | No | Read-only, local cache sufficient |
| `prlt ticket list` | No | Read-only, local cache sufficient |
| `prlt ticket create` | **Yes** | Mutation - need latest state |
| `prlt ticket move` | **Yes** | Mutation - need latest state |
| `prlt ticket update` | **Yes** | Mutation - need latest state |
| `prlt ticket delete` | **Yes** | Mutation - need latest state |
| `prlt board pull` | Yes | Explicit sync |
| `prlt board push` | Yes | Push includes pull first |

### In-Repo vs Separate-Repo Considerations

| Aspect | In-Repo | Separate-Repo |
|--------|---------|---------------|
| Git hooks | Not recommended (repo-level) | Optional (dedicated repo) |
| Cache invalidation | mtime check | mtime check |
| Pull frequency | On mutations | On mutations |
| Conflict risk | Higher (shared repo) | Lower (dedicated repo) |

For **in-repo** mode, git hooks are problematic because they apply to the entire repository, not just the PMO directory. Use mtime-based cache invalidation instead.

For **separate-repo** mode, you can optionally add git hooks:

```bash
# .pmo-repo/.git/hooks/post-merge
#!/bin/bash
# Rebuild cache after pulling
prlt board cache rebuild
```

## Data Flow Examples

### Engineer Takes a Ticket

```
┌─────────────────────────────────────────────────────────────────────────┐
│ prlt ticket move implement-auth "In Progress"                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. withSync() wrapper starts                                            │
│    - git pull origin main         ◄── Catch any remote changes         │
│    - ensureCache() runs           ◄── Rebuild if board.md changed      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Read from SQLite cache                                               │
│    - SELECT * FROM tickets WHERE id = 'implement-auth'                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Apply change in memory                                               │
│    - ticket.column = 'In Progress'                                      │
│    - ticket.updatedAt = now()                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Write board.md (source of truth)                                     │
│    - generateBoardMarkdown(board)                                       │
│    - fs.writeFile(boardPath, markdown)                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Update SQLite cache                                                  │
│    - UPDATE tickets SET column_name = 'In Progress' WHERE id = '...'   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Git commit                                                           │
│    - git add board.md                                                   │
│    - git commit -m "PMO: Move ticket: implement-auth → In Progress"    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. (Optional) Auto-push if configured                                   │
│    - git push origin main                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Engineer Lists Tickets (Read-Only)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ prlt ticket list --priority URGENT                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Check local cache validity (mtime)                                   │
│    - if board.md.mtime > cache.boardMtime → rebuild                    │
│    - No git pull (read-only operation)                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Query SQLite cache                                                   │
│    - SELECT * FROM tickets WHERE priority = 'URGENT'                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Return results (fast, indexed query)                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Another Node Syncs Changes

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Node B: prlt board pull                                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. git pull origin main                                                 │
│    - Downloads board.md changes from Node A                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Rebuild cache from updated board.md                                  │
│    - parseBoard(markdown)                                               │
│    - rebuildCache(board)                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Node B now has same state as Node A                                  │
│    - SQLite cache reflects latest board state                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### init()

```typescript
async function init(config: BoardConfig): Promise<Board> {
  // 1. Create directory structure
  if (config.mode === 'in-repo') {
    await fs.mkdir('.pmo', { recursive: true })
  } else {
    // Clone or init separate repo
    await git.clone(config.repo) // or git.init()
  }

  // 2. Create config.yaml
  await fs.writeFile(configPath, yaml.stringify(config))

  // 3. Create initial board.md with default columns
  const boardMd = generateBoardMarkdown({
    columns: config.columns || ['Backlog', 'In Progress', 'Review', 'Done'],
    tickets: []
  })
  await fs.writeFile(boardPath, boardMd)

  // 4. Add .cache.db to .gitignore
  await appendToGitignore('.cache.db')

  // 5. Initial commit
  await git.add([configPath, boardPath, '.gitignore'])
  await git.commit('Initialize PMO board')

  // 6. Build initial cache
  const board = parseBoard(boardMd)
  await rebuildCache(board)

  return board
}
```

### getBoard()

```typescript
async function getBoard(): Promise<Board> {
  // Ensure cache is valid (rebuilds if board.md changed)
  await ensureCache()

  // Query from SQLite cache
  return queryBoardFromCache()
}
```

### getBoardMarkdown()

```typescript
async function getBoardMarkdown(): Promise<string> {
  return fs.readFile(boardPath, 'utf-8')
}
```

### createTicket()

```typescript
async function createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
  return withSync(async () => {
    // 1. Read current board from cache
    const board = await getBoard()

    // 2. Generate ticket id if not provided
    const id = ticket.id || slugify(ticket.title)

    // 3. Create ticket object
    const newTicket: Ticket = {
      id,
      title: ticket.title || id,
      column: ticket.column || board.columns[0].name,
      position: ticket.position ?? board.columns[0].tickets.length,
      priority: ticket.priority,
      category: ticket.category,
      description: ticket.description,
      specs: ticket.specs || [],
      subtasks: ticket.subtasks || [],
      metadata: ticket.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date()
    }

    // 4. Add to board
    const column = board.columns.find(c => c.name === newTicket.column)
    column.tickets.splice(newTicket.position, 0, newTicket)

    // 5. Write board.md (source of truth)
    await fs.writeFile(boardPath, generateBoardMarkdown(board))

    // 6. Update cache
    await insertTicketToCache(newTicket)

    return newTicket
  }, `Add ticket: ${ticket.id || slugify(ticket.title)}`)
}
```

### updateTicket()

```typescript
async function updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
  return withSync(async () => {
    // 1. Read current board from cache
    const board = await getBoard()

    // 2. Find ticket
    const ticket = findTicket(board, id)
    if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)

    // 3. Apply changes
    Object.assign(ticket, changes, { updatedAt: new Date() })

    // 4. Write board.md (source of truth)
    await fs.writeFile(boardPath, generateBoardMarkdown(board))

    // 5. Update cache
    await updateTicketInCache(id, ticket)

    return ticket
  }, `Update ticket: ${id}`)
}
```

### moveTicket()

```typescript
async function moveTicket(id: string, column: string, position?: number): Promise<Ticket> {
  return withSync(async () => {
    // 1. Read current board from cache
    const board = await getBoard()

    // 2. Find and remove ticket from current column
    const ticket = findAndRemoveTicket(board, id)
    if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)

    // 3. Add to new column
    const targetColumn = board.columns.find(c => c.name === column)
    if (!targetColumn) throw new PMOError('NOT_FOUND', `Column not found: ${column}`)

    const pos = position ?? targetColumn.tickets.length
    ticket.column = column
    ticket.position = pos
    ticket.updatedAt = new Date()
    targetColumn.tickets.splice(pos, 0, ticket)

    // 4. Write board.md (source of truth)
    await fs.writeFile(boardPath, generateBoardMarkdown(board))

    // 5. Update cache
    await updateTicketInCache(id, ticket)

    return ticket
  }, `Move ticket: ${id} → ${column}`)
}
```

### deleteTicket()

```typescript
async function deleteTicket(id: string): Promise<void> {
  return withSync(async () => {
    // 1. Read current board from cache
    const board = await getBoard()

    // 2. Find and remove ticket
    const ticket = findAndRemoveTicket(board, id)
    if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`)

    // 3. Write board.md (source of truth)
    await fs.writeFile(boardPath, generateBoardMarkdown(board))

    // 4. Delete from cache
    await deleteTicketFromCache(id)
  }, `Delete ticket: ${id}`)
}
```

### listTickets()

```typescript
async function listTickets(filter?: TicketFilter): Promise<Ticket[]> {
  // Ensure cache is valid (no pull needed for reads)
  await ensureCache()

  // Query from SQLite cache with filters
  // This is much faster than parsing markdown and filtering in memory
  return queryTicketsFromCache(filter)
}

// Cache query implementation
async function queryTicketsFromCache(filter?: TicketFilter): Promise<Ticket[]> {
  let query = 'SELECT * FROM tickets WHERE 1=1'
  const params: any[] = []

  if (filter?.column) {
    query += ' AND column_name = ?'
    params.push(filter.column)
  }
  if (filter?.priority) {
    query += ' AND priority = ?'
    params.push(filter.priority)
  }
  if (filter?.category) {
    query += ' AND category = ?'
    params.push(filter.category)
  }
  if (filter?.search) {
    query += ' AND (title LIKE ? OR description LIKE ?)'
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }

  query += ' ORDER BY column_name, position'

  return db.all(query, params)
}
```

## Sync Operations

### pull()

```typescript
async function pull(): Promise<SyncResult> {
  try {
    // 1. Stash local changes if any
    const hasChanges = await git.status().then(s => s.modified.length > 0)
    if (hasChanges) {
      await git.stash()
    }

    // 2. Pull from remote
    const result = await git.pull()

    // 3. Pop stash if we stashed
    if (hasChanges) {
      try {
        await git.stash.pop()
      } catch (e) {
        // Conflict during stash pop
        return {
          success: false,
          changes: 0,
          conflicts: await detectConflicts()
        }
      }
    }

    // 4. Rebuild cache if board.md changed
    if (result.files.includes(boardPath)) {
      await rebuildCacheFromMarkdown()
    }

    return {
      success: true,
      changes: result.files.length
    }
  } catch (e) {
    return {
      success: false,
      changes: 0,
      conflicts: await detectConflicts()
    }
  }
}
```

### push()

```typescript
async function push(): Promise<SyncResult> {
  try {
    // 1. Check for uncommitted changes
    const status = await git.status()
    if (status.modified.includes(boardPath)) {
      await git.add([boardPath])
      await git.commit('Update board')
    }

    // 2. Pull first to avoid conflicts
    const pullResult = await pull()
    if (!pullResult.success) {
      return pullResult
    }

    // 3. Push to remote
    await git.push()

    return {
      success: true,
      changes: 1
    }
  } catch (e) {
    return {
      success: false,
      changes: 0,
      conflicts: [{ type: 'push_failed', message: e.message }]
    }
  }
}
```

### status()

```typescript
async function status(): Promise<SyncStatus> {
  const gitStatus = await git.status()

  // Check ahead/behind
  const ahead = gitStatus.ahead || 0
  const behind = gitStatus.behind || 0

  // Check for conflicts
  const conflicts = gitStatus.conflicted.length > 0

  return { ahead, behind, conflicts }
}
```

## Conflict Resolution

### Detection

Conflicts occur when:
- Same ticket modified in both local and remote
- Ticket moved to different columns in local vs remote
- Ticket deleted remotely but modified locally

### Strategies

#### Manual (Default)

```typescript
// On conflict, abort and show diff
if (conflicts.length > 0) {
  console.log('Conflicts detected:')
  conflicts.forEach(c => {
    console.log(`  - ${c.ticketId}: ${c.description}`)
  })
  console.log('Resolve manually in board.md, then run: prlt board push')
}
```

#### Theirs (Remote Wins)

```typescript
await git.checkout('--theirs', boardPath)
await git.add([boardPath])
```

#### Ours (Local Wins)

```typescript
await git.checkout('--ours', boardPath)
await git.add([boardPath])
```

## Parser Implementation

### parseBoard()

```typescript
function parseBoard(markdown: string): Board {
  const lines = markdown.split('\n')
  const board: Board = {
    id: 'default',
    name: 'Board',
    columns: [],
    updatedAt: new Date()
  }

  let currentColumn: Column | null = null
  let currentTicket: Ticket | null = null
  let inDescription = false

  for (const line of lines) {
    // Column header: ## Column Name
    if (line.startsWith('## ')) {
      currentColumn = {
        id: slugify(line.slice(3)),
        name: line.slice(3).trim(),
        position: board.columns.length,
        tickets: []
      }
      board.columns.push(currentColumn)
      currentTicket = null
      continue
    }

    // Ticket: - [ ] [[ticket-id]] or - [ ] Title
    const ticketMatch = line.match(/^- \[ \] \[\[(.+?)\]\]|^- \[ \] (.+)$/)
    if (ticketMatch && currentColumn) {
      const id = ticketMatch[1] || slugify(ticketMatch[2])
      currentTicket = {
        id,
        title: ticketMatch[1] || ticketMatch[2],
        column: currentColumn.name,
        position: currentColumn.tickets.length,
        specs: [],
        subtasks: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
      currentColumn.tickets.push(currentTicket)
      inDescription = false
      continue
    }

    // Metadata: **Key:** Value
    const metaMatch = line.match(/^\s+\*\*(.+?):\*\*\s*(.*)$/)
    if (metaMatch && currentTicket) {
      const [, key, value] = metaMatch
      if (key === 'Priority') currentTicket.priority = value
      else if (key === 'Category') currentTicket.category = value
      else if (key === 'Specs') {
        // Parse specs: [[spec-1]], [[spec-2]]
        const specMatches = value.matchAll(/\[\[([^\]]+)\]\]/g)
        currentTicket.specs = Array.from(specMatches, m => m[1])
      }
      else currentTicket.metadata[key] = value
      continue
    }

    // Separator: ***
    if (line.trim() === '***' && currentTicket) {
      inDescription = true
      continue
    }

    // Subtask: - [ ] or - [x] (indented)
    const subtaskMatch = line.match(/^\s+- \[([ x])\] (.+)$/)
    if (subtaskMatch && currentTicket) {
      currentTicket.subtasks.push({
        id: slugify(subtaskMatch[2]),
        title: subtaskMatch[2],
        done: subtaskMatch[1] === 'x'
      })
      continue
    }

    // Description text (after ***)
    if (inDescription && currentTicket && line.trim()) {
      currentTicket.description = currentTicket.description
        ? currentTicket.description + '\n' + line.trim()
        : line.trim()
    }
  }

  return board
}
```

### generateBoardMarkdown()

```typescript
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
      if (ticket.specs && ticket.specs.length > 0) {
        const specLinks = ticket.specs.map(s => `[[${s}]]`).join(', ')
        lines.push(`      **Specs:** ${specLinks}`)
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

## CLI Examples

```bash
# Initialize in-repo PMO
prlt board init --mode in-repo

# Initialize separate repo PMO
prlt board init --mode separate-repo --repo git@github.com:user/pmo.git

# View board
prlt board view

# Create ticket (auto-pulls before mutation)
prlt ticket create --title "Implement feature X" --column "Backlog" --priority IMPORTANT

# Move ticket (auto-pulls before mutation)
prlt ticket move implement-feature-x "In Progress"

# Sync
prlt board pull
prlt board push
prlt board status

# Cache operations
prlt board cache status    # Show cache validity
prlt board cache rebuild   # Force rebuild cache from board.md
```

## Edge Cases

### Empty Board

```markdown
## Backlog

## In Progress

## Done
```

Valid - columns exist but no tickets.

### Ticket Without Metadata

```markdown
## Backlog

- [ ] [[simple-ticket]]
      ***
      Just a description, no metadata fields.
```

Valid - metadata fields are optional.

### Malformed Ticket

If parser encounters malformed ticket:
1. Log warning
2. Skip the ticket
3. Continue parsing
4. Report skipped tickets after parse completes

## Migration

See [pmo-migrate.md](./pmo-migrate.md) for migrating to/from git storage.
