---
sidebar_position: 6
title: ticket delete
---

# prlt ticket delete

Delete a ticket.

## Usage

```bash
prlt ticket delete <id>
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID |

## Options

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation |
| `--json` | Output JSON |

## Examples

### With Confirmation

```bash
prlt ticket delete TKT-001
# Prompts for confirmation
```

### Force Delete

```bash
prlt ticket delete TKT-001 --force
```

## Output

```
? Delete TKT-001: Add user authentication?
  Yes
> No

✓ Deleted TKT-001
```

## See Also

- [ticket list](/commands/ticket/list)
- [ticket complete](/commands/ticket/complete)
