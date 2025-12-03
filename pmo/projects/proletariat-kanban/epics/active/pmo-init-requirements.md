---
title: PMO Initialization Requirements
created: 2024-12-02T00:00:00.000Z
status: active
type: product-requirements
tickets:
  - id: INIT-REQ-001
    title: Remove storage type question from init prompts
    description: |
      Storage type should NOT be asked during PMO initialization.
      SQLite is always used for storage. Any sync-related options
      (like git sync for markdown files) should be a separate sync
      configuration question, not a storage question.
    priority: HIGH
    category: ux

  - id: INIT-REQ-002
    title: PMO location choice required during init
    description: |
      PMO init must ask where to create the PMO:
      - Inside one of the repos (repos/{reponame}/pmo/)
      - Separate from repos at HQ root (pmo/)
      This affects version control strategy and should be explicit.
    priority: HIGH
    category: ux

  - id: INIT-REQ-003
    title: Default board name uses {hqname}-kanban pattern
    description: |
      When initializing PMO, the default board name should be derived
      from the HQ name with "-kanban" suffix. Example:
      - HQ name: "myproject-hq" -> default board: "myproject-kanban"
      - HQ name: "acme" -> default board: "acme-kanban"
      User can still override this default.
    priority: HIGH
    category: ux

  - id: INIT-REQ-004
    title: Board names must be preserved correctly
    description: |
      When user provides a custom board name, that exact name must be
      preserved through the creation process. Multiple boards should
      NOT get the same generic name like "Board".
    priority: HIGH
    category: bug

  - id: INIT-REQ-005
    title: Board filename uses project-specific naming
    description: |
      Board markdown file should be named after the project with -kanban suffix:
      - pmo/projects/{projectId}/{projectId}-kanban.md
      NOT the generic:
      - pmo/projects/{projectId}/board.md
      This makes boards identifiable when viewing files directly.
      Must maintain backwards compatibility with existing board.md and {projectId}.md files.
    priority: MEDIUM
    category: enhancement
---

# PMO Initialization Requirements

This spec defines the expected behavior for `prlt init` and `prlt pmo init` commands.

## Context

The PMO (Project Management Office) initialization creates the structure for project management including:
- Database tables in workspace.db (pmo_* tables)
- Project folder with board and specs
- Kanban board markdown file (Obsidian compatible)
- Spec folder structure (active, complete, future, dropped)

## Requirements

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

## Testing Checklist

- [ ] `prlt init` does NOT ask about storage type
- [ ] `prlt init` asks about PMO location (repo vs separate)
- [ ] `prlt init` defaults board name to `{hqname}-kanban`
- [ ] `prlt pmo init` defaults board name to `{hqname}-kanban`
- [ ] Custom board names are preserved correctly
- [ ] Board file uses project-specific filename
- [ ] Existing board.md files still work (backwards compat)

## Related Commands

- `prlt init` - Full HQ initialization (includes PMO setup)
- `prlt pmo init` - Standalone PMO initialization
