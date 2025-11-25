# Team PMO Specification

## Purpose
Single-team Project Management Office functionality for managing tickets, boards, and workflows within a unified team context. Optimized for 1-6 engineers working on a single motion with shared backlog.

## Scope
- **Team Size**: 1-6 engineers
- **Motion**: Single project/initiative
- **Ticket Namespace**: Simple (T001, T002, etc.)
- **Board Structure**: Single kanban board
- **Storage Options**: SQLite, In-Repo, or Separate Repo

## Core Concepts
- **Obsidian Integration**: Native kanban boards using Obsidian Kanban plugin
- **Ticket Lifecycle**: Creation → Assignment → Progress → Completion
- **File-based Storage**: Markdown specs with git versioning
- **Agent Integration**: Direct ticket assignment to workspace agents
- **Workspace Traversal**: Works from any subdirectory in an HQ

## Command Overview

### PMO Commands

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt pmo`                   | Interactive PMO operations menu        | Menu        | ❌ Not Implemented |
| `prlt pmo init`              | Initialize PMO structure in HQ         | Setup       | ✅ Implemented |
| `prlt pmo board [action]`    | View/edit/open kanban board            | Board       | ✅ Implemented |

### Board Commands

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt pmo board view`        | View kanban board in terminal          | Board       | ✅ Implemented |
| `prlt pmo board edit`        | Edit board in default editor           | Board       | ✅ Implemented |
| `prlt pmo board open`        | Open board in Obsidian                 | Board       | ✅ Implemented |

### Ticket Commands

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt ticket`                | Interactive ticket operations menu     | Menu        | ❌ Not Implemented |
| `prlt ticket create [title]` | Create new ticket with Ink UI          | Creation    | ✅ Implemented |
| `prlt ticket list`           | List all tickets                       | Overview    | ❌ Not Implemented |
| `prlt ticket status [id] [status]` | Update ticket status             | Management  | ✅ Implemented |
| `prlt ticket claim [id]`     | Claim ticket with Ink UI               | Assignment  | ✅ Implemented |
| `prlt ticket complete [id]`  | Mark ticket as complete                | Management  | ✅ Implemented |
| `prlt ticket assign [id] [agent]` | Assign ticket to agent            | Assignment  | ❌ Not Implemented |
| `prlt ticket reassign [id] [agent]` | Reassign to different agent     | Assignment  | ❌ Not Implemented |
| `prlt ticket unassign [id]`  | Remove assignment                      | Assignment  | ❌ Not Implemented |

---

## Architecture Patterns for Team PMO

### Decision Matrix (Team PMO Subset)

Focus on 1-5 engineers, showing each PMO storage option as a separate row.

| Engineers | Repos | Host Nodes | Workers/Host | PMO Storage    | Viable? | Notes                          |
| --------- | ----- | ---------- | ------------ | -------------- | ------- | ------------------------------ |
| **1**     | Mono  | **1**      | **1**        | SQLite         | ✅ Yes   | Simple, no sync needed         |
| **1**     | Mono  | **1**      | **1**        | In-Repo Main   | ✅ Yes   | Company-as-code                |
| **1**     | Mono  | **1**      | **1**        | In-Repo Branch | ✅ Yes   | Overkill for single dev        |
| **1**     | Mono  | **1**      | **1**        | Separate Repo  | ✅ Yes   | Extra complexity               |
| **1**     | Mono  | **1**      | **1**        | Hosted DB      | ✅ Yes   | Unnecessary cost               |
| **1**     | Multi | **1**      | **1**        | SQLite         | ✅ Yes   | Local coordination             |
| **1**     | Multi | **1**      | **1**        | In-Repo Main   | ❌ No    | No single repo for PMO         |
| **1**     | Multi | **1**      | **1**        | In-Repo Branch | ❌ No    | No single repo for PMO         |
| **1**     | Multi | **1**      | **1**        | Separate Repo  | ✅ Yes   | Clean separation               |
| **1**     | Multi | **1**      | **1**        | Hosted DB      | ✅ Yes   | Unnecessary cost               |
| **1**     | Mono  | **1**      | **2-5**      | SQLite         | ✅ Yes   | Use WAL mode for concurrency   |
| **1**     | Mono  | **1**      | **2-5**      | In-Repo Main   | ✅ Yes   | Workers can coordinate via git |
| **1**     | Mono  | **1**      | **2-5**      | In-Repo Branch | ✅ Yes   | Overkill for single dev        |
| **1**     | Mono  | **1**      | **2-5**      | Separate Repo  | ✅ Yes   | Extra complexity               |
| **1**     | Mono  | **1**      | **2-5**      | Hosted DB      | ✅ Yes   | Unnecessary cost               |
| **1**     | Multi | **1**      | **2-5**      | SQLite         | ✅ Yes   | Use WAL mode                   |
| **1**     | Multi | **1**      | **2-5**      | In-Repo Main   | ❌ No    | No single repo                 |
| **1**     | Multi | **1**      | **2-5**      | In-Repo Branch | ❌ No    | No single repo                 |
| **1**     | Multi | **1**      | **2-5**      | Separate Repo  | ✅ Yes   | Clean separation               |
| **1**     | Multi | **1**      | **2-5**      | Hosted DB      | ✅ Yes   | Unnecessary cost               |
| **1**     | Mono  | **2+**     | **Any**      | SQLite         | ❌ No    | Can't sync across nodes        |
| **1**     | Mono  | **2+**     | **Any**      | In-Repo Main   | ✅ Yes   | Git syncs across nodes         |
| **1**     | Mono  | **2+**     | **Any**      | In-Repo Branch | ✅ Yes   | Avoids PR blocks               |
| **1**     | Mono  | **2+**     | **Any**      | Separate Repo  | ✅ Yes   | Works well                     |
| **1**     | Mono  | **2+**     | **Any**      | Hosted DB      | ✅ Yes   | If you have infrastructure     |
| **1**     | Multi | **2+**     | **Any**      | SQLite         | ❌ No    | Can't sync across nodes        |
| **1**     | Multi | **2+**     | **Any**      | In-Repo Main   | ❌ No    | No single repo                 |
| **1**     | Multi | **2+**     | **Any**      | In-Repo Branch | ❌ No    | No single repo                 |
| **1**     | Multi | **2+**     | **Any**      | Separate Repo  | ✅ Yes   | Only viable git option         |
| **1**     | Multi | **2+**     | **Any**      | Hosted DB      | ✅ Yes   | If you have infrastructure     |
| **2-5**   | Mono  | **2-5**    | **1-5**      | SQLite         | ❌ No    | Multi-node needs sync          |
| **2-5**   | Mono  | **2-5**    | **1-5**      | In-Repo Main   | ✅ Yes   | Team can coordinate            |
| **2-5**   | Mono  | **2-5**    | **1-5**      | In-Repo Branch | ✅ Yes   | Avoids PR conflicts            |
| **2-5**   | Mono  | **2-5**    | **1-5**      | Separate Repo  | ✅ Yes   | Clean separation               |
| **2-5**   | Mono  | **2-5**    | **1-5**      | Hosted DB      | ✅ Yes   | If you want real-time          |
| **2-5**   | Multi | **2-5**    | **1-5**      | SQLite         | ❌ No    | Multi-node needs sync          |
| **2-5**   | Multi | **2-5**    | **1-5**      | In-Repo Main   | ❌ No    | No single repo                 |
| **2-5**   | Multi | **2-5**    | **1-5**      | In-Repo Branch | ❌ No    | No single repo                 |
| **2-5**   | Multi | **2-5**    | **1-5**      | Separate Repo  | ✅ Yes   | Only viable git option         |
| **2-5**   | Multi | **2-5**    | **1-5**      | Hosted DB      | ✅ Yes   | If you want real-time          |

### Key Constraints
- **Multi-Repo**: Cannot use In-Repo PMO (no single repo for PMO)
- **Multi-Node**: Cannot use SQLite (local files don't sync)
- **Multi-Worker**: SQLite needs WAL mode for concurrency

## Storage Architecture

### SQLite (Single Host Node)
Best for solo developers or teams on a single machine.

```
hq/
├── .proletariat/
│   └── pmo.db              # SQLite database
├── agents/
└── repos/
```

**Advantages**:
- Fast local queries
- ACID transactions
- No sync needed

**Commands**:
```bash
prlt pmo init --storage=sqlite
prlt ticket create "Fix bug"      # → SQLite insert
prlt ticket list --filter=open    # → SQL query
```

### In-Repo PMO (Monorepo Only)
Best for teams wanting "company as code" philosophy.

```
monorepo/
├── src/
├── pmo/
│   ├── board.md            # Kanban board
│   ├── config.json         # PMO config
│   └── specs/              # Ticket specs
│       ├── backlog/
│       ├── in-progress/
│       ├── in-review/
│       └── done/
└── .proletariat/
```

**Advantages**:
- Version controlled with code
- PR workflow for PMO changes
- Visible in code reviews

**Commands**:
```bash
prlt pmo init --storage=in-repo --branch=main
prlt ticket create "Add feature"  # → Creates PR
git commit -am "Update tickets"   # → Normal git flow
```

### Separate Repo PMO (Multi-Repo Compatible)
Best for teams with multiple repositories or distributed nodes.

```
my-pmo/                     # Separate git repo
├── board.md
├── config.json
└── specs/
    ├── backlog/
    ├── in-progress/
    ├── in-review/
    └── done/

my-project-hq/              # References PMO repo
├── .proletariat/
│   └── config.json         # Points to PMO repo
├── agents/
└── repos/
```

**Advantages**:
- Works with multi-repo
- Independent PMO updates
- Clean separation

**Commands**:
```bash
prlt pmo init --storage=separate --repo=git@github.com:org/pmo.git
cd ../my-pmo && git pull
prlt ticket create "Fix bug"      # → Commits to PMO repo
git push                           # → Share with team
```

---

## Ticket Management

### Ticket Structure
```markdown
# T0042: Implement user authentication

**Priority:** high
**Queue:** feature
**Assignee:** @alice
**Created:** 2024-01-15T10:30:00Z
**Status:** In Progress

## Description
Add OAuth2 authentication flow for user login.

## Acceptance Criteria
- [ ] Users can login with Google
- [ ] Sessions persist across restarts
- [ ] Logout functionality works

## Work Log
- 2024-01-15 10:30 - Created by @alice
- 2024-01-15 14:00 - Moved to In Progress
```

### Ticket Numbering
- Simple sequential: T0001, T0002, T0003
- Stored in `config.json` as `lastTicketId`
- No namespace complexity needed

### Status Workflow
```
Backlog → In Progress → In Review → Done
         ↓                ↓
      Blocked         Changes Requested
```

---

## Kanban Board Format

### Obsidian-Compatible Markdown
```markdown
# Project Kanban

## 📥 Backlog
- [ ] [[specs/backlog/T0001-setup-ci.md|T0001]] Setup CI pipeline #high +infra @unassigned
- [ ] [[specs/backlog/T0002-add-tests.md|T0002]] Add unit tests #medium +quality @alice

## 🚀 In Progress  
- [ ] [[specs/in-progress/T0003-fix-auth.md|T0003]] Fix auth bug #high +bug @bob

## 👀 In Review
- [ ] [[specs/in-review/T0004-api-docs.md|T0004]] Update API docs #low +docs @charlie

## ✅ Done
- [x] [[specs/done/T0005-deploy.md|T0005]] Deploy to staging #high +ops @alice

---
*Last updated: 2024-01-15T14:30:00Z*
```

### Board Elements
- `- [ ]` - Uncompleted task
- `- [x]` - Completed task
- `[[path|label]]` - Link to ticket spec
- `#priority` - Priority tag (high/medium/low)
- `+queue` - Queue/category tag
- `@assignee` - Assigned agent/person

---

## Agent Integration

### Assignment Flow
```bash
# Interactive claim
prlt ticket claim
? Select ticket to claim:
❯ T0001: Setup CI pipeline
  T0002: Add unit tests

? Select agent:
❯ alice (you)
  bob
  charlie

# Direct assignment
prlt ticket assign T0001 alice
```

### Agent Status Sync
- Tickets update agent `current_task` in database
- Agent worktrees can query assigned tickets
- Status changes reflect in both PMO and agent state

---

## Git Workflow Integration

### Commit Hooks
```bash
# Pre-commit: Validate ticket references
git commit -m "T0042: Add login endpoint"  # ✓ Valid
git commit -m "Add stuff"                  # ✗ Warning

# Post-commit: Auto-update ticket
# Detects T0042 in commit, adds to work log
```

### Branch Naming
```bash
# Automatic branch creation from ticket
prlt ticket start T0042
# Creates: feature/T0042-implement-user-auth
```

---

## Interactive UI Components

### Ticket Creation (Ink UI)
```
🎫 Create New Ticket

Title: Implement user authentication
Priority: ● High ○ Medium ○ Low
Queue: feature
Description: (opens editor)

Creating ticket...
✅ Created ticket T0042
```

### Ticket Claim (Ink UI)  
```
🎯 Claim Ticket

? Select ticket to claim:
❯ T0001: Setup CI pipeline (high, infra)
  T0002: Add unit tests (medium, quality)
  T0003: Fix auth bug (high, bug)

? Assign to agent:
❯ alice (you)
  bob
  charlie

✅ Ticket T0001 assigned to alice
```

---

## Configuration

### PMO Config (`pmo/config.json`)
```json
{
  "version": "1.0.0",
  "storage": "in-repo",
  "lastTicketId": 42,
  "queues": ["feature", "bug", "refactor", "docs", "infra"],
  "priorities": ["high", "medium", "low"],
  "statuses": {
    "backlog": "📥 Backlog",
    "in-progress": "🚀 In Progress",
    "in-review": "👀 In Review",
    "done": "✅ Done"
  },
  "agents": ["alice", "bob", "charlie"],
  "defaultAssignee": "unassigned"
}
```

### HQ Config (`.proletariat/config.json`)
```json
{
  "type": "hq",
  "hasPMO": true,
  "pmoPath": "./pmo",           // Relative for in-repo
  "pmoRepo": null                // Or git URL for separate
}
```

---

## Error Handling

### Common Errors
```bash
# PMO not initialized
prlt ticket create
❌ Error: PMO not found. Run "prlt pmo init" first.

# Invalid ticket ID
prlt ticket claim T9999
❌ Error: Ticket T9999 not found

# Assignment conflict
prlt ticket claim T0001
❌ Error: Ticket T0001 already assigned to bob
? Would you like to reassign it? (y/N)
```

---

## Testing Scenarios

### Single Developer
```bash
prlt init my-project-hq
prlt pmo init
prlt ticket create "Setup project"
prlt ticket claim T0001
prlt ticket complete T0001
```

### Small Team
```bash
# Alice creates
prlt ticket create "Add feature"

# Bob claims
prlt ticket claim T0001 --agent=bob

# Charlie reviews
prlt ticket status T0001 in-review --agent=charlie

# Alice completes
prlt ticket complete T0001
```

### Git-based Sync
```bash
# Developer A
cd pmo && git pull
prlt ticket create "New feature"
git push

# Developer B  
cd pmo && git pull
prlt ticket list  # Sees new ticket
prlt ticket claim T0001
git push
```