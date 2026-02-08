---
sidebar_position: 3
title: work spawn-all
---

# prlt work spawn-all

Spawn agents for all planned tickets.

## Usage

```bash
prlt work spawn-all [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--project <id>` | Filter by project |
| `--action <action>` | Action to perform |
| `--display <mode>` | Display mode |
| `--skip-permissions` | YOLO mode |
| `--json` | Output JSON |

## Examples

### Spawn All Planned

```bash
prlt work spawn-all
```

### For Specific Project

```bash
prlt work spawn-all --project PRJ-001
```

### With Options

```bash
prlt work spawn-all \
  --action implement \
  --display background
```

## Output

```
Found 5 planned tickets
Spawning agents...
  TKT-001 → bold-bezos
  TKT-002 → keen-gates
  TKT-003 → swift-musk
  TKT-004 → quick-zuck
  TKT-005 → smart-cook

✓ 5 agents spawned
```

## See Also

- [work spawn](/commands/work/spawn)
- [Multi-Agent Workflows](/guides/multi-agent-workflows)
