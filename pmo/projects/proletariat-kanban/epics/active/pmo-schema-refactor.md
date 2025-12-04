---
id: EPIC-SCHEMA
title: PMO Schema Refactor - Normalize Board View & Add Epic/Sync Support
status: active
created: 2024-11-30T00:30:00.000Z
description: Refactor PMO database schema to add epic support, status tracking, and normalize board view state
---

# PMO Schema Refactor

## Overview

Refactor the PMO database schema to:
1. Add epic support (tickets can link to epics via epic_id)
2. Add status/owner/assignee for agent orchestration
3. Normalize board view state into separate table
4. Add sync tracking for conflict detection

This sets the foundation for bidirectional sync between spec frontmatter, database, and board.md.

## Goals

- [x] Epic support with ticket linking
- [x] Clean separation between ticket data and board layout
- [x] Support for lifecycle status tracking
- [x] Support for owner/assignee workflow
- [x] Foundation for conflict detection in sync
- [ ] Database migration for existing installations
- [ ] Epic CRUD commands with markdown file generation

## Success Criteria

- [x] Schema updated in schema.ts
- [x] `prlt tickets link` command implemented
- [x] `prlt tickets reassign` command implemented
- [x] `prlt tickets update` command implemented
- [x] SYSTEM_CARD.md updated
- [x] `prlt epic create/list/view/archive/activate/move/progress` commands
- [x] Epic markdown files generated in epics/{status}/ folders
- [ ] Run migration on existing workspace.db
- [ ] Implement `prlt db` commands for database inspection

## Entity Model

### Specs vs Epics vs Tickets

| Entity | Purpose | Lifecycle | Storage |
|--------|---------|-----------|---------|
| **Spec** | Static documentation defining WHAT | None (always exists) | Markdown files |
| **Epic** | Work container for implementation | draft → active → complete/dropped | DB + markdown files |
| **Ticket** | Atomic work item | backlog → in_progress → done | DB, displayed on board |

**Key relationship**: Tickets link to Epics (not Specs). Epics are work containers.

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
  file_path TEXT,  -- Markdown file path
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

## Tickets

Create these tickets with:
```bash
# Schema changes (done)
prlt ticket create --epic EPIC-SCHEMA -t "Add epic_id foreign key to pmo_tickets" -p HIGH --category schema
prlt ticket create --epic EPIC-SCHEMA -t "Add status field to pmo_tickets" -p HIGH --category schema
prlt ticket create --epic EPIC-SCHEMA -t "Add owner and assignee fields to pmo_tickets" -p HIGH --category schema
prlt ticket create --epic EPIC-SCHEMA -t "Create pmo_board_tickets table" -p HIGH --category schema
prlt ticket create --epic EPIC-SCHEMA -t "Add sync tracking fields" -p HIGH --category schema
prlt ticket create --epic EPIC-SCHEMA -t "Add status and file_path to pmo_epics" -p HIGH --category schema

# Commands (done)
prlt ticket create --epic EPIC-SCHEMA -t "Implement prlt tickets link command" -p HIGH --category commands
prlt ticket create --epic EPIC-SCHEMA -t "Implement prlt tickets reassign command" -p HIGH --category commands
prlt ticket create --epic EPIC-SCHEMA -t "Implement prlt tickets update command" -p MEDIUM --category commands

# Pending
prlt ticket create --epic EPIC-SCHEMA -t "Implement prlt db commands" -p MEDIUM --category commands
prlt ticket create --epic EPIC-SCHEMA -t "Run database migration" -p HIGH --category migration
```
