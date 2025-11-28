# PMO (Project Management Office)

## Structure

```
pmo/
└── projects/
    └── {project-id}/
        ├── board.md          # Obsidian-compatible kanban board
        └── specs/
            ├── active/       # Active work specifications
            ├── complete/     # Completed specifications
            ├── future/       # Future/backlog specifications
            └── dropped/      # Dropped/cancelled work
```

## Overview

Multi-project PMO system with:
- **SQLite database** (`../.proletariat/workspace.db`) as source of truth
- **Markdown boards** (`projects/{id}/board.md`) synced with database
- **Project-based organization** for managing multiple workstreams
- **Obsidian integration** for visual kanban boards

## Current Projects

### proletariat
Main Proletariat CLI development project.

**Location**: `pmo/projects/proletariat/`

**Active Specs**:
- `SYSTEM_CARD.md` - System architecture and design
- `pmo-architecture.md` - PMO architecture design
- `pmo-crud-commands.md` - CRUD command specifications
- `pmo-work-commands.md` - Work command specifications

**Completed Specs**:
- `MULTI_PROJECT_PLAN.md` - Multi-project PMO implementation ✅
- `mvp-completion.md` - MVP completion checklist ✅
- `pmo-storage-sqlite.md` - SQLite storage implementation ✅
- `pmo-interface.md` - PMO interface design ✅
- `agent-commands.md`, `agents-commands.md`, `init-commands.md`, `init.md`

**Future Work**:
- `org-pmo.md` - Organization-level PMO features
- `pmo-storage-git.md` - Git-based storage backend
- `pmo-storage-cloud.md` - Cloud storage backend
- `pmo-storage-adapter.md` - Storage adapter pattern

**Dropped**:
- `cli-enhancement.md` - Superseded by current implementation
- `documentation-update.md` - Superseded by current documentation
- `pmo-migrate.md` - Migration no longer needed (greenfield)

## Usage

### CLI Commands

```bash
# View board
prlt board view

# Create ticket
prlt ticket create --title "My ticket" --column "Ready"

# List tickets
prlt ticket list
prlt ticket list --column "In Progress"
prlt ticket list --priority URGENT

# Move ticket
prlt ticket move <ticket-id> "In Progress"

# Update ticket
prlt ticket update <ticket-id> --priority HIGH

# Projects
prlt project create "New Project"
prlt project list
prlt project view proletariat
```

### Obsidian Setup

1. Open the `pmo/` directory as an Obsidian vault
2. Install the "Kanban" plugin
3. Open `projects/{id}/board.md` and switch to Kanban view
4. Drag and drop tickets between columns
5. Changes sync bidirectionally with the database

## Spec Organization

- **active/**: Currently being worked on
- **complete/**: Finished and shipped
- **future/**: Planned but not started
- **dropped/**: Cancelled or superseded

## Data Storage

All PMO data lives in `../.proletariat/workspace.db`:
- `pmo_projects` - Project metadata
- `pmo_boards` - Board configurations
- `pmo_columns` - Column definitions
- `pmo_tickets` - Ticket data
- `pmo_custom_fields` - Custom field values

Board markdown files are auto-synced with the database for Obsidian compatibility.
