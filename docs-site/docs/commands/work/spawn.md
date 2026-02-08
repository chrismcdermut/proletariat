---
sidebar_position: 2
title: work spawn
---

# prlt work spawn

Batch spawn agents on multiple tickets.

## Usage

```bash
prlt work spawn [ids...] [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `ids` | Ticket IDs (optional - interactive if omitted) |

## Options

| Flag | Description |
|------|-------------|
| `--all` | Spawn all matching tickets |
| `--column <column>` | Filter by board column |
| `--category <category>` | Filter by category |
| `--priority <priority>` | Filter by priority |
| `--action <action>` | Action to perform |
| `--display <mode>` | Display mode |
| `--skip-permissions` | YOLO mode |
| `--json` | Output JSON |

## Examples

### Interactive

```bash
prlt work spawn
# Select tickets from menu
```

### Specific Tickets

```bash
prlt work spawn TKT-001 TKT-002 TKT-003
```

### All in Column

```bash
prlt work spawn --all --column Backlog
```

### All Bugs

```bash
prlt work spawn --all --category bug
```

### High Priority

```bash
prlt work spawn --all --priority P0 P1
```

### With Options

```bash
prlt work spawn TKT-001 TKT-002 \
  --action implement \
  --display background \
  --skip-permissions
```

## Output

```text
Spawning 3 agents...
  TKT-001 → bold-bezos
  TKT-002 → keen-gates
  TKT-003 → swift-musk

✓ 3 agents spawned
```

## See Also

- [work start](/commands/work/start)
- [work spawn-all](/commands/work/spawn-all)
- [Multi-Agent Workflows](/guides/multi-agent-workflows)
