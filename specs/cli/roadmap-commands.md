---
title: Roadmap Commands Specification
status: draft
created: 2024-12-16
---

# Roadmap Commands Specification

## Overview

Roadmap commands provide visualization and planning tools for work ordering. They consume dependency data (see [pmo-dependencies.md](pmo-dependencies.md)) to show:
- Ordered list of work based on dependencies and priority
- Progress across epics and milestones
- Timeline/gantt-style views
- Export to ROADMAP.md for human consumption

## Core Concepts

- **Roadmap**: Ordered view of epics/milestones with progress
- **Milestone**: Time-boxed collection of epics (optional)
- **Work Order**: Calculated sequence based on dependencies + priority
- **Critical Path**: Longest chain of blocking dependencies

## Command Overview

| Command                    | Purpose                              | Status |
| -------------------------- | ------------------------------------ | ------ |
| `prlt roadmap`             | Interactive roadmap menu             | Draft  |
| `prlt roadmap view`        | Show ordered roadmap                 | Draft  |
| `prlt roadmap export`      | Generate ROADMAP.md from epics       | Draft  |
| `prlt roadmap import`      | Parse ROADMAP.md into epics          | Draft  |
| `prlt roadmap reorder`     | Manually reorder epics               | Draft  |

---

## Command Specifications

### `prlt roadmap`

**Purpose**: Interactive menu for roadmap operations

**Interactive Flow**:

```
? 🗺️  Roadmap Operations - What would you like to do?
  ❯ View roadmap
    Export to ROADMAP.md
    Import from ROADMAP.md
    Reorder epics
    ─────────
    Cancel
```

---

### `prlt roadmap view`

**Purpose**: Show ordered roadmap with progress and dependencies

**Options**:
- `--format, -f <format>`: Output format (list, tree, gantt). Default: list
- `--status, -s <status>`: Filter by epic status (active, draft, complete, all). Default: active
- `--show-tickets`: Include tickets under each epic
- `--show-blockers`: Highlight blocking dependencies

**Output (list format)**:

```
🗺️  Roadmap - proletariat
═══════════════════════════════════════════════════════════════

Phase 1: Foundation (100% complete)
──────────────────────────────────────────────────────────────
✅ EPIC-001: Schema Refactor                     [████████████] 12/12
✅ EPIC-002: Core CRUD Commands                  [████████████]  6/6

Phase 2: Work Management (75% complete)
──────────────────────────────────────────────────────────────
✅ EPIC-003: Board Commands                      [████████████]  7/7
🚧 EPIC-004: Work Commands                       [█████████░░░]  9/12
   └─ Blocked by: (none)
   └─ Blocks: EPIC-005, EPIC-006

Phase 3: Advanced Features (0% complete)
──────────────────────────────────────────────────────────────
⏸️  EPIC-005: PR Workflow                        [░░░░░░░░░░░░]  0/5
   └─ Blocked by: EPIC-004
⏸️  EPIC-006: Review Feedback Loop               [░░░░░░░░░░░░]  0/4
   └─ Blocked by: EPIC-004, EPIC-005

═══════════════════════════════════════════════════════════════
Overall: 34/46 tickets (74%)
Critical Path: EPIC-004 → EPIC-005 → EPIC-006
```

**Output (tree format)**:

```
🗺️  Roadmap - proletariat
═══════════════════════════════════════════════════════════════

EPIC-004: Work Commands (75%)
├── TKT-001: work start ✅
├── TKT-002: work ready ✅
├── TKT-003: work complete ✅
├── TKT-004: Permission mode 🚧
│   └── Blocks: TKT-005
├── TKT-005: Agent busy checking ⏸️
│   └── Blocked by: TKT-004
└── ...
```

**Output (gantt format)**:

```
🗺️  Roadmap - proletariat (Gantt View)
═══════════════════════════════════════════════════════════════

                    Dec 2024        Jan 2025        Feb 2025
                    ─────────────── ─────────────── ───────────
Schema Refactor     ████████████
Core CRUD           ░░░░████████████
Board Commands              ░░░░████████
Work Commands                   ░░░░░░░░████████████
PR Workflow                                 ░░░░░░░░████████
Review Loop                                         ░░░░████

Legend: ████ = complete, ░░░░ = in progress/planned
```

---

### `prlt roadmap export`

**Purpose**: Generate ROADMAP.md from epic data

**Options**:
- `--output, -o <path>`: Output file path. Default: `docs/ROADMAP.md`
- `--format <format>`: Export format (markdown, json). Default: markdown
- `--include-tickets`: Include ticket lists under epics
- `--include-session-notes`: Preserve session notes section

**Output (to file)**:

```markdown
# Proletariat Roadmap

## Implementation Status

### Core Commands (✅ Complete)
| Command Area | Status | Notes |
|--------------|--------|-------|
| Schema | ✅ 100% | Database schema complete |
| Ticket CRUD | ✅ 100% | create, list, view, move, delete |
...

## Phase 1: Foundation

### EPIC-001: Schema Refactor ✅
- [x] TKT-001: Create base tables
- [x] TKT-002: Add indexes
...

## Phase 2: Work Management

### EPIC-004: Work Commands 🚧
**Progress**: 9/12 (75%)
**Blocked by**: None
**Blocks**: PR Workflow, Review Loop

- [x] TKT-010: work start command
- [x] TKT-011: work ready command
- [ ] TKT-012: Permission mode selection
...

---

*Generated by `prlt roadmap export` on 2024-12-16*
```

**Behavior**:
- Reads epics, tickets, and dependencies from PMO
- Calculates progress percentages
- Orders by dependency chain then priority
- Preserves existing session notes if `--include-session-notes`

---

### `prlt roadmap import`

**Purpose**: Parse ROADMAP.md and create/update epics

**Arguments**:
- `path` (optional): Path to ROADMAP.md. Default: `docs/ROADMAP.md`

**Options**:
- `--dry-run`: Show what would be created/updated without making changes
- `--merge`: Update existing epics instead of replacing
- `--create-tickets`: Also create tickets from checkbox items

**Interactive Flow**:

```
? Found ROADMAP.md with 6 epics and 46 tasks

Epics to create:
  + EPIC-005: PR Workflow (5 tickets)
  + EPIC-006: Review Feedback Loop (4 tickets)

Epics to update:
  ~ EPIC-004: Work Commands (add 2 tickets)

? Proceed with import?
  ❯ Yes, import all
    Import epics only (no tickets)
    Dry run (show changes only)
    Cancel
```

**Output**:

```
📥 Imported from ROADMAP.md
   Created: 2 epics, 9 tickets
   Updated: 1 epic
   Skipped: 3 epics (already exist)
```

---

### `prlt roadmap reorder`

**Purpose**: Manually reorder epics/phases

**Options**:
- `--epic <id>`: Move specific epic
- `--before <id>`: Place before this epic
- `--after <id>`: Place after this epic
- `--phase <name>`: Move to specific phase

**Interactive Flow**:

```
? Select epic to move:
  ❯ EPIC-004: Work Commands
    EPIC-005: PR Workflow
    EPIC-006: Review Feedback Loop

? Where should EPIC-004 go?
  ❯ Before EPIC-005
    After EPIC-005
    Before EPIC-006
    After EPIC-006
    Move to different phase

✅ Moved EPIC-004 before EPIC-005
```

**Non-interactive**:

```bash
prlt roadmap reorder --epic EPIC-006 --before EPIC-005
```

---

## Database Schema

### Milestones Table (optional)

```sql
CREATE TABLE pmo_milestones (
  id TEXT PRIMARY KEY,              -- MILE-001
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status TEXT DEFAULT 'planned',    -- planned, active, complete
  position INTEGER,                 -- ordering
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id)
);

-- Link epics to milestones
ALTER TABLE pmo_epics ADD COLUMN milestone_id TEXT
  REFERENCES pmo_milestones(id) ON DELETE SET NULL;

-- Add ordering to epics
ALTER TABLE pmo_epics ADD COLUMN position INTEGER;
```

---

## Progress Calculation

### Epic Progress

```typescript
function calculateEpicProgress(epicId: string): { done: number; total: number; percent: number } {
  const tickets = getTicketsByEpic(epicId);
  const done = tickets.filter(t => t.column === 'Done').length;
  const total = tickets.length;
  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0
  };
}
```

### Critical Path

```typescript
function findCriticalPath(epics: Epic[]): Epic[] {
  // Find longest chain of blocking dependencies
  const graph = buildDependencyGraph(epics);
  let longestPath: Epic[] = [];

  for (const epic of epics) {
    const path = findLongestPathFrom(epic, graph);
    if (path.length > longestPath.length) {
      longestPath = path;
    }
  }

  return longestPath;
}
```

### Work Order

```typescript
function calculateWorkOrder(epics: Epic[]): Epic[] {
  // Topological sort based on dependencies
  // Break ties with priority
  return topologicalSort(epics, {
    getDependencies: (e) => getBlockingEpics(e.id),
    comparator: (a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]
  });
}
```

---

## Integration with Board

### Ready Queue

Show "ready to start" items (no blockers or all blockers done):

```bash
$ prlt board view --ready

📋 Ready to Start
═══════════════════════════════════════════════════
TKT-015: Add permission prompt     (EPIC-004, HIGH)
TKT-016: Agent busy checking       (EPIC-004, MEDIUM)
TKT-020: Create PR command         (EPIC-005, HIGH) - needs EPIC-004

Commands:
  prlt work claim TKT-015   # Claim and start working
```

### Blocked View

Show blocked items with their blockers:

```bash
$ prlt board view --blocked

🔒 Blocked Items
═══════════════════════════════════════════════════
TKT-025: Review comment injection
   Blocked by: TKT-020 (In Progress), TKT-021 (Backlog)

EPIC-006: Review Feedback Loop
   Blocked by: EPIC-004 (75%), EPIC-005 (0%)
```

---

## Future Enhancements

### Timeline View

```bash
prlt roadmap timeline
# Calendar-based view with dates
```

### Milestone Commands

```bash
prlt milestone create "Q1 2025" --target-date 2025-03-31
prlt milestone add EPIC-004 EPIC-005 --to "Q1 2025"
prlt milestone view "Q1 2025"
```

### Burndown Chart

```bash
prlt roadmap burndown --epic EPIC-004
# ASCII burndown chart
```

### Velocity Tracking

```bash
prlt roadmap velocity
# Tickets completed per week/sprint
```

### What-If Analysis

```bash
prlt roadmap simulate --complete TKT-020
# Show what becomes unblocked
```
