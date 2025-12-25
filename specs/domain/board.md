---
title: Board
domain: board
---

# Board

## Overview

Boards are kanban views for organizing tickets into columns. Each project has one board. Boards sync bidirectionally between SQLite and markdown files (kanban.md).

## Abilities

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| View board | Display the kanban board with all columns and tickets | `getBoard()` | `prlt board view` | `GET /api/board` | `BoardView` | `kanban.md` |
| Open in editor | Open the board markdown file in the default editor | - | `prlt board open` | - | - | `open file` |
| Export board | Export board to markdown format | `getBoardMarkdown()` | `prlt board export` | `GET /api/board/export` | `ExportButton` | - |
| Sync board | Synchronize board between database and markdown file | `syncBoard()` | `prlt board sync` | `POST /api/board/sync` | `SyncButton` | `auto` |
| Watch changes | Watch for changes to board file and auto-sync | - | `prlt board watch` | - | - | `Obsidian Kanban` |
| Create column | Add a new column to the board | `createColumn()` | `prlt column create` | `POST /api/columns` | `AddColumnButton` | `add section` |
| Rename column | Change the name of a column | `renameColumn()` | `prlt column rename` | `PATCH /api/columns/:id` | `EditColumnModal` | `rename section` |
| Move column | Reorder a column's position on the board | `moveColumn()` | `prlt column move` | `PATCH /api/columns/:id` | `DragColumn` | `reorder sections` |
| Delete column | Remove a column from the board | `deleteColumn()` | `prlt column delete` | `DELETE /api/columns/:id` | `DeleteColumnButton` | `delete section` |

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
