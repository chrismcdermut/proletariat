---
sidebar_position: 8
title: ticket bulk
---

# prlt ticket bulk

Bulk ticket operations.

## Usage

```bash
prlt ticket bulk [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--file <path>` | Import from JSON file |
| `--move <status>` | Move multiple tickets |
| `--delete` | Delete multiple tickets |
| `--category <category>` | Filter for bulk operation |
| `--priority <priority>` | Filter for bulk operation |
| `--json` | Output JSON |

## Examples

### Bulk Create from File

```bash
prlt ticket bulk --file tickets.json
```

File format:
```json
[
  {
    "title": "Add OAuth",
    "category": "feature",
    "priority": "P1"
  },
  {
    "title": "Fix login bug",
    "category": "bug",
    "priority": "P0"
  }
]
```

### Bulk Move

```bash
prlt ticket bulk --move "In Progress" --category bug
```

### Bulk Delete

```bash
prlt ticket bulk --delete --status Done
```

## Output

```
✓ Created 5 tickets
✓ Moved 3 tickets to "In Progress"
```

## See Also

- [ticket create](/commands/ticket/create)
- [ticket move](/commands/ticket/move)
