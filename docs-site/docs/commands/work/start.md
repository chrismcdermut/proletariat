---
sidebar_position: 1
title: work start
---

# prlt work start

Start an agent on a single ticket.

## Usage

```bash
prlt work start <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |

## Options

| Flag | Description |
|------|-------------|
| `--action <action>` | Action to perform (implement, groom, review) |
| `--agent <name>` | Use specific staff agent |
| `--display <mode>` | Display mode (terminal, background) |
| `--mode <mode>` | Execution mode (docker, host) |
| `--run-on-host` | Run on host instead of Docker |
| `--skip-permissions` | YOLO mode - no permission prompts |
| `--json` | Output JSON |

## Examples

### Basic Start

```bash
prlt work start TKT-001
```

### With Action

```bash
prlt work start TKT-001 --action implement
prlt work start TKT-001 --action groom
prlt work start TKT-001 --action review
```

### Background Mode

```bash
prlt work start TKT-001 --display background
```

### YOLO Mode (Docker)

```bash
prlt work start TKT-001 --skip-permissions
```

### Host Mode

```bash
prlt work start TKT-001 --run-on-host
```

### With Specific Agent

```bash
prlt work start TKT-001 --agent alice
```

## Output

```text
✓ Starting work on TKT-001
  Agent: bold-bezos
  Branch: feat/TKT-001-add-oauth
  Action: implement

Attaching to session...
```

## See Also

- [work spawn](/commands/work/spawn)
- [work ready](/commands/work/ready)
- [Spawning Agents Guide](/guides/spawning-agents)
