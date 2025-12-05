# Branch Commands Specification

## Purpose
Commands for creating and managing git branches with conventional naming. Inspired by interactive branch creation workflows that enforce consistent naming patterns.

## Core Concepts
- **Branch Types**: Conventional prefixes that categorize the work (feat, fix, rfct, etc.)
- **Coder Tag**: Optional identifier for the developer/agent working on the branch
- **Description**: Kebab-case description of the work
- **Branch Format**: `{type}/{coder}/{description}` or `{type}/{description}`

## Branch Types
| Type    | Purpose                                    |
| ------- | ------------------------------------------ |
| `build` | Build system or external dependency changes |
| `chore` | Maintenance tasks, no production code       |
| `ci`    | CI/CD configuration changes                 |
| `db`    | Database migrations or schema changes       |
| `docs`  | Documentation only                          |
| `feat`  | New feature                                 |
| `fix`   | Bug fix                                     |
| `hotf`  | Hotfix for production issue                 |
| `infra` | Infrastructure changes                      |
| `perf`  | Performance improvement                     |
| `mrkt`  | Marketing and promotional content           |
| `pmo`   | Project management operations               |
| `rel`   | Release preparation                         |
| `rev`   | Code review changes                         |
| `rfct`  | Refactoring (no functional change)          |
| `sec`   | Security fixes or improvements              |
| `style` | Formatting, whitespace, no code change      |
| `test`  | Test additions or corrections               |
| `write` | Writing or content creation                 |

## Command Overview

| Command                    | Purpose                               | Status  |
| -------------------------- | ------------------------------------- | ------- |
| `prlt branch`              | Interactive menu for branch operations | Planned |
| `prlt branch create`       | Interactive branch creation wizard     | Planned |
| `prlt branch create [name]`| Create branch with given name          | Planned |
| `prlt branch list`         | List branches with conventional info   | Planned |
| `prlt branch validate`     | Validate branch name format            | Planned |

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
When an agent creates a branch:
- Type inferred from task context (e.g., ticket type → branch type)
- Coder set to agent identifier
- Description derived from task/ticket title

```bash
# Agent "bezos" working on ticket "Implement user dashboard"
prlt branch create -t feat -c bezos -d implement-user-dashboard
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
