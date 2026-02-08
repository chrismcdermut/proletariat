---
sidebar_position: 7
title: ticket complete
---

# prlt ticket complete

Mark a ticket as complete.

## Usage

```bash
prlt ticket complete <id>
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

## Examples

### Complete Ticket

```bash
prlt ticket complete TKT-001
```

## Output

```
✓ Completed TKT-001
```

## Notes

- Moves ticket to final status in workflow
- Use after PR is merged
- Equivalent to `prlt ticket move TKT-001 Done`

## See Also

- [work complete](/commands/work/complete)
- [ticket move](/commands/ticket/move)
