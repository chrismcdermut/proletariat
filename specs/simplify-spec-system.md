# Simplify Spec System

## Problem

Current spec system is overengineered for system documentation (abilities, modalities, implementations) when we need simple product/technical specs that generate tickets.

- 7 database tables for specs
- Complex parsing for abilities tables
- Not used for its intended purpose
- Specs should be living decision docs, not system documentation

## Solution

Specs become simple content stored in DB with markdown export/import for git sync.

- 2 tables instead of 7 (specs, spec_tickets)
- Simple format: Problem, Solution, Decisions, Not Now, Tickets
- DB is source of truth, files are views (like board.md)
- Tickets reference specs, specs don't track ticket status

## Decisions

- Specs store content in DB (not just file paths)
- Spec format: Problem, Solution, Decisions, Not Now, Context
- Tickets section uses checkbox syntax for deterministic parsing
- Files are exportable/importable views, git-syncable
- Remove abilities, modalities, implementations, fields, rules, relations
- Tickets point to specs (via label/link), not embedded in spec
- Agent spawner should respect ticket dependencies

## Not Now

- AI-assisted spec writing
- Spec templates
- Spec versioning/history
- Bidirectional sync (start with manual export/import)

## New Schema

```sql
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'draft',  -- draft, active, implemented
  problem TEXT,
  solution TEXT,
  decisions TEXT,
  not_now TEXT,
  context TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE spec_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id TEXT REFERENCES specs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  external_id TEXT,         -- Linear ABC-123
  done BOOLEAN DEFAULT false,
  position INTEGER
);
```

## Tickets

### Schema & DB

- [ ] Create new specs table schema (schema.ts)
- [ ] Create new spec_tickets table schema (schema.ts)
- [ ] Update storage-sqlite.ts for new spec methods (depends: schema)
- [ ] Add migration to drop old spec_* tables (depends: all others done)

### Types

- [ ] Simplify Spec interface in types.ts (depends: schema)
- [ ] Remove SpecAbility, SpecImplementation, SpecField, SpecRule, SpecRelation (depends: Spec interface)
- [ ] Remove/simplify spec-types.ts (depends: types cleanup)

### Parser

- [ ] Rewrite spec-parser.ts for new simple format (depends: types)
- [ ] Parse tickets from checkbox syntax (depends: parser rewrite)

### Commands

- [ ] Update `spec create` for new format (depends: storage, parser)
- [ ] Update `spec view` for new format (depends: storage, parser)
- [ ] Update `spec list` for new format (depends: storage)
- [ ] Simplify `spec generate-tickets` (depends: storage, parser)
- [ ] Remove `spec sync` command
- [ ] Remove `spec index` command
- [ ] Add `spec export` command (depends: storage, parser)
- [ ] Add `spec import` command (depends: storage, parser)
- [ ] Update or remove `spec link` command (depends: storage)

### Cleanup

- [ ] Remove modality constants and types
- [ ] Remove DomainSpec, InfrastructureSpec distinction
- [ ] Update PMOStorage interface for new spec methods
- [ ] Update tests for new spec format (depends: all others)

### Agent Enhancement

- [ ] Make agent spawner respect ticket dependencies (independent)
