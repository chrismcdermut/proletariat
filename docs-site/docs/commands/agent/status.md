---
sidebar_position: 2
title: agent status
---

# prlt agent status

Check agent status.

## Usage

```bash
prlt agent status <name>
```

## Arguments

| Argument | Description |
|----------|-------------|
| `name` | Agent name |

## Examples

```bash
prlt agent status alice
prlt agent status bold-bezos-1
```

## Output

```
Agent: bold-bezos-1
Type: temp
Status: working
Ticket: TKT-001 - Add OAuth
Execution: exec-abc123
Tmux: prlt-bold-bezos-1
Started: 5 minutes ago
```
