---
sidebar_position: 6
title: docker logs
---

# prlt docker logs

View container logs.

## Usage

```bash
prlt docker logs <name> [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `name` | Container/agent name |

## Options

| Flag | Description |
|------|-------------|
| `--follow` | Stream logs |
| `--tail <n>` | Show last n lines |

## Examples

```bash
prlt docker logs bold-bezos-1
prlt docker logs bold-bezos-1 --follow
```
