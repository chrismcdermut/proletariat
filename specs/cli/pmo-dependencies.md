---
title: PMO Dependencies Specification
status: draft
created: 2024-12-16
---

# PMO Dependencies Specification

## Overview

Dependencies define relationships between work items (tickets, epics). They enable:
- Blocking relationships ("can't start until X is done")
- Work ordering and prioritization
- Dependency visualization in board views
- Validation to prevent starting blocked work

## Core Concepts

- **Blocker**: Item that must be completed before another can start
- **Blocked**: Item waiting on a blocker to complete
- **Dependency Type**: Nature of the relationship (blocks, relates_to, duplicates)
- **Circular Dependency**: Invalid state where A blocks B blocks A

## Dependency Types

| Type         | Meaning                                      | Enforcement |
| ------------ | -------------------------------------------- | ----------- |
| `blocks`     | Source must complete before target can start | Hard block  |
| `relates_to` | Items are related (informational)            | None        |
| `duplicates` | Target is duplicate of source                | Soft warn   |

## Database Schema

```sql
CREATE TABLE pmo_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,        -- 'ticket' or 'epic'
  source_id TEXT NOT NULL,          -- TKT-001 or EPIC-001
  target_type TEXT NOT NULL,        -- 'ticket' or 'epic'
  target_id TEXT NOT NULL,          -- TKT-002 or EPIC-002
  dependency_type TEXT NOT NULL,    -- 'blocks', 'relates_to', 'duplicates'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,                  -- user who created the link
  notes TEXT,                       -- optional context
  UNIQUE(source_type, source_id, target_type, target_id, dependency_type)
);

CREATE INDEX idx_dependencies_source ON pmo_dependencies(source_type, source_id);
CREATE INDEX idx_dependencies_target ON pmo_dependencies(target_type, target_id);
CREATE INDEX idx_dependencies_type ON pmo_dependencies(dependency_type);
```

## Command Overview

| Command                              | Purpose                           | Status |
| ------------------------------------ | --------------------------------- | ------ |
| `prlt ticket link <id> <target>`     | Link ticket to another item       | Draft  |
| `prlt ticket unlink <id> <target>`   | Remove link between items         | Draft  |
| `prlt ticket links [id]`             | Show all links for a ticket       | Draft  |
| `prlt epic link <id> <target>`       | Link epic to another item         | Draft  |
| `prlt epic unlink <id> <target>`     | Remove link between items         | Draft  |
| `prlt epic links [id]`               | Show all links for an epic        | Draft  |

---

## Command Specifications

### `prlt ticket link <id> <target>`

**Purpose**: Create a dependency link from a ticket to another item

**Arguments**:
- `id`: Source ticket ID (e.g., TKT-001)
- `target`: Target item ID (e.g., TKT-002, EPIC-001)

**Options**:
- `--type, -t <type>`: Dependency type (blocks, relates_to, duplicates). Default: blocks
- `--notes, -n <text>`: Optional notes about the relationship

**Interactive Flow** (if arguments not provided):

```
? Select ticket to link from:
  ❯ TKT-001 - Add login screen
    TKT-002 - Setup CI/CD

? Link type:
  ❯ blocks     - TKT-001 must complete before target can start
    relates_to - Informational link
    duplicates - Target is duplicate of TKT-001

? Select target to link to:
  ❯ TKT-002 - Setup CI/CD
    TKT-003 - Implement auth
    ── Epics ──
    EPIC-001 - User Authentication
```

**Output**:

```
🔗 Linked TKT-001 → TKT-002
   Type: blocks
   TKT-002 is now blocked by TKT-001
```

**Validation**:
- Prevent self-links (TKT-001 → TKT-001)
- Prevent duplicate links
- Detect and reject circular dependencies

---

### `prlt ticket unlink <id> <target>`

**Purpose**: Remove a dependency link

**Arguments**:
- `id`: Source ticket ID
- `target`: Target item ID

**Options**:
- `--type, -t <type>`: Specific type to remove (removes all types if not specified)

**Output**:

```
🔓 Unlinked TKT-001 → TKT-002
   Removed: blocks
```

---

### `prlt ticket links [id]`

**Purpose**: Show all links for a ticket

**Arguments**:
- `id` (optional): Ticket ID - prompts if not provided

**Options**:
- `--type, -t <type>`: Filter by dependency type
- `--direction, -d <dir>`: Filter by direction (outgoing, incoming, both). Default: both

**Output**:

```
🔗 Links for TKT-001: Add login screen
═══════════════════════════════════════════════════

Blocking (must complete first):
  → TKT-002 - Setup CI/CD (blocks)
  → TKT-003 - Implement auth (blocks)

Blocked by (waiting on):
  ← TKT-000 - Database schema (blocks)

Related:
  ↔ EPIC-001 - User Authentication (relates_to)

═══════════════════════════════════════════════════
Total: 4 links (2 outgoing blocks, 1 incoming block, 1 relation)
```

---

### `prlt epic link` / `prlt epic unlink` / `prlt epic links`

Same as ticket commands but for epics.

---

## Behavior Integration

### Board View

Show blocked tickets with indicator:

```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 Backlog          │ 🚧 In Progress    │ 👀 In Review │ ✅ Done │
├─────────────────────────────────────────────────────────────────┤
│ TKT-002 🔒          │ TKT-001           │              │         │
│ Setup CI/CD         │ Add login screen  │              │         │
│ (blocked by TKT-001)│                   │              │         │
└─────────────────────────────────────────────────────────────────┘
```

### Work Start Validation

When starting work on a blocked ticket:

```bash
$ prlt work start TKT-002

⚠️  TKT-002 is blocked by:
   - TKT-001: Add login screen (In Progress)

? Start anyway?
  ❯ No, cancel
    Yes, start despite blockers
```

### Ticket View

Show dependencies in ticket detail view:

```bash
$ prlt ticket view TKT-002

📋 TKT-002: Setup CI/CD
═══════════════════════════════════════════════════
...

🔗 Dependencies:
   Blocked by: TKT-001 (In Progress)
   Blocks: TKT-005, TKT-006
```

---

## Circular Dependency Detection

Before creating a link, validate the dependency graph:

```typescript
function wouldCreateCycle(source: string, target: string, type: 'blocks'): boolean {
  // Only 'blocks' relationships can create problematic cycles
  if (type !== 'blocks') return false;

  // BFS/DFS from target to see if we can reach source
  const visited = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    // Get all items that 'current' blocks
    const blockedBy = getBlockedItems(current);
    queue.push(...blockedBy);
  }

  return false;
}
```

---

## Query Examples

### Find all blocked tickets

```sql
SELECT DISTINCT t.id, t.title, d.source_id as blocked_by
FROM pmo_tickets t
INNER JOIN pmo_dependencies d
  ON d.target_type = 'ticket' AND d.target_id = t.id
WHERE d.dependency_type = 'blocks'
  AND d.source_id IN (
    SELECT id FROM pmo_tickets WHERE column_id != 'done'
  );
```

### Find ready-to-start tickets (no blockers or all blockers done)

```sql
SELECT t.id, t.title
FROM pmo_tickets t
WHERE t.column_id = 'backlog'
  AND NOT EXISTS (
    SELECT 1 FROM pmo_dependencies d
    INNER JOIN pmo_tickets blocker ON d.source_id = blocker.id
    WHERE d.target_id = t.id
      AND d.dependency_type = 'blocks'
      AND blocker.column_id != 'done'
  );
```

### Get dependency chain depth

```sql
WITH RECURSIVE dep_chain AS (
  SELECT target_id, source_id, 1 as depth
  FROM pmo_dependencies
  WHERE dependency_type = 'blocks'

  UNION ALL

  SELECT d.target_id, dc.source_id, dc.depth + 1
  FROM pmo_dependencies d
  INNER JOIN dep_chain dc ON d.target_id = dc.source_id
  WHERE d.dependency_type = 'blocks'
)
SELECT target_id, MAX(depth) as chain_depth
FROM dep_chain
GROUP BY target_id;
```

---

## Future Enhancements

### Dependency Graph Visualization

```bash
prlt deps graph TKT-001
# Opens graphviz/mermaid visualization
```

### Auto-link from PR references

When a PR mentions "fixes TKT-001", auto-create relates_to link.

### Bulk operations

```bash
prlt ticket link TKT-001 --blocks TKT-002,TKT-003,TKT-004
```

### Export/Import

```bash
prlt deps export --format json > deps.json
prlt deps import deps.json
```
