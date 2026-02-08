---
sidebar_position: 8
title: agent cleanup
---

# prlt agent cleanup

Remove old temp agents.

## Usage

```bash
prlt agent cleanup [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation |
| `--all` | Remove all temp agents |
| `--json` | Output JSON |

## Examples

```bash
prlt agent cleanup
prlt agent cleanup --force
prlt agent cleanup --all
```

## Output

```
Found 5 inactive temp agents:
  - bold-bezos-1 (TKT-001, completed 2 hours ago)
  - keen-gates-2 (TKT-002, completed 1 hour ago)

? Remove these agents? Yes
✓ Removed 2 agents
```

Removes git worktrees and agent records for inactive temp agents.
