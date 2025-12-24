---
title: Spec Format Definition
---

# Spec Format Definition

Specs define the **ideal state** of the product - what it should do, not what it currently does. The database is the source of truth; markdown files are views for editing.

## Spec Types

| Type | Location | Purpose |
|------|----------|---------|
| Domain | `specs/domain/` | What - abilities, data model, business rules |
| Infrastructure | `specs/infrastructure/` | Technical internals (not user-facing) |

## Domain Spec Format

Each domain gets one spec file that shows ALL modalities (Storage, CLI, API, Web, etc.) in a single abilities table.

```markdown
---
title: {Domain Name}
domain: {domain-id}
---

# {Domain Name}

## Overview

{1-3 sentences describing this domain}

## Abilities

| Ability | Storage | CLI | API | Web | Obsidian |
|---------|---------|-----|-----|-----|----------|
| {verb + noun} | `{method()}` | `{command}` | `{endpoint}` | {Component} | {feature} |

## Data Model

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| {field} | {type} | {✓ or auto or blank} | {default} | {description} |

## Business Rules

- **{Rule name}**: {Rule description}

## Related Domains

- [{Domain}]({domain}.md) - {relationship description}
```

## Abilities Table

The abilities table is the core of a domain spec. Each row is a user capability; each column is a modality (platform) where it's implemented.

- **Ability**: User-facing capability (verb + noun)
- **Columns**: Modalities showing implementation signature
- **Empty cell or `-`**: Not planned for this modality
- **Signature**: The intended implementation (method, command, endpoint, component)

### Modalities

| Modality | Description | Column Header |
|----------|-------------|---------------|
| `storage` | Direct database operations (MVP) | Storage |
| `cli` | Command-line interface | CLI |
| `api` | REST/GraphQL endpoints | API |
| `sdk` | Programmatic SDK | SDK |
| `web` | Web application | Web |
| `mobile` | Mobile application | Mobile |
| `desktop` | Desktop application | Desktop |
| `obsidian` | Obsidian plugin | Obsidian |
| `slack` | Slack integration | Slack |
| `sms` | SMS interface | SMS |

Not all domains need all modalities. Only include columns that are relevant.

## Ability Naming

Abilities should be verb + noun format:

| Good | Bad |
|------|-----|
| Create ticket | Ticket creation |
| List epics | Get all epics |
| Move ticket | Change ticket column |
| View progress | Progress |

## Data Model Types

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text | `"hello"` |
| `number` | Integer or float | `42` |
| `boolean` | True/false | `true` |
| `timestamp` | Date/time | `2024-12-17T10:00:00Z` |
| `enum` | Fixed set of values | `URGENT, HIGH, MEDIUM, LOW` |
| `ref` | Foreign key reference | `EPIC-001` |
| `json` | JSON object | `{ "key": "value" }` |

## Required Fields

| Symbol | Meaning |
|--------|---------|
| `auto` | Auto-generated (id, timestamps) |
| `✓` | Required input |
| (blank) | Optional |

## File Structure

```
specs/
├── spec-format.md              # This file
├── README.md                   # Overview
│
├── domain/                     # What (ideal state)
│   ├── tickets.md
│   ├── epics.md
│   ├── agents.md
│   ├── board.md
│   ├── projects.md
│   ├── work.md
│   ├── specs.md
│   └── {domain}.md
│
├── infrastructure/             # Technical internals
│   ├── storage/
│   │   ├── pmo-storage-sqlite.md
│   │   └── ...
│   └── {subsystem}/
│
└── testing/                    # Test specifications
    └── {area}-tests.md
```

## Workflow

1. **Edit markdown**: Human edits spec file
2. **Sync to DB**: `prlt spec sync` parses markdown → writes to database
3. **Generate reports**: `prlt system-card generate` reads from DB → generates coverage report

## Database Storage

Specs are stored in these tables:

- `pmo_specs` - Spec metadata (id, path, title, domain, status)
- `pmo_spec_abilities` - Abilities with implementation per modality
- `pmo_spec_fields` - Data model fields
- `pmo_spec_rules` - Business rules
- `pmo_spec_relations` - Related domain links

## Parsing

Domain specs are parsed to extract:
1. Frontmatter → `pmo_specs` table
2. `## Abilities` table → `pmo_spec_abilities` table
3. `## Data Model` table → `pmo_spec_fields` table
4. `## Business Rules` list → `pmo_spec_rules` table
5. `## Related Domains` list → `pmo_spec_relations` table

The System Card generator reads from DB to show implementation coverage across all domains and modalities.
