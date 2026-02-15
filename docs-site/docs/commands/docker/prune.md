---
sidebar_position: 9
title: docker prune
---

# prlt docker prune

Remove unused Docker resources.

## Usage

```bash
prlt docker prune [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation |
| `--all` | Remove all unused resources |

## Examples

```bash
prlt docker prune
prlt docker prune --all
```

Removes unused containers, images, and volumes.
