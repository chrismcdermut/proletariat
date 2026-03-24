# Claude Code Context

## Build & Package Manager

**Use `pnpm` not `npm`**

```bash
pnpm install        # Install dependencies
pnpm run build      # Build all packages
pnpm -r build       # Build recursively
```

## Project Structure

This is a pnpm monorepo workspace:

```
apps/
  cli/              # Main CLI tool (prlt command)
    src/
      commands/     # oclif commands
      lib/          # Shared utilities
docs/               # Documentation
pmo/                # Project management office templates
scripts/            # Build and utility scripts
specs/              # Specification files
```

## Key Patterns

- **Commands**: Use oclif framework in `apps/cli/src/commands/`
- **Database**: SQLite via better-sqlite3 in `apps/cli/src/lib/database/`
- **Themes**: Optional agent naming themes in `apps/cli/src/lib/themes.ts`

## Testing

```bash
pnpm test            # Run all tests (unit + e2e)
pnpm test:unit       # Run unit tests only
pnpm test:e2e        # Run e2e tests only
pnpm test:smoke      # Run smoke tests
```

**Important:** Always verify the build passes after modifying TypeScript files in `apps/cli/`:

```bash
cd apps/cli && pnpm build
```

**Every bug fix PR MUST include a regression test** that fails if the fix is reverted.

## Command Code Rules

- **Never call `process.exit()` in command code** — let oclif handle lifecycle (use `return` instead).

## Provider Architecture

**All ticket operations MUST go through the `TicketProvider` interface** (`src/lib/providers/types.ts`). Never call PMO storage directly for ticket reads/writes.

- Use `resolveTicketProvider()` or `resolveProjectProvider()` from `src/lib/providers/resolver.ts` to get the correct provider
- **Local PMO** is just another provider (implements `TicketProvider`), not a cache or intermediary
- **Linear is the source of truth** when configured — prlt reads and writes directly to Linear API
- Never sync/mirror Linear data into PMO — they are parallel providers, not a pipeline

```typescript
// WRONG — bypasses provider, goes to PMO directly
import { PMOStorage } from '../../lib/pmo/storage.js'
const tickets = await storage.listTickets(projectId)

// RIGHT — goes through provider adapter to configured source
const provider = resolveProjectProvider(db, storage, projectId)
const result = await provider.listTickets(projectId, filter)
```

Provider implementations live in `apps/cli/src/lib/providers/`.

## Migrations

**Every schema change MUST have a migration.** If you add a table, column, or index, create a numbered migration in `apps/cli/src/lib/database/migrations/`. Never modify the schema with raw SQL outside of migrations.

## Database Access

**All database access MUST go through the DAL** (`src/lib/database/index.ts`). Never import `better-sqlite3` or the database driver directly.

```typescript
// WRONG — imports driver directly
import Database from 'better-sqlite3'
const db = new Database(dbPath)

// RIGHT — goes through DAL
import { openWorkspaceDatabase } from '../../lib/database/index.js'
const db = openWorkspaceDatabase(hqPath)
```

The DAL provides safety features: WAL mode, backups, integrity checks, auto-repair, and migrations.

## Branch Naming

Branch names use the **source ticket ID** (e.g., `PRLT-xxx`), not the internal PMO ID (`TKT-xxx`).

Format: `{ticketId}/{type}/{owner}/{agent}/{description}`

Example: `PRLT-123/feat/chris/altman/implement-auth`

## Workflow & Actions

- Actions wire to **specific state names** (`from_state`/`to_state`), not categories.
- The **workflow rules table** maps state transitions to actions with trigger types (`manual` | `on_enter`).

## Non-Interactive Mode

The `--yes` flag is being removed. Use the **`selection_needed` pattern** for non-interactive mode instead.

## Execution Environment

**Docker is the default execution environment** for agents.

## Release Process

**Version bumps should be PRs**, not direct pushes to main.

## Issue Tracking

**All GitHub issues should be tracked in Linear** with a comment linking back.

## UX Preferences

- **Never use Y/n confirm prompts** — always use list selection (Yes/No choices) instead of typing y/n. This provides better UX with arrow key navigation.

```typescript
// BAD - requires typing
const { confirmed } = await inquirer.prompt([{
  type: 'confirm',
  name: 'confirmed',
  message: 'Continue?',
}])

// GOOD - arrow key selection
const { confirmed } = await inquirer.prompt([{
  type: 'list',
  name: 'confirmed',
  message: 'Continue?',
  choices: [
    { name: 'Yes', value: true },
    { name: 'No', value: false },
  ],
}])
```

## JSON Mode for AI Agents

**When adding any `inquirer.prompt`, ALWAYS include the JSON output pattern.** This allows AI agents to receive prompt configs as JSON instead of interactive menus.

```typescript
// 1. Define choices and message ONCE (reuse for both modes)
const choices = [
  { name: 'Option A', value: 'a' },
  { name: 'Option B', value: 'b' },
]
const message = 'Select an option:'

// 2. Handle JSON mode FIRST - output prompt config and return
if (jsonMode) {
  outputPromptAsJson(
    buildPromptConfig('list', 'fieldName', message, choices),
    createMetadata('command-name', flags)
  )
  return
}

// 3. THEN do interactive prompt for humans
const { fieldName } = await inquirer.prompt([{
  type: 'list',
  name: 'fieldName',
  message,
  choices,
}])
```

**Never add an `inquirer.prompt` without the corresponding `outputPromptAsJson` block.**
