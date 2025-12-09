# Branch Commands Specification

## Purpose
Commands for creating and managing git branches with conventional naming. Inspired by interactive branch creation workflows that enforce consistent naming patterns.

## Core Concepts
- **Branch Types**: Conventional prefixes that categorize the work (feat, fix, rfct, etc.)
- **Coder Tag**: Optional identifier for the developer/agent working on the branch
- **Description**: Kebab-case description of the work
- **Branch Format**: `{type}/{coder}/{description}` or `{type}/{description}`

## Branch Types

### Conventional Commits (standard types)
| Type    | Purpose                                    |
| ------- | ------------------------------------------ |
| `feat`  | New feature                                 |
| `fix`   | Bug fix                                     |
| `rfct`  | Refactoring (no functional change)          |
| `docs`  | Documentation only                          |
| `test`  | Test additions or corrections               |
| `chore` | Maintenance tasks, no production code       |
| `perf`  | Performance improvement                     |
| `ci`    | CI/CD configuration changes                 |
| `build` | Build system or external dependency changes |

### Extended Types (proletariat extras)
| Type    | Purpose                                    |
| ------- | ------------------------------------------ |
| `sec`   | Security fixes or improvements              |
| `db`    | Database migrations or schema changes       |
| `rel`   | Release preparation                         |

### 5Tool Founder Types
| Type    | Purpose                                    |
| ------- | ------------------------------------------ |
| `ship`  | Shipping, deployment, and launch            |
| `grow`  | Growth and marketing initiatives            |
| `cx`    | Customer experience and support             |
| `strat` | Strategy and planning                       |
| `ops`   | Business operations                         |

### Category → Type Mapping

When inferring branch type from ticket category:

**Conventional Commits**
| Category (ticket)           | Type (branch) |
| --------------------------- | ------------- |
| feature, feat, new          | `feat`        |
| bug, fix, bugfix            | `fix`         |
| refactor, cleanup           | `rfct`        |
| docs, documentation         | `docs`        |
| test, testing               | `test`        |
| chore, maintenance          | `chore`       |
| performance                 | `perf`        |
| ci, pipeline                | `ci`          |
| build, deps, dependencies   | `build`       |

**Extended Types (proletariat extras)**
| Category (ticket)           | Type (branch) |
| --------------------------- | ------------- |
| security                    | `sec`         |
| database, migration, schema | `db`          |
| release                     | `rel`         |

**5Tool Founder Types**
| Category (ticket)           | Type (branch) |
| --------------------------- | ------------- |
| ship, deploy, launch        | `ship`        |
| growth, marketing           | `grow`        |
| support, customer           | `cx`          |
| strategy, planning          | `strat`       |
| ops, operations, bizops     | `ops`         |

| *(unmatched)*               | `feat`        |

## Command Overview

| Command                    | Purpose                               | Status      |
| -------------------------- | ------------------------------------- | ----------- |
| `prlt branch`              | Interactive menu for branch operations | Implemented |
| `prlt branch create`       | Interactive branch creation wizard     | Implemented |
| `prlt branch create [name]`| Create branch with given name          | Implemented |
| `prlt branch list`         | List branches with conventional info   | Implemented |
| `prlt branch validate`     | Validate branch name format            | Implemented |

---

## Command Specifications

### `prlt branch`
**Purpose**: Interactive menu for branch operations

**Menu Options**:
```
🌿 Branch Operations

? What would you like to do?
❯ ✨ Create new branch
  📋 List branches
  ✅ Validate branch name
  ──────────────
  ❌ Cancel
```

---

### `prlt branch create`
**Purpose**: Interactive wizard for creating conventionally-named branches

**Options**:
- `--type, -t <type>`: Branch type (feat, fix, rfct, etc.)
- `--coder, -c <coder>`: Coder/agent identifier
- `--description, -d <desc>`: Branch description (kebab-case)
- `--empty-commit, -e`: Create initial empty commit
- `--no-switch`: Create branch without switching to it

**Interactive Flow** (no arguments):
```
🌿 Create New Branch

? Select branch type:
❯ feat   - New feature
  fix    - Bug fix
  rfct   - Refactoring
  chore  - Maintenance
  docs   - Documentation
  test   - Tests
  ▼ More options...

? Enter coder name (optional, press enter to skip): chris

? Enter description (kebab-case): add-user-auth

✅ Creating branch: feat/chris/add-user-auth
Switched to a new branch 'feat/chris/add-user-auth'

? Create initial empty commit? (helps seed PR title)
❯ Yes
  No

[If Yes:]
? Enter commit message (press enter for: feat/chris/add-user-auth):
✅ Created empty commit: feat/chris/add-user-auth
```

**With Arguments**:
```bash
# Full specification
prlt branch create --type feat --coder chris --description add-user-auth

# Short form
prlt branch create -t fix -c chris -d login-bug

# Without coder
prlt branch create -t rfct -d cleanup-utils
```

**Validation Rules**:
- Type must be from the allowed list
- Coder name must be kebab-case (lowercase, hyphens only)
- Description must be kebab-case
- No uppercase letters allowed
- No spaces or special characters (except hyphens)

**Error Examples**:
```
❌ Invalid coder name: "Chris"
   Coder name must be kebab-case (lowercase, hyphens only)
   Example: chris, chris-m, team-alpha

❌ Invalid description: "Add User Auth"
   Description must be kebab-case (lowercase, hyphens only)
   Example: add-user-auth, fix-login-bug, update-deps
```

---

### `prlt branch create [name]`
**Purpose**: Create branch with explicit name (bypasses wizard)

**Arguments**:
- `name`: Full branch name to create

**Behavior**:
- Validates name against conventional format
- Warns if name doesn't match pattern (but allows creation)
- Switches to the new branch

**Examples**:
```bash
# Valid conventional name
prlt branch create feat/chris/add-user-auth
✅ Created branch: feat/chris/add-user-auth

# Valid without coder
prlt branch create fix/login-bug
✅ Created branch: fix/login-bug

# Non-conventional name (warning)
prlt branch create my-feature-branch
⚠️  Branch name doesn't follow conventional format: {type}/{coder?}/{description}
   Continue anyway? (y/N)
```

---

### `prlt branch list`
**Purpose**: List branches with conventional naming information

**Options**:
- `--format, -f <format>`: Output format (table, compact, json)
- `--all, -a`: Include remote branches
- `--type <type>`: Filter by branch type

**Output** (table format):
```
🌿 Branches (5)

Name                        Type   Coder   Description         Status
─────────────────────────────────────────────────────────────────────────
* feat/chris/add-user-auth  feat   chris   add-user-auth       current
  fix/login-bug             fix    -       login-bug           local
  rfct/chris/cleanup-utils  rfct   chris   cleanup-utils       local
  main                      -      -       -                   tracking origin
  develop                   -      -       -                   tracking origin

Legend: * = current branch
```

**Output** (compact format):
```
🌿 * feat/chris/add-user-auth (feat)
🌿   fix/login-bug (fix)
🌿   rfct/chris/cleanup-utils (rfct)
    main
    develop
```

**Filtered by type**:
```bash
prlt branch list --type feat

🌿 Feature Branches (2)

  feat/chris/add-user-auth
  feat/alex/dashboard-widget
```

---

### `prlt branch validate`
**Purpose**: Validate branch name against conventional format

**Arguments**:
- `name` (optional): Branch name to validate. Defaults to current branch.

**Output**:
```bash
prlt branch validate feat/chris/add-user-auth
✅ Valid branch name
   Type: feat
   Coder: chris
   Description: add-user-auth

prlt branch validate my-random-branch
❌ Invalid branch name format
   Expected: {type}/{coder?}/{description}
   Types: build, chore, ci, db, docs, feat, fix, hotf, infra, mrkt, perf, pmo, rel, rev, rfct, sec, style, test, write

prlt branch validate
# Validates current branch
✅ Current branch 'feat/chris/add-user-auth' is valid
```

---

## Design Principles

### Naming Convention
```
{type}/{coder}/{description}
  │      │         │
  │      │         └── kebab-case work description
  │      └── optional kebab-case coder/agent identifier
  └── lowercase conventional type prefix
```

**Examples**:
- `feat/chris/add-user-auth`
- `fix/login-bug`
- `rfct/alex/cleanup-utils`
- `hotf/urgent-security-patch`
- `pmo/sprint-planning-q4`

### Integration with Commits
Branches can be used to prefix commit messages for consistency:
```
feat/chris/add-user-auth: implement JWT authentication
feat/chris/add-user-auth: add login form component
```

### Agent Workflow Integration

When `prlt ticket execute` creates a branch for an agent:

**Format**: `{type}/{agent}/{ticket-id}-{slug}`

**Examples**:
- `feat/alice/TKT-001-add-login-screen`
- `fix/bob/TKT-042-null-pointer-exception`
- `rfct/charlie/TKT-015-cleanup-auth-utils`

**How it's generated**:
- **Type**: Inferred from ticket category (feature→feat, bug→fix, etc.) or defaults to `feat`
- **Agent**: The assigned agent's name
- **Ticket ID**: From the ticket being executed
- **Slug**: Kebab-case version of ticket title (truncated if too long)

```bash
# When executing TKT-001 "Add login screen" assigned to alice:
prlt ticket execute TKT-001
# Creates branch: feat/alice/TKT-001-add-login-screen
```

**Manual branch creation** (for agents or humans):
```bash
prlt branch create -t feat -c alice -d TKT-001-add-login-screen
```

### Worktree Considerations
For agent worktrees, branch naming should:
- Include agent name as coder when agent-specific
- Use shared prefix for cross-agent work
- Follow same validation rules

---

## Configuration

### Default Settings
```yaml
# .prlt/config.yaml
branch:
  requireType: true          # Require conventional type prefix
  requireCoder: false        # Coder is optional by default
  defaultCoder: null         # No default coder
  allowNonConventional: true # Allow non-conventional names with warning
  emptyCommitOnCreate: ask   # ask, always, never
```

### Per-Repository Settings
Repositories can override defaults:
```yaml
# repos/my-project/.prlt.yaml
branch:
  requireCoder: true
  defaultCoder: team-alpha
```

---

## Error Handling

| Error                        | Message                                          | Resolution                    |
| ---------------------------- | ------------------------------------------------ | ----------------------------- |
| Invalid type                 | "Unknown branch type: {type}"                    | Show valid types list         |
| Invalid coder format         | "Coder must be kebab-case"                       | Show format examples          |
| Invalid description format   | "Description must be kebab-case"                 | Show format examples          |
| Branch already exists        | "Branch '{name}' already exists"                 | Suggest checkout or new name  |
| Not in git repository        | "Not in a git repository"                        | Navigate to repo directory    |
