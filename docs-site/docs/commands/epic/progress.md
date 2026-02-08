---
sidebar_position: 5
title: epic progress
---

# prlt epic progress

View epic progress.

## Usage

```bash
prlt epic progress <id>
```

## Arguments

| Argument | Description |
|----------|-------------|
| `id` | Epic ID |

## Examples

```bash
prlt epic progress EPC-001
```

## Output

```
EPC-001: User Authentication
Progress: 60% (3/5 tickets done)

┌──────────┬────────────────────┬──────────────┐
│ Ticket   │ Title              │ Status       │
├──────────┼────────────────────┼──────────────┤
│ TKT-001  │ Add login page     │ ✓ Done       │
│ TKT-002  │ Add register page  │ ✓ Done       │
│ TKT-003  │ Add OAuth          │ ✓ Done       │
│ TKT-004  │ Add password reset │ In Progress  │
│ TKT-005  │ Add 2FA            │ To Do        │
└──────────┴────────────────────┴──────────────┘
```
