---
sidebar_position: 3
title: ticket view
---

# prlt ticket view

View ticket details.

## Usage

```bash
prlt ticket view <id>
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Ticket ID (e.g., TKT-001) |

## Options

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |

## Examples

### View Ticket

```bash
prlt ticket view TKT-001
```

### JSON Output

```bash
prlt ticket view TKT-001 --json
```

## Output

```
╔═══════════════════════════════════════════════════════════════╗
║ TKT-001: Add user authentication                              ║
╠═══════════════════════════════════════════════════════════════╣
║ Priority: P1          Status: In Progress    Category: feature║
╠═══════════════════════════════════════════════════════════════╣
║ Description:                                                  ║
║ Implement login/logout with JWT tokens.                       ║
║                                                               ║
║ Acceptance Criteria:                                          ║
║ ☐ User can log in with email/password                         ║
║ ☐ JWT token generated on login                                ║
║ ☐ Token validated on protected routes                         ║
║ ☐ User can log out                                            ║
╚═══════════════════════════════════════════════════════════════╝
```

## See Also

- [ticket edit](/commands/ticket/edit)
- [ticket list](/commands/ticket/list)
