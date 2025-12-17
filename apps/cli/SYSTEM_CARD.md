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
- 🧪 Test: Automated tests passing

#### Core Commands

| Command               | 📝 | ✅ | 🧪 | Description                 | Spec                                                 |
| --------------------- | -- | -- | -- | --------------------------- | ---------------------------------------------------- |
| `prlt init <hq-name>` | ✓  | ✓  | ✓  | Initialize new HQ workspace | [init-commands.md](../../specs/cli/init-commands.md) |
| `prlt help [command]` | ✓  | ✓  | ✓  | Show help for commands      | oclif built-in                                       |
| `prlt --version`      | -  | -  | -  | Show CLI version            | -                                                    |

#### Agent Commands (Individual Operations)

| Command                      | 📝 | ✅ | 🧪 | Description                   | Spec                                                     |
| ---------------------------- | -- | -- | -- | ----------------------------- | -------------------------------------------------------- |
| `prlt agent`                 | ✓  | ✓  | -  | Interactive individual menu   | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent status [name]`   | ✓  | ✓  | -  | Show detailed agent status    | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent visit [name]`    | ✓  | ✓  | -  | Navigate to agent directory   | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent add`             | ✓  | ✓  | -  | Add agent (redirects to bulk) | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent remove [name]`   | ✓  | ✓  | -  | Remove specific agent         | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent login [name]`    | ✓  | ✓  | -  | Auth Claude in devcontainer   | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent grant`           | ✓  | -  | -  | Grant repo access to agents   | [agent-commands.md](../../specs/cli/agent-commands.md)   |
| `prlt agent revoke`          | ✓  | -  | -  | Revoke repo access            | [agent-commands.md](../../specs/cli/agent-commands.md)   |

#### Agents Commands (Bulk Operations)

| Command              | 📝 | ✅ | 🧪 | Description                      | Spec                                                   |
| -------------------- | -- | -- | -- | -------------------------------- | ------------------------------------------------------ |
| `prlt agents`        | ✓  | ✓  | -  | Interactive bulk operations menu | [agent-commands.md](../../specs/cli/agent-commands.md) |
| `prlt agents list`   | ✓  | ✓  | -  | List all agents with overview    | [agent-commands.md](../../specs/cli/agent-commands.md) |
| `prlt agents status` | ✓  | ✓  | -  | Status overview for all agents   | [agent-commands.md](../../specs/cli/agent-commands.md) |
| `prlt agents add`    | ✓  | ✓  | -  | Add multiple agents (bulk, creates devcontainer by default) | [agent-commands.md](../../specs/cli/agent-commands.md) |
| `prlt agents remove` | ✓  | ✓  | -  | Remove multiple agents (bulk)    | [agent-commands.md](../../specs/cli/agent-commands.md) |

**Agent Options:**
- `--no-container`: Skip devcontainer setup (not recommended for autonomous agents)

#### Repo Commands (Individual Operations)

| Command                | 📝 | ✅ | 🧪 | Description                     | Spec                                                 |
| ---------------------- | -- | -- | -- | ------------------------------- | ---------------------------------------------------- |
| `prlt repo`            | ✓  | ✓  | -  | Interactive individual menu     | [repo-commands.md](../../specs/cli/repo-commands.md) |
| `prlt repo add`        | ✓  | ✓  | -  | Add single repository           | [repo-commands.md](../../specs/cli/repo-commands.md) |
| `prlt repo remove`     | ✓  | ✓  | -  | Remove single repository        | [repo-commands.md](../../specs/cli/repo-commands.md) |
| `prlt repo view`       | ✓  | ✓  | -  | View repository details         | [repo-commands.md](../../specs/cli/repo-commands.md) |

#### Repos Commands (Bulk Operations)

| Command             | 📝 | ✅ | 🧪 | Description                        | Spec                                                 |
| ------------------- | -- | -- | -- | ---------------------------------- | ---------------------------------------------------- |
| `prlt repos`        | ✓  | ✓  | -  | Interactive bulk operations menu   | [repo-commands.md](../../specs/cli/repo-commands.md) |
| `prlt repos list`   | ✓  | ✓  | -  | List all repositories              | [repo-commands.md](../../specs/cli/repo-commands.md) |
| `prlt repos add`    | ✓  | ✓  | -  | Add multiple repositories (bulk)   | [repo-commands.md](../../specs/cli/repo-commands.md) |
| `prlt repos remove` | ✓  | ✓  | -  | Remove multiple repositories (bulk)| [repo-commands.md](../../specs/cli/repo-commands.md) |

#### PMO Commands

| Command         | 📝 | ✅ | 🧪 | Description                      | Spec                                                 |
| --------------- | -- | -- | -- | -------------------------------- | ---------------------------------------------------- |
| `prlt pmo init` | ✓  | ✓  | -  | Initialize PMO system (one-time) | [init-commands.md](../../specs/cli/init-commands.md) |

#### Project Commands

| Command                      | 📝 | ✅ | 🧪 | Description          | Spec                                                               |
| ---------------------------- | -- | -- | -- | -------------------- | ------------------------------------------------------------------ |
| `prlt project create`        | ✓  | ✓  | -  | Create new project   | [project-commands.md](../../specs/cli/project-commands.md) |
| `prlt project list`          | ✓  | ✓  | -  | List all projects    | [project-commands.md](../../specs/cli/project-commands.md) |
| `prlt project view [id]`     | ✓  | ✓  | -  | View project details | [project-commands.md](../../specs/cli/project-commands.md) |
| `prlt project delete [id]`   | ✓  | ✓  | -  | Delete project       | [project-commands.md](../../specs/cli/project-commands.md) |

#### Board Commands

| Command               | 📝 | ✅ | 🧪 | Description                        | Spec                                                           |
| --------------------- | -- | -- | -- | ---------------------------------- | -------------------------------------------------------------- |
| `prlt board`          | ✓  | ✓  | -  | Interactive board menu (view/open/sync/etc) | [board-commands.md](../../specs/cli/board-commands.md) |
| `prlt board watch`    | ✓  | ✓  | -  | Watch kanban.md for changes        | [board-commands.md](../../specs/cli/board-commands.md) |

**Note**: Board operations (view, open, markdown, export, sync) are available through the `prlt board` interactive menu.

#### Spec Commands

Specs are **static documentation** (design docs, architecture, requirements). No lifecycle, no tickets.

| Command                   | 📝 | ✅ | 🧪 | Description              | Spec                                                         |
| ------------------------- | -- | -- | -- | ------------------------ | ------------------------------------------------------------ |
| `prlt spec`               | ✓  | ✓  | -  | Interactive spec menu    | [spec-commands.md](../../specs/cli/spec-commands.md) |
| `prlt spec create [name]` | ✓  | ✓  | -  | Create new spec document | [spec-commands.md](../../specs/cli/spec-commands.md) |
| `prlt spec list`          | ✓  | ✓  | -  | List all specs           | [spec-commands.md](../../specs/cli/spec-commands.md) |
| `prlt spec view [id]`     | ✓  | ✓  | -  | View spec content        | [spec-commands.md](../../specs/cli/spec-commands.md) |

#### Epic Commands

Epics are **work containers** with lifecycle status. Tickets link to epics via `epic_id`.

| Command                        | 📝 | ✅ | 🧪 | Description                    | Spec                                                         |
| ------------------------------ | -- | -- | -- | ------------------------------ | ------------------------------------------------------------ |
| `prlt epic`                    | ✓  | ✓  | -  | Interactive epic menu          | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic create [name]`      | ✓  | ✓  | -  | Create new epic                | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic list`               | ✓  | ✓  | -  | List all epics                 | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic view [id]`          | ✓  | ✓  | -  | View epic and linked tickets   | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic archive [id]`       | ✓  | ✓  | -  | Move epic to complete/ folder  | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic activate [id]`      | ✓  | ✓  | -  | Move epic to active/ folder    | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic move [id] [status]` | ✓  | ✓  | -  | Move epic between status folders | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic progress [id]`      | ✓  | ✓  | -  | Show completion percentage     | [epic-commands.md](../../specs/cli/epic-commands.md) |
| `prlt epic link [id] [tickets...]` | ✓  | ✓  | -  | Link tickets to epic, or epic to spec (--spec) | [epic-commands.md](../../specs/cli/epic-commands.md) |

#### Ticket Commands (CRUD Operations)

| Command                          | 📝 | ✅ | 🧪 | Description             | Spec                                                             |
| -------------------------------- | -- | -- | -- | ----------------------- | ---------------------------------------------------------------- |
| `prlt ticket`                    | ✓  | ✓  | -  | Interactive ticket menu | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket create [title]`     | ✓  | ✓  | -  | Create new ticket       | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket list`               | ✓  | ✓  | -  | List all tickets        | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket view [id]`          | ✓  | ✓  | -  | View ticket details     | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket edit [id]`          | ✓  | ✓  | -  | Edit ticket fields      | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket move [id] [column]` | ✓  | ✓  | -  | Move ticket to column   | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket delete [id]`        | ✓  | ✓  | -  | Delete ticket           | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket status [id]`        | ✓  | ✓  | -  | Show ticket status      | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt ticket link [id] [epic-id]`| ✓  | ✓  | -  | Link ticket to epic     | [ticket-commands.md](../../specs/cli/ticket-commands.md) |

#### Bulk Ticket Commands (`prlt tickets`)

| Command                 | 📝 | ✅ | 🧪 | Description                           | Spec                                                             |
| ----------------------- | -- | -- | -- | ------------------------------------- | ---------------------------------------------------------------- |
| `prlt tickets`          | ✓  | ✓  | -  | Interactive bulk operations menu      | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets list`     | ✓  | ✓  | -  | List all tickets with filtering       | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets move`     | ✓  | ✓  | -  | Move multiple tickets to column       | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets delete`   | ✓  | ✓  | -  | Delete multiple tickets               | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets complete` | ✓  | ✓  | -  | Complete multiple tickets             | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets reassign` | ✓  | ✓  | -  | Reassign tickets to different agent   | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets link`     | ✓  | ✓  | -  | Link tickets to different epic        | [ticket-commands.md](../../specs/cli/ticket-commands.md) |
| `prlt tickets update`   | ✓  | ✓  | -  | Update priority/category for multiple | [ticket-commands.md](../../specs/cli/ticket-commands.md) |

#### Work Commands (Ownership, Assignment & Execution)

**Note**: The `work` namespace handles the execution/implementation of tickets - who is responsible, who does the work, and how work runs.

| Command                           | 📝 | ✅ | 🧪 | Description                        | Spec                                                             |
| --------------------------------- | -- | -- | -- | ---------------------------------- | ---------------------------------------------------------------- |
| `prlt work start [id]`            | ✓  | ✓  | -  | Start agent working on ticket      | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt work ready [id]`            | ✓  | ✓  | -  | Mark work as ready for review      | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt work complete [id]`         | ✓  | ✓  | -  | Mark work as complete (Done)       | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt work claim [id]`            | ✓  | ✓  | -  | Claim work for yourself or agent   | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt work assign [id] [agent]`   | ✓  | ✓  | -  | Assign work to human/agent         | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt work own [id]`              | ✓  | ✓  | -  | Take accountability for work       | [execute-commands.md](../../specs/cli/execute-commands.md) |

#### Execution Commands (Agent Runtime Management)

**Note**: These commands manage running agent processes.

| Command                           | 📝 | ✅ | 🧪 | Description                        | Spec                                                             |
| --------------------------------- | -- | -- | -- | ---------------------------------- | ---------------------------------------------------------------- |
| `prlt execution list`             | ✓  | ✓  | -  | List running/recent executions     | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt execution logs [id]`        | ✓  | ✓  | -  | View execution logs                | [execute-commands.md](../../specs/cli/execute-commands.md) |
| `prlt execution stop [id]`        | ✓  | ✓  | -  | Stop a running execution           | [execute-commands.md](../../specs/cli/execute-commands.md) |

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

See [devcontainer-agents.md](../../specs/cli/devcontainer-agents.md) for sandboxed agent execution.

#### Branch Commands

| Command                         | 📝 | ✅ | 🧪 | Description                        | Spec                                                     |
| ------------------------------- | -- | -- | -- | ---------------------------------- | -------------------------------------------------------- |
| `prlt branch`                   | ✓  | ✓  | -  | Interactive branch menu            | [branch-commands.md](../../specs/cli/branch-commands.md) |
| `prlt branch create`            | ✓  | ✓  | -  | Interactive branch creation wizard | [branch-commands.md](../../specs/cli/branch-commands.md) |
| `prlt branch create [name]`     | ✓  | ✓  | -  | Create branch with given name      | [branch-commands.md](../../specs/cli/branch-commands.md) |
| `prlt branch list`              | ✓  | ✓  | -  | List branches with conventional info | [branch-commands.md](../../specs/cli/branch-commands.md) |
| `prlt branch validate`          | ✓  | ✓  | -  | Validate branch name format        | [branch-commands.md](../../specs/cli/branch-commands.md) |

**Branch Types:**

| Group | Types |
| ----- | ----- |
| Conventional Commits | `feat`, `fix`, `rfct`, `docs`, `test`, `chore`, `perf`, `ci`, `build` |
| Extended Types | `sec`, `db`, `rel` |
| 5Tool Founder | `ship`, `grow`, `cx`, `strat`, `ops` |

#### Database Commands

| Command                 | 📝 | ✅ | 🧪 | Description                      | Spec                                               |
| ----------------------- | -- | -- | -- | -------------------------------- | -------------------------------------------------- |
| `prlt db`               | ✓  | -  | -  | Interactive database menu        | [db-commands.md](../../specs/cli/db-commands.md)   |
| `prlt db tables`        | ✓  | -  | -  | List all tables with row counts  | [db-commands.md](../../specs/cli/db-commands.md)   |
| `prlt db schema [table]`| ✓  | -  | -  | Show table structure             | [db-commands.md](../../specs/cli/db-commands.md)   |
| `prlt db query <sql>`   | ✓  | -  | -  | Run SQL query (read-only default)| [db-commands.md](../../specs/cli/db-commands.md)   |
| `prlt db stats`         | ✓  | -  | -  | Database size and health info    | [db-commands.md](../../specs/cli/db-commands.md)   |

#### Config Commands

| Command                         | 📝 | ✅ | 🧪 | Description                     | Spec                                                     |
| ------------------------------- | -- | -- | -- | ------------------------------- | -------------------------------------------------------- |
| `prlt config get <key>`         | ✓  | -  | -  | Get a configuration value       | [config-commands.md](../../specs/cli/config-commands.md) |
| `prlt config set <key> <value>` | ✓  | -  | -  | Set a configuration value       | [config-commands.md](../../specs/cli/config-commands.md) |
| `prlt config list`              | ✓  | -  | -  | List all configuration settings | [config-commands.md](../../specs/cli/config-commands.md) |
| `prlt config reset <key>`       | ✓  | -  | -  | Reset a setting to default      | [config-commands.md](../../specs/cli/config-commands.md) |

#### Maintenance Commands

| Command                  | 📝 | ✅ | 🧪 | Description             |
| ------------------------ | -- | -- | -- | ----------------------- |
| `prlt themes`            | -  | -  | -  | List available themes   |
| `prlt repair`            | -  | -  | -  | Repair broken worktrees |
| `prlt health`            | -  | -  | -  | Check worktree health   |
| `prlt migrate <hq-name>` | -  | -  | -  | Migrate repo into HQ    |
| `prlt upgrade`           | -  | -  | -  | Upgrade config format   |

#### Plugin Commands (Oclif Built-in)

| Command                           | 📝 | ✅ | 🧪 | Description             |
| --------------------------------- | -- | -- | -- | ----------------------- |
| `prlt plugins`                    | -  | -  | -  | List installed plugins  |
| `prlt plugins install <plugin>`   | -  | -  | -  | Install a plugin        |
| `prlt plugins uninstall <plugin>` | -  | -  | -  | Remove a plugin         |
| `prlt plugins update`             | -  | -  | -  | Update all plugins      |
| `prlt plugins link <path>`        | -  | -  | -  | Link local plugin       |
| `prlt plugins reset`              | -  | -  | -  | Remove all user plugins |
| `prlt plugins inspect <plugin>`   | -  | -  | -  | Show plugin details     |

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

| Table                            | Primary Key             | Columns                                                                                                  | Description                      |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **workspace**              | id                      | type, theme, workspace_name, has_pmo, created_at                                                         | Core workspace metadata          |
| **agents**                 | name                    | theme, status, current_task, created_at, last_activity                                                   | Agent instances                  |
| **agent_worktrees**        | (agent_name, repo_name) | worktree_path, branch, created_at, commits_ahead, is_clean                                               | Agent-owned worktrees            |
| **repositories**           | name                    | path, type, source_url, action, added_at                                                                 | Repository management            |
| **themes**                 | name                    | workspace_dir, add_command, remove_command, agents                                                       | Theme configurations             |
| **pmo_projects**           | id                      | name, template, description, initiative_id, created_at, updated_at                                       | Multi-project support            |
| **pmo_initiatives**        | id                      | name, objective, key_results, created_at, updated_at                                                     | Optional OKR-level grouping      |
| **pmo_columns**            | (project_id, id)        | name, position, created_at                                                                               | Kanban lanes (per-project)       |
| **pmo_tickets**            | id                      | project_id, title, column_id, position, priority, category, description, epic_id, created_at, updated_at | Kanban cards (per-project)       |
| **pmo_epics**              | id                      | project_id, title, status, file_path, spec_id, created_at, updated_at                                    | Work containers with lifecycle   |
| **pmo_subtasks**           | (ticket_id, id)         | title, done, position                                                                                    | Task breakdown                   |
| **pmo_ticket_metadata**    | (ticket_id, key)        | value                                                                                                    | Custom ticket fields             |
| **pmo_specs**              | id                      | path, title, created_at, updated_at                                                                      | Static specification documents   |
| **pmo_ticket_assignments** | (ticket_id, agent_name) | assigned_at                                                                                              | Agent-Ticket assignments (M:M)   |
| **pmo_cache_metadata**     | key                     | value                                                                                                    | Board.md sync tracking           |
| **agent_work**             | id                      | ticket_id, agent_name, executor, mode, environment, display_mode, sandboxed, status, branch, pid, container_id, session_id, host, log_path, started_at, completed_at, exit_code | Execution tracking (agent work sessions) |

**Foreign Key Constraints:**

- `pmo_tickets.column_id` → `pmo_columns(project_id, id)` ON DELETE CASCADE
- `pmo_tickets.epic_id` → `pmo_epics(id)` ON DELETE SET NULL
- `pmo_epics.project_id` → `pmo_projects.id` ON DELETE CASCADE
- `pmo_epics.spec_id` → `pmo_specs(id)` ON DELETE SET NULL
- `pmo_subtasks.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_metadata.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `pmo_ticket_assignments.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `agent_work.ticket_id` → `pmo_tickets.id` ON DELETE CASCADE
- `agent_work.agent_name` → `agents.name` ON DELETE CASCADE

**Note on Ownership Model:** The current schema uses `pmo_ticket_assignments` for many-to-many agent assignments. The ownership model documented in [ticket-commands.md](../../specs/cli/ticket-commands.md) (owner vs assignee) is not yet implemented. Implementation will require adding `owner` and `assignee` columns to `pmo_tickets`.

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

## Command Specifications

Detailed specifications for each command are in the `specs/` directory at the repo root.

### CLI Commands
- [init-commands.md](../../specs/cli/init-commands.md) - `prlt init`, `prlt pmo init`
- [agent-commands.md](../../specs/cli/agent-commands.md) - `prlt agent`, `prlt agents`
- [repo-commands.md](../../specs/cli/repo-commands.md) - `prlt repo`, `prlt repos`
- [project-commands.md](../../specs/cli/project-commands.md) - `prlt project`
- [board-commands.md](../../specs/cli/board-commands.md) - `prlt board`
- [ticket-commands.md](../../specs/cli/ticket-commands.md) - `prlt ticket`, `prlt tickets` (CRUD operations)
- [spec-commands.md](../../specs/cli/spec-commands.md) - `prlt spec` (static documentation)
- [epic-commands.md](../../specs/cli/epic-commands.md) - `prlt epic` (work containers)
- [execute-commands.md](../../specs/cli/execute-commands.md) - `prlt work` (ownership, assignment, execution), `prlt execution` (runtime management)
- [branch-commands.md](../../specs/cli/branch-commands.md) - `prlt branch` (conventional branch naming)
- [db-commands.md](../../specs/cli/db-commands.md) - `prlt db` (database inspection, not yet implemented)
- [config-commands.md](../../specs/cli/config-commands.md) - `prlt config` (configuration management, not yet implemented)

### Storage Layer
- [pmo-interface.md](../../specs/architecture/pmo-interface.md) - Core PMO interface contract
- [pmo-storage-sqlite.md](../../specs/storage/pmo-storage-sqlite.md) - SQLite storage (current)
- [pmo-storage-git.md](../../specs/storage/pmo-storage-git.md) - Git-based storage (future)
- [pmo-storage-cloud.md](../../specs/storage/pmo-storage-cloud.md) - Cloud DB storage (future)
- [pmo-storage-adapter.md](../../specs/storage/pmo-storage-adapter.md) - External tool adapters (Jira, Linear, Notion)

### Architecture Documentation
- [pmo-storage.md](../../docs/architecture/pmo-storage.md) - Storage architecture decision matrix

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
