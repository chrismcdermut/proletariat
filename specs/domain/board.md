---
title: Board
domain: board
---

# Board

## Overview

Boards are kanban views for organizing tickets into columns. Each project has one board. Boards sync bidirectionally between SQLite and markdown files (kanban.md).

## Abilities

### View board

Display the kanban board with all columns and tickets.

| Modality | Signature |
|----------|-----------|
| storage | `getBoard()` |
| cli | `prlt board view` |
| api | `GET /api/board` |
| web | `BoardView` |
| obsidian | `kanban.md` |

### Open in editor

Open the board markdown file in the default editor.

| Modality | Signature |
|----------|-----------|
| cli | `prlt board open` |
| obsidian | `open file` |

### Export board

Export board to markdown format.

| Modality | Signature |
|----------|-----------|
| storage | `getBoardMarkdown()` |
| cli | `prlt board export` |
| api | `GET /api/board/export` |
| web | `ExportButton` |

### Sync board

Synchronize board between database and markdown file.

| Modality | Signature |
|----------|-----------|
| storage | `syncBoard()` |
| cli | `prlt board sync` |
| api | `POST /api/board/sync` |
| web | `SyncButton` |
| obsidian | `auto` |

### Watch changes

Watch for changes to board file and auto-sync.

| Modality | Signature |
|----------|-----------|
| cli | `prlt board watch` |
| obsidian | `Obsidian Kanban` |

### Create column

Add a new column to the board.

| Modality | Signature |
|----------|-----------|
| storage | `createColumn()` |
| cli | `prlt column create` |
| api | `POST /api/columns` |
| web | `AddColumnButton` |
| obsidian | `add section` |

### Rename column

Change the name of a column.

| Modality | Signature |
|----------|-----------|
| storage | `renameColumn()` |
| cli | `prlt column rename` |
| api | `PATCH /api/columns/:id` |
| web | `EditColumnModal` |
| obsidian | `rename section` |

### Move column

Reorder a column's position on the board.

| Modality | Signature |
|----------|-----------|
| storage | `moveColumn()` |
| cli | `prlt column move` |
| api | `PATCH /api/columns/:id` |
| web | `DragColumn` |
| obsidian | `reorder sections` |

### Delete column

Remove a column from the board.

| Modality | Signature |
|----------|-----------|
| storage | `deleteColumn()` |
| cli | `prlt column delete` |
| api | `DELETE /api/columns/:id` |
| web | `DeleteColumnButton` |
| obsidian | `delete section` |

## Data Model

### Board

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | Same as project_id |
| name | string | | project name | Board display name |
| columns | ref[] | auto | default columns | Ordered column list |
| updated_at | timestamp | auto | now | Last modified |

### Column

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | Column identifier |
| project_id | ref | ✓ | - | Parent project |
| name | string | ✓ | - | Column display name |
| position | number | auto | - | Order in board |
| status | string | | null | Semantic status mapping |

## Business Rules

- **One board per project**: Board ID equals project ID
- **Default columns**: New boards get Backlog, In Progress, Review, Done
- **Bidirectional sync**: Changes to kanban.md sync to DB and vice versa
- **Last-write-wins**: Timestamp-based conflict resolution
- **Cascade positioning**: Moving a column reorders others

## Board File Format

```markdown
---
kanban-plugin: basic
---

# Project Name

## Backlog

- [ ] **TKT-001** [[TKT-001]] Ticket title
      **Priority:** high

## In Progress

## Done
```

## Related Domains

- [Tickets](tickets.md) - Tickets displayed on board
- [Projects](projects.md) - Each project has one board
- [Settings](settings.md) - Column mappings for work lifecycle
- [Work](work.md) - Work commands move tickets between columns
