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
./test-cli.sh       # Run CLI tests
```
