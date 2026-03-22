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

- **Staff Agents**: Persistent named agents via `prlt agent staff add/list/remove`
- **Ephemeral Agents**: On-demand agents via `prlt agent temp list/cleanup`
- **Git Worktree Integration**: Each agent has isolated workspace with proper cleanup
- **Interactive Menus**: Arrow-key navigation with cancel options
- **Status Tracking**: Repository states, commits, activity, and ticket assignments
- **Navigation Support**: Directory switching and path calculation
- **Theme Integration**: Billionaires, cars, companies, or custom agent names via `prlt agent themes`

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
| `prlt init`           | ✓  | ✓  | ✓  | -  | Initialize machine config   | -                                                    |
| `prlt new <hq-name>`  | ✓  | ✓  | ✓  | -  | Create new HQ workspace     | -                                                    |
| `prlt help [command]` | ✓  | ✓  | ✓  | -  | Show help for commands      | oclif built-in                                       |
| `prlt --version`      | -  | -  | -  | -  | Show CLI version            | -                                                    |

#### Agent Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                   | Spec                                                 |
| ------------------------------- | -- | -- | -- | -- | ----------------------------- | ---------------------------------------------------- |
| `prlt agent`                    | ✓  | ✓  | -  | -  | Interactive agent menu        | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent list`               | ✓  | ✓  | -  | -  | List all agents               | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent status [name]`      | ✓  | ✓  | -  | -  | Show detailed agent status    | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent visit [name]`       | ✓  | ✓  | -  | -  | Navigate to agent directory   | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent shell [name]`       | ✓  | ✓  | -  | -  | Shell into agent workspace    | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent login [name]`       | ✓  | ✓  | -  | -  | Auth Claude in container      | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent rebuild [name]`     | ✓  | ✓  | -  | -  | Rebuild agent workspace       | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent restart [name]`     | ✓  | ✓  | -  | -  | Restart agent                 | [agents.md](../../specs/domain/agents.md)            |

#### Agent Staff Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                   | Spec                                                 |
| ------------------------------- | -- | -- | -- | -- | ----------------------------- | ---------------------------------------------------- |
| `prlt agent staff add <names>`  | ✓  | ✓  | -  | -  | Add named (staff) agents      | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent staff list`         | ✓  | ✓  | -  | -  | List staff agents             | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent staff remove`       | ✓  | ✓  | -  | -  | Remove staff agent            | [agents.md](../../specs/domain/agents.md)            |

#### Agent Temp Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                   | Spec                                                 |
| ------------------------------- | -- | -- | -- | -- | ----------------------------- | ---------------------------------------------------- |
| `prlt agent temp list`          | ✓  | ✓  | -  | -  | List ephemeral agents         | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent temp cleanup`       | ✓  | ✓  | -  | -  | Remove ephemeral agents       | [agents.md](../../specs/domain/agents.md)            |

#### Agent Theme Commands

| Command                               | 📝 | ✅ | 🧪 | 👤 | Description                   | Spec                                                 |
| ------------------------------------- | -- | -- | -- | -- | ----------------------------- | ---------------------------------------------------- |
| `prlt agent themes list`              | ✓  | ✓  | -  | -  | List available themes         | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent themes set <name>`        | ✓  | ✓  | -  | -  | Set active theme              | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent themes create <name>`     | ✓  | ✓  | -  | -  | Create custom theme           | [agents.md](../../specs/domain/agents.md)            |
| `prlt agent themes add-names`         | ✓  | ✓  | -  | -  | Add names to theme            | [agents.md](../../specs/domain/agents.md)            |

#### Repo Commands

| Command                | 📝 | ✅ | 🧪 | 👤 | Description                     | Spec |
| ---------------------- | -- | -- | -- | -- | ------------------------------- | ---- |
| `prlt repo`            | ✓  | ✓  | -  | -  | Interactive repo menu           | -    |
| `prlt repo add <url>`  | ✓  | ✓  | -  | -  | Add repository                  | -    |
| `prlt repo list`       | ✓  | ✓  | -  | -  | List repositories               | -    |
| `prlt repo view`       | ✓  | ✓  | -  | -  | View repository details         | -    |
| `prlt repo remove`     | ✓  | ✓  | -  | -  | Remove repository               | -    |

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

#### Bulk Ticket Commands (`prlt ticket --bulk`)

| Command                        | 📝 | ✅ | 🧪 | 👤 | Description                           | Spec                                            |
| ------------------------------ | -- | -- | -- | -- | ------------------------------------- | ----------------------------------------------- |
| `prlt ticket bulk`             | ✓  | ✓  | -  | -  | Interactive bulk operations menu      | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket move --bulk`      | ✓  | ✓  | -  | -  | Move multiple tickets to column       | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket delete --bulk`    | ✓  | ✓  | -  | -  | Delete multiple tickets               | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket complete --bulk`  | ✓  | ✓  | -  | -  | Complete multiple tickets             | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket reassign --bulk`  | ✓  | ✓  | -  | -  | Reassign tickets to different agent   | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket update --bulk`    | ✓  | ✓  | -  | -  | Update priority/category for multiple | [tickets.md](../../specs/domain/tickets.md)     |
| `prlt ticket project --bulk`   | ✓  | ✓  | -  | -  | Move multiple tickets to project      | [tickets.md](../../specs/domain/tickets.md)     |

#### Work Commands (Spawning & Execution)

**Note**: The `work` namespace handles spawning agents on tickets and tracking work state.

| Command                           | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec                                        |
| --------------------------------- | -- | -- | -- | -- | ---------------------------------- | ------------------------------------------- |
| `prlt work start [id]`            | ✓  | ✓  | -  | -  | Spawn agent to work on ticket      | [work.md](../../specs/domain/work.md)       |
| `prlt work groom [id]`            | ✓  | ✓  | -  | -  | Enrich ticket with requirements    | [work.md](../../specs/domain/work.md)       |
| `prlt work resolve [id]`          | ✓  | ✓  | -  | -  | Resolve ambiguity questions        | [work.md](../../specs/domain/work.md)       |
| `prlt work implement [id]`        | ✓  | ✓  | -  | -  | Spawn agent to implement ticket    | [work.md](../../specs/domain/work.md)       |
| `prlt work review [id]`           | ✓  | ✓  | -  | -  | Spawn agent to review PR           | [work.md](../../specs/domain/work.md)       |
| `prlt work peek [id]`             | ✓  | ✓  | -  | -  | Check agent status and progress    | [work.md](../../specs/domain/work.md)       |
| `prlt work poke [id]`             | ✓  | ✓  | -  | -  | Send message to steer an agent     | [work.md](../../specs/domain/work.md)       |
| `prlt work stop [id]`             | ✓  | ✓  | -  | -  | Stop a running agent               | [work.md](../../specs/domain/work.md)       |
| `prlt work spawn`                 | ✓  | ✓  | -  | -  | Batch spawn multiple tickets       | [work.md](../../specs/domain/work.md)       |
| `prlt work ready [id]`            | ✓  | ✓  | -  | -  | Mark work as ready for review      | [work.md](../../specs/domain/work.md)       |
| `prlt work complete [id]`         | ✓  | ✓  | -  | -  | Mark work as complete (Done)       | [work.md](../../specs/domain/work.md)       |
| `prlt work watch`                 | ✓  | ✓  | -  | -  | Watch work progress                | [work.md](../../specs/domain/work.md)       |

#### Execution Commands (Agent Runtime Management)

**Note**: These commands manage running agent processes.

| Command                           | 📝 | ✅ | 🧪 | 👤 | Description                        | Spec                                        |
| --------------------------------- | -- | -- | -- | -- | ---------------------------------- | ------------------------------------------- |
| `prlt execution list`             | ✓  | ✓  | -  | -  | List running/recent executions     | [work.md](../../specs/domain/work.md)       |
| `prlt execution logs [id]`        | ✓  | ✓  | -  | -  | View execution logs                | [work.md](../../specs/domain/work.md)       |
| `prlt execution stop [id]`        | ✓  | ✓  | -  | -  | Stop a running execution           | [work.md](../../specs/domain/work.md)       |

**Execution Environment** (where agent runs):

| Environment    | Flag               | Description                              |
| -------------- | ------------------ | ---------------------------------------- |
| `docker`       | `--mode docker`    | Docker container (isolated, recommended) |
| `host`         | `--run-on-host`    | Directly on host machine (fast)          |

**Display Mode** (how output is shown):

| Mode           | Flag                       | Description                              |
| -------------- | -------------------------- | ---------------------------------------- |
| `terminal`     | `--display terminal`       | New terminal tab                         |
| `background`   | `--display background`     | Detached, reattach later                 |

All sessions run on tmux under the hood for persistence.

**Permission Mode**:

| Mode   | Flag                   | Description                                          |
| ------ | ---------------------- | ---------------------------------------------------- |
| Safe   | (default)              | Agent prompts for permissions                        |
| YOLO   | `--skip-permissions`   | No prompts, full access. Use with Docker for safety. |

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

#### GitHub Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ------------------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt gh`                       | ✓  | ✓  | -  | -  | Interactive GitHub menu          | -    |
| `prlt gh login`                 | ✓  | ✓  | -  | -  | Login to GitHub                  | -    |
| `prlt gh status`                | ✓  | ✓  | -  | -  | Check auth status                | -    |
| `prlt gh token`                 | ✓  | ✓  | -  | -  | Get GitHub token                 | -    |

#### Pull Request Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ------------------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt pr`                       | ✓  | ✓  | -  | -  | Interactive PR menu              | -    |
| `prlt pr create`                | ✓  | ✓  | -  | -  | Create pull request              | -    |
| `prlt pr status [id]`           | ✓  | ✓  | -  | -  | Check PR status                  | -    |
| `prlt pr link [id] [url]`       | ✓  | ✓  | -  | -  | Link PR to ticket                | -    |

#### Docker Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ------------------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt docker`                   | ✓  | ✓  | -  | -  | Interactive Docker menu          | -    |
| `prlt docker list`              | ✓  | ✓  | -  | -  | List containers                  | -    |
| `prlt docker status`            | ✓  | ✓  | -  | -  | Check Docker status              | -    |
| `prlt docker start [name]`      | ✓  | ✓  | -  | -  | Start container                  | -    |
| `prlt docker stop [name]`       | ✓  | ✓  | -  | -  | Stop container                   | -    |
| `prlt docker restart [name]`    | ✓  | ✓  | -  | -  | Restart container                | -    |
| `prlt docker logs [name]`       | ✓  | ✓  | -  | -  | View container logs              | -    |
| `prlt docker shell [name]`      | ✓  | ✓  | -  | -  | Shell into container             | -    |
| `prlt docker sync [name]`       | ✓  | ✓  | -  | -  | Sync container files             | -    |
| `prlt docker clean`             | ✓  | ✓  | -  | -  | Remove stopped containers        | -    |
| `prlt docker prune`             | ✓  | ✓  | -  | -  | Remove unused resources          | -    |

#### Action Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ------------------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt action`                   | ✓  | ✓  | -  | -  | Interactive action menu          | -    |
| `prlt action create`            | ✓  | ✓  | -  | -  | Create action template           | -    |
| `prlt action list`              | ✓  | ✓  | -  | -  | List actions                     | -    |
| `prlt action show [id]`         | ✓  | ✓  | -  | -  | Show action details              | -    |
| `prlt action run [id]`          | ✓  | ✓  | -  | -  | Run action                       | -    |
| `prlt action update [id]`       | ✓  | ✓  | -  | -  | Update action                    | -    |
| `prlt action delete [id]`       | ✓  | ✓  | -  | -  | Delete action                    | -    |

#### Session Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ------------------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt session`                  | ✓  | ✓  | -  | -  | Interactive session menu         | -    |
| `prlt session list`             | ✓  | ✓  | -  | -  | List active tmux sessions        | -    |
| `prlt session attach [name]`    | ✓  | ✓  | -  | -  | Attach to tmux session           | -    |

#### Workspace Commands

| Command                         | 📝 | ✅ | 🧪 | 👤 | Description                      | Spec |
| ------------------------------- | -- | -- | -- | -- | -------------------------------- | ---- |
| `prlt workspace list`           | ✓  | ✓  | -  | -  | List workspaces                  | -    |
| `prlt workspace add`            | ✓  | ✓  | -  | -  | Add workspace                    | -    |
| `prlt workspace use [name]`     | ✓  | ✓  | -  | -  | Switch workspace                 | -    |
| `prlt workspace remove`         | ✓  | ✓  | -  | -  | Remove workspace                 | -    |

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

### Project and Ticket

| Entity | Purpose | Status/Lifecycle | Links |
|--------|---------|------------------|-------|
| **Ticket** | Work item | Column position on board | Part of project |

### Relationships

```
Project
├── Board (1:1)
│   └── Columns → Tickets
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
| **pmo_subtasks** | (ticket_id, id) | Task breakdown | - | - |
| **pmo_ticket_metadata** | (ticket_id, key) | Custom ticket fields | - | - |
| **pmo_ticket_dependencies** | (ticket_id, blocked_by_ticket_id) | Ticket blocking relationships | - | - |
| **pmo_ticket_affected_paths** | id | File/directory scope hints | - | - |
| **pmo_ticket_acceptance_criteria** | (ticket_id, id) | Structured acceptance criteria | - | - |
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
| pmo_tickets | project_id, title, column_id, position, priority, category, description, owner, assignee, status, created_at, updated_at |
| pmo_subtasks | title, done, position |
| pmo_ticket_metadata | value |
| pmo_ticket_dependencies | created_at |
| pmo_ticket_affected_paths | ticket_id, path_pattern, path_type, created_at |
| pmo_ticket_acceptance_criteria | criterion, verifiable, verified, verified_at, verified_by, position |
| pmo_ticket_assignments | assigned_at |
| pmo_cache_metadata | value |
| pmo_settings | value |
| agent_work | ticket_id, agent_name, executor, mode, environment, display_mode, sandboxed, status, branch, pid, container_id, session_id, host, log_path, started_at, completed_at, exit_code |

**Foreign Key Constraints:**

- `pmo_tickets.column_id` → `pmo_columns(project_id, id)` ON DELETE CASCADE
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
│   ├── init.ts         # Initialize HQ workspace
│   ├── commit.ts       # Conventional commit
│   ├── whoami.ts       # Show current context
│   ├── agent/
│   │   ├── index.ts    # Interactive menu
│   │   ├── list.ts
│   │   ├── status.ts
│   │   ├── shell.ts
│   │   ├── visit.ts
│   │   ├── login.ts
│   │   ├── rebuild.ts
│   │   ├── restart.ts
│   │   ├── staff/      # Named agent operations
│   │   │   ├── add.ts
│   │   │   ├── list.ts
│   │   │   └── remove.ts
│   │   ├── temp/       # Ephemeral agent operations
│   │   │   ├── list.ts
│   │   │   └── cleanup.ts
│   │   └── themes/     # Theme management
│   │       ├── list.ts
│   │       ├── set.ts
│   │       ├── create.ts
│   │       └── add-names.ts
│   ├── repo/
│   │   ├── index.ts
│   │   ├── add.ts
│   │   ├── list.ts
│   │   ├── view.ts
│   │   └── remove.ts
│   ├── ticket/
│   │   ├── index.ts
│   │   ├── create.ts
│   │   ├── list.ts
│   │   ├── view.ts
│   │   ├── edit.ts
│   │   ├── move.ts
│   │   ├── delete.ts
│   │   ├── complete.ts
│   │   ├── bulk.ts
│   │   └── link/
│   │       ├── block.ts
│   │       ├── relates.ts
│   │       └── remove.ts
│   ├── work/           # Work execution commands
│   │   ├── start.ts    # Spawn agent on ticket
│   │   ├── spawn.ts    # Batch spawn
│   │   ├── ready.ts
│   │   ├── complete.ts
│   │   ├── revise.ts
│   │   └── watch.ts
│   ├── execution/
│   │   ├── list.ts
│   │   ├── logs.ts
│   │   └── stop.ts
│   ├── project/
│   │   ├── create.ts, list.ts, view.ts, archive.ts, ...
│   ├── board/
│   │   ├── index.ts, watch.ts
│   ├── branch/
│   │   ├── create.ts, list.ts, validate.ts
│   ├── action/
│   │   ├── create.ts, list.ts, show.ts, run.ts, ...
│   ├── session/
│   │   ├── list.ts, attach.ts
│   ├── workspace/
│   │   ├── list.ts, add.ts, use.ts, remove.ts
│   ├── docker/
│   │   ├── list.ts, status.ts, start.ts, stop.ts, ...
│   ├── gh/
│   │   ├── login.ts, status.ts, token.ts
│   ├── pr/
│   │   ├── create.ts, status.ts, link.ts
│   ├── pmo/
│   │   └── init.ts
│   └── autocomplete/
│       └── setup.ts
├── test/              # Integration tests
├── README.md          # User documentation
└── SYSTEM_CARD.md     # This file - system specification
```

### Documentation Strategy

1. **Code is truth**: Each command's `static description` and `static examples` in the TypeScript files
2. **README**: Generated from code + manual additions for concepts
3. **Tests**: Validate commands work as documented
4. **No drift**: Oclif generates help from the actual code

## Domain Specifications

Detailed specifications for each domain are in the `specs/domain/` directory at the repo root.

### Domain Specs
- [agents.md](../../specs/domain/agents.md) - `prlt agent`, `prlt agent staff`, `prlt agent temp`, `prlt agent themes`
- [projects.md](../../specs/domain/projects.md) - `prlt project`
- [board.md](../../specs/domain/board.md) - `prlt board`
- [tickets.md](../../specs/domain/tickets.md) - `prlt ticket` (CRUD and bulk operations)
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
