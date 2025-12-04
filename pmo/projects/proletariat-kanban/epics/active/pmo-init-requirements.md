---
id: EPIC-INIT
title: PMO Initialization Requirements
status: active
created: 2024-12-02T00:00:00.000Z
description: Define expected behavior for prlt init and prlt pmo init commands
---

# PMO Initialization Requirements

## Overview

This epic defines the expected behavior for `prlt init` and `prlt pmo init` commands.

The PMO (Project Management Office) initialization creates the structure for project management including:
- Database tables in workspace.db (pmo_* tables)
- Project folder with board and specs
- Kanban board markdown file (Obsidian compatible)
- Spec folder structure (active, complete, future, dropped)

## Goals

- [ ] Storage type not exposed to user (SQLite always used)
- [ ] PMO location choice during init (repo vs separate)
- [ ] Default board naming convention ({hqname}-kanban)
- [ ] Board name preservation through creation process
- [ ] Project-specific board file naming

## Success Criteria

- [ ] `prlt init` does NOT ask about storage type
- [ ] `prlt init` asks about PMO location (repo vs separate)
- [ ] `prlt init` defaults board name to `{hqname}-kanban`
- [ ] `prlt pmo init` defaults board name to `{hqname}-kanban`
- [ ] Custom board names are preserved correctly
- [ ] Board file uses project-specific filename
- [ ] Existing board.md files still work (backwards compat)

## Requirements Detail

### REQ-1: Storage Type Not User-Facing

**Current Behavior (Bug):** Asks user to choose between SQLite and git storage.

**Required Behavior:** SQLite is always used. The question should be removed.
Any sync options (like pushing markdown to git) should be a separate workflow.

### REQ-2: PMO Location Choice

**Required Behavior:** During init, prompt user for PMO location:
- `separate` - Creates pmo/ at HQ root (recommended for multi-repo)
- `repo:{name}` - Creates pmo/ inside specific repo

This affects:
- Version control (separate = own git repo, in-repo = part of repo)
- File organization
- Multi-repo vs single-repo workflows

### REQ-3: Default Board Naming Convention

**Required Behavior:** Default board name should be `{hqname}-kanban`

Examples:
```
HQ: proletariat-hq  ->  Board: proletariat-kanban
HQ: acme            ->  Board: acme-kanban
```

User can override but this provides sensible default.

### REQ-4: Board Name Preservation

**Required Behavior:** User-provided board names must be preserved exactly
through the entire creation process:
- In database (pmo_projects.name)
- In project folder name (slugified)
- In board file header

### REQ-5: Board File Naming

**Required Behavior:** Board file named after project, not generic `board.md`

```
# New pattern
pmo/projects/proletariat-kanban/proletariat-kanban.md

# Legacy pattern (backwards compatible)
pmo/projects/proletariat-kanban/board.md
```

## Related Commands

- `prlt init` - Full HQ initialization (includes PMO setup)
- `prlt pmo init` - Standalone PMO initialization

## Tickets

Create these tickets with:
```bash
prlt ticket create --epic EPIC-INIT -t "Remove storage type question from init prompts" -p HIGH --category ux
prlt ticket create --epic EPIC-INIT -t "PMO location choice required during init" -p HIGH --category ux
prlt ticket create --epic EPIC-INIT -t "Default board name uses {hqname}-kanban pattern" -p HIGH --category ux
prlt ticket create --epic EPIC-INIT -t "Board names must be preserved correctly" -p HIGH --category bug
prlt ticket create --epic EPIC-INIT -t "Board filename uses project-specific naming" -p MEDIUM --category enhancement
```
