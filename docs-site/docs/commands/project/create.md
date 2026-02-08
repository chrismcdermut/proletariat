---
sidebar_position: 1
title: project create
---

# prlt project create

Create a new project.

## Usage

```bash
prlt project create [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--name <name>` | Project name |
| `--description <desc>` | Project description |
| `--workflow <id>` | Workflow to use |
| `--dry-run` | Preview without creating |
| `--json` | Output JSON |

## Examples

```bash
prlt project create
prlt project create --name "Auth System" --description "User authentication"
```
