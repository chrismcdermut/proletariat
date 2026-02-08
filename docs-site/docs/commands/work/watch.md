---
sidebar_position: 7
title: work watch
---

# prlt work watch

Watch for tickets and auto-spawn agents.

## Usage

```bash
prlt work watch [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--column <column>` | Watch specific column |
| `--priority <priority>` | Filter by priority |
| `--action <action>` | Action for spawned agents |
| `--json` | Output JSON |

## Examples

### Watch To Do Column

```bash
prlt work watch --column "To Do"
```

### Watch High Priority

```bash
prlt work watch --priority P0 P1
```

### With Action

```bash
prlt work watch --column Backlog --action implement
```

## Output

```text
Watching for new tickets...

[12:34:56] New ticket: TKT-005
  Spawning agent: bold-bezos
  Action: implement

[12:35:12] New ticket: TKT-006
  Spawning agent: keen-gates
  Action: implement
```

## Notes

- Runs continuously until stopped (Ctrl+C)
- Auto-spawns agents on matching tickets
- Useful for automated workflows

## See Also

- [work spawn](/commands/work/spawn)
- [board watch](/commands/other/board)
