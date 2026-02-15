---
sidebar_position: 1
title: spec create
---

# prlt spec create

Create a specification document.

## Usage

```bash
prlt spec create [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--title <title>` | Spec title |
| `--type <type>` | Spec type (technical, design, etc.) |
| `--content <content>` | Spec content |
| `--dry-run` | Preview without creating |
| `--json` | Output JSON |

## Examples

```bash
prlt spec create
prlt spec create --title "Auth Design" --type technical
```
