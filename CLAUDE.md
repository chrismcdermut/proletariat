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

Commands route through a configured **ticket provider** (Linear, Jira, local PMO), not hardcoded to local PMO.

- **Local PMO** is just the default provider for users without integrations — it is not a cache layer.
- **Linear is the source of truth** when configured — prlt reads and writes directly to Linear.

Provider implementations live in `apps/cli/src/lib/providers/`.

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
