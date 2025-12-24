---
title: Dependencies
domain: dependencies
---

# Dependencies

## Overview

Dependencies define relationships between work items (tickets, epics). They enable blocking relationships ("can't start until X is done"), work ordering and prioritization, and dependency visualization in board views.

## Abilities

### Link ticket

Create a dependency link from a ticket to another item.

| Modality | Signature |
|----------|-----------|
| storage | `createDependency()` |
| cli | `prlt ticket link` |
| api | `POST /api/dependencies` |
| web | `LinkButton` |

### Unlink ticket

Remove a dependency link between items.

| Modality | Signature |
|----------|-----------|
| storage | `deleteDependency()` |
| cli | `prlt ticket unlink` |
| api | `DELETE /api/dependencies/:id` |
| web | `UnlinkButton` |

### List links

Show all dependency links for a ticket or epic.

| Modality | Signature |
|----------|-----------|
| storage | `listDependencies()` |
| cli | `prlt ticket links` |
| api | `GET /api/dependencies` |
| web | `DependencyList` |

### Link epic

Create a dependency link from an epic to another item.

| Modality | Signature |
|----------|-----------|
| storage | `createDependency()` |
| cli | `prlt epic link` |
| api | `POST /api/dependencies` |
| web | `LinkButton` |

### Unlink epic

Remove a dependency link from an epic.

| Modality | Signature |
|----------|-----------|
| storage | `deleteDependency()` |
| cli | `prlt epic unlink` |
| api | `DELETE /api/dependencies/:id` |
| web | `UnlinkButton` |

### View dependency graph

Visualize the dependency graph for work items.

| Modality | Signature |
|----------|-----------|
| cli | `prlt deps graph` |
| api | `GET /api/dependencies/graph` |
| web | `DependencyGraph` |

## Data Model

### Dependency

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | number | auto | - | Auto-increment ID |
| source_type | enum | ✓ | - | ticket or epic |
| source_id | string | ✓ | - | TKT-001 or EPIC-001 |
| target_type | enum | ✓ | - | ticket or epic |
| target_id | string | ✓ | - | TKT-002 or EPIC-002 |
| dependency_type | enum | ✓ | - | blocks, relates_to, duplicates |
| created_at | timestamp | auto | now | Creation time |
| created_by | string | | null | User who created the link |
| notes | string | | null | Optional context |

## Business Rules

- **No self-links**: Cannot link an item to itself
- **No duplicates**: Each source-target-type combination must be unique
- **Circular detection**: Prevent circular blocking dependencies (A blocks B blocks A)
- **Cascade behavior**: Deleting an item removes its dependency links

## Dependency Types

| Type | Meaning | Enforcement |
|------|---------|-------------|
| blocks | Source must complete before target can start | Hard block |
| relates_to | Items are related (informational) | None |
| duplicates | Target is duplicate of source | Soft warn |

## Board Integration

Blocked tickets show an indicator on the board:

```
┌─────────────────────────────────────────────────────────────────┐
│ Backlog            │ In Progress       │ In Review │ Done      │
├─────────────────────────────────────────────────────────────────┤
│ TKT-002 🔒         │ TKT-001          │           │           │
│ Setup CI/CD        │ Add login screen │           │           │
│ (blocked by TKT-001)│                  │           │           │
└─────────────────────────────────────────────────────────────────┘
```

## Work Start Validation

When starting work on a blocked ticket:

```
$ prlt work start TKT-002

⚠️  TKT-002 is blocked by:
   - TKT-001: Add login screen (In Progress)

? Start anyway?
  ❯ No, cancel
    Yes, start despite blockers
```

## Related Domains

- [Tickets](tickets.md) - Tickets can have dependencies
- [Epics](epics.md) - Epics can have dependencies
