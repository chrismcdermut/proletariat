---
sidebar_position: 5
title: work ready
---

# prlt work ready

Mark work as ready for review.

## Usage

```bash
prlt work ready <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |

## Options

| Flag | Description |
|------|-------------|
| `--pr` | Create pull request |
| `--json` | Output JSON |

## Examples

### Mark Ready

```bash
prlt work ready TKT-001
```

### With PR Creation

```bash
prlt work ready TKT-001 --pr
```

## Output

```
✓ TKT-001 ready for review
  Moved to: In Review
  PR: https://github.com/org/repo/pull/123
```

## Notes

- Moves ticket to Review status
- `--pr` creates GitHub pull request
- Agent typically calls this when work is complete

## See Also

- [work complete](/commands/work/complete)
- [work revise](/commands/work/revise)
- [pr create](/commands/other/pr)
