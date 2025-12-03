---
title: PMO Schema Refactor - Normalize Board View & Add Epic/Sync Support
created: 2024-11-30T00:30:00.000Z
status: active
tickets:
  - id: REFACTOR-001
    title: Add epic_id foreign key to pmo_tickets
    description: Tickets can link to epics via epic_id field
    priority: HIGH
    category: schema
    status: done
  - id: REFACTOR-002
    title: Add status field to pmo_tickets
    description: Add lifecycle status separate from column position (backlog, ready, in_progress, blocked, review, done, cancelled)
    priority: HIGH
    category: schema
    status: done
  - id: REFACTOR-003
    title: Add owner and assignee fields to pmo_tickets
    description: Add owner (human responsible) and assignee (executor - human or agent) fields
    priority: HIGH
    category: schema
    status: done
  - id: REFACTOR-004
    title: Create pmo_board_tickets table
    description: Normalize board view state into separate table (column_id, position)
    priority: HIGH
    category: schema
    status: done
  - id: REFACTOR-005
    title: Add sync tracking fields
    description: Add last_synced_from_spec and last_synced_from_board timestamps for conflict detection
    priority: HIGH
    category: schema
    status: done
  - id: REFACTOR-006
    title: Add status and file_path to pmo_epics
    description: Epics need status (active, draft, complete, dropped, future) and file_path for markdown sync
    priority: HIGH
    category: schema
    status: done
  - id: REFACTOR-007
    title: Implement prlt tickets link command
    description: Bulk command to link tickets to epics
    priority: HIGH
    category: commands
    status: done
  - id: REFACTOR-008
    title: Implement prlt tickets reassign command
    description: Bulk command to reassign tickets to different agents
    priority: HIGH
    category: commands
    status: done
  - id: REFACTOR-009
    title: Implement prlt tickets update command
    description: Bulk command to update priority/category
    priority: MEDIUM
    category: commands
    status: done
  - id: REFACTOR-010
    title: Implement prlt db commands
    description: Database inspection commands (tables, schema, query, stats)
    priority: MEDIUM
    category: commands
    status: pending
  - id: REFACTOR-011
    title: Run database migration
    description: Add epic_id, status, file_path columns to existing database
    priority: HIGH
    category: migration
    status: pending
---

# PMO Schema Refactor

## Overview

Refactor the PMO database schema to:
1. Add epic support (tickets can link to epics via epic_id)
2. Add status/owner/assignee for agent orchestration
3. Normalize board view state into separate table
4. Add sync tracking for conflict detection

This sets the foundation for bidirectional sync between spec frontmatter, database, and board.md.

## Entity Model

### Specs vs Epics vs Tickets

| Entity | Purpose | Lifecycle | Storage |
|--------|---------|-----------|---------|
| **Spec** | Static documentation defining WHAT | None (always exists) | Markdown files |
| **Epic** | Work container for implementation | draft → active → complete/dropped | DB + optional markdown |
| **Ticket** | Atomic work item | backlog → in_progress → done | DB, displayed on board |

**Key relationship**: Tickets link to Epics (not Specs). Epics are work containers.

## Goals

- [x] Epic support with ticket linking
- [x] Clean separation between ticket data and board layout
- [x] Support for lifecycle status tracking
- [x] Support for owner/assignee workflow
- [x] Foundation for conflict detection in sync
- [ ] Database migration for existing installations

## Schema Design

### pmo_tickets
```sql
CREATE TABLE pmo_tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'backlog',
  owner TEXT,
  assignee TEXT,
  spec_id TEXT,
  epic_id TEXT,  -- Links to epic
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced_from_spec TIMESTAMP,
  last_synced_from_board TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
  FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL
);
```

### pmo_epics
```sql
CREATE TABLE pmo_epics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active, draft, complete, dropped, future
  file_path TEXT,  -- Optional markdown file path
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
);
```

### pmo_board_tickets (Board view state)
```sql
CREATE TABLE pmo_board_tickets (
  project_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, ticket_id),
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
);
```

## Implementation Status

### Completed
- [x] Schema updated in schema.ts
- [x] `prlt tickets link` command implemented
- [x] `prlt tickets reassign` command implemented
- [x] `prlt tickets update` command implemented
- [x] SYSTEM_CARD.md updated

### Pending
- [ ] Run migration on existing workspace.db
- [ ] Implement `prlt db` commands for database inspection
- [ ] Implement epic CRUD commands (`prlt epic create/list/view/archive`)

## Migration Notes

The schema is updated in code but existing databases need migration:

```bash
# Check current schema
sqlite3 .proletariat/workspace.db ".schema pmo_tickets"

# Add missing columns manually (if needed)
sqlite3 .proletariat/workspace.db "ALTER TABLE pmo_tickets ADD COLUMN epic_id TEXT"
sqlite3 .proletariat/workspace.db "ALTER TABLE pmo_epics ADD COLUMN status TEXT DEFAULT 'active'"
sqlite3 .proletariat/workspace.db "ALTER TABLE pmo_epics ADD COLUMN file_path TEXT"
```

Or delete and recreate:
```bash
rm .proletariat/workspace.db
prlt pmo init
```
