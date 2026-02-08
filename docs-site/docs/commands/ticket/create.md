---
sidebar_position: 1
title: ticket create
---

# prlt ticket create

Create a new ticket.

## Usage

```bash
prlt ticket create [options]
```

## Options

| Flag | Description |
|------|-------------|
| `--title <title>` | Ticket title [required for non-interactive] |
| `--description <desc>` | Ticket description |
| `--priority <priority>` | Priority (P0-P4) |
| `--category <category>` | Category (feature, bug, enhancement, etc.) |
| `--project <id>` | Project ID |
| `--epic <id>` | Epic ID |
| `--json` | Output JSON for AI agents |
| `--dry-run` | Preview without creating |

## Examples

### Interactive Mode

```bash
prlt ticket create
```

Prompts for all fields interactively.

### With Flags

```bash
prlt ticket create \
  --title "Add user authentication" \
  --description "Implement login/logout with JWT" \
  --priority P1 \
  --category feature
```

### JSON Mode

```bash
prlt ticket create --json
```

Returns prompt configuration for AI agents.

### Dry Run

```bash
prlt ticket create \
  --title "Test ticket" \
  --category feature \
  --dry-run
```

Preview what would be created without saving.

## Output

### Success

```
✓ Created TKT-001: Add user authentication
```

### JSON Output

```json
{
  "id": "TKT-001",
  "title": "Add user authentication",
  "priority": "P1",
  "category": "feature",
  "status": "To Do"
}
```

## See Also

- [ticket list](/commands/ticket/list)
- [ticket view](/commands/ticket/view)
- [ticket edit](/commands/ticket/edit)
- [Creating Tickets Guide](/guides/creating-tickets)
