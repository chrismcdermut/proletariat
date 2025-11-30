# Development Scripts

Utility scripts for PMO development and testing.

## Scripts

### `export-board.mjs`
Exports the current board to board.md from the database.

**Usage:**
```bash
node scripts/export-board.mjs
```

### `register-specs.mjs`
Registers spec files in the database without generating tickets.

**Usage:**
```bash
node scripts/register-specs.mjs
```

**Use Case:** When you create new spec files and need to register them in the `pmo_specs` table before running `prlt spec generate-tickets`.

### `regenerate-all-tickets.mjs`
Deletes all tickets and regenerates them from all active specs.

**Usage:**
```bash
node scripts/regenerate-all-tickets.mjs
```

**⚠️ Warning:** This is destructive! It deletes all existing tickets.

### `test-roundtrip.mjs`
Tests markdown parsing and generation roundtrip.

**Usage:**
```bash
node scripts/test-roundtrip.mjs
```

**Purpose:** Validates that tickets can be exported to markdown and imported back without data loss.

### `test-ticket-format.mjs`
Tests the ticket ID and wikilink format.

**Usage:**
```bash
node scripts/test-ticket-format.mjs
```

**Purpose:** Validates the `**{id}** [[{id}]] {title}` format is correctly generated.

## Notes

- These scripts are development utilities, not production code
- They directly access the database and bypass normal CLI validation
- Use with caution in production environments
- Consider converting useful scripts into proper CLI commands

## Converting to CLI Commands

If a script becomes frequently used, consider converting it to a proper CLI command:

1. Create command in `apps/cli/src/commands/`
2. Add proper argument parsing with oclif
3. Add help text and examples
4. Add to SYSTEM_CARD.md
5. Write E2E tests

Example:
```typescript
// apps/cli/src/commands/board/regenerate.ts
import { Command, Flags } from '@oclif/core';

export default class BoardRegenerate extends Command {
  static description = 'Regenerate all tickets from specs';

  static flags = {
    force: Flags.boolean({ char: 'f', description: 'Skip confirmation' })
  };

  async run() {
    // Implementation from regenerate-all-tickets.mjs
  }
}
```
