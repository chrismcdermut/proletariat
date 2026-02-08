---
sidebar_position: 2
title: ticket list
---

# prlt ticket list

List all tickets.

## Usage

```bash
prlt ticket list [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--status <status>` | Filter by status |
| `--category <category>` | Filter by category |
| `--priority <priority>` | Filter by priority |
| `--project <id>` | Filter by project |
| `--epic <id>` | Filter by epic |
| `--assignee <name>` | Filter by assignee |
| `--json` | Output JSON |

## Examples

### List All

```bash
prlt ticket list
```

### Filter by Status

```bash
prlt ticket list --status "In Progress"
```

### Filter by Category

```bash
prlt ticket list --category bug
```

### Filter by Priority

```bash
prlt ticket list --priority P0 P1
```

### JSON Output

```bash
prlt ticket list --json
```

## Output

```
┌──────────┬────────────────────────┬──────────┬──────────────┬──────────┐
│ ID       │ Title                  │ Priority │ Status       │ Category │
├──────────┼────────────────────────┼──────────┼──────────────┼──────────┤
│ TKT-001  │ Add user auth          │ P1       │ In Progress  │ feature  │
│ TKT-002  │ Fix login bug          │ P0       │ To Do        │ bug      │
│ TKT-003  │ Improve perf           │ P2       │ To Do        │ enhance  │
└──────────┴────────────────────────┴──────────┴──────────────┴──────────┘
```

## See Also

- [ticket view](/commands/ticket/view)
- [ticket create](/commands/ticket/create)
- [board](/commands/other/board)
