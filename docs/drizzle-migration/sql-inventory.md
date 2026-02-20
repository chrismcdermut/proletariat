# SQL Usage Inventory

> Authoritative inventory of all raw SQL usage in the proletariat CLI codebase.
> Generated for the ORM migration to Drizzle (TKT-1086).

## Summary

| Metric | Count |
|--------|-------|
| Total files with raw SQL | 30 |
| Total `.prepare()` call sites | ~352 |
| Total `.exec()` call sites | ~42 |
| Database driver | better-sqlite3 v12.6.2 |
| ORM (target) | drizzle-orm v0.37.0 |

## Domain Boundaries

### 1. Workspace Domain (`apps/cli/src/lib/database/`)

Core workspace config, agent management, theme management, repository tracking.

| File | `.prepare()` | `.exec()` | Tables Touched | Description |
|------|-------------|----------|----------------|-------------|
| `database/index.ts` | 47 | 13 | workspace, agents, agent_worktrees, agent_themes, agent_theme_names, repositories, workspace_settings, pmo_tickets | DB init, migrations, workspace CRUD, agent CRUD, theme CRUD, repo CRUD |

**Key functions with raw SQL:**
- `openWorkspaceDatabase()` - schema migrations via `.exec()` and `.prepare()` (lines 208-337)
- `createWorkspaceDatabase()` - initial schema + INSERT (lines 342-383)
- `getWorkspaceConfig()` - SELECT workspace (line 391)
- `setActiveTheme()` - SELECT + UPDATE (lines 449-463)
- `addRepositoriesToDatabase()` - INSERT OR REPLACE in transaction (lines 468-491)
- `addAgentsToDatabase()` - SELECT + INSERT OR REPLACE in transaction (lines 496-559)
- `addEphemeralAgentToDatabase()` - INSERT + SELECT (lines 564-606)
- `getEphemeralAgentNames()` - SELECT (line 613)
- `removeEphemeralAgent()` - DELETE (line 623)
- `getWorkspaceAgents()` - SELECT (lines 630-660)
- `getAgentByPath()` - SELECT (lines 667-717)
- `markAgentCleaned()` - UPDATE (lines 722-727)
- `discoverAgentsOnDisk()` - SELECT + UPDATE + INSERT (lines 769-858)
- `getWorkspaceRepositories()` - SELECT (lines 863-868)
- `getAgentWorktrees()` - SELECT (lines 873-878)
- `removeAgentsFromDatabase()` - DELETE in transaction (lines 884-898)
- `getThemes()` - SELECT (lines 907-912)
- `getTheme()` - SELECT (lines 917-922)
- `createTheme()` - INSERT + SELECT (lines 927-942)
- `deleteTheme()` - SELECT + DELETE (lines 947-964)
- `getThemeNames()` - SELECT (lines 969-974)
- `getAvailableThemeNames()` - SELECT x2 (lines 982-1017)
- `addThemeNames()` - SELECT + INSERT in transaction (lines 1022-1046)
- `ensureEphemeralAgentTypes()` - SELECT + UPDATE x3 (lines 156-189)

### 2. PMO Domain (`apps/cli/src/lib/pmo/storage/`)

Project management: tickets, projects, epics, statuses, workflows, etc.

| File | `.prepare()` | `.exec()` | Tables Touched | Description |
|------|-------------|----------|----------------|-------------|
| `storage/base.ts` | 28 | 28 | All PMO tables | Schema init, migrations, seeding builtins |
| `storage/tickets.ts` | 38 | 0 | pmo_tickets, pmo_ticket_acceptance_criteria, pmo_workflow_statuses | Ticket CRUD, filtering, position management |
| `storage/statuses.ts` | 31 | 0 | pmo_workflow_statuses, pmo_workflows | Status/workflow CRUD, reordering, defaults |
| `storage/phases.ts` | 25 | 0 | pmo_phases, pmo_phase_templates | Phase CRUD, templates, reordering |
| `storage/subtasks.ts` | 22 | 0 | pmo_subtasks, pmo_ticket_acceptance_criteria | Subtask + acceptance criteria CRUD |
| `storage/specs.ts` | 21 | 0 | pmo_specs, pmo_spec_dependencies, pmo_ticket_specs, pmo_project_specs | Spec CRUD, dependencies |
| `storage/labels.ts` | 20 | 0 | pmo_labels, pmo_label_groups, pmo_ticket_labels | Label + group CRUD |
| `storage/index.ts` | 19 | 1 | pmo_board_views, pmo_workflow_statuses, pmo_tickets, pmo_cache_metadata | Board ops, column management, cache |
| `storage/views.ts` | 19 | 0 | pmo_board_views | Board view CRUD, filters |
| `storage/dependencies.ts` | 18 | 0 | pmo_ticket_dependencies, pmo_spec_dependencies, pmo_epic_dependencies | All dependency types CRUD |
| `storage/projects.ts` | 18 | 0 | pmo_projects, pmo_workflows | Project CRUD, filtering |
| `storage/epics.ts` | 15 | 0 | pmo_epics, pmo_tickets | Epic CRUD, position management |
| `storage/categories.ts` | 11 | 0 | pmo_categories | Category CRUD |
| `storage/templates.ts` | 9 | 0 | pmo_ticket_templates | Ticket template CRUD |
| `storage/actions.ts` | 7 | 0 | pmo_actions | Work action CRUD |
| `storage/helpers.ts` | 4 | 0 | (various - constraint checking) | Error handling utilities |

### 3. PMO Support Files (`apps/cli/src/lib/pmo/`)

| File | `.prepare()` | `.exec()` | Description |
|------|-------------|----------|-------------|
| `pmo/utils.ts` | 7 | 0 | ID generation, position calculation, orphan ticket reassignment |
| `pmo/index.ts` | 3 | 0 | PMO settings read/write |
| `pmo/find-pmo.ts` | 3 | 0 | PMO path lookup from settings |
| `pmo/diet.ts` | 2 | 0 | Lightweight PMO queries (ticket counts, etc.) |

### 4. Execution Domain (`apps/cli/src/lib/execution/`)

Agent work execution tracking and Docker container management.

| File | `.prepare()` | `.exec()` | Description |
|------|-------------|----------|-------------|
| `execution/storage.ts` | 21 | 1 | AgentWork + Container CRUD, status updates, listing |
| `execution/config.ts` | 3 | 0 | Execution settings read/write/delete |

### 5. Repository Management (`apps/cli/src/lib/repos/`)

| File | `.prepare()` | `.exec()` | Description |
|------|-------------|----------|-------------|
| `repos/index.ts` | 5 | 0 | Repo removal, worktree queries, agent worktree management |

### 6. Command Hotspots (`apps/cli/src/commands/`)

Commands that bypass the storage layer and use raw SQL directly:

| File | `.prepare()` | `.exec()` | Description |
|------|-------------|----------|-------------|
| `commands/ticket/epic.ts` | 8 | 0 | Epic-ticket association, direct SQL for epic queries |
| `commands/epic/ticket.ts` | 5 | 0 | Ticket-epic management, position updates |
| `commands/epic/project.ts` | 3 | 0 | Epic project reassignment |
| `commands/pmo/init.ts` | 6 | 0 | PMO initialization, settings, table drops |
| `commands/execution/config.ts` | 2 | 0 | Execution config read/write |
| `commands/ticket/reassign.ts` | 1 | 0 | Agent name lookup for reassignment |
| `commands/repo/view.ts` | 1 | 0 | Worktree listing for repos |
| `commands/branch/where.ts` | 1 | 0 | Agent worktree search |
| `commands/claude/index.ts` | 0 | 1 | Temp DB for MCP server |

## SQL Operation Types by File

### Schema DDL (CREATE/ALTER/DROP)
- `database/index.ts` - CREATE TABLE, ALTER TABLE, CREATE INDEX, PRAGMA
- `storage/base.ts` - CREATE TABLE, ALTER TABLE, CREATE INDEX
- `commands/pmo/init.ts` - DROP TABLE IF EXISTS

### DML Patterns
- **SELECT**: All storage files + most command hotspots
- **INSERT**: tickets, projects, epics, statuses, phases, labels, specs, subtasks, templates, actions, views, roadmaps, categories, dependencies
- **UPDATE**: tickets (position, status), statuses (reorder), phases (reorder), epics (position), agents (status)
- **DELETE**: All storage files support deletion; CASCADE handles most FK cleanup
- **INSERT OR REPLACE**: database/index.ts (repos, agents), pmo/index.ts (settings)
- **INSERT OR IGNORE**: database/index.ts (theme migration)
- **Transactions**: database/index.ts, tickets.ts, statuses.ts, phases.ts, base.ts

## Drizzle ORM Status

### Already Migrated
- `database/drizzle-schema.ts` - Full schema definitions (40+ tables)
- `database/drizzle.ts` - Connection wrapper (wraps better-sqlite3)

### Not Yet Migrated
- All storage modules still use raw `.prepare()` / `.exec()` / `.run()` / `.get()` / `.all()`
- All command hotspots use raw SQL
- No Drizzle query builder calls in production code

## Table Inventory

### Workspace Tables (7)
| Table | Defined In | Primary Storage |
|-------|-----------|-----------------|
| `workspace` | database/index.ts | database/index.ts |
| `repositories` | database/index.ts | database/index.ts, repos/index.ts |
| `agents` | database/index.ts | database/index.ts |
| `agent_worktrees` | database/index.ts | database/index.ts |
| `agent_themes` | database/index.ts | database/index.ts |
| `agent_theme_names` | database/index.ts | database/index.ts |
| `workspace_settings` | database/index.ts | database/index.ts |

### PMO Tables (30+)
| Table | Defined In | Primary Storage |
|-------|-----------|-----------------|
| `pmo_projects` | pmo/schema.ts | storage/projects.ts |
| `pmo_tickets` | pmo/schema.ts | storage/tickets.ts |
| `pmo_subtasks` | pmo/schema.ts | storage/subtasks.ts |
| `pmo_ticket_acceptance_criteria` | pmo/schema.ts | storage/subtasks.ts |
| `pmo_ticket_dependencies` | pmo/schema.ts | storage/dependencies.ts |
| `pmo_spec_dependencies` | pmo/schema.ts | storage/dependencies.ts |
| `pmo_epic_dependencies` | pmo/schema.ts | storage/dependencies.ts |
| `pmo_specs` | pmo/schema.ts | storage/specs.ts |
| `pmo_ticket_specs` | pmo/schema.ts | storage/specs.ts |
| `pmo_project_specs` | pmo/schema.ts | storage/specs.ts |
| `pmo_epics` | pmo/schema.ts | storage/epics.ts |
| `pmo_workflows` | pmo/schema.ts | storage/statuses.ts |
| `pmo_workflow_statuses` | pmo/schema.ts | storage/statuses.ts |
| `pmo_phases` | pmo/schema.ts | storage/phases.ts |
| `pmo_phase_templates` | pmo/schema.ts | storage/phases.ts |
| `pmo_categories` | pmo/schema.ts | storage/categories.ts |
| `pmo_labels` | pmo/schema.ts | storage/labels.ts |
| `pmo_label_groups` | pmo/schema.ts | storage/labels.ts |
| `pmo_ticket_labels` | pmo/schema.ts | storage/labels.ts |
| `pmo_board_views` | pmo/schema.ts | storage/views.ts |
| `pmo_actions` | pmo/schema.ts | storage/actions.ts |
| `pmo_ticket_templates` | pmo/schema.ts | storage/templates.ts |
| `pmo_roadmaps` | pmo/schema.ts | storage/roadmaps.ts |
| `pmo_roadmap_projects` | pmo/schema.ts | storage/roadmaps.ts |
| `pmo_settings` | pmo/schema.ts | pmo/index.ts |
| `pmo_cache_metadata` | pmo/schema.ts | storage/index.ts |
| `pmo_initiatives` | pmo/schema.ts | (minimal usage) |
| `pmo_ticket_metadata` | pmo/schema.ts | (minimal usage) |
| `pmo_ticket_affected_paths` | pmo/schema.ts | (minimal usage) |
| `pmo_ticket_assignments` | pmo/schema.ts | (minimal usage) |
| `id_sequences` | pmo/schema.ts | pmo/utils.ts |
| `agent_work` | pmo/schema.ts | execution/storage.ts |
| `containers` | pmo/schema.ts | execution/storage.ts |

### Legacy/Deprecated Tables (3)
| Table | Status |
|-------|--------|
| `pmo_columns` | DEPRECATED - use workflow_statuses |
| `pmo_board_tickets` | DEPRECATED - tickets use status_id directly |
| `pmo_statuses` | DEPRECATED - use workflow_statuses |
