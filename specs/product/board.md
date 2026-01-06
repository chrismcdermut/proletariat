---
title: Board
domain: board
---

# Board

## Overview

Boards are kanban views for organizing tickets into columns. Each project has one board. Board columns correspond directly to the project's workflow statuses (see [Workflow](workflow.md)) - moving a ticket to a column updates its status, and vice versa.

Similar to Linear and Notion, boards support **multiple views** - saved filter/sort/group configurations that show the same underlying data in different ways. Views don't duplicate data; they're just different lenses to view the board.

Boards sync bidirectionally between SQLite and markdown files (kanban.md).

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

### View Abilities

| Ability | Description | storage | cli |
|---------|-------------|---------|-----|
| List views | List all saved views for a project | `listViews()` | `prlt view list` |
| Create view | Create a new view with filters | `createView()` | `prlt view create` |
| Update view | Modify a view's settings | `updateView()` | `prlt view update` |
| Delete view | Remove a saved view | `deleteView()` | `prlt view delete` |
| Get default view | Get the project's default view | `getDefaultView()` | - |
| View board with filters | Display board through a view's lens | `getBoardWithView()` | `prlt board view` |

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

### View

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | View identifier (VIEW-XXX) |
| project_id | ref | required | - | Parent project |
| name | string | required | - | View display name |
| type | enum | | kanban | View type: kanban, list, table |
| filter | json | | {} | Filter configuration |
| group_by | enum | | status | Group by: status, assignee, priority, category, none |
| sort_by | enum | | position | Sort by: priority, created, updated, title, assignee, position |
| sort_direction | enum | | asc | Sort direction: asc, desc |
| is_default | boolean | | false | Default view for project |
| position | number | auto | - | Order in view list |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

### ViewFilter (JSON structure)

| Field | Type | Description |
|-------|------|-------------|
| assignee | string[] | Filter by assignee(s), "unassigned" for no assignee |
| priority | string[] | Filter by priority level(s): HIGH, MEDIUM, LOW |
| statusCategory | string[] | Filter by status category: backlog, unstarted, started, completed, canceled |
| statusId | string[] | Filter by specific status ID(s) |
| column | string[] | Filter by column name(s) |
| search | string | Free text search in title, ID, description |

## Business Rules

- **One board per project**: Board ID equals project ID
- **Multiple views per board**: Views are filter/sort/group presets, not separate data
- **Default columns**: New boards get Backlog, In Progress, Review, Done
- **Bidirectional sync**: Changes to kanban.md sync to DB and vice versa
- **Last-write-wins**: Timestamp-based conflict resolution
- **Cascade positioning**: Moving a column reorders others

### View Rules

- **Views don't duplicate data**: Views filter the same underlying tickets
- **One default view per project**: Setting a new default unsets the previous one
- **Inline filters override saved views**: CLI flags take precedence
- **Filter combination**: Multiple filters are AND-combined
- **Empty results**: Show helpful message when no tickets match filters

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

- [Workflow](workflow.md) - Board columns = workflow statuses
- [Tickets](tickets.md) - Tickets displayed on board
- [Projects](projects.md) - Each project has one board
- [Settings](settings.md) - Column mappings for work lifecycle
- [Work](work.md) - Work commands move tickets between columns
