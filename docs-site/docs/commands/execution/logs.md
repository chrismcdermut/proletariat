---
sidebar_position: 2
title: execution logs
---

# prlt execution logs

View execution output.

## Usage

```bash
prlt execution logs <id> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Execution ID |

## Options

| Flag | Description |
|------|-------------|
| `--follow` | Stream logs in real-time |
| `--tail <n>` | Show last n lines |

## Examples

```bash
prlt execution logs exec-001
prlt execution logs exec-001 --follow
prlt execution logs exec-001 --tail 50
```
