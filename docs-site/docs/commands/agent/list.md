---
sidebar_position: 1
title: agent list
---

# prlt agent list

List all agents.

## Usage

```bash
prlt agent list [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--staff` | Show only staff agents |
| `--temp` | Show only temp agents |
| `--json` | Output JSON |

## Examples

```bash
prlt agent list
prlt agent list --staff
prlt agent list --temp
```

## Output

```
┌──────────────┬───────┬───────────┬──────────────────────┐
│ Name         │ Type  │ Status    │ Working On           │
├──────────────┼───────┼───────────┼──────────────────────┤
│ alice        │ staff │ available │ -                    │
│ bob          │ staff │ working   │ TKT-003              │
│ bold-bezos-1 │ temp  │ working   │ TKT-001              │
│ keen-gates-2 │ temp  │ working   │ TKT-002              │
└──────────────┴───────┴───────────┴──────────────────────┘
```
