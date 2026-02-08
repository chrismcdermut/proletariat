---
sidebar_position: 3
title: execution stop
---

# prlt execution stop

Stop a running execution.

## Usage

```bash
prlt execution stop <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Execution ID |

## Options

| Flag | Description |
|------|-------------|
| `--all` | Stop all executions |
| `--force` | Force stop |

## Examples

```bash
prlt execution stop exec-001
prlt execution stop --all
prlt execution stop exec-001 --force
```
