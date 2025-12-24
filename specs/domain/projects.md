---
title: Projects
domain: projects
---

# Projects

## Overview

Projects are containers for tickets and boards. Each workspace can have multiple projects. A "default" project is auto-created and cannot be deleted.

## Abilities

### Initialize PMO

Initialize the PMO system in a workspace, creating database and default project.

| Modality | Signature |
|----------|-----------|
| storage | `init()` |
| cli | `prlt pmo init` |
| api | `POST /api/pmo/init` |

### Create project

Create a new project with its own board and ticket namespace.

| Modality | Signature |
|----------|-----------|
| storage | `createProject()` |
| cli | `prlt project create` |
| api | `POST /api/projects` |
| web | `CreateProjectModal` |
| obsidian | `new folder` |

### List projects

List all projects in the workspace.

| Modality | Signature |
|----------|-----------|
| storage | `listProjects()` |
| cli | `prlt project list` |
| api | `GET /api/projects` |
| web | `ProjectList` |
| obsidian | `folders` |

### View project

View a project's details including ticket count and board summary.

| Modality | Signature |
|----------|-----------|
| storage | `getProject()` |
| cli | `prlt project view` |
| api | `GET /api/projects/:id` |
| web | `/projects/:id` |
| obsidian | `project folder` |

### Update project

Update project metadata like name and description.

| Modality | Signature |
|----------|-----------|
| storage | `updateProject()` |
| cli | `prlt project update` |
| api | `PATCH /api/projects/:id` |
| web | `EditProjectModal` |
| obsidian | `edit config` |

### Delete project

Delete a project and all its tickets, columns, and board data.

| Modality | Signature |
|----------|-----------|
| storage | `deleteProject()` |
| cli | `prlt project delete` |
| api | `DELETE /api/projects/:id` |
| web | `DeleteButton` |
| obsidian | `delete folder` |

### Archive project

Mark a project as archived (soft delete).

| Modality | Signature |
|----------|-----------|
| storage | `updateProject()` |
| cli | `prlt project archive` |
| api | `PATCH /api/projects/:id` |
| web | `ArchiveButton` |
| obsidian | `move to archive/` |

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
