# Initialization Commands Specification

## Purpose
Commands for initializing workspaces, HQs, PMO systems, and related configuration. These are typically one-time setup commands that establish the foundational structure.

## Core Concepts
- **HQ (Headquarters)**: Full workspace with repositories, agents, and optional PMO
- **Workspace-Only**: Lightweight setup without repository management
- **PMO Initialization**: Project management office setup with board templates
- **Theme Selection**: Agent personality/naming theme for the workspace
- **Storage**: SQLite database (`workspace.db`) is the single source of truth

## Command Overview

| Command           | Purpose                                    | Category | Status         |
| ----------------- | ------------------------------------------ | -------- | -------------- |
| `prlt init`       | Initialize HQ or workspace                 | Setup    | ✅ Implemented |
| `prlt pmo init`   | Initialize PMO system                      | PMO      | ✅ Implemented |
| `prlt theme`      | Select or change theme                     | Config   | ❌ Not Implemented |

---

## Command Specifications

### `prlt init`
**Purpose**: Interactive wizard to initialize an HQ (headquarters) or workspace-only setup

**Workflow Types**:
1. **Full HQ**: Repositories + Agents + Optional PMO
2. **Workspace-Only**: Just agents without repository management

**Interactive Flow**:
```
🚀 Welcome to Proletariat...

? What type of workspace do you want to create?
  ❯ Full HQ (repositories + agents + PMO)
    Workspace-only (just agents, no repos)

[If Full HQ selected:]

🏢 Setting up workspace...

? What would you like to call your HQ? my-startup

? Add '-hq' suffix to directory name?
  ❯ Yes (my-startup-hq)
    No (my-startup)

? Where should the HQ be created?
  ❯ Current directory (/path/to/current)
    Custom location...

? Choose a theme for your agents:
  ❯ Tech Founders (bezos, gates, zuck, etc.)
    Scientists (einstein, curie, tesla, etc.)
    Philosophers (plato, socrates, nietzsche, etc.)

? Select agents to include (space to select, enter to continue):
  ◯ bezos
  ◉ gates
  ◉ zuck
  ◯ musk

? Add repositories to manage:
  [Shows interactive repository selection]

? Include PMO (Project Management Office)?
  ❯ Yes
    No

[If PMO selected, runs pmo init flow]

✅ HQ initialized successfully!
   Location: /path/to/my-startup-hq
   Theme: Tech Founders
   Agents: 2 (gates, zuck)
   Repositories: 3
   PMO: Enabled (Kanban)

Next steps:
  1. Navigate to HQ: cd my-startup-hq
  2. View agent status: prlt agents status
  3. Create your first ticket: prlt ticket create
```

**Behavior**:
- Interactive prompts guide through entire setup process
- Validates inputs before proceeding
- Creates directory structure
- Initializes SQLite database
- Sets up agent worktrees
- Optionally initializes PMO
- Shows next steps after completion

**Directory Structure Created**:
```
my-startup-hq/
├── .proletariat/
│   ├── config.json          # HQ configuration
│   └── workspace.db         # SQLite database
├── agents/
│   └── staff/
│       ├── gates/           # Agent worktree
│       └── zuck/            # Agent worktree
├── pmo/                     # (if PMO enabled)
│   ├── board.md
│   └── specs/
└── repos/                   # Repository clones
```

---

### `prlt pmo init`
**Purpose**: Initialize PMO (Project Management Office) system in current directory or HQ

**Arguments**: None (fully interactive)

**Flags**:
- `--location, -l <type>`: PMO location (`separate` or `repo:name`)
- `--template, -t <template>`: Board template (kanban, scrum, founder, custom)
- `--name, -n <name>`: Board name

**Interactive Flow**:
```
🎯 Initializing PMO...

   Creates board.md and specs/ for project planning
   (Data stored in SQLite, synced to markdown files)

? Where should PMO be located?
  ❯ Separate pmo/ directory (recommended)
    Inside repo: proletariat

? Choose board template:
  ❯ Kanban (Backlog, In Progress, Done)
    Scrum (+ In Review, Blocked)
    5-Tool Founder (BUILD/GROW/SUPPORT/BIZOPS/STRATEGY + workflow)
    Custom (define your own columns)

? Board name: my-startup-kanban

  ✓ board.md created
  ✓ specs/ folders created
  ✓ Git repository initialized

✅ PMO initialized successfully!

Next steps:
  1. Create your first ticket: prlt ticket create
  2. Create a spec: prlt spec create
  3. Open pmo/ in Obsidian for visual kanban
```

**Example**:
```bash
prlt pmo init
prlt pmo init --location repo:proletariat --template founder
prlt pmo init --location separate --template scrum --name "Sprint Board"
```

**Behavior**:
- Detects if in HQ or standalone
- If PMO already exists, prompts for reinitialize (requires typed confirmation "delete pmo")
- Creates `pmo/` directory with board.md for Obsidian compatibility
- SQLite database (`workspace.db`) is always the source of truth
- board.md is an export for viewing/editing in Obsidian
- For separate PMO, initializes git repository with .gitignore

**Storage Architecture**:
- **Source of truth**: `.proletariat/workspace.db` (SQLite)
- **View/Edit file**: `pmo/board.md` (Obsidian-compatible kanban)
- **Sync**: `prlt board sync` imports board.md changes back to SQLite

**Templates**:
- **Kanban**: Backlog, In Progress, Done
- **Scrum**: Backlog, In Progress, In Review, Blocked, Done
- **Founder**: BUILD, GROW, SUPPORT, BIZOPS, STRATEGY (with sub-workflows)
- **Custom**: User-defined columns

**Directory Structure** (within HQ):
```
my-startup-hq/
├── .proletariat/
│   ├── config.json          # HQ configuration
│   └── workspace.db         # SQLite database (PMO tables here)
├── pmo/                      # PMO directory
│   ├── board.md              # Kanban board (Obsidian compatible)
│   ├── .gitignore            # (if git init selected)
│   └── specs/                # Spec documents
│       ├── draft/
│       ├── active/
│       └── future/
└── ...
```

**Standalone PMO** (no HQ):
```
.pmo/
├── .proletariat/
│   ├── config.json
│   └── workspace.db
├── board.md
└── specs/
```

---

### `prlt theme` (Not Implemented)
**Purpose**: Select or change the current workspace theme

**Arguments**: None (interactive) or theme name

**Interactive Flow**:
```
? Choose a theme for your agents:
  ❯ Tech Founders (bezos, gates, zuck, etc.)
    Scientists (einstein, curie, tesla, etc.)
    Philosophers (plato, socrates, nietzsche, etc.)
    Custom (define your own)

✅ Theme changed to: Tech Founders

Note: Existing agents are not renamed. Use 'prlt agents add' to create agents from new theme.
```

**Example**:
```bash
prlt theme
prlt theme scientists
```

**Behavior**:
- Shows available themes
- Updates workspace configuration
- Does NOT rename existing agents
- Affects future agent creation
- Warns about existing agents

---

## Design Principles

### One-Time Setup Commands
- **Interactive by Default**: Guide users through complex setup
- **Validation**: Check prerequisites before execution
- **Clear Feedback**: Show what's being created in real-time
- **Next Steps**: Always provide guidance after completion
- **Idempotent**: Prevent accidental re-initialization

### Progressive Disclosure
- **Simple Path**: Default choices for quick setup
- **Advanced Options**: Flags for automation and customization
- **Contextual Help**: Explain choices during prompts
- **Sensible Defaults**: Zero-config option for common use cases

---

## Future Enhancements

### Cloud Initialization
```bash
prlt pmo init --storage cloud --provider notion
prlt pmo init --storage cloud --provider linear
```

### Templates Marketplace
```bash
prlt template list
prlt template install agile-with-sprints
prlt pmo init --template agile-with-sprints
```

### Bulk Import
```bash
prlt init --from-config workspace.yaml
prlt pmo init --import-from jira
```
