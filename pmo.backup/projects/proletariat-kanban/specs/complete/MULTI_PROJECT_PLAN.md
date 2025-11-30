# Multi-Project PMO Implementation Plan

## Overview

Enable PMO to support multiple **projects** per workspace, using standard PMO hierarchy:
- **Initiative** (optional) - OKR-level grouping
- **Project** - Discrete effort with its own board + specs
- **Epic** (optional) - Large body of work within a project
- **Ticket** - Individual work item
- **Subtask** - Smallest actionable piece

## Design Principles

1. **SQLite is source of truth** - All data in `workspace.db`
2. **Single config file** - `.proletariat/config.json` for workspace settings
3. **No redundant JSON** - Delete `pmo/config.json`, use SQLite
4. **Bidirectional sync** - `board.md` ←→ SQLite (edit in Obsidian or CLI)

---

## Current State

```
.proletariat/
├── config.json      # Workspace config (type: 'hq')
└── workspace.db     # All data

pmo/
├── config.json      # REDUNDANT - to be removed
├── board.md         # Single board export
└── specs/
```

## Target State

```
.proletariat/
├── config.json      # Workspace + PMO settings
└── workspace.db     # All data (projects, columns, tickets, etc.)

pmo/
├── board.md         # Default project board (synced from DB)
├── board-spike.md   # Spike project board (synced from DB)
└── specs/           # Shared specs
```

---

## Phase 1: Database Schema

### 1.1 Rename `pmo_board` → `pmo_projects`

```sql
-- Drop old table, create new
DROP TABLE IF EXISTS pmo_board;

CREATE TABLE pmo_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT,
  description TEXT,
  initiative_id TEXT,  -- Optional FK to initiatives
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Initiatives table
CREATE TABLE pmo_initiatives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT,
  key_results TEXT,  -- JSON array
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.2 Add `project_id` to tables

```sql
-- Add project_id to pmo_columns (composite key)
ALTER TABLE pmo_columns ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_pmo_columns_project ON pmo_columns(project_id);

-- Add project_id to pmo_tickets
ALTER TABLE pmo_tickets ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_pmo_tickets_project ON pmo_tickets(project_id);

-- Optional: epics table
CREATE TABLE pmo_epics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 1.3 Migration strategy

```typescript
private migrateToMultiProject(): void {
  // Check if migration needed
  const hasProjectId = this.db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('pmo_columns')
    WHERE name = 'project_id'
  `).get() as { count: number };

  if (hasProjectId.count > 0) return; // Already migrated

  // Create projects table
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate existing board to 'default' project
  const existingBoard = this.db.prepare(`SELECT * FROM pmo_board WHERE id = 'default'`).get();
  if (existingBoard) {
    this.db.prepare(`
      INSERT INTO pmo_projects (id, name, template, created_at, updated_at)
      VALUES ('default', ?, ?, ?, ?)
    `).run(existingBoard.name, existingBoard.template, existingBoard.created_at, existingBoard.updated_at);
  } else {
    // Create default project
    this.db.prepare(`
      INSERT INTO pmo_projects (id, name, template)
      VALUES ('default', 'Main Project', 'kanban')
    `).run();
  }

  // Add project_id columns
  this.db.exec(`
    ALTER TABLE pmo_columns ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE pmo_tickets ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
  `);
}
```

---

## Phase 2: Config Consolidation

### 2.1 Update `.proletariat/config.json`

```json
{
  "type": "hq",
  "defaultProject": "default",
  "syncBoards": true
}
```

### 2.2 Remove `pmo/config.json`

- Delete file during migration
- Update `findPMO()` to not require it
- PMO discovery via `.proletariat/config.json` with `type: 'hq'`

### 2.3 Config interface

```typescript
interface WorkspaceConfig {
  type: 'hq' | 'agent';
  defaultProject?: string;  // For HQ only
  syncBoards?: boolean;     // Enable board.md sync
}
```

---

## Phase 3: Storage Layer Updates

### 3.1 SQLiteStorage changes

```typescript
export class SQLiteStorage implements PMOStorage {
  private currentProjectId: string;

  constructor(dbPath: string, projectId: string = 'default') {
    this.currentProjectId = projectId;
    // ...
    this.migrateToMultiProject();
  }

  // Project operations
  async createProject(project: Partial<Project>): Promise<Project>;
  async getProject(id: string): Promise<Project | null>;
  async listProjects(): Promise<Project[]>;
  async deleteProject(id: string): Promise<void>;
  async setCurrentProject(id: string): void;

  // Existing methods now filter by project_id
  async getColumns(): Promise<Column[]> {
    return this.db.prepare(`
      SELECT * FROM pmo_columns
      WHERE project_id = ?
      ORDER BY position
    `).all(this.currentProjectId);
  }
}
```

### 3.2 Methods to update

| Method | Change |
|--------|--------|
| `getBoard()` → `getProject()` | Query pmo_projects by id |
| `getColumns()` | Add `WHERE project_id = ?` |
| `getTickets()` | Add `WHERE project_id = ?` |
| `createTicket()` | Include `project_id` in INSERT |
| `createColumn()` | Include `project_id` in INSERT |
| `rebuildFromBoard()` | Use `currentProjectId` |

---

## Phase 4: Command Updates

### 4.1 Add `--project` flag

```typescript
// Base flag for project selection
const projectFlag = Flags.string({
  char: 'p',
  description: 'Project ID (default: from config)',
});
```

Commands to update:
- `pmo board view` → add `--project`
- `ticket create` → add `--project`
- `ticket list` → add `--project`
- `ticket move` → add `--project`
- `pmo watch` → add `--project`

### 4.2 New project commands

```
prlt project create [name]     # Create new project
prlt project list              # List all projects
prlt project delete <id>       # Delete project
prlt project set-default <id>  # Set default project
prlt project view [id]         # View project details
```

### 4.3 Project resolution

```typescript
async function resolveProjectId(
  flags: { project?: string },
  storage: SQLiteStorage
): Promise<string> {
  // 1. Explicit --project flag
  if (flags.project) {
    const project = await storage.getProject(flags.project);
    if (!project) {
      const projects = await storage.listProjects();
      throw new Error(
        `Project "${flags.project}" not found. Available: ${projects.map(p => p.id).join(', ')}`
      );
    }
    return flags.project;
  }

  // 2. From workspace config
  const config = readWorkspaceConfig();
  return config.defaultProject || 'default';
}
```

---

## Phase 5: Board Sync Updates

### 5.1 Board file naming

```
pmo/board.md           # Default project (backward compat)
pmo/board-spike.md     # Spike project
pmo/board-mobile.md    # Mobile project
```

### 5.2 Sync manager changes

```typescript
export function getBoardPath(pmoPath: string, projectId: string): string {
  if (projectId === 'default') {
    return path.join(pmoPath, 'board.md');
  }
  return path.join(pmoPath, `board-${projectId}.md`);
}

export function autoSyncFromBoard(
  pmoPath: string,
  storage: SQLiteStorage,
  projectId: string = 'default'
): boolean {
  const boardPath = getBoardPath(pmoPath, projectId);
  // ... sync logic with projectId
}

export function parseBoard(markdown: string, projectId: string = 'default'): Board {
  return {
    id: projectId,  // Use parameter instead of 'default'
    // ... rest of parsing
  };
}
```

---

## Implementation Order

### Step 1: Database migration
1. Create `pmo_projects` table
2. Add `project_id` to `pmo_columns`, `pmo_tickets`
3. Migrate existing data to 'default' project
4. Update `ensurePMOTables()` with new schema

### Step 2: Storage layer
1. Add `currentProjectId` to SQLiteStorage
2. Add project CRUD methods
3. Update all queries to filter by `project_id`
4. Add migration function

### Step 3: Config consolidation
1. Add `defaultProject` to workspace config
2. Update config reading across commands
3. Remove `pmo/config.json` dependency

### Step 4: Command flags
1. Add `--project` flag to existing commands
2. Implement project resolution logic
3. Create `prlt project` command group

### Step 5: Board sync
1. Update board file path logic
2. Update `parseBoard()` signature
3. Update sync manager for multi-project

---

## Migration Checklist

- [ ] Update `lib/database/index.ts` schema
- [ ] Update `lib/pmo/storage-sqlite.ts`
- [ ] Add `lib/pmo/projects.ts` for project operations
- [ ] Update `commands/pmo/board.ts`
- [ ] Update `commands/ticket/*.ts`
- [ ] Create `commands/project/*.ts`
- [ ] Update `lib/pmo/sync-manager.ts`
- [ ] Update `lib/pmo/markdown.ts`
- [ ] Remove `pmo/config.json` reads
- [ ] Add migration for existing workspaces

---

## Breaking Changes

None - fully backward compatible:
- Existing 'default' project works unchanged
- `pmo/board.md` continues to work
- All commands work without `--project` flag

## New Capabilities

- Multiple projects per workspace
- `prlt project create/list/delete`
- `--project` flag on all commands
- Per-project board.md files
- Optional initiatives for OKR grouping
