---
sidebar_position: 4
title: epic ticket
---

# prlt epic ticket

Manage tickets in an epic.

## Usage

```bash
prlt epic ticket <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Epic ID |

## Options

| Flag | Description |
|------|-------------|
| `--add <ticket-ids>` | Add tickets to epic |
| `--remove <ticket-ids>` | Remove tickets from epic |
| `--create <title>` | Create new ticket in epic |
| `--json` | Output JSON |

## Examples

```bash
prlt epic ticket EPC-001 --add TKT-001 TKT-002
prlt epic ticket EPC-001 --remove TKT-003
prlt epic ticket EPC-001 --create "Add login page"
```
