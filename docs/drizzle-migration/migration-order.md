# Drizzle Migration Order

> Module-by-module migration order from raw better-sqlite3 to Drizzle ORM.
> Each phase is independent and can be shipped + verified separately.

## Repository Boundaries

The Drizzle data layer is organized into two domains:

### PMO Domain (`apps/cli/src/lib/pmo/storage/`)
All project management operations: tickets, projects, epics, workflows, statuses,
phases, specs, labels, templates, actions, roadmaps, categories, dependencies,
subtasks, views.

- **Schema source**: `apps/cli/src/lib/pmo/schema.ts` (SQL) + `database/drizzle-schema.ts` (Drizzle)
- **Storage layer**: 16 modules in `storage/` directory
- **Support files**: `pmo/utils.ts`, `pmo/index.ts`, `pmo/find-pmo.ts`, `pmo/diet.ts`

### Workspace Domain (`apps/cli/src/lib/database/`)
Core workspace config, agent lifecycle, theme management, repository tracking.

- **Schema source**: `database/index.ts` (SQL) + `database/drizzle-schema.ts` (Drizzle)
- **Single file**: `database/index.ts` (all CRUD in one file)
- **Related**: `repos/index.ts`, `execution/storage.ts`, `execution/config.ts`

---

## Migration Phases

### Phase 1: Low-risk, self-contained CRUD modules

These modules have simple CRUD patterns, few cross-table joins, and are
self-contained. Ideal for establishing migration patterns.

| Order | Module | File | `.prepare()` | Risk | Rationale |
|-------|--------|------|-------------|------|-----------|
| 1.1 | **Actions** | `storage/actions.ts` | 7 | Low | Simplest module, isolated table, no FK dependencies |
| 1.2 | **Templates** | `storage/templates.ts` | 9 | Low | Simple CRUD, single table, no FK dependencies |
| 1.3 | **Categories** | `storage/categories.ts` | 11 | Low | Simple CRUD, self-contained |
| 1.4 | **Roadmaps** | `storage/roadmaps.ts` | 15* | Low | Two tables but simple patterns |

*Roadmaps has 0 `.prepare()` but 15 `.run()` — uses pre-prepared statements from the class.

### Phase 2: Medium complexity with position management

These modules have reordering logic (gapped integers) which needs careful
migration to preserve position semantics.

| Order | Module | File | `.prepare()` | Risk | Rationale |
|-------|--------|------|-------------|------|-----------|
| 2.1 | **Labels** | `storage/labels.ts` | 20 | Medium | Groups + labels, position management |
| 2.2 | **Phases** | `storage/phases.ts` | 25 | Medium | Templates + phases, position reordering |
| 2.3 | **Views** | `storage/views.ts` | 19 | Medium | Board views with JSON filter storage |
| 2.4 | **Helpers** | `storage/helpers.ts` | 4 | Low | Utility functions, migrate alongside dependents |

### Phase 3: Core PMO entities with cross-table dependencies

These modules have foreign key relationships and more complex query patterns.

| Order | Module | File | `.prepare()` | Risk | Rationale |
|-------|--------|------|-------------|------|-----------|
| 3.1 | **Specs** | `storage/specs.ts` | 21 | Medium | Dependencies + project/ticket associations |
| 3.2 | **Epics** | `storage/epics.ts` | 15 | Medium | Position management + ticket FK |
| 3.3 | **Projects** | `storage/projects.ts` | 18 | Medium | Workflow FK, filtering, board integration |
| 3.4 | **Dependencies** | `storage/dependencies.ts` | 18 | Medium | Cross-entity deps (tickets, specs, epics) |

### Phase 4: High-complexity core modules

These are the most complex modules with the most SQL operations. They should
be migrated after patterns are well-established from earlier phases.

| Order | Module | File | `.prepare()` | Risk | Rationale |
|-------|--------|------|-------------|------|-----------|
| 4.1 | **Subtasks** | `storage/subtasks.ts` | 22 | High | Two tables (subtasks + acceptance criteria) |
| 4.2 | **Statuses** | `storage/statuses.ts` | 31 | High | Workflow management, reordering, defaults, cascading |
| 4.3 | **Tickets** | `storage/tickets.ts` | 38 | High | Most complex - filtering, position, status transitions |
| 4.4 | **Board/Index** | `storage/index.ts` | 19 | High | Orchestrates board ops, cache, status management |

### Phase 5: PMO support + base

| Order | Module | File | `.prepare()` | Risk | Rationale |
|-------|--------|------|-------------|------|-----------|
| 5.1 | **PMO utils** | `pmo/utils.ts` | 7 | Medium | ID generation, orphan reassignment |
| 5.2 | **PMO index** | `pmo/index.ts` | 3 | Low | Settings read/write |
| 5.3 | **PMO find** | `pmo/find-pmo.ts` | 3 | Low | PMO path lookup |
| 5.4 | **PMO diet** | `pmo/diet.ts` | 2 | Low | Lightweight queries |
| 5.5 | **Base** | `storage/base.ts` | 28+28 | High | Schema init, migrations, seeding — migrate last or keep raw SQL for DDL |

### Phase 6: Workspace domain

| Order | Module | File | `.prepare()` | Risk | Rationale |
|-------|--------|------|-------------|------|-----------|
| 6.1 | **Execution config** | `execution/config.ts` | 3 | Low | Simple settings |
| 6.2 | **Execution storage** | `execution/storage.ts` | 21 | Medium | Agent work + containers |
| 6.3 | **Repos** | `repos/index.ts` | 5 | Low | Repo + worktree queries |
| 6.4 | **Database/index** | `database/index.ts` | 47 | High | Core workspace — includes migrations, agent discovery |

### Phase 7: Command hotspot cleanup

After storage layers are migrated, refactor commands to use the storage API
instead of direct SQL.

| Order | Command | File | `.prepare()` | Approach |
|-------|---------|------|-------------|----------|
| 7.1 | `ticket epic` | `commands/ticket/epic.ts` | 8 | Move to storage/epics.ts or storage/tickets.ts |
| 7.2 | `epic ticket` | `commands/epic/ticket.ts` | 5 | Move to storage/epics.ts |
| 7.3 | `pmo init` | `commands/pmo/init.ts` | 6 | Move to storage/base.ts |
| 7.4 | `epic project` | `commands/epic/project.ts` | 3 | Move to storage/epics.ts |
| 7.5 | `execution config` | `commands/execution/config.ts` | 2 | Move to execution/config.ts |
| 7.6 | `ticket reassign` | `commands/ticket/reassign.ts` | 1 | Use database/index.ts API |
| 7.7 | `repo view` | `commands/repo/view.ts` | 1 | Use repos/index.ts API |
| 7.8 | `branch where` | `commands/branch/where.ts` | 1 | Use database/index.ts API |
| 7.9 | `claude index` | `commands/claude/index.ts` | 1 | Keep (temp DB for MCP) |

---

## Notes

- **DDL operations** (CREATE TABLE, ALTER TABLE, migrations) in `storage/base.ts` and
  `database/index.ts` may remain as raw SQL since Drizzle's migration tooling handles
  these separately via `drizzle-kit`.
- **Transactions** should be migrated to Drizzle's `db.transaction()` API.
- **Position management** (gapped integers: 1000, 2000, ...) is a pattern used across
  tickets, epics, statuses, phases, and labels. Consider a shared Drizzle helper.
- **Existing Drizzle schema** in `database/drizzle-schema.ts` already covers all tables
  and can be used as-is for the migration target.
