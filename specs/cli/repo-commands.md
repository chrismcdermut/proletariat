# Repository Commands Specification

## Purpose
Commands for managing repositories in an HQ workspace. Split between individual operations (`prlt repo`) and bulk operations (`prlt repos`).

## Core Concepts
- **Repository**: A git repository cloned or moved into `repos/` directory
- **Add Actions**: `clone` (copy from source), `move` (relocate to HQ), `create` (new empty repo)
- **Individual vs Bulk**: Singular `repo` for one-at-a-time, plural `repos` for batch
- **Database Tracking**: Repositories are tracked in `workspace.db` with metadata

## Command Overview

### Individual Operations (`prlt repo`)
| Command                  | Purpose                              | Status         |
| ------------------------ | ------------------------------------ | -------------- |
| `prlt repo`              | Interactive menu for repo operations | ✅ Implemented |
| `prlt repo add [path]`   | Add single repository                | ✅ Implemented |
| `prlt repo remove [name]`| Remove specific repository           | ✅ Implemented |
| `prlt repo view [name]`  | View repository details              | ✅ Implemented |

### Bulk Operations (`prlt repos`)
| Command                    | Purpose                          | Status         |
| -------------------------- | -------------------------------- | -------------- |
| `prlt repos`               | Interactive menu for bulk ops    | ✅ Implemented |
| `prlt repos list`          | List all repositories            | ✅ Implemented |
| `prlt repos add`           | Add multiple repositories        | ✅ Implemented |
| `prlt repos remove`        | Remove multiple repositories     | ✅ Implemented |

---

## Individual Command Specifications

### `prlt repo`
**Purpose**: Interactive menu for individual repository operations

**Menu Options**:
```
📦 Individual Repository Operations

? What would you like to do?
❯ ➕ Add repository
  🗑️  Remove repository
  📄 View repository details
  ──────────────
  ❌ Cancel
```

---

### `prlt repo add [path]`
**Purpose**: Add a single repository to the HQ

**Arguments**:
- `path` (optional): Repository path, Git URL, or "create" for new. If omitted, prompts interactively.

**Options**:
- `--action, -a <action>`: For local paths - `clone` or `move` (default: clone)
- `--name, -n <name>`: Override repository name

**Interactive Flow** (if path not provided):
```
? How would you like to add a repository?
❯ 📁 Enter path or Git URL
  🔍 Search for repositories on this machine
  ✨ Create new repository
  ❌ Cancel

[If "Enter path or Git URL":]
? Enter repo path or Git URL: /path/to/my-repo

? my-repo - Move or Clone?
❯ Clone (keep original)
  Move (relocate to HQ)

Cloning /path/to/my-repo to repos/my-repo...
✅ Repository my-repo added successfully
```

**For Git URLs**:
```
? Enter repo path or Git URL: git@github.com:user/project.git

Cloning git@github.com:user/project.git to repos/project...
✅ Repository project added successfully
```

**For new repository**:
```
? Repository name: my-new-project
? Initialize with README.md?
❯ Yes
  No

✅ Created new repository: my-new-project
```

**Behavior**:
- Validates path/URL before adding
- Prevents duplicates
- Updates database and creates agent worktrees
- For local paths inside current directory, forces clone (can't move)

---

### `prlt repo remove [name]`
**Purpose**: Remove a specific repository from the HQ

**Arguments**:
- `name` (optional): Repository name. If omitted, shows interactive selection.

**Options**:
- `--force, -f`: Skip confirmation prompt
- `--keep-files`: Remove from database but keep files in repos/

**Interactive Flow** (if name not provided):
```
? Select repository to remove:
❯ proletariat
  my-app
  shared-lib
  ──────────────
  ❌ Cancel

⚠️  This will:
  • Remove repos/proletariat directory
  • Remove agent worktrees for this repo
  • Update database

? Are you sure you want to remove "proletariat"?
❯ ❌ No, cancel
  ⚠️  Yes, remove repository

Removing repository "proletariat"...
✅ Repository proletariat removed
```

**Behavior**:
- Removes from `repos/` directory (unless --keep-files)
- Removes corresponding worktrees from all agents
- Updates database
- Shows warning about data loss

---

### `prlt repo view [name]`
**Purpose**: View detailed information about a repository

**Arguments**:
- `name` (optional): Repository name. If omitted, shows interactive selection.

**Output**:
```
📦 Repository: proletariat

Path:        repos/proletariat
Source:      git@github.com:user/proletariat.git
Added:       11/26/2024, 10:30:00 AM
Action:      clone

📊 Git Status:
  Branch:    main
  Status:    clean
  Remote:    origin (git@github.com:user/proletariat.git)
  Commits:   2 ahead, 0 behind

👥 Agent Worktrees:
  • bezos - clean
  • gates - 3 uncommitted changes
  • zuck  - missing (needs rebuild)
```

---

## Bulk Command Specifications

### `prlt repos`
**Purpose**: Interactive menu for bulk repository operations

**Menu Options**:
```
📦 Repository Management (Bulk Operations)

? What would you like to do?
❯ 📋 List all repositories
  ➕ Add repositories (bulk)
  ➖ Remove repositories (bulk)
  ──────────────
  ❌ Cancel
```

---

### `prlt repos list`
**Purpose**: List all repositories with their status

**Options**:
- `--format, -f <format>`: Output format (table, compact, json)

**Output** (table format):
```
📦 Repositories (3)

Name              Status    Branch    Commits    Added
────────────────────────────────────────────────────────
proletariat       clean     main      2 ahead    11/26/2024
my-app            dirty     feature   -          11/25/2024
shared-lib        clean     main      -          11/20/2024

Summary:
  3 repositories
  1 with uncommitted changes
  1 with unpushed commits
```

**Output** (compact format):
```
📦 proletariat (main, clean, 2 ahead)
📦 my-app (feature, dirty)
📦 shared-lib (main, clean)
```

---

### `prlt repos add`
**Purpose**: Add multiple repositories to the HQ

**Interactive Flow**:
```
📦 Add Repositories

? How would you like to add repositories?
❯ 🔍 Search for repositories on this machine
  📁 Enter paths/URLs one by one
  ❌ Cancel

[If "Search":]
🔍 Searching for git repositories...

? Found 15 repositories. Select which ones to add:
  ◯ my-app (/Users/chris/Projects/my-app)
  ◉ shared-lib (/Users/chris/Projects/shared-lib)
  ◉ utils (/Users/chris/Code/utils)
  ◯ old-project (/Users/chris/Projects/old-project)

Selected 2 repositories

Cloning shared-lib...
✅ Repository shared-lib added

Cloning utils...
✅ Repository utils added

✅ Added 2 repositories
```

**Behavior**:
- Searches common dev directories (~/Projects, ~/Developer, ~/Code, etc.)
- Multi-select checkbox interface
- Clones by default (safer than moving)
- Creates worktrees for all existing agents

---

### `prlt repos remove`
**Purpose**: Remove multiple repositories from the HQ

**Interactive Flow**:
```
📦 Remove Repositories

? Select repositories to remove:
  ◯ proletariat
  ◉ old-project
  ◉ deprecated-lib
  ──────────────
  ❌ Cancel

Selected 2 repositories

⚠️  This will permanently delete:
  • repos/old-project
  • repos/deprecated-lib
  • Agent worktrees for these repos

? Are you sure?
❯ ❌ No, cancel
  ⚠️  Yes, remove repositories

Removing old-project...
✅ Removed old-project

Removing deprecated-lib...
✅ Removed deprecated-lib

✅ Removed 2 repositories
```

---

## Design Principles

### Individual vs Bulk Pattern
- **Singular (`repo`)**: Operations on one repository at a time with detailed output
- **Plural (`repos`)**: Batch operations with summary output
- **Consistent UX**: Both use interactive selection when arguments omitted

### Repository Lifecycle
1. **Add**: Clone/move/create into `repos/` directory
2. **Track**: Store metadata in `workspace.db`
3. **Worktrees**: Create worktrees for all agents
4. **Remove**: Delete files, worktrees, and database entry

### Agent Worktree Integration
When a repository is added:
- Create worktree in each agent's directory
- Branch naming: `agent-{agentname}`

When a repository is removed:
- Remove worktree from each agent's directory
- Clean up git worktree references

### Database Schema
```sql
-- Existing table in workspace.db
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  source_url TEXT,
  action TEXT,  -- 'clone', 'move', 'create'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Directory Structure
```
my-hq/
├── repos/
│   ├── proletariat/     # Cloned/moved repository
│   ├── my-app/          # Another repository
│   └── shared-lib/      # Third repository
└── agents/
    └── staff/
        ├── bezos/
        │   ├── proletariat/  # Worktree
        │   ├── my-app/       # Worktree
        │   └── shared-lib/   # Worktree
        └── gates/
            ├── proletariat/  # Worktree
            ├── my-app/       # Worktree
            └── shared-lib/   # Worktree
```
