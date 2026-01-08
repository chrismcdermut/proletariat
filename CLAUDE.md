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
