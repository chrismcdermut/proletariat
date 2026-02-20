# Drizzle ORM Migration Playbook

Migration guide for transitioning the PMO data layer from raw `better-sqlite3` SQL to Drizzle ORM.

## Current State

| Module | Status | Notes |
|--------|--------|-------|
| `roadmaps.ts` | Migrated | Full Drizzle ORM |
| `tickets.ts` | Raw SQL | 38+ prepared statements |
| `projects.ts` | Raw SQL | 18+ prepared statements |
| `specs.ts` | Raw SQL | 21+ prepared statements |
| `epics.ts` | Raw SQL | 15+ prepared statements |
| `statuses.ts` | Raw SQL | 31+ prepared statements |
| `labels.ts` | Raw SQL | 20+ prepared statements |
| `subtasks.ts` | Raw SQL | 22+ prepared statements |
| `dependencies.ts` | Raw SQL | 18+ prepared statements |
| `views.ts` | Raw SQL | 19+ prepared statements |
| `templates.ts` | Raw SQL | 9+ prepared statements |
| `phases.ts` | Raw SQL | 25+ prepared statements |
| `actions.ts` | Raw SQL | 7+ prepared statements |
| `categories.ts` | Raw SQL | 11+ prepared statements |
| `base.ts` | Raw SQL | Migrations and seeding |

**Infrastructure**: Drizzle connection (`drizzle.ts`), full schema (`drizzle-schema.ts`), and `StorageContext` with dual `db`/`drizzle` access are already in place.

## Rollout Order

Migrate in order of risk (lowest first), validating each module before proceeding.

### Phase 1: Low-risk, read-heavy modules
1. **`actions.ts`** - 7 queries, simple CRUD, no joins
2. **`categories.ts`** - 11 queries, simple CRUD
3. **`templates.ts`** - 9 queries, simple CRUD

### Phase 2: Medium complexity
4. **`phases.ts`** - 25 queries, includes ordering/positioning
5. **`views.ts`** - 19 queries, JSON filter fields
6. **`labels.ts`** - 20 queries, multi-table (groups + labels + ticket_labels)

### Phase 3: Core entities
7. **`specs.ts`** - 21 queries, dependency relationships
8. **`epics.ts`** - 15 queries, project relationships
9. **`dependencies.ts`** - 18 queries, complex joins and blocking logic

### Phase 4: High-risk, critical path
10. **`subtasks.ts`** - 22 queries, ticket relationships
11. **`statuses.ts`** - 31 queries, workflow management
12. **`projects.ts`** - 18 queries, project resolver, board assembly
13. **`tickets.ts`** - 38 queries, most complex module (filters, joins, gapped positioning)

### Phase 5: Foundation
14. **`base.ts`** - Migration scripts and seeding (optional, may stay as raw SQL for DDL)

## Per-Module Migration Steps

For each module:

### 1. Prepare

```bash
# Create a feature branch
git checkout -b drizzle-migrate-<module-name>
```

### 2. Add Drizzle imports

Replace raw SQL patterns with Drizzle query builders:

```typescript
// Before (raw SQL)
import { PMO_TABLES } from '../schema.js'
const T = PMO_TABLES

// After (Drizzle ORM)
import { eq, and, like, or, desc, asc, sql } from 'drizzle-orm'
import {
  pmoTickets,
  pmoWorkflowStatuses,
  // ... other tables
} from '../../database/drizzle-schema.js'
```

### 3. Convert queries

**Simple SELECT:**
```typescript
// Before
this.ctx.db.prepare(`SELECT * FROM ${T.actions} WHERE id = ?`).get(id)

// After
this.ctx.drizzle.select().from(pmoActions).where(eq(pmoActions.id, id)).get()
```

**Filtered SELECT with dynamic conditions:**
```typescript
// Before
let query = `SELECT * FROM ${T.tickets} WHERE 1=1`
const params: unknown[] = []
if (filter?.priority) {
  query += ' AND priority = ?'
  params.push(filter.priority)
}
this.ctx.db.prepare(query).all(...params)

// After
let query = this.ctx.drizzle.select().from(pmoTickets).$dynamic()
const conditions = []
if (filter?.priority) {
  conditions.push(eq(pmoTickets.priority, filter.priority))
}
if (conditions.length > 0) {
  query = query.where(and(...conditions))
}
query.all()
```

**INSERT:**
```typescript
// Before
this.ctx.db.prepare(`INSERT INTO ${T.actions} (id, name, prompt) VALUES (?, ?, ?)`).run(id, name, prompt)

// After
this.ctx.drizzle.insert(pmoActions).values({ id, name, prompt }).run()
```

**UPDATE:**
```typescript
// Before
this.ctx.db.prepare(`UPDATE ${T.actions} SET name = ? WHERE id = ?`).run(name, id)

// After
this.ctx.drizzle.update(pmoActions).set({ name }).where(eq(pmoActions.id, id)).run()
```

**DELETE:**
```typescript
// Before
this.ctx.db.prepare(`DELETE FROM ${T.actions} WHERE id = ?`).run(id)

// After
this.ctx.drizzle.delete(pmoActions).where(eq(pmoActions.id, id)).run()
```

**Aggregate with raw SQL fallback:**
```typescript
// Before
this.ctx.db.prepare(`SELECT COALESCE(MAX(position), 0) as max FROM ${T.tickets} WHERE status_id = ?`).get(statusId)

// After
this.ctx.drizzle
  .select({ max: sql<number>`COALESCE(MAX(${pmoTickets.position}), 0)` })
  .from(pmoTickets)
  .where(eq(pmoTickets.statusId, statusId))
  .get()
```

**JOINs:**
```typescript
// Before
this.ctx.db.prepare(`
  SELECT t.*, ws.name as column_name
  FROM ${T.tickets} t
  LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
  WHERE t.id = ?
`).get(id)

// After
this.ctx.drizzle
  .select({
    ...getTableColumns(pmoTickets),
    columnName: pmoWorkflowStatuses.name,
  })
  .from(pmoTickets)
  .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
  .where(eq(pmoTickets.id, id))
  .get()
```

### 4. Run validation

```bash
# Build
cd apps/cli && pnpm build

# Run regression tests
pnpm mocha --forbid-only "test/unit/drizzle-migration-regression.test.ts"

# Run performance tests
pnpm mocha --forbid-only "test/unit/drizzle-migration-perf.test.ts"

# Run existing unit tests
pnpm test:unit

# Run PMO E2E tests
pnpm test:e2e:pmo
```

### 5. Commit and review

```bash
git add -A
prlt commit "migrate <module> to drizzle orm"
git push
```

## Rollback Procedure

If a regression is discovered after migration:

### Immediate Rollback (< 1 hour)

1. **Revert the commit:**
   ```bash
   git revert <commit-sha>
   pnpm build
   ```

2. **Verify rollback:**
   ```bash
   pnpm test:unit
   pnpm test:e2e:pmo
   ```

### Rollback After Multiple Commits

1. **Identify the pre-migration commit:**
   ```bash
   git log --oneline --all | grep "migrate"
   ```

2. **Create a rollback branch:**
   ```bash
   git checkout -b rollback-drizzle-<module>
   git revert --no-commit <migration-commits>...
   git commit -m "rollback: revert drizzle migration for <module>"
   ```

3. **Rebuild and test:**
   ```bash
   pnpm build && pnpm test:unit && pnpm test:e2e:pmo
   ```

### Rollback Safety

The migration is safe to rollback because:

- **No schema changes**: Drizzle ORM uses the same SQLite schema. The `drizzle-schema.ts` file defines types for existing tables - it does not alter them.
- **No data migration**: The ORM migration only changes how queries are constructed in TypeScript, not the underlying data format.
- **Dual access**: `StorageContext` provides both `db` (raw) and `drizzle` (ORM) connections. Reverting a module to raw SQL only requires changing the query code.
- **Same database file**: `workspace.db` is unchanged. No import/export is needed.

## Validation Checklist

Run for each migrated module:

- [ ] `pnpm build` passes with no type errors
- [ ] `pnpm test:unit` passes (all existing unit tests)
- [ ] `pnpm test:e2e:pmo` passes (all PMO E2E tests)
- [ ] `drizzle-migration-regression.test.ts` passes
- [ ] `drizzle-migration-perf.test.ts` shows no material regression (< 3x overhead)
- [ ] Manual smoke test: `prlt ticket list`, `prlt ticket view TKT-*`, `prlt ticket create`

## Performance Benchmarks

The `drizzle-migration-perf.test.ts` test suite measures:

| Operation | Description | Threshold |
|-----------|-------------|-----------|
| `ticket list (100)` | List 100 tickets with status joins | < 3x overhead |
| `ticket view (single)` | Retrieve single ticket with joins | < 3x overhead |
| `ticket create` | Insert ticket with position calculation | < 3x overhead |
| `work spawn selection` | Query backlog/unstarted tickets for work | < 3x overhead |
| `ticket list (filtered)` | List tickets with priority filter | < 3x overhead |
| `roadmap list (migrated)` | Baseline for already-migrated module | < 3x overhead |

**Accepted tradeoffs:**
- Drizzle ORM adds a query-building abstraction layer, which introduces small overhead (~1.1-1.5x typical).
- For SQLite with local files, absolute query times are sub-millisecond, so even 2-3x overhead is negligible for user-facing operations.
- The tradeoff is justified by: type safety, reduced SQL injection surface, better IDE support, and easier maintenance.

## Known Considerations

### `base.ts` Migration

`base.ts` contains DDL statements (CREATE TABLE, ALTER TABLE) and data migration scripts. These should likely remain as raw SQL because:
- Drizzle Kit handles schema migrations separately via `drizzle-kit push/generate`
- DDL statements are not well-suited to ORM query builders
- Migration scripts run once and benefit from explicit SQL control

### Transaction Handling

Raw SQL transactions:
```typescript
const txn = this.ctx.db.transaction(() => { ... })
txn()
```

Drizzle transactions:
```typescript
this.ctx.drizzle.transaction((tx) => {
  tx.insert(pmoTickets).values({...}).run()
  tx.update(pmoTickets).set({...}).where(eq(pmoTickets.id, id)).run()
})
```

Both use the same underlying `better-sqlite3` transaction mechanism.

### LOWER() Case-Insensitive Lookups

Several queries use `LOWER(t.id) = LOWER(?)` for case-insensitive matching. In Drizzle:
```typescript
.where(sql`LOWER(${pmoTickets.id}) = LOWER(${id})`)
```

Consider whether case-insensitive matching is needed for each field, as it prevents index usage.

## Test Artifacts

| File | Purpose |
|------|---------|
| `test/unit/drizzle-migration-regression.test.ts` | Validates raw SQL and Drizzle produce identical results |
| `test/unit/drizzle-migration-perf.test.ts` | Compares query performance between layers |
| `test/unit/pmo-storage.test.ts` | Existing storage tests (must continue passing) |
