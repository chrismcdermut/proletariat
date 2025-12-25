---
title: Specs
domain: specs
---

# Specs

## Overview

Specs define what the product should do. They are the source of truth for abilities, data models, and business rules. Specs are stored in the database and rendered as markdown files for editing.

## Abilities

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Create spec | Create a new spec document for a domain | `createSpec()` | `prlt spec create` | `POST /api/specs` | `CreateSpecModal` | `new file` |
| List specs | List all specs with optional filtering by type or domain | `listSpecs()` | `prlt spec list` | `GET /api/specs` | `SpecList` | `specs folder` |
| View spec | View a spec's full content including abilities, data model, and rules | `getSpec()` | `prlt spec view` | `GET /api/specs/:id` | `/specs/:id` | `spec file` |
| Update spec | Update spec content through the markdown file | `updateSpec()` | `prlt spec edit` | `PATCH /api/specs/:id` | `EditSpecModal` | `edit file` |
| Delete spec | Delete a spec and unlink all associated tickets | `deleteSpec()` | `prlt spec delete` | `DELETE /api/specs/:id` | `DeleteButton` | `delete file` |
| Sync specs | Parse markdown spec files and sync to database | - | `prlt spec sync` | `POST /api/specs/sync` | `SyncButton` | - |
| Link ticket | Associate a ticket with a spec for requirements tracing | `linkTicketToSpec()` | `prlt ticket link` | `POST /api/specs/:id/tickets` | `TicketDropdown` | `frontmatter` |
| Generate System Card | Generate a System Card showing spec coverage across modalities | - | `prlt system-card generate` | `GET /api/system-card` | `SystemCardView` | - |

## Data Model

### Spec

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | Domain name as ID |
| path | string | ✓ | - | File path relative to specs/ |
| title | string | | null | Display title |
| overview | string | | null | Description text |
| status | enum | | active | draft, active, deprecated |
| spec_type | enum | | domain | domain, infrastructure |
| domain | string | | null | Domain name |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

### Spec Ability

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | number | auto | - | Auto-increment ID |
| spec_id | ref | ✓ | - | Parent spec |
| name | string | ✓ | - | Ability name |
| description | string | | null | What this ability does |
| position | number | auto | - | Order in list |

### Spec Implementation

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | number | auto | - | Auto-increment ID |
| ability_id | ref | ✓ | - | Parent ability |
| modality | string | ✓ | - | Implementation modality (storage, cli, api, etc.) |
| signature | string | ✓ | - | Implementation signature |

### Spec Field

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | number | auto | - | Auto-increment ID |
| spec_id | ref | ✓ | - | Parent spec |
| name | string | ✓ | - | Field name |
| field_type | enum | ✓ | - | string, number, boolean, timestamp, enum, ref, json |
| required | enum | | optional | required, auto, optional |
| default_value | string | | null | Default value |
| description | string | | null | Field description |
| position | number | auto | - | Order in table |

### Spec Rule

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | number | auto | - | Auto-increment ID |
| spec_id | ref | ✓ | - | Parent spec |
| name | string | ✓ | - | Rule name |
| description | string | ✓ | - | Rule description |
| position | number | auto | - | Order in list |

## Business Rules

- **DB is source of truth**: Specs stored in database, markdown is view
- **Sync direction**: `prlt spec sync` parses markdown → writes to DB
- **One spec per domain**: Domain name is the spec ID
- **Abilities define capabilities**: What the product should do
- **Data model defines schema**: What data is stored
- **Rules define constraints**: Business logic requirements

## Spec Types

| Type | Directory | Purpose |
|------|-----------|---------
| domain | `specs/domain/` | What - abilities, data model, rules |
| infrastructure | `specs/infrastructure/` | Technical internals |

## Related Domains

- [Tickets](tickets.md) - Tickets can link to specs
- [Epics](epics.md) - Epics can link to specs
