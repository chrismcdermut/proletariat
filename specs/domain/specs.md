---
title: Specs
domain: specs
---

# Specs

## Overview

Specs define what the product should do. They are the source of truth for abilities, data models, and business rules. Specs are stored in the database and rendered as markdown files for editing.

## Abilities

### Create spec

Create a new spec document for a domain.

| Modality | Signature |
|----------|-----------|
| storage | `createSpec()` |
| cli | `prlt spec create` |
| api | `POST /api/specs` |
| web | `CreateSpecModal` |
| obsidian | `new file` |

### List specs

List all specs with optional filtering by type or domain.

| Modality | Signature |
|----------|-----------|
| storage | `listSpecs()` |
| cli | `prlt spec list` |
| api | `GET /api/specs` |
| web | `SpecList` |
| obsidian | `specs folder` |

### View spec

View a spec's full content including abilities, data model, and rules.

| Modality | Signature |
|----------|-----------|
| storage | `getSpec()` |
| cli | `prlt spec view` |
| api | `GET /api/specs/:id` |
| web | `/specs/:id` |
| obsidian | `spec file` |

### Update spec

Update spec content through the markdown file.

| Modality | Signature |
|----------|-----------|
| storage | `updateSpec()` |
| cli | `prlt spec edit` |
| api | `PATCH /api/specs/:id` |
| web | `EditSpecModal` |
| obsidian | `edit file` |

### Delete spec

Delete a spec and unlink all associated tickets.

| Modality | Signature |
|----------|-----------|
| storage | `deleteSpec()` |
| cli | `prlt spec delete` |
| api | `DELETE /api/specs/:id` |
| web | `DeleteButton` |
| obsidian | `delete file` |

### Sync specs

Parse markdown spec files and sync to database.

| Modality | Signature |
|----------|-----------|
| cli | `prlt spec sync` |
| api | `POST /api/specs/sync` |
| web | `SyncButton` |

### Link ticket

Associate a ticket with a spec for requirements tracing.

| Modality | Signature |
|----------|-----------|
| storage | `linkTicketToSpec()` |
| cli | `prlt ticket link` |
| api | `POST /api/specs/:id/tickets` |
| web | `TicketDropdown` |
| obsidian | `frontmatter` |

### Generate System Card

Generate a System Card showing spec coverage across modalities.

| Modality | Signature |
|----------|-----------|
| cli | `prlt system-card generate` |
| api | `GET /api/system-card` |
| web | `SystemCardView` |

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
