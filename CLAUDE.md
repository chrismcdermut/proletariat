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
- **Flags**: Use FlagResolver in `apps/cli/src/lib/flags/` for unified JSON/interactive handling

## Testing & Building

```bash
cd apps/cli && pnpm build   # Build CLI (ALWAYS run after code changes)
./test-cli.sh               # Run CLI tests
```

**Important:** Always verify the build passes after modifying TypeScript files in `apps/cli/`.

## UX Preferences

- **Never use Y/n confirm prompts** - Always use list selection (Yes/No choices) instead of typing y/n. This provides better UX with arrow key navigation.

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

**Use FlagResolver for unified human/machine handling.** This abstraction treats both interactive prompts and JSON mode as "flag producers", ensuring consistent behavior across modes.

### Preferred: FlagResolver Pattern

```typescript
import { FlagResolver } from '../../lib/flags/index.js'

// Create resolver with command context
const resolver = new FlagResolver({
  commandName: 'ticket create',
  baseCommand: 'prlt ticket create',
  flags: flags as Record<string, unknown>,
  jsonMode: shouldOutputJson(flags),
})

// Define flags declaratively
resolver
  .define({
    name: 'column',
    type: 'string',
    promptType: 'list',
    message: 'Select column:',
    required: true,
    priority: 1,  // Resolve first
    choices: () => columns.map(c => ({ name: c, value: c })),
  })
  .define({
    name: 'title',
    type: 'string',
    promptType: 'input',
    message: 'Enter title:',
    required: true,
    priority: 2,  // Resolve second
    when: (ctx) => !!ctx.resolved.column,  // Only after column
  })

// Resolve all flags
const result = await resolver.resolve()
if (!result.complete) {
  // JSON mode - prompt was output, exit
  return
}

// Use resolved values (works identically in both modes!)
const { column, title } = result.values
```

### FlagResolver Features

- **Unified handling**: Same code path for JSON and interactive modes
- **Priority ordering**: Control resolution order with `priority`
- **Conditional flags**: Use `when` clause for dependent flags
- **Async choices**: Load data dynamically with `choices: async () => ...`
- **Auto command generation**: JSON output includes follow-up commands for AI agents
- **Validation**: Use `validate` for input validation

### Flag Definition Options

```typescript
interface FlagDefinition {
  name: string           // CLI flag name (e.g., 'column')
  type: 'string' | 'boolean' | 'array'
  promptType?: 'list' | 'checkbox' | 'input' | 'confirm' | 'editor'
  message: string        // Prompt message
  required?: boolean     // Default: false
  default?: T           // Default value
  choices?: FlagChoice[] | (() => FlagChoice[] | Promise<FlagChoice[]>)
  when?: (ctx) => boolean  // Conditional resolution
  validate?: (value, ctx) => boolean | string
  priority?: number      // Lower = earlier (default: 100)
  flagArg?: string       // Override CLI arg format (e.g., '--skip-permissions')
  context?: object       // Extra data for JSON output
}
```

### When to Use FlagResolver

- **Use FlagResolver** for: Single flags, sequential prompts, flag-based decisions
- **Keep manual pattern** for: Complex control flow loops, state-dependent retries, nested conditionals

### Legacy Pattern (for complex control flow only)

For complex interactive loops with retry logic, the manual pattern may still be needed:

```typescript
// Only use when FlagResolver doesn't fit the control flow
if (jsonMode) {
  outputPromptAsJson(
    buildPromptConfig('list', 'fieldName', message, choices),
    createMetadata('command-name', flags)
  )
  return
}

const { fieldName } = await inquirer.prompt([{
  type: 'list',
  name: 'fieldName',
  message,
  choices,
}])
```
