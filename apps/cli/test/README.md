# Test Suite

This directory contains all tests for the Proletariat CLI.

## Test Organization

```
test/
├── unit/              # Unit tests for individual modules
├── e2e/               # End-to-end tests for command workflows
├── commands/          # Command integration tests
└── tsconfig.json      # TypeScript config for tests
```

## Test Types

### Unit Tests (`test/unit/`)
Test individual modules and functions in isolation.

- `pmo-markdown.test.ts` - Markdown parsing/generation
- `pmo-storage.test.ts` - Database operations
- `pmo-templates.test.ts` - Template rendering
- `pmo-utils.test.ts` - Utility functions

### E2E Tests (`test/e2e/`)
Test actual command execution as users would interact with the CLI.

- `pmo-board-commands.test.ts` - Board CRUD operations (view, sync, export)
- `pmo-ticket-commands.test.ts` - Ticket CRUD and bulk operations
- `pmo-spec-commands.test.ts` - Spec management and ticket generation
- `pmo-board-views.test.ts` - Board filtering, grouping, and sorting

### Command Tests (`test/commands/`)
Integration tests for command behavior.

- `agent-commands.test.ts` - Agent management
- `agent.test.ts` - Agent execution
- `init.test.ts` - HQ initialization

## Running Tests

### All tests
```bash
pnpm test
```

### Unit tests only
```bash
pnpm test:unit
```

### E2E tests only
```bash
pnpm test:e2e
```

### PMO E2E tests only
```bash
pnpm test:e2e:pmo
```

### Command tests only
```bash
pnpm test:commands
```

## Writing Tests

### E2E Test Structure

E2E tests should:
1. Create a temporary test directory
2. Initialize test database with schema
3. Execute actual CLI commands via `execSync`
4. Verify database state and file system changes
5. Clean up after themselves

Example:

```typescript
describe('prlt ticket create', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    db = new Database(path.join(testDir, '.proletariat/workspace.db'));
    setupTestDatabase(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should create ticket with all flags', () => {
    const output = exec('ticket create --title "Test" --priority HIGH');

    expect(output).to.contain('Created ticket');

    const tickets = db.prepare('SELECT * FROM pmo_tickets').all();
    expect(tickets).to.have.lengthOf(1);
  });
});
```

## Test Coverage

See spec files in `pmo/projects/proletariat-kanban/specs/active/` for detailed command specifications:

- [pmo-board-commands.md](../../pmo/projects/proletariat-kanban/specs/active/pmo-board-commands.md)
- [pmo-ticket-commands.md](../../pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md)
- [pmo-spec-commands.md](../../pmo/projects/proletariat-kanban/specs/active/pmo-spec-commands.md)
- [pmo-board-views.md](../../pmo/projects/proletariat-kanban/specs/active/pmo-board-views.md)
