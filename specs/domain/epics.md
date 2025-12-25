---
title: Epics
domain: epics
---

# Epics

## Overview

Epics are containers for related tickets that represent a larger body of work. They have a lifecycle (draft → active → complete) and can be linked to specs for requirements tracking.

## Abilities

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Create epic | Create a new epic to group related tickets | `createEpic()` | `prlt epic create` | `POST /api/epics` | `CreateEpicModal` | `new epic file` |
| List epics | List all epics with optional filtering by status | `listEpics()` | `prlt epic list` | `GET /api/epics` | `EpicList` | `epics folder` |
| View epic | View an epic's details including linked tickets | `getEpic()` | `prlt epic view` | `GET /api/epics/:id` | `/epics/:id` | `EPIC-001.md` |
| Update epic | Update epic fields like title, description, status | `updateEpic()` | `prlt epic edit` | `PATCH /api/epics/:id` | `EditEpicModal` | `edit file` |
| Delete epic | Delete an epic (does not delete linked tickets) | `deleteEpic()` | `prlt epic delete` | `DELETE /api/epics/:id` | `DeleteButton` | `delete file` |
| Activate epic | Move an epic from draft to active status | `updateEpic()` | `prlt epic activate` | `PATCH /api/epics/:id` | `StatusDropdown` | `move to active/` |
| Archive epic | Move a completed epic to archived status | `updateEpic()` | `prlt epic archive` | `PATCH /api/epics/:id` | `ArchiveButton` | `move to complete/` |
| View progress | Show epic progress based on ticket completion | `getEpicProgress()` | `prlt epic progress` | `GET /api/epics/:id/progress` | `ProgressBar` | `dataview query` |
| Link to spec | Associate an epic with a spec document | `updateEpic()` | `prlt epic link` | `PATCH /api/epics/:id` | `SpecDropdown` | `spec_id frontmatter` |
| List tickets | Show all tickets belonging to an epic | `listTickets()` | `prlt epic view` | `GET /api/epics/:id/tickets` | `TicketList` | `linked tickets` |

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
