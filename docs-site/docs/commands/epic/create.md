---
sidebar_position: 1
title: epic create
---

# prlt epic create

Create a new epic.

## Usage

```bash
prlt epic create [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--title <title>` | Epic title |
| `--description <desc>` | Epic description |
| `--project <id>` | Project ID |
| `--dry-run` | Preview without creating |
| `--json` | Output JSON |

## Examples

```bash
prlt epic create
prlt epic create --title "User Auth System" --project PRJ-001
```
