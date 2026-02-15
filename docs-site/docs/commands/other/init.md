---
sidebar_position: 1
title: init
---

# prlt init

Initialize a new prlt workspace.

## Usage

```bash
prlt init [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--name <name>` | Workspace name |
| `--theme <theme>` | Agent naming theme |
| `--json` | Output JSON |

## Examples

```bash
prlt init
prlt init --name "My Project" --theme billionaires
```

## Interactive Flow

1. Enter workspace name
2. Select agent naming theme
3. Add repositories
4. Confirm setup

## Output

```
✓ Initialized workspace: My Project
  Database: .proletariat/workspace.db
  Theme: billionaires

Next steps:
  prlt ticket create    Create your first ticket
  prlt work spawn       Start an agent
```
