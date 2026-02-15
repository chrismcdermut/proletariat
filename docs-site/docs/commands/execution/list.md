---
sidebar_position: 1
title: execution list
---

# prlt execution list

List running agent executions.

## Usage

```bash
prlt execution list [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--all` | Include completed executions |
| `--json` | Output JSON |

## Examples

```bash
prlt execution list
prlt execution list --all
```

## Output

```
┌──────────┬────────────────┬───────────┬──────────┬──────────────────┐
│ ID       │ Agent          │ Ticket    │ Status   │ Started          │
├──────────┼────────────────┼───────────┼──────────┼──────────────────┤
│ exec-001 │ bold-bezos     │ TKT-001   │ running  │ 5 minutes ago    │
│ exec-002 │ keen-gates     │ TKT-002   │ running  │ 3 minutes ago    │
└──────────┴────────────────┴───────────┴──────────┴──────────────────┘
```
