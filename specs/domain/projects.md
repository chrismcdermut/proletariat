---
title: Projects
domain: projects
---

# Projects

## Overview

Projects are containers for tickets and boards. Each workspace can have multiple projects. A "default" project is auto-created and cannot be deleted.

## Abilities

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Initialize PMO | Initialize the PMO system in a workspace, creating database and default project | `init()` | `prlt pmo init` | `POST /api/pmo/init` | - | - |
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
| template | string | | "kanban" | Board template used |
| initiative_id | ref | | null | Parent initiative |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

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

- [Board](board.md) - Each project has one board
- [Tickets](tickets.md) - Tickets belong to projects
- [Epics](epics.md) - Epics belong to projects
