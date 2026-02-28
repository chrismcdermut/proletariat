# Migration Checklist: `[MODULE_NAME]`

> Template for migrating a storage module from raw better-sqlite3 to Drizzle ORM.
> Copy this file and fill in for each module migration.

## Module Info

- **File**: `apps/cli/src/lib/pmo/storage/[file].ts`
- **Tables**: [list tables touched]
- **Raw SQL call sites**: [count]
- **Migration phase**: [1-7]
- **Ticket**: TKT-XXXX

## Pre-Migration

- [ ] Read and understand all functions in the module
- [ ] Verify Drizzle schema in `database/drizzle-schema.ts` matches the raw SQL schema
- [ ] Identify all query patterns (SELECT, INSERT, UPDATE, DELETE, transactions)
- [ ] Identify position management / reordering logic (if any)
- [ ] Identify JSON serialization patterns (if any)
- [ ] Check for cross-module dependencies (other files importing from this module)
- [ ] List all callers of each exported function

## Migration Steps

- [ ] Import Drizzle schema tables and helpers
- [ ] Replace `.prepare(...).get()` with `db.select().from(table).where(...).get()`
- [ ] Replace `.prepare(...).all()` with `db.select().from(table).where(...).all()`
- [ ] Replace `.prepare(...).run()` INSERT with `db.insert(table).values(...)`
- [ ] Replace `.prepare(...).run()` UPDATE with `db.update(table).set(...).where(...)`
- [ ] Replace `.prepare(...).run()` DELETE with `db.delete(table).where(...)`
- [ ] Replace `.exec()` DDL with Drizzle migration or keep as raw SQL (DDL only)
- [ ] Migrate transactions to `db.transaction(tx => { ... })`
- [ ] Remove unused `better-sqlite3` imports
- [ ] Ensure type safety — remove manual `as Type` casts where Drizzle infers types

## Validation

- [ ] All existing unit tests pass
- [ ] All existing e2e tests pass
- [ ] Manual smoke test of affected commands
- [ ] Build passes (`pnpm run build` in `apps/cli/`)
- [ ] No new raw SQL introduced (run `pnpm run check:raw-sql`)
- [ ] Type-check passes (`pnpm run typecheck`)

## Post-Migration

- [ ] Remove legacy SQL strings (if fully replaced)
- [ ] Update SQL inventory (`docs/drizzle-migration/sql-inventory.md`)
- [ ] Mark module as completed in migration order doc
- [ ] Commit with message: `refactor(pmo): migrate [module] to Drizzle ORM`

## Notes

<!-- Add any module-specific notes, edge cases, or decisions here -->
