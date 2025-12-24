# PMO Interface Specification

## Overview

This spec defines the canonical interface for the PMO (Project Management Orchestration) system. All storage backends (SQLite, Git, Cloud DB, PMO Tool Adapter) must implement this interface.

## Board Format (Obsidian Kanban Compatible)

The board uses Obsidian Kanban plugin markdown format as the canonical view format.

### Structure

```markdown
## Column Name

- [ ] [[ticket-id]]
      **Priority:** VALUE
      **Category:** VALUE
      **Specs:** [[spec-id]], [[another-spec]]
      ***
      Description text here
      - [ ] Subtask 1
      - [ ] Subtask 2
      - [x] Completed subtask
```

### Elements

| Element | Markdown Syntax | Notes |
|---------|-----------------|-------|
| Column | `## Column Name` | H2 heading, order in file = order on board |
| Ticket | `- [ ] [[ticket-id]]` | Top-level checkbox (hidden in view), becomes card |
| Metadata | `**Key:** Value` | Indented under ticket, bold key |
| Specs | `**Specs:** [[id]], [[id]]` | Comma-separated backlinks to spec files |
| Separator | `***` | Horizontal rule between metadata and description |
| Description | Plain text | Indented under ticket, after separator |
| Subtask | `- [ ]` or `- [x]` | Nested checkbox, visible in card view |

### Ticket Status

- Status is determined by **which column** the ticket is under
- The `- [ ]` checkbox at ticket level is syntax only (not a status indicator)
- Moving a ticket between columns = changing its status

### Subtask Status

- `- [ ]` = incomplete subtask (checkbox visible, unchecked)
- `- [x]` = completed subtask (checkbox visible, checked)

## Data Schema

### Board

```typescript
interface Board {
  id: string
  name: string
  columns: Column[]
  updatedAt: Date
}
```

### Column

```typescript
interface Column {
  id: string
  name: string
  position: number      // order on board (0-indexed)
  tickets: Ticket[]
}
```

### Ticket

```typescript
interface Ticket {
  id: string            // slug, e.g. "support-other-notion-templates"
  title: string         // display title (can differ from id)
  column: string        // column id/name
  position: number      // order within column
  priority?: string     // e.g. "IMPORTANT", "URGENT", "LOW"
  category?: string     // e.g. "BUILD/Infra", "GROW"
  description?: string  // body text after ***
  specs: string[]       // spec IDs this ticket implements
  subtasks: Subtask[]
  metadata: Record<string, string>  // additional **Key:** Value pairs
  createdAt: Date
  updatedAt: Date
}
```

### Spec

```typescript
interface Spec {
  id: string            // slug, e.g. "pmo-storage-git"
  path: string          // file path, e.g. "specs/pmo-storage-git.md"
  title?: string        // display title
  status: 'draft' | 'active' | 'deprecated'
  createdAt: Date
  updatedAt: Date
}
```

### Subtask

```typescript
interface Subtask {
  id: string
  title: string
  done: boolean
}
```

## Interface Operations

All storage backends must implement these operations.

### Board Operations

```typescript
interface PMOStorage {
  // Initialize a new board
  init(config: BoardConfig): Promise<Board>

  // Get the full board state
  getBoard(): Promise<Board>

  // Get board as markdown string
  getBoardMarkdown(): Promise<string>
}
```

### Column Operations

```typescript
interface PMOStorage {
  // Create a new column
  createColumn(name: string, position?: number): Promise<Column>

  // Rename a column
  renameColumn(id: string, name: string): Promise<Column>

  // Reorder a column
  moveColumn(id: string, position: number): Promise<Column>

  // Delete a column (must be empty or specify cascade)
  deleteColumn(id: string, cascade?: boolean): Promise<void>
}
```

### Ticket Operations

```typescript
interface PMOStorage {
  // Create a new ticket
  createTicket(ticket: Partial<Ticket>): Promise<Ticket>

  // Get a ticket by id
  getTicket(id: string): Promise<Ticket | null>

  // Update ticket fields
  updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket>

  // Move ticket to different column and/or position
  moveTicket(id: string, column: string, position?: number): Promise<Ticket>

  // Delete a ticket
  deleteTicket(id: string): Promise<void>

  // List tickets with optional filter
  listTickets(filter?: TicketFilter): Promise<Ticket[]>
}

interface TicketFilter {
  column?: string
  priority?: string
  category?: string
  search?: string       // full-text search in title/description
}
```

### Subtask Operations

```typescript
interface PMOStorage {
  // Add subtask to ticket
  addSubtask(ticketId: string, title: string): Promise<Subtask>

  // Toggle subtask completion
  toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask>

  // Remove subtask
  removeSubtask(ticketId: string, subtaskId: string): Promise<void>
}
```

### Spec Operations

```typescript
interface PMOStorage {
  // Register a spec (usually auto-discovered from specs/ directory)
  createSpec(spec: Partial<Spec>): Promise<Spec>

  // Get a spec by id
  getSpec(id: string): Promise<Spec | null>

  // List all specs
  listSpecs(filter?: SpecFilter): Promise<Spec[]>

  // Update spec status
  updateSpec(id: string, changes: Partial<Spec>): Promise<Spec>

  // Link a ticket to a spec
  linkTicketToSpec(ticketId: string, specId: string): Promise<void>

  // Unlink a ticket from a spec
  unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void>

  // Get all tickets implementing a spec
  getTicketsForSpec(specId: string): Promise<Ticket[]>

  // Get all specs for a ticket
  getSpecsForTicket(ticketId: string): Promise<Spec[]>
}

interface SpecFilter {
  status?: 'draft' | 'active' | 'deprecated'
  search?: string
}
```

### Sync Operations (Backend-Specific)

```typescript
interface PMOStorage {
  // Pull latest state from remote (git pull, API fetch, etc.)
  pull(): Promise<SyncResult>

  // Push local changes to remote (git push, API update, etc.)
  push(): Promise<SyncResult>

  // Check if local state differs from remote
  status(): Promise<SyncStatus>
}

interface SyncResult {
  success: boolean
  changes: number       // number of tickets changed
  conflicts?: Conflict[]
}

interface SyncStatus {
  ahead: number         // local changes not pushed
  behind: number        // remote changes not pulled
  conflicts: boolean
}
```

## Input Methods

### CLI Commands

Primary interface for agents and users:

| Command | Operation |
|---------|-----------|
| `prlt board init` | `init()` |
| `prlt board view` | `getBoardMarkdown()` |
| `prlt ticket create` | `createTicket()` |
| `prlt ticket view <id>` | `getTicket()` |
| `prlt ticket update <id>` | `updateTicket()` |
| `prlt ticket move <id> <column>` | `moveTicket()` |
| `prlt ticket delete <id>` | `deleteTicket()` |
| `prlt ticket list` | `listTickets()` |
| `prlt spec list` | `listSpecs()` |
| `prlt spec view <id>` | `getSpec()` |
| `prlt spec tickets <id>` | `getTicketsForSpec()` |
| `prlt ticket link <id> <spec>` | `linkTicketToSpec()` |
| `prlt ticket unlink <id> <spec>` | `unlinkTicketFromSpec()` |
| `prlt board pull` | `pull()` |
| `prlt board push` | `push()` |
| `prlt board status` | `status()` |

### Direct File Edit (Git/File-based backends)

For users editing markdown directly:

1. User edits `board.md`
2. On save, parser validates changes
3. Changes converted to operations (createTicket, moveTicket, etc.)
4. On `prlt board push`, changes propagate to remote

### PMO Tool Adapter (Future)

For Jira/Linear/Notion integration:

1. Webhook receives change from external tool
2. Adapter translates to internal Ticket format
3. Calls appropriate operation (updateTicket, etc.)
4. Board markdown regenerated

## Parser Requirements

### Markdown → Structured Data

Parser must handle:

- [ ] Extract columns from `## ` headings
- [ ] Extract tickets from top-level `- [ ] [[id]]`
- [ ] Parse metadata fields `**Key:** Value`
- [ ] Recognize `***` separator
- [ ] Extract description (text after separator)
- [ ] Parse nested subtasks `- [ ]` / `- [x]`
- [ ] Preserve ticket order within columns
- [ ] Handle malformed tickets gracefully (warn, don't crash)

### Structured Data → Markdown

Generator must:

- [ ] Output valid Obsidian Kanban format
- [ ] Preserve column order
- [ ] Preserve ticket order within columns
- [ ] Format metadata consistently
- [ ] Indent properly (spaces, not tabs)

## Standard Columns

Recommended default columns (configurable):

```markdown
## Backlog
## In Progress
## Review
## Done
```

## Metadata Fields

Standard fields (all optional):

| Field | Values | Purpose |
|-------|--------|---------|
| Priority | `URGENT`, `IMPORTANT`, `LOW` | Ticket priority |
| Category | `BUILD/Infra`, `GROW`, etc. | Work type grouping |
| Specs | `[[spec-id]], [[spec-id]]` | Backlinks to spec files |
| Assignee | Agent/user identifier | Who's working on it |
| Due | ISO date | Deadline |

Custom fields supported via `**CustomKey:** Value` syntax.

## Spec Discovery

Specs are auto-discovered from the `specs/` directory:

```typescript
async function discoverSpecs(specsDir: string): Promise<Spec[]> {
  const files = await glob('**/*.md', { cwd: specsDir })
  return files.map(file => ({
    id: path.basename(file, '.md'),  // "pmo-storage-git"
    path: path.join(specsDir, file), // "specs/pmo-storage-git.md"
    title: extractTitle(file),        // from first # heading
    status: 'active'
  }))
}
```

On `prlt board init` or `prlt spec sync`, specs are registered in storage.

## Error Handling

Operations should return meaningful errors:

```typescript
interface PMOError {
  code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'SYNC_FAILED'
  message: string
  ticketId?: string
}
```

## Backend-Specific Behavior

See individual storage specs for implementation details:

- [pmo-storage-sqlite.md](./pmo-storage-sqlite.md) - Local SQLite database
- [pmo-storage-git.md](./pmo-storage-git.md) - Git repository (in-repo or separate)
- [pmo-storage-cloud.md](./pmo-storage-cloud.md) - Cloud database (Postgres, etc.)
- [pmo-storage-adapter.md](./pmo-storage-adapter.md) - PMO tool adapters (Jira, Linear, Notion)
