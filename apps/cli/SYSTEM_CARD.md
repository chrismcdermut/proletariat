# Proletariat CLI System Specification

> **Note:** This document is the **single source of truth** for implementation status and system architecture. All command implementation tracking is maintained here.

## Purpose

Multi-agent development orchestration system for managing distributed AI-powered development teams.

## Core Capabilities

### 1. Workspace Management (HQ)

- Initialize headquarters (HQ) for centralized control
- Support single-repo and multi-repo modes
- Theme-based agent naming (cars, billionaires, companies, custom)

### 2. Agent Management

- **Dual Command Structure**: `prlt agent` (individual) and `prlt agents` (bulk)
- **Individual Operations**: Focus on single agent workflows (status, visit, remove)
- **Bulk Operations**: Multi-agent management with checkbox selection
- **Git Worktree Integration**: Each agent has isolated workspace with proper cleanup
- **Interactive Menus**: Arrow-key navigation with cancel options
- **Status Tracking**: Repository states, commits, activity, and ticket assignments
- **Navigation Support**: Directory switching and path calculation
- **Theme Integration**: Billionaires, cars, companies, or custom agent names

### 3. Ticket Management (PMO)

- Create tickets with priority and queue assignment
- Assign tickets to specific agents
- Agents can claim tickets from their worktree
- Track ticket lifecycle (todo → in-progress → done)
- Obsidian-compatible kanban boards (see [PMO spec](pmo.md))

### 4. Command Specification

This is the authoritative list of commands that MUST exist in the CLI.

**Legend:**

- 📝 Spec: Specification defined
- ✅ Impl: Code implemented
- 🧪 E2E: Automated E2E tests passing
- 👤 Manual: Manual testing completed

#### Core Commands

| Command               | 📝 | ✅ | 🧪 | 👤 | Description                 | Spec                                                 |
| --------------------- | -- | -- | -- | -- | --------------------------- | ---------------------------------------------------- |
| `prlt init <hq-name>` | ✓  | ✓  | ✓  | -  | Initialize new HQ workspace | -                                                    |
| `prlt help [command]` | ✓  | ✓  | ✓  | -  | Show help for commands      | oclif built-in                                       |
| `prlt --version`      | -  | -  | -  | -  | Show CLI version            | -                                                    |

#### Agent Commands (Individual Operations)

| Command                      | 📝 | ✅ | 🧪 | 👤 | Description                   | Spec                                                 |
| ---------------------------- | -- | -- | -- | -- | ----------------------------- | ---------------------------------------------------- |
| `prlt agent`                 | ✓  | ✓  | -  | -  | Interactive individual menu   | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent status [name]`   | ✓  | ✓  | -  | -  | Show detailed agent status    | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent visit [name]`    | ✓  | ✓  | -  | -  | Navigate to agent directory   | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent add`             | ✓  | ✓  | -  | -  | Add agent (redirects to bulk) | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent remove [name]`   | ✓  | ✓  | -  | -  | Remove specific agent         | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent login [name]`    | ✓  | ✓  | -  | -  | Auth Claude in devcontainer   | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent grant`           | ✓  | -  | -  | -  | Grant repo access to agents   | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent revoke`          | ✓  | -  | -  | -  | Revoke repo access            | [agents.md](../../specs/domain/agents.md)            |

#### Agents Commands (Bulk Operations)

| Command              | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec                                      |
| -------------------- | -- | -- | -- | -- | -------------------------------- | ----------------------------------------- |
| `prlt agents`        | ✓  | ✓  | -  | -  | Interactive bulk operations menu | [agents.md](../../specs/domain/agents.md) |
| `prlt agents list`   | ✓  | ✓  | -  | -  | List all agents with overview    | [agents.md](../../specs/domain/agents.md) |
| `prlt agents status` | ✓  | ✓  | -  | -  | Status overview for all agents   | [agents.md](../../specs/domain/agents.md) |
| `prlt agents add`    | ✓  | ✓  | -  | -  | Add multiple agents (bulk, creates devcontainer by default) | [agents.md](../../specs/domain/agents.md) |
| `prlt agents remove` | ✓  | ✓  | -  | -  | Remove multiple agents (bulk)    | [agents.md](../../specs/domain/agents.md) |

**Agent Options:**
- `--no-container`: Skip devcontainer setup (not recommended for autonomous agents)

#### Repo Commands (Individual Operations)

| Command                | 📝 | ✅ | 🧪 | 👤 | Description                     | Spec |
| ---------------------- | -- | -- | -- | -- | ------------------------------- | ---- |
| `prlt repo`            | ✓  | ✓  | -  | -  | Interactive individual menu     | -    |
| `prlt repo add`        | ✓  | ✓  | -  | -  | Add single repository           | -    |
| `prlt repo remove`     | ✓  | ✓  | -  | -  | Remove single repository        | -    |
| `prlt repo view`       | ✓  | ✓  | -  | -  | View repository details         | -    |

#### Repos Commands (Bulk Operations)

| Command             | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec |
| ------------------- | -- | -- | -- | -- | ---------------------------------- | ---- |
| `prlt repos`        | ✓  | ✓  | -  | -  | Interactive bulk operations menu   | -    |
| `prlt repos list`   | ✓  | ✓  | -  | -  | List all repositories              | -    |
| `prlt repos add`    | ✓  | ✓  | -  | -  | Add multiple repositories (bulk)   | -    |
| `prlt repos remove` | ✓  | ✓  | -  | -  | Remove multiple repositories (bulk)| -    |

#### PMO Commands

| Command         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| --------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt pmo init` | ✓  | ✓  | -  | -  | Initialize PMO system (one-time) | -    |

#### Project Commands

| Command                      | 📝 | ✅ | 🧪 | 👤 | Description          | Spec                                            |
| ---------------------------- | -- | -- | -- | -- | -------------------- | ----------------------------------------------- |
| `prlt project create`        | ✓  | ✓  | -  | -  | Create new project   | [projects.md](../../specs/domain/projects.md)   |
| `prlt project list`          | ✓  | ✓  | -  | -  | List all projects    | [projects.md](../../specs/domain/projects.md)   |
| `prlt project view [id]`     | ✓  | ✓  | -  | -  | View project details | [projects.md](../../specs/domain/projects.md)   |
| `prlt project delete [id]`   | ✓  | ✓  | -  | -  | Delete project       | [projects.md](../../specs/domain/projects.md)   |

#### Board Commands

| Command               | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec                                        |
| --------------------- | -- | -- | -- | -- | ---------------------------------- | ------------------------------------------- |
| `prlt board`          | ✓  | ✓  | -  | -  | Interactive board menu (view/open/sync/etc) | [board.md](../../specs/domain/board.md) |
| `prlt board watch`    | ✓  | ✓  | -  | -  | Watch kanban.md for changes        | [board.md](../../specs/domain/board.md)     |

**Note**: Board operations (view, open, markdown, export, sync) are available through the `prlt board` interactive menu.

#### Spec Commands

Specs are **static documentation** (design docs, architecture, requirements). No lifecycle, no tickets.

| Command                   | 📝 | ✅ | 🧪 | 👤 | Description              | Spec                                        |
| ------------------------- | -- | -- | -- | -- | ------------------------ | ------------------------------------------- |
| `prlt spec`               | ✓  | ✓  | -  | -  | Interactive spec menu    | [specs.md](../../specs/domain/specs.md)     |
| `prlt spec create [name]` | ✓  | ✓  | -  | -  | Create new spec document | [specs.md](../../specs/domain/specs.md)     |
| `prlt spec list`          | ✓  | ✓  | -  | -  | List all specs           | [specs.md](../../specs/domain/specs.md)     |
| `prlt spec view [id]`     | ✓  | ✓  | -  | -  | View spec content        | [specs.md](../../specs/domain/specs.md)     |

#### Epic Commands

Epics are **work containers** with lifecycle status. Tickets link to epics via `epic_id`.

| Command                        | 📝 | ✅ | 🧪 | 👤 | Description                    | Spec                                        |
| ------------------------------ | -- | -- | -- | -- | ------------------------------ | ------------------------------------------- |
| `prlt epic`                    | ✓  | ✓  | -  | -  | Interactive epic menu          | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic create [name]`      | ✓  | ✓  | -  | -  | Create new epic                | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic list`               | ✓  | ✓  | -  | -  | List all epics                 | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic view [id]`          | ✓  | ✓  | -  | -  | View epic and linked tickets   | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic archive [id]`       | ✓  | ✓  | -  | -  | Move epic to complete/ folder  | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic activate [id]`      | ✓  | ✓  | -  | -  | Move epic to active/ folder    | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic move [id] [status]` | ✓  | ✓  | -  | -  | Move epic between status folders | [epics.md](../../specs/domain/epics.md)   |
| `prlt epic progress [id]`      | ✓  | ✓  | -  | -  | Show completion percentage     | [epics.md](../../specs/domain/epics.md)     |
| `prlt epic link [id] [tickets...]` | ✓  | ✓  | -  | -  | Link tickets to epic, or epic to spec (--spec) | [epics.md](../../specs/domain/epics.md) |

#### Ticket Commands (CRUD Operations)

| Command                          | 📝 | ✅ | 🧪 | 👤 | Description             | Spec                                            |
| -------------------------------- | -- | -- | -- | -- | ----------------------- | ----------------------------------------------- |
| `prlt ticket`                    | ✓  | ✓  | -  | -  | Interactive ticket menu | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket create [title]`     | ✓  | ✓  | -  | -  | Create new ticket       | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket list`               | ✓  | ✓  | -  | -  | List all tickets        | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket view [id]`          | ✓  | ✓  | -  | -  | View ticket details     | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket edit [id]`          | ✓  | ✓  | -  | -  | Edit ticket fields      | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket move [id] [column]` | ✓  | ✓  | -  | -  | Move ticket to column   | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket delete [id]`        | ✓  | ✓  | -  | -  | Delete ticket           | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket status [id]`        | ✓  | ✓  | -  | -  | Show ticket status      | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket link [id] [epic-id]`| ✓  | ✓  | -  | -  | Link ticket to epic     | [tickets.md](../../specs/domain/tickets.md)     |

#### Bulk Ticket Commands (`prlt ticket --bulk`)

| Command                        | 📝 | ✅ | 🧪 | 👤 | Description                           | Spec                                            |
| ------------------------------ | -- | -- | -- | -- | ------------------------------------- | ----------------------------------------------- |
| `prlt ticket bulk`             | ✓  | ✓  | -  | -  | Interactive bulk operations menu      | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket move --bulk`      | ✓  | ✓  | -  | -  | Move multiple tickets to column       | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket delete --bulk`    | ✓  | ✓  | -  | -  | Delete multiple tickets               | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket complete --bulk`  | ✓  | ✓  | -  | -  | Complete multiple tickets             | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket reassign --bulk`  | ✓  | ✓  | -  | -  | Reassign tickets to different agent   | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket epic --bulk`      | ✓  | ✓  | -  | -  | Link tickets to different epic        | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket update --bulk`    | ✓  | ✓  | -  | -  | Update priority/category for multiple | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket spec --bulk`      | ✓  | ✓  | -  | -  | Assign spec to multiple tickets       | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket project --bulk`   | ✓  | ✓  | -  | -  | Move multiple tickets to project      | [tickets.md](../../specs/domain/tickets.md)     |

#### Work Commands (Ownership, Assignment & Execution)

**Note**: The `work` namespace handles the execution/implementation of tickets - who is responsible, who does the work, and how work runs.

| Command                           | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec                                        |
| --------------------------------- | -- | -- | -- | -- | ---------------------------------- | ------------------------------------------- |
| `prlt work start [id]`            | ✓  | ✓  | -  | -  | Start agent working on ticket      | [work.md](../../specs/domain/work.md)       |
| `prlt work ready [id]`            | ✓  | ✓  | -  | -  | Mark work as ready for review      | [work.md](../../specs/domain/work.md)       |
| `prlt work complete [id]`         | ✓  | ✓  | -  | -  | Mark work as complete (Done)       | [work.md](../../specs/domain/work.md)       |
| `prlt work claim [id]`            | ✓  | ✓  | -  | -  | Claim work for yourself or agent   | [work.md](../../specs/domain/work.md)       |
| `prlt work assign [id] [agent]`   | ✓  | ✓  | -  | -  | Assign work to human/agent         | [work.md](../../specs/domain/work.md)       |
| `prlt work own [id]`              | ✓  | ✓  | -  | -  | Take accountability for work       | [work.md](../../specs/domain/work.md)       |

#### Execution Commands (Agent Runtime Management)

**Note**: These commands manage running agent processes.

| Command                           | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec                                        |
| --------------------------------- | -- | -- | -- | -- | ---------------------------------- | ------------------------------------------- |
| `prlt execution list`             | ✓  | ✓  | -  | -  | List running/recent executions     | [work.md](../../specs/domain/work.md)       |
| `prlt execution logs [id]`        | ✓  | ✓  | -  | -  | View execution logs                | [work.md](../../specs/domain/work.md)       |
| `prlt execution stop [id]`        | ✓  | ✓  | -  | -  | Stop a running execution           | [work.md](../../specs/domain/work.md)       |

**Execution Environment** (where agent runs):

| Environment    | Description                              |
| -------------- | ---------------------------------------- |
| `devcontainer` | VS Code devcontainer (recommended)       |
| `host`         | Directly on host machine                 |
| `docker`       | Raw Docker container                     |
| `vm`           | Remote VM via SSH                        |

**Display Mode** (how output is shown):

| Mode           | Description                              |
| -------------- | ---------------------------------------- |
| `terminal`     | New terminal window (macOS)              |
| `foreground`   | Subprocess in current terminal           |
| `background`   | Detached process, logs to file           |
| `tmux`         | New tmux pane/window                     |

**Permission Mode**:
- `safe` (sandboxed=true): Requires approval for dangerous operations (recommended)
- `danger` (sandboxed=false): Skip permission checks (--dangerously-skip-permissions)

**Execute Options:**
- `--run-on-host`: Bypass devcontainer and run directly on host machine
- `--vm-host <host>`: Specify VM hostname for vm mode

**Agent Selection:**
- Available agents shown first, busy agents disabled with current ticket info
- Prevents double-booking of agents on multiple tickets

See [devcontainer.md](../../specs/infrastructure/devcontainer.md) for sandboxed agent execution.

#### Branch Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec |
| ------------------------------- | -- | -- | -- | -- | ---------------------------------- | ---- |
| `prlt branch`                   | ✓  | ✓  | -  | -  | Interactive branch menu            | -    |
| `prlt branch create`            | ✓  | ✓  | -  | -  | Interactive branch creation wizard | -    |
| `prlt branch create [name]`     | ✓  | ✓  | -  | -  | Create branch with given name      | -    |
| `prlt branch list`              | ✓  | ✓  | -  | -  | List branches with conventional info | -  |
| `prlt branch validate`          | ✓  | ✓  | -  | -  | Validate branch name format        | -    |

**Branch Types:**

| Group | Types |
| ----- | ----- |
| Conventional Commits | `feat`, `fix`, `rfct`, `docs`, `test`, `chore`, `perf`, `ci`, `build` |
| Extended Types | `sec`, `db`, `rel` |
| 5Tool Founder | `ship`, `grow`, `cx`, `strat`, `ops` |

#### Database Commands

| Command                 | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ----------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt db`               | ✓  | -  | -  | -  | Interactive database menu        | -    |
| `prlt db tables`        | ✓  | -  | -  | -  | List all tables with row counts  | -    |
| `prlt db schema [table]`| ✓  | -  | -  | -  | Show table structure             | -    |
| `prlt db query <sql>`   | ✓  | -  | -  | -  | Run SQL query (read-only default)| -    |
| `prlt db stats`         | ✓  | -  | -  | -  | Database size and health info    | -    |

#### Config Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                     | Spec |
| ------------------------------- | -- | -- | -- | -- | ------------------------------- | ---- |
| `prlt config get <key>`         | ✓  | -  | -  | -  | Get a configuration value       | -    |
| `prlt config set <key> <value>` | ✓  | -  | -  | -  | Set a configuration value       | -    |
| `prlt config list`              | ✓  | -  | -  | -  | List all configuration settings | -    |
| `prlt config reset <key>`       | ✓  | -  | -  | -  | Reset a setting to default      | -    |

#### Maintenance Commands

| Command                  | 📝 | ✅ | 🧪 | 👤 | Description             |
| ------------------------ | -- | -- | -- | -- | ----------------------- |
| `prlt themes`            | -  | -  | -  | -  | List available themes   |
| `prlt repair`            | -  | -  | -  | -  | Repair broken worktrees |
| `prlt health`            | -  | -  | -  | -  | Check worktree health   |
| `prlt migrate <hq-name>` | -  | -  | -  | -  | Migrate repo into HQ    |
| `prlt upgrade`           | -  | -  | -  | -  | Upgrade config format   |

#### Plugin Commands (Oclif Built-in)

| Command                           | 📝 | ✅ | 🧪 | 👤 | Description             |
| --------------------------------- | -- | -- | -- | -- | ----------------------- |
| `prlt plugins`                    | -  | -  | -  | -  | List installed plugins  |
| `prlt plugins install <plugin>`   | -  | -  | -  | -  | Install a plugin        |
| `prlt plugins uninstall <plugin>` | -  | -  | -  | -  | Remove a plugin         |
| `prlt plugins update`             | -  | -  | -  | -  | Update all plugins      |
| `prlt plugins link <path>`        | -  | -  | -  | -  | Link local plugin       |
| `prlt plugins reset`              | -  | -  | -  | -  | Remove all user plugins |
| `prlt plugins inspect <plugin>`   | -  | -  | -  | -  | Show plugin details     |

---

## Entity Model

### Spec vs Epic vs Ticket

| Entity | Purpose | Status/Lifecycle | Links |
|--------|---------|------------------|-------|
| **Spec** | Static documentation (design docs, architecture) | None | Epics link via `spec_id` |
| **Epic** | Work container | active, draft, complete, dropped, future | Links to spec, tickets link to epic |
| **Ticket** | Work item | Column position on board | Optional `epic_id` reference |

### Relationships

```
Spec → Epic → Ticket
(1)    (many)  (many)
```

- **Spec → Epic**: One spec can describe multiple epics (via `epic.spec_id`)
- **Epic → Ticket**: One epic contains many tickets (via `ticket.epic_id`)
- **Ticket → Spec**: Not allowed directly - must go through epic for traceability

```
Project
├── Board (1:1)
│   └── Columns → Tickets
├── Specs (1:many) - static documentation
│   └── Epics link via spec_id (optional)
└── Epics (1:many) - work containers with status
    └── Tickets link via epic_id (optional)
```

---

## Storage Compatibility Matrix

PMO commands work across multiple storage backends. This matrix shows current implementation status per backend.

**Storage Backends:**
- **SQLite**: Local database (current default)
- **Git In-Repo**: PMO data in same repo as code
- **Git Separate**: PMO data in dedicated repo
- **Cloud**: Hosted database (future)

See [pmo-storage.md](../../docs/architecture/pmo-storage.md) for architecture decisions on when to use each backend.

### Feature Support by Backend

| Feature                | SQLite | Git In-Repo | Git Separate | Cloud |
| ---------------------- | ------ | ----------- | ------------ | ----- |
| Project CRUD           | ✓      | -           | -            | -     |
| Board view/sync        | ✓      | -           | -            | -     |
| Ticket CRUD            | ✓      | -           | -            | -     |
| Spec management        | ✓      | -           | -            | -     |
| Epic management        | ✓      | -           | -            | -     |
| Work assignment        | -      | -           | -            | -     |
| Multi-worker (WAL)     | ✓      | N/A         | N/A          | ✓     |
| Multi-host sync        | -      | ✓           | ✓            | ✓     |
| Real-time updates      | -      | -           | -            | -     |
| Conflict resolution    | N/A    | -           | -            | -     |

**Legend:** ✓ = Implemented, - = Not yet, N/A = Not applicable

### Migration Triggers

| From     | To           | When                                |
| -------- | ------------ | ----------------------------------- |
| SQLite   | SQLite WAL   | Adding 2+ concurrent workers        |
| SQLite   | Git Separate | Adding second host node             |
| In-Repo  | Git Separate | Team growth or PR conflicts         |
| Any      | Cloud        | 10+ engineers or real-time needs    |

---

## Theme System

See [THEME_SPEC.md](./THEME_SPEC.md) for complete theme command specification.

**Key principle**: Base commands always work. Theme commands are optional aliases.

Examples:

- Base: `prlt agent add alice`
- Cars theme: `prlt drive camry` (alias for agent add)
- Billionaires theme: `prlt hire elon` (alias for agent add)

## Architecture Decisions

### SQLite Database Migration (v2.0)

**Major architectural improvement:** Migrated from JSON config files to SQLite database for better team coordination and data consistency.

**Benefits:**

- **Concurrent Access**: Multiple team members can safely read/write workspace data
- **ACID Transactions**: Data integrity for agent and repository operations
- **Structured Queries**: Efficient filtering and reporting of agent status
- **Schema Evolution**: Database migrations for future feature additions
- **Performance**: Fast lookups for large workspaces with many agents

**Database Schema:**

| Table | Primary Key | Description | Auto | Manual |
| ----- | ----------- | ----------- | ---- | ------ |
| **workspace** | id | Core workspace metadata | - | - |
| **agents** | name | Agent instances | - | - |
| **agent_worktrees** | (agent_name, repo_name) | Agent-owned worktrees | - | - |
| **repositories** | name | Repository management | - | - |
| **themes** | name | Theme configurations | - | - |
| **pmo_projects** | id | Multi-project support | - | - |
| **pmo_initiatives** | id | Optional OKR-level grouping | - | - |
| **pmo_columns** | (project_id, id) | Kanban lanes (per-project) | - | - |
| **pmo_tickets** | id | Kanban cards (per-project) | - | - |
| **pmo_epics** | id | Work containers with lifecycle | - | - |
| **pmo_subtasks** | (ticket_id, id) | Task breakdown | - | - |
| **pmo_ticket_metadata** | (ticket_id, key) | Custom ticket fields | - | - |
| **pmo_ticket_dependencies** | (ticket_id, blocked_by_ticket_id) | Ticket blocking relationships | - | - |
| **pmo_ticket_affected_paths** | id | File/directory scope hints | - | - |
| **pmo_ticket_acceptance_criteria** | (ticket_id, id) | Structured acceptance criteria | - | - |
| **pmo_specs** | id | Static specification documents | - | - |
| **pmo_ticket_assignments** | (ticket_id, agent_name) | Agent-Ticket assignments (M:M) | - | - |
| **pmo_cache_metadata** | key | Board.md sync tracking | - | - |
| **pmo_settings** | key | PMO configuration settings | - | - |
| **agent_work** | id | Execution tracking (agent work sessions) | - | - |

**Table Columns (expanded):**

| Table | Columns |
| ----- | ------- |
| workspace | type, theme, workspace_name, has_pmo, created_at |
| agents | theme, status, current_task, created_at, last_activity |
| agent_worktrees | worktree_path, branch, created_at, commits_ahead, is_clean |
| repositories | path, type, source_url, action, added_at |
| themes | workspace_dir, add_command, remove_command, agents |
| pmo_projects | name, template, description, initiative_id, created_at, updated_at |
| pmo_initiatives | name, objective, key_results, created_at, updated_at |
| pmo_columns | name, position, created_at |
| pmo_tickets | project_id, title, column_id, position, priority, category, description, spec_id, epic_id, owner, assignee, status, created_at, updated_at |
| pmo_epics | project_id, title, status, file_path, spec_id, created_at, updated_at |
| pmo_subtasks | title, done, position |
| pmo_ticket_metadata | value |
| pmo_ticket_dependencies | created_at |
| pmo_ticket_affected_paths | ticket_id, path_pattern, path_type, created_at |
| pmo_ticket_acceptance_criteria | criterion, verifiable, verified, verified_at, verified_by, position |
| pmo_specs | path, title, created_at, updated_at |
| pmo_ticket_assignments | assigned_at |
| pmo_cache_metadata | value |
| pmo_settings | value |
| agent_work | ticket_id, agent_name, executor, mode, environment, display_mode, sandboxed, status, branch, pid, container_id, session_id, host, log_path, started_at, completed_at, exit_code |

**Foreign Key Constraints:**

- `pmo_tickets.column_id` → `pmo_columns(project_id, id)` ON DELETE CASCADE
- `pmo_tickets.spec_id` → `pmo_specs(id)` ON DELETE SET NULL
- `pmo_tickets.epic_id` → `pmo_epics(id)` ON DELETE SET NULL
- `pmo_epics.project_id` → `pmo_projects.id` ON DELETE CASCADE
- `pmo_epics.spec_id` → `pmo_specs(id)` ON DELETE SET NULL
- `pmo_subtasks.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_metadata.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_dependencies.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_dependencies.blocked_by_ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_affected_paths.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_acceptance_criteria.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_assignments.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `agent_work.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `agent_work.agent_name` → `agents.name` ON DELETE CASCADE

**Note on Ownership Model:** Tickets have both `owner` (human accountable) and `assignee` (who does the work, e.g., "agent:dorsey"). The `pmo_ticket_assignments` table provides many-to-many agent assignments for historical tracking.

**Agent Execution Support:** The schema includes three tables for agent orchestration:
- `pmo_ticket_dependencies`: Tracks blocking relationships for dependency-based scheduling
- `pmo_ticket_affected_paths`: File/directory scope hints for agent context injection
- `pmo_ticket_acceptance_criteria`: Structured, verifiable criteria (separate from description markdown)

**PMO Settings (`pmo_settings`):** Key-value store for PMO configuration:

| Key | Default Value | Description |
|-----|---------------|-------------|
| `column_in_progress` | In Progress | Column for `work start` to move tickets to |
| `column_review` | Review | Column for `work ready` to move tickets to |
| `column_done` | Done | Column for `work complete` to move tickets to |
| `next_ticket_id` | 1 | Auto-increment counter for TKT-XXX IDs |
| `next_epic_id` | 1 | Auto-increment counter for EPIC-XXX IDs |
| `pmo_path` | pmo | Relative path to PMO directory from HQ root |

**Template-specific column mappings** (set automatically by `pmo init`):

| Template | column_in_progress | column_review | column_done |
|----------|-------------------|---------------|-------------|
| kanban | In Progress | In Progress | Done |
| scrum | In Progress | In Review | Done |
| founder | In Progress | In Review | Published |
| custom | (auto-detected) | (auto-detected) | (auto-detected) |

Column names are matched case-insensitively with fallback to partial matching. This allows work commands to work with any board layout (e.g., "Active" instead of "In Progress", "Completed" instead of "Done").

**DRY Architecture:**

- Shared utilities in `lib/agents/commands.ts`
- Single source of truth for workspace detection
- Unified status and validation logic
- Eliminating code duplication across commands

### Why Oclif?

- **Auto-documentation**: Commands self-document from code
- **Plugin system**: Future extensibility for cloud features
- **Hooks**: Pre/post command execution for validation
- **Testing**: Built-in testing helpers
- **TypeScript**: Full type safety

### File Structure

```
apps/cli/
├── src/commands/       # Oclif commands (single source of truth)
│   ├── init.ts
│   ├── agent/
│   │   ├── add.ts
│   │   ├── list.ts
│   │   └── remove.ts
│   ├── agents/         # Bulk agent operations
│   │   ├── index.ts
│   │   ├── list.ts
│   │   ├── add.ts
│   │   └── remove.ts
│   ├── repo/
│   │   ├── index.ts
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   └── view.ts
│   ├── repos/          # Bulk repo operations
│   │   ├── index.ts
│   │   ├── list.ts
│   │   ├── add.ts
│   │   └── remove.ts
│   ├── pmo/
│   │   ├── init.ts
│   │   └── board.ts
│   ├── ticket/
│   │   ├── create.ts
│   │   ├── list.ts
│   │   ├── view.ts
│   │   ├── move.ts
│   │   ├── delete.ts
│   │   ├── status.ts
│   │   └── link.ts
│   ├── tickets/        # Bulk ticket operations
│   │   ├── index.ts
│   │   ├── list.ts
│   │   ├── move.ts
│   │   ├── delete.ts
│   │   ├── complete.ts
│   │   ├── reassign.ts
│   │   ├── link.ts
│   │   └── update.ts
│   ├── work/           # Work execution commands
│   │   ├── start.ts    # Start agent on ticket
│   │   ├── ready.ts    # Mark ready for review
│   │   ├── complete.ts # Mark work done
│   │   ├── claim.ts    # Claim work
│   │   ├── assign.ts   # Assign work
│   │   └── own.ts      # Take ownership
│   ├── spec/
│   │   ├── index.ts
│   │   ├── create.ts
│   │   ├── list.ts
│   │   └── view.ts
│   ├── epic/           # Epic commands
│   │   ├── index.ts
│   │   ├── create.ts
│   │   ├── list.ts
│   │   ├── view.ts
│   │   ├── archive.ts
│   │   ├── activate.ts
│   │   ├── move.ts
│   │   ├── progress.ts
│   │   └── link.ts
│   ├── branch/         # Branch commands
│   │   ├── index.ts
│   │   ├── create.ts
│   │   ├── list.ts
│   │   └── validate.ts
│   ├── execution/      # Execution commands
│   │   ├── index.ts
│   │   ├── list.ts
│   │   ├── logs.ts
│   │   └── stop.ts
│   └── db/             # Database inspection commands (not yet implemented)
│       ├── index.ts
│       ├── tables.ts
│       ├── schema.ts
│       ├── query.ts
│       └── stats.ts
├── test/              # Integration tests
├── README.md          # User documentation
└── SYSTEM.md          # This file - system context
```

### Documentation Strategy

1. **Code is truth**: Each command's `static description` and `static examples` in the TypeScript files
2. **README**: Generated from code + manual additions for concepts
3. **Tests**: Validate commands work as documented
4. **No drift**: Oclif generates help from the actual code

## Domain Specifications

Detailed specifications for each domain are in the `specs/domain/` directory at the repo root.

### Domain Specs
- [agents.md](../../specs/domain/agents.md) - `prlt agent`, `prlt agents`
- [projects.md](../../specs/domain/projects.md) - `prlt project`
- [board.md](../../specs/domain/board.md) - `prlt board`
- [tickets.md](../../specs/domain/tickets.md) - `prlt ticket`, `prlt ticket --bulk` (CRUD operations)
- [specs.md](../../specs/domain/specs.md) - `prlt spec` (static documentation)
- [epics.md](../../specs/domain/epics.md) - `prlt epic` (work containers)
- [work.md](../../specs/domain/work.md) - `prlt work` (ownership, assignment, execution), `prlt execution` (runtime management)
- [dependencies.md](../../specs/domain/dependencies.md) - Ticket dependency tracking

### Storage Layer
- [pmo-interface.md](../../specs/infrastructure/architecture/pmo-interface.md) - Core PMO interface contract
- [pmo-storage-sqlite.md](../../specs/infrastructure/storage/pmo-storage-sqlite.md) - SQLite storage (current)
- [pmo-storage-git.md](../../specs/infrastructure/storage/pmo-storage-git.md) - Git-based storage (future)
- [pmo-storage-cloud.md](../../specs/infrastructure/storage/pmo-storage-cloud.md) - Cloud DB storage (future)
- [pmo-storage-adapter.md](../../specs/infrastructure/storage/pmo-storage-adapter.md) - External tool adapters (Jira, Linear, Notion)

## Future Features (Cloud)

- Docker containers for agents
- Distributed execution
- Web dashboard
- Agent collaboration
- Automated work distribution

## Testing Commands

```bash
# Build
pnpm build

# Test help
prlt --help
prlt ticket --help

# Run integration tests
pnpm test
```

## For AI Assistants

When modifying this CLI:

1. Commands are in `src/commands/` - this is the source of truth
2. Update command's `static description` and `static examples`
3. Run `npm run build` after changes
4. README should reflect major features but not duplicate command details
5. Integration tests should verify critical paths work
