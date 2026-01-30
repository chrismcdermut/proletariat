---
title: Projects
domain: projects
---

# Projects

## Overview

Projects are the primary container for work. Each project has a kanban board, a workflow configuration (status set), and contains tickets. Projects can represent either time-bounded efforts (like Linear's Projects) or ongoing workstreams.

Each workspace can have multiple projects. A "default" project is auto-created and cannot be deleted.

## Abilities

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Initialize PMO | Initialize the PMO system in a workspace, creating database and default project | `init()` | `prlt init` | `POST /api/pmo/init` | - | - |
| Create project | Create a new project with its own board and ticket namespace | `createProject()` | `prlt project create` | `POST /api/projects` | `CreateProjectModal` | `new folder` |
| List projects | List all projects in the workspace | `listProjects()` | `prlt project list` | `GET /api/projects` | `ProjectList` | `folders` |
| View project | View a project's details including ticket count and board summary | `getProject()` | `prlt project view` | `GET /api/projects/:id` | `/projects/:id` | `project folder` |
| Update project | Update project metadata like name and description | `updateProject()` | `prlt project update` | `PATCH /api/projects/:id` | `EditProjectModal` | `edit config` |
| Delete project | Delete a project and all its tickets, columns, and board data | `deleteProject()` | `prlt project delete` | `DELETE /api/projects/:id` | `DeleteButton` | `delete folder` |
| Archive project | Mark a project as archived (soft delete) | `updateProject()` | `prlt project archive` | `PATCH /api/projects/:id` | `ArchiveButton` | `move to archive/` |

## Data Model

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | Project identifier (slug) |
| name | string | ✓ | - | Display name |
| description | string | | "" | Project description |
| status | enum | | active | Project lifecycle: draft, active, completed, archived |
| template | string | | "kanban" | Workflow template used to seed status configuration |
| target_date | timestamp | | null | Optional end date for time-bounded projects |
| initiative_id | ref | | null | Parent initiative |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

### Project Lifecycle

Projects have a fixed status lifecycle (separate from ticket statuses):

```
┌───────┐     ┌────────┐     ┌───────────┐     ┌──────────┐
│ draft │ ──▶ │ active │ ──▶ │ completed │ ──▶ │ archived │
└───────┘     └────────┘     └───────────┘     └──────────┘
```

- **draft**: Planning phase, defining scope and tickets
- **active**: Work is actively happening
- **completed**: Project goals achieved, may still reference for history
- **archived**: Soft-deleted, hidden from default views

## Business Rules

- **Default project**: Every workspace has a "default" project that cannot be deleted
- **One board per project**: Creating a project auto-creates its board
- **Cascade delete**: Deleting project removes all its tickets, columns, and board
- **Unique IDs**: Project IDs are slugified names, must be unique

## Project Structure

```
.proletariat/
├── pmo/
│   ├── projects/
│   │   ├── default/
│   │   │   └── kanban.md
│   │   └── mobile-app/
│   │       └── kanban.md
│   └── config.json
└── workspace.db
```

## Related Domains

- [Workflow](workflow.md) - Projects own a status configuration for their tickets
- [Board](board.md) - Each project has one board (columns = statuses)
- [Tickets](tickets.md) - Tickets belong to projects
- [Epics](epics.md) - **Deprecated**: Projects now serve as the primary grouping mechanism, similar to Linear. Epic functionality may be removed in a future version.
