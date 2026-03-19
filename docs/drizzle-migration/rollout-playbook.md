# ORM Migration Rollout Playbook

> Step-by-step guide for rolling out the raw-SQL → Drizzle ORM migration
> and rolling back if a problem is detected.
>
> Companion to: [migration-order.md](./migration-order.md) · [sql-inventory.md](./sql-inventory.md) · [migration-checklist.template.md](./migration-checklist.template.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Pre-Rollout Checklist](#pre-rollout-checklist)
3. [Rollout Procedure](#rollout-procedure)
4. [Validation Gates](#validation-gates)
5. [Rollback Procedure](#rollback-procedure)
6. [Incident Response](#incident-response)
7. [Phase-Specific Notes](#phase-specific-notes)
8. [FAQ](#faq)

---

## Overview

### What is changing

The proletariat CLI is migrating its data-access layer from **raw better-sqlite3
`.prepare()` calls** to the **Drizzle ORM query builder**. The underlying SQLite
database file, schema, and migration system remain unchanged.

### What is NOT changing

| Unchanged | Details |
|-----------|---------|
| Database engine | SQLite via better-sqlite3 (no change) |
| Schema definitions | Tables, columns, indexes, constraints stay the same |
| Migration system | Custom `migrator.ts` with `prlt_migrations` table (not switching to drizzle-kit push) |
| Database file location | `.proletariat/workspace.db` |
| Public CLI behavior | All commands produce the same output |

### Risk profile

The migration replaces **how queries are built** (string SQL → Drizzle query builder)
but does not alter the database schema. This limits the blast radius to:

- **Query correctness** — a Drizzle expression could generate different SQL than the
  original hand-written statement.
- **Performance** — Drizzle adds a thin abstraction; most operations should be within
  noise, but complex joins or filters could regress.
- **Type coercion** — Drizzle's type inference may surface latent mismatches between
  JS types and SQLite affinity types.

---

## Pre-Rollout Checklist

Complete **every item** before merging a migration phase to `main`.

### Code review

- [ ] Each migrated module has a 1:1 diff showing the old `.prepare()` call
      alongside the new Drizzle expression.
- [ ] No new `.prepare()` or `.exec()` calls are introduced (except in DDL/migration
      code which stays as raw SQL by design).
- [ ] Drizzle schema imports match the tables actually queried.
- [ ] SQL semantics preserved: `LOWER()`, `COALESCE()`, `LIKE`, `GLOB`, `NULL`
      handling, `ORDER BY`, `LIMIT` — all replicated in Drizzle equivalents.

### Testing

- [ ] **Regression suite passes**: `pnpm mocha test/unit/orm-migration-regression.test.ts`
- [ ] **Performance benchmarks pass**: `pnpm mocha --grep "@perf" test/unit/orm-migration-perf.test.ts`
- [ ] **Existing unit tests pass**: `pnpm test:unit`
- [ ] **Existing e2e tests pass**: `pnpm test:e2e`
- [ ] **Smoke tests pass**: `pnpm test:smoke`
- [ ] **Build succeeds**: `cd apps/cli && pnpm build`
- [ ] **Type-check succeeds**: `cd apps/cli && pnpm typecheck`

### Performance baseline (first phase only)

Before Phase 1 merges, record baseline numbers:

```bash
pnpm mocha --grep "@perf" test/unit/orm-migration-perf.test.ts 2>&1 | tee docs/drizzle-migration/perf-baseline.txt
```

Compare each subsequent phase against this baseline. Acceptable thresholds:

| Metric | Acceptable | Investigate | Block |
|--------|-----------|-------------|-------|
| Mean latency delta | < 20% | 20-50% | > 50% |
| p95 latency delta | < 30% | 30-75% | > 75% |
| New test failures | 0 | 0 | > 0 |

---

## Rollout Procedure

Each phase from [migration-order.md](./migration-order.md) is an independent,
shippable unit. Follow this procedure **per phase**.

### Step 1: Branch and implement

```bash
# Create feature branch from main
git checkout main && git pull
git checkout -b drizzle/phase-N-module-name

# Implement the migration (see migration-checklist.template.md)
# ... edit storage module, replace .prepare() with Drizzle ...
```

### Step 2: Validate locally

```bash
cd apps/cli

# Full validation suite
pnpm build
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm test:smoke

# Migration-specific tests
pnpm mocha test/unit/orm-migration-regression.test.ts
pnpm mocha --grep "@perf" test/unit/orm-migration-perf.test.ts
```

### Step 3: PR and review

- Title: `drizzle: migrate {module} to Drizzle ORM (Phase N.M)`
- Label: `orm-migration`
- Description: Include before/after code snippets for the most complex query
- CI must be green (all test suites)

### Step 4: Merge and monitor

```bash
# After PR approval and green CI
git checkout main && git pull
# Merge via GitHub UI (squash or merge commit)

# Tag the phase completion
git tag drizzle-phase-N-complete
```

### Step 5: Verify in production-like environment

After merge, verify with a real workspace database:

```bash
# In a test workspace or devcontainer
prlt ticket list
prlt ticket create --title "Smoke test" --column Backlog
prlt ticket show <ticket-id>
prlt board view
```

---

## Validation Gates

### Gate 1: Unit tests (automated)

All existing and new unit tests must pass.

```bash
pnpm test:unit
```

### Gate 2: Regression suite (automated)

The ORM migration regression suite exercises every critical path through the
Drizzle layer.

```bash
pnpm mocha test/unit/orm-migration-regression.test.ts
```

### Gate 3: Performance benchmarks (automated)

Benchmark suite measures ticket create, view, list, and workspace reads.
Tests fail if mean latency exceeds generous ceilings.

```bash
pnpm mocha --grep "@perf" test/unit/orm-migration-perf.test.ts
```

### Gate 4: E2E smoke (automated)

Full CLI integration tests exercise commands end-to-end.

```bash
pnpm test:smoke
```

### Gate 5: Manual spot-check (human)

After merging a phase, spend 5 minutes using the CLI in a real workspace to
verify the migrated flows feel correct:

- Create a ticket → verify it appears on the board
- List tickets with filters → verify results match
- Move a ticket between columns → verify status changes
- Delete a ticket → verify it's gone

---

## Rollback Procedure

### When to rollback

Rollback if **any** of these occur after merging a phase:

1. A test suite that was green before the merge now fails
2. Users report data loss or incorrect query results
3. Performance benchmarks show > 50% regression on a key flow
4. A constraint violation that wasn't present before

### How to rollback

Since the migration changes **code only** (not the database schema), rollback
is a simple git revert:

```bash
# 1. Identify the merge commit
git log --oneline --merges -10

# 2. Revert the merge commit
git revert -m 1 <merge-commit-sha>

# 3. Push the revert
git push origin main

# 4. Verify tests pass on the reverted code
cd apps/cli && pnpm build && pnpm test:unit && pnpm test:e2e
```

### Why this is safe

- **No schema changes**: The Drizzle migration replaces query-building code only.
  The database file is unchanged. Reverting the code reverts to the old `.prepare()`
  calls which work against the same schema.
- **No data migration**: No rows are moved, transformed, or deleted. The same
  `workspace.db` works with both old and new code.
- **Drizzle connection is a wrapper**: `createDrizzleConnection(db)` wraps the
  existing better-sqlite3 instance. Removing Drizzle usage doesn't affect the
  underlying connection.

### Partial rollback (single module)

If only one module is problematic:

```bash
# Revert just the file(s) from the phase
git checkout main~1 -- apps/cli/src/lib/pmo/storage/<module>.ts
git commit -m "revert: rollback <module> Drizzle migration"
git push origin main
```

---

## Incident Response

### Symptoms and diagnosis

| Symptom | Likely cause | Diagnosis command |
|---------|-------------|-------------------|
| "UNIQUE constraint failed" on create | Drizzle type coercion generating different ID | Check `pmoTickets.id` value in Drizzle insert |
| Missing tickets in list | WHERE clause difference (NULL handling, LOWER()) | Compare raw SQL vs Drizzle-generated SQL with `.toSQL()` |
| Wrong sort order | ORDER BY not matching original | Check `orderBy()` arguments against original SQL |
| "no such column" error | Schema import mismatch | Verify drizzle-schema.ts matches actual table |
| Performance regression | Missing index or extra round-trips | Run perf tests, check query plan with `EXPLAIN QUERY PLAN` |

### Debugging Drizzle queries

To see the SQL that Drizzle generates:

```typescript
// Instead of .all() or .get(), use .toSQL() to inspect
const query = ctx.drizzle
  .select()
  .from(pmoTickets)
  .where(eq(pmoTickets.id, 'TKT-001'))
  .toSQL();

console.log(query.sql);    // The SQL string
console.log(query.params); // Bound parameters
```

### Emergency: direct database inspection

```bash
# Open the workspace database directly
sqlite3 .proletariat/workspace.db

# Check table contents
.tables
SELECT COUNT(*) FROM pmo_tickets;
SELECT * FROM pmo_tickets LIMIT 5;

# Check query plan
EXPLAIN QUERY PLAN SELECT * FROM pmo_tickets WHERE status_id = 'xxx';
```

---

## Phase-Specific Notes

### Phase 1: Actions, Templates, Categories, Roadmaps

- **Risk**: Low — simple CRUD, no cross-table joins
- **Rollback**: Revert individual module files
- **Key validation**: `pnpm test:unit` (pmo-storage, pmo-templates tests)

### Phase 2: Labels, Phases, Views, Helpers

- **Risk**: Medium — position management (gapped integers)
- **Watch for**: Position gaps collapsing, sort order changes
- **Key validation**: Test reorder operations, verify gapped positions

### Phase 3: Specs, Epics, Projects, Dependencies

- **Risk**: Medium — cross-table foreign keys
- **Watch for**: CASCADE delete behavior, FK constraint errors
- **Key validation**: Create ticket with epic → delete epic → verify ticket survives

### Phase 4: Subtasks, Statuses, Tickets, Board/Index

- **Risk**: High — most complex modules, highest query count
- **Watch for**: Ticket list filters, status transitions, position management
- **Key validation**: Full regression suite + performance benchmarks
- **Recommendation**: Ship Tickets and Statuses as separate PRs, not batched

### Phase 5: PMO Support + Base

- **Risk**: Mixed — utils are low-risk, base.ts (DDL) should stay raw SQL
- **Watch for**: ID generation changes in `generateEntityId()`
- **Note**: `base.ts` schema init and seed operations may remain as raw SQL

### Phase 6: Workspace Domain

- **Risk**: High — core database init, agent lifecycle
- **Watch for**: `openWorkspaceDatabase()` migration runner, agent type detection
- **Key validation**: `pnpm test:unit` (execution-storage, session-store tests)

### Phase 7: Command Hotspot Cleanup

- **Risk**: Low — moving SQL from commands into storage methods
- **Watch for**: Commands that bypass the storage layer for performance
- **Key validation**: E2E tests for affected commands

---

## FAQ

### Q: Does this change the database file format?

No. The SQLite database file (`.proletariat/workspace.db`) is unchanged. The
same file works with both raw SQL and Drizzle ORM code. There are no schema
migrations associated with this change.

### Q: Can I run old and new code against the same database?

Yes. Since the schema is identical, both code versions read/write the same
tables with the same column types. This is what makes rollback safe.

### Q: What if Drizzle generates slower SQL?

The performance benchmarks (`@perf` tests) detect regressions. If a specific
query is slower, you can:
1. Use `.toSQL()` to inspect the generated SQL
2. Compare with the original hand-written SQL via `EXPLAIN QUERY PLAN`
3. Optimize the Drizzle expression or add an index
4. As a last resort, keep that specific query as raw SQL using `sql\`...\``

### Q: Should DDL operations (CREATE TABLE, ALTER TABLE) be migrated?

No. DDL operations in `base.ts` and `migrator.ts` should remain as raw SQL.
Drizzle's migration tooling (`drizzle-kit`) is not used in this project — the
custom migration system is preferred.

### Q: How do I add a new regression test?

Add a new `it()` block in `test/unit/orm-migration-regression.test.ts`. Follow
the existing pattern: create test data, exercise the migrated code path, assert
the expected result matches the pre-migration behavior.

### Q: What's the timeline?

Each phase is independent and can be shipped whenever ready. There is no
hard deadline — correctness and safety take priority over speed. See
[migration-order.md](./migration-order.md) for the recommended sequence.
