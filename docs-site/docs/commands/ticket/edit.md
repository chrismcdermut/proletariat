---
sidebar_position: 4
title: ticket edit
---

# prlt ticket edit

Edit a ticket.

## Usage

```bash
prlt ticket edit <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |

## Options

| Flag | Description |
|------|-------------|
| `--title <title>` | New title |
| `--description <desc>` | New description |
| `--priority <priority>` | New priority |
| `--category <category>` | New category |
| `--add-ac <criteria>` | Add acceptance criteria |
| `--remove-ac <index>` | Remove AC by index |
| `--json` | Output JSON |

## Examples

### Interactive Edit

```bash
prlt ticket edit TKT-001
```

### Change Title

```bash
prlt ticket edit TKT-001 --title "Updated title"
```

### Add Acceptance Criteria

```bash
prlt ticket edit TKT-001 --add-ac "Must validate email format"
prlt ticket edit TKT-001 --add-ac "Must hash passwords"
```

### Change Priority

```bash
prlt ticket edit TKT-001 --priority P0
```

## Output

```
✓ Updated TKT-001
```

## See Also

- [ticket view](/commands/ticket/view)
- [ticket move](/commands/ticket/move)
