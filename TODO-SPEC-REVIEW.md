# Spec Review TODO

Session: 2026-01-02

## Goal

Refine specs → generate tickets → spawn agents → dogfood prlt

## Specs to Review (Priority Order)

### Tier 1: Core Loop

- [X] **specs** - Simplify to 2 tables (recreate tech-simplify-specs content)
- [ ] **tickets** - States (Linear-style)? Bulk ops already exist. Clean up.
- [ ] **work** - Consolidate start/spawn/spawn-all naming
- [ ] **agents** - Drop themes/status tracking for MVP?

### Tier 2: Important

- [ ] **dependencies** - Keep separate domain, cross-entity (specs, tickets, epics)
- [ ] **board** - One board + views? Linear-style states?
- [ ] **projects** - One board per project or views?
- [ ] **settings** - Implement or defer?

### Tier 3: Defer

- [ ] **epics** - Keep but don't prioritize
- [ ] **hooks** - Keep tabled
- [ ] **migrations** - DB schema migrations (versioned, up/down), command deprecations
- [ ] **repositories** - Seems fine
- [ ] **branches** - Seems fine
- [ ] **pull-requests** - Seems fine
- [ ] **executions** - Seems fine
- [ ] **workspace** - Seems fine
- [ ] **github** - Seems fine

## Key Decisions to Make

1. **Linear-style states?**

   - States: Backlog, Planned, In Progress, Done, Canceled
   - Statuses: custom labels within each state
   - Or keep current column-only model?
2. **One board + views vs multiple boards?**

   - Linear/Notion: one board, different views (kanban, list, etc.)
   - Current: one board per project
3. **Spawn command consolidation?**

   - `work start [ticket]` - single
   - `work start --all` - batch backlog
   - `work spawn --column X` - batch by column
   - Kill spawn-all.ts (redundant)
4. **Spec dependencies?**

   - Specs can depend on other specs
   - Generalized dependency table across entity types?

## Missing Content

The `tech-simplify-specs.md` file was deleted. Key content to recreate:

```sql
-- Proposed simple schema
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'draft',  -- draft, active, implemented
  problem TEXT,
  solution TEXT,
  decisions TEXT,
  not_now TEXT,
  context TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE spec_tickets (
  id INTEGER PRIMARY KEY,
  spec_id TEXT REFERENCES specs(id),
  title TEXT NOT NULL,
  external_id TEXT,  -- TKT-123
  done BOOLEAN DEFAULT false,
  position INTEGER
);
```

## Integration Specs to Create (Stubs)

- [ ] **linear** - Sync tickets/projects with Linear, import/export
- [ ] **jira** - Sync tickets/projects with Jira, import/export
- [ ] **notion** - Sync with Notion databases, import/export
- [ ] **asana** - Sync tasks/projects with Asana, import/export
- [ ] **monday** - Sync items/boards with Monday.com, import/export
- [ ] **shortcut** - Sync stories/epics with Shortcut, import/export

Common pattern for all:

- `prlt {integration} connect` - OAuth/API key setup
- `prlt {integration} sync` - Bidirectional sync
- `prlt {integration} import` - Pull from external
- `prlt {integration} export` - Push to external
- Map: tickets ↔ issues, columns ↔ statuses, epics ↔ epics

## After Spec Review

1. Generate tickets from refined specs
2. Move tickets to Backlog column
3. `prlt work spawn --column Backlog`
4. Review PRs
5. Iterate

## Architecture Notes

**HQ structure flexibility:**

- Currently requires `-hq` suffix and specific folder structure
- Should work with any repo structure (single repo, monorepo, multi-repo)
- Think about: `prlt init` in any directory, no naming conventions required
- Agents could be: local worktrees, remote VMs, cloud containers
- PMO could be: local SQLite, hosted DB, or external (Linear/Jira)

## Future Features

**Migration tooling:**

- DB schema migrations (versioned, up/down)
- Command renames/deprecations with aliases
- `prlt migrate` to run pending migrations

**CI/CD & Publishing:**

- Auto-deploy to npm on release
- GitHub Actions for build/test/publish
- Versioning strategy (semver)

**Claude Code integration:**

- `/spec` slash command - create a spec interactively
- `/ticket` slash command - create a ticket interactively
- Skills for common prlt workflows

**Natural language interface:**

- `prlt ask "what tickets are blocked?"`
- `prlt do "create a ticket for fixing the login bug"`
- Gen AI layer on top of CLI commands

**UX improvements:**

- Smooth Ctrl+C exit (graceful shutdown, no stack traces)
- Progress indicators for long operations
- Better error messages

## Notes from Session

- Bulk ticket ops DO exist under `prlt tickets` (drift report was wrong)
- Epics: keep but deprioritize for MVP
- Dependencies: keep as separate domain, works across entity types
- DB is source of truth, markdown files are views
- Spec status field not folder (`draft` → `active` → `implemented`)
