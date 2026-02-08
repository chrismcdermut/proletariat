---
sidebar_position: 4
title: work complete
---

# prlt work complete

Mark work as complete.

## Usage

```bash
prlt work complete <id>
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

### Complete Work

```bash
prlt work complete TKT-001
```

## Output

```
✓ Completed TKT-001
  Moved to: Done
```

## Notes

- Use after PR is merged
- Moves ticket to final status
- Stops any running execution

## See Also

- [work ready](/commands/work/ready)
- [ticket complete](/commands/ticket/complete)
