---
sidebar_position: 6
title: work revise
---

# prlt work revise

Request revision on work.

## Usage

```bash
prlt work revise <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |

## Options

| Flag | Description |
|------|-------------|
| `--comment <text>` | Revision feedback |
| `--json` | Output JSON |

## Examples

### Request Revision

```bash
prlt work revise TKT-001
```

### With Feedback

```bash
prlt work revise TKT-001 --comment "Need tests for edge cases"
```

## Output

```text
✓ Requested revision for TKT-001
  Moved to: In Progress
  Comment: Need tests for edge cases
```

## Notes

- Moves ticket back to In Progress
- Optionally adds comment to ticket
- Use when PR review finds issues

## See Also

- [work ready](/commands/work/ready)
- [work start](/commands/work/start)
