---
title: Settings
domain: settings
---

# Settings

## Overview

Settings provide configurable values for PMO behavior. They are stored in the `pmo_settings` table as key-value pairs and control how work commands, board templates, and other features operate.

## Abilities

### Get setting

Retrieve a setting value with fallback to default.

| Modality | Signature |
|----------|-----------|
| storage | `getWorkColumnSetting()` |
| cli | `prlt config get <key>` |
| api | `GET /api/settings/:key` |

### Set setting

Store a setting value.

| Modality | Signature |
|----------|-----------|
| storage | `setWorkColumnSetting()` |
| cli | `prlt config set <key> <value>` |
| api | `PUT /api/settings/:key` |

### List settings

List all configured settings.

| Modality | Signature |
|----------|-----------|
| storage | `listSettings()` |
| cli | `prlt config list` |
| api | `GET /api/settings` |

### Delete setting

Remove a setting (reverts to default).

| Modality | Signature |
|----------|-----------|
| storage | `deleteSetting()` |
| cli | `prlt config delete <key>` |
| api | `DELETE /api/settings/:key` |

## Data Model

### Settings Table (`pmo_settings`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| key | string | ✓ | - | Setting identifier (primary key) |
| value | string | ✓ | - | Setting value |

## Settings Reference

### Column Configuration

Control which board columns are used by work lifecycle commands.

| Key | Default | Used By | Description |
|-----|---------|---------|-------------|
| `column_in_progress` | In Progress | `work start` | Column for active work |
| `column_review` | Review | `work ready` | Column for work awaiting review |
| `column_done` | Done | `work complete` | Column for completed work |

**Template defaults** (set automatically by `pmo init`):

| Template | column_in_progress | column_review | column_done |
|----------|-------------------|---------------|-------------|
| kanban | In Progress | In Progress | Done |
| scrum | In Progress | In Review | Done |
| founder | In Progress | In Review | Published |
| custom | (auto-detected) | (auto-detected) | (auto-detected) |

### ID Generation

Auto-increment counters for entity IDs.

| Key | Default | Description |
|-----|---------|-------------|
| `next_ticket_id` | 1 | Next TKT-XXX number |
| `next_epic_id` | 1 | Next EPIC-XXX number |

### Path Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `pmo_path` | pmo | Relative path to PMO directory from HQ root |

## Business Rules

- **Fallback to defaults**: If a setting is not configured, the system uses a sensible default
- **Case-insensitive column matching**: Column names are matched case-insensitively with partial match fallback
- **Template initialization**: `pmo init` sets column settings based on the chosen board template
- **Key format**: Setting keys use snake_case (e.g., `column_in_progress`)

## Column Matching Algorithm

When work commands look for a column:

1. **Exact match (case-insensitive)**: "In Progress" matches "in progress"
2. **Partial match**: "progress" matches "In Progress", "Active Progress", etc.
3. **Error if not found**: Command fails with helpful error message

```bash
# Example: Configure for a custom board layout
prlt config set column_in_progress "Active"
prlt config set column_review "Ready for Review"
prlt config set column_done "Completed"
```

## Related Domains

- [Work](work.md) - Work commands use column settings
- [Board](board.md) - Columns are defined in board configuration
- [Projects](projects.md) - Project templates set initial column settings
