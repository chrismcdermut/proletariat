---
sidebar_position: 5
title: ticket move
---

# prlt ticket move

Change ticket status.

## Usage

```bash
prlt ticket move <id> [status]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |
| `status` | Target status (optional - interactive if omitted) |

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

## Examples

### Interactive Move

```bash
prlt ticket move TKT-001
# Select from available statuses
```

### Direct Move

```bash
prlt ticket move TKT-001 "In Progress"
```

### Move to Review

```bash
prlt ticket move TKT-001 "In Review"
```

## Output

```
✓ Moved TKT-001 to "In Progress"
```

## See Also

- [ticket view](/commands/ticket/view)
- [work ready](/commands/work/ready)
- [work complete](/commands/work/complete)
