---
sidebar_position: 15
title: commit
---

# prlt commit

Create a conventional commit.

## Usage

```bash
prlt commit <message>
```

## Arguments

| Argument | Description |
|----------|-------------|
| `message` | Commit message |

## Examples

```bash
prlt commit "add user authentication"
```

Formats as: `feat(TKT-001): add user authentication`

Automatically:
- Determines commit type (feat, fix, etc.)
- Adds ticket ID from current branch
- Stages changes
- Creates commit
