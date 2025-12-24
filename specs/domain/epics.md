---
title: Epics
domain: epics
---

# Epics

## Overview

Epics are containers for related tickets that represent a larger body of work. They have a lifecycle (draft → active → complete) and can be linked to specs for requirements tracking.

## Abilities

### Create epic

Create a new epic to group related tickets.

| Modality | Signature |
|----------|-----------|
| storage | `createEpic()` |
| cli | `prlt epic create` |
| api | `POST /api/epics` |
| web | `CreateEpicModal` |
| obsidian | `new epic file` |

### List epics

List all epics with optional filtering by status.

| Modality | Signature |
|----------|-----------|
| storage | `listEpics()` |
| cli | `prlt epic list` |
| api | `GET /api/epics` |
| web | `EpicList` |
| obsidian | `epics folder` |

### View epic

View an epic's details including linked tickets.

| Modality | Signature |
|----------|-----------|
| storage | `getEpic()` |
| cli | `prlt epic view` |
| api | `GET /api/epics/:id` |
| web | `/epics/:id` |
| obsidian | `EPIC-001.md` |

### Update epic

Update epic fields like title, description, status.

| Modality | Signature |
|----------|-----------|
| storage | `updateEpic()` |
| cli | `prlt epic edit` |
| api | `PATCH /api/epics/:id` |
| web | `EditEpicModal` |
| obsidian | `edit file` |

### Delete epic

Delete an epic (does not delete linked tickets).

| Modality | Signature |
|----------|-----------|
| storage | `deleteEpic()` |
| cli | `prlt epic delete` |
| api | `DELETE /api/epics/:id` |
| web | `DeleteButton` |
| obsidian | `delete file` |

### Activate epic

Move an epic from draft to active status.

| Modality | Signature |
|----------|-----------|
| storage | `updateEpic()` |
| cli | `prlt epic activate` |
| api | `PATCH /api/epics/:id` |
| web | `StatusDropdown` |
| obsidian | `move to active/` |

### Archive epic

Move a completed epic to archived status.

| Modality | Signature |
|----------|-----------|
| storage | `updateEpic()` |
| cli | `prlt epic archive` |
| api | `PATCH /api/epics/:id` |
| web | `ArchiveButton` |
| obsidian | `move to complete/` |

### View progress

Show epic progress based on ticket completion.

| Modality | Signature |
|----------|-----------|
| storage | `getEpicProgress()` |
| cli | `prlt epic progress` |
| api | `GET /api/epics/:id/progress` |
| web | `ProgressBar` |
| obsidian | `dataview query` |

### Link to spec

Associate an epic with a spec document.

| Modality | Signature |
|----------|-----------|
| storage | `updateEpic()` |
| cli | `prlt epic link` |
| api | `PATCH /api/epics/:id` |
| web | `SpecDropdown` |
| obsidian | `spec_id frontmatter` |

### List tickets

Show all tickets belonging to an epic.

| Modality | Signature |
|----------|-----------|
| storage | `listTickets()` |
| cli | `prlt epic view` |
| api | `GET /api/epics/:id/tickets` |
| web | `TicketList` |
| obsidian | `linked tickets` |

## Data Model

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | EPIC-001 format, auto-generated |
| project_id | string | ✓ | "default" | Parent project |
| title | string | ✓ | - | Epic title |
| description | string | | "" | Markdown body |
| status | enum | | active | draft, active, complete, dropped |
| file_path | string | | null | Path to epic markdown file |
| spec_id | ref | | null | Link to spec document |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

## Business Rules

- **Title required**: Cannot create epic without title
- **Auto-ID**: IDs generated as `EPIC-XXX` (sequential, zero-padded)
- **Lifecycle**: draft → active → complete (or dropped)
- **Many tickets**: An epic can have many tickets linked via `ticket.epic_id`
- **Optional spec**: Epic can optionally link to a spec document
- **Progress**: Calculated from tickets (done / total)

## Epic Lifecycle

```
┌─────────┐     ┌─────────┐     ┌──────────┐
│  DRAFT  │ ──▶ │ ACTIVE  │ ──▶ │ COMPLETE │
└─────────┘     └─────────┘     └──────────┘
     │               │
     │               ▼
     │          ┌─────────┐
     └────────▶ │ DROPPED │
                └─────────┘
```

- **Draft**: Planning phase, not yet started
- **Active**: Work in progress
- **Complete**: All tickets done, archived
- **Dropped**: Cancelled, not pursuing

## Related Domains

- [Tickets](tickets.md) - Tickets belong to epics
- [Specs](specs.md) - Epics can link to specs
- [Projects](projects.md) - Epics belong to projects
