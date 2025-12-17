---
title: CLI Testing Specification
status: active
created: 2024-12-16
---

# CLI Testing Specification

## Overview

This document tracks test coverage for the prlt CLI. Tests are organized into:
- **Unit tests**: Test individual functions/modules in isolation
- **E2E tests**: Test full command execution with real database
- **Command tests**: Test oclif command parsing and basic execution

## Running Tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test:unit

# E2E tests only
pnpm test:e2e

# PMO E2E tests
pnpm test:e2e:pmo

# Command tests
pnpm test:commands
```

## Test File Structure

```
test/
├── commands/           # Command parsing tests
│   ├── agent.test.ts
│   ├── agent-commands.test.ts
│   └── init.test.ts
├── e2e/               # End-to-end tests
│   ├── pmo-board-commands.test.ts
│   ├── pmo-board-views.test.ts
│   ├── pmo-epic-commands.test.ts
│   ├── pmo-spec-commands.test.ts
│   └── pmo-ticket-commands.test.ts
└── unit/              # Unit tests
    ├── pmo-markdown.test.ts
    ├── pmo-storage.test.ts
    ├── pmo-templates.test.ts
    └── pmo-utils.test.ts
```

---

## Coverage Status

### Legend
- ✅ Tested (test exists and passes)
- 🚧 Partial (some tests exist)
- ❌ Not tested
- ⏸️ Not applicable

---

## Ticket Commands

**Spec**: [ticket-commands.md](../cli/ticket-commands.md)
**Test file**: `test/e2e/pmo-ticket-commands.test.ts`

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt ticket` | ❌ | Interactive menu |
| `prlt ticket create` | ✅ | With flags, auto-generate ID, adds to board.md |
| `prlt ticket list` | ❌ | Basic list, filter by column/priority/assignee |
| `prlt ticket view` | ❌ | Show ticket details, subtasks |
| `prlt ticket move` | ✅ | Move between columns, update board.md |
| `prlt ticket delete` | 🚧 | With confirmation, with --force |

### Missing Tests
- [ ] `ticket list` with filters
- [ ] `ticket view` with subtasks display
- [ ] `ticket delete --force`
- [ ] Interactive mode for all commands

---

## Board Commands

**Spec**: [board-commands.md](../cli/board-commands.md)
**Test files**: `test/e2e/pmo-board-commands.test.ts`, `test/e2e/pmo-board-views.test.ts`

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt board` | ❌ | Interactive menu |
| `prlt board view` | 🚧 | Basic view, column display |
| `prlt board sync` | 🚧 | Export/import, dry-run |
| `prlt board open` | ❌ | Opens in Obsidian |
| `prlt board markdown` | 🚧 | Valid format output |

### Missing Tests
- [ ] `board view` with filters (--assignee, --priority)
- [ ] `board sync` conflict detection
- [ ] `board open` (platform-specific)

---

## Spec Commands

**Spec**: [spec-commands.md](../cli/spec-commands.md)
**Test file**: `test/e2e/pmo-spec-commands.test.ts`

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt spec` | ❌ | Interactive menu |
| `prlt spec create` | 🚧 | Basic creation, templates |
| `prlt spec list` | 🚧 | List all specs |
| `prlt spec view` | 🚧 | View content, --full flag |

### Missing Tests
- [ ] All templates (feature, architecture, api)
- [ ] `spec view --full`

---

## Epic Commands

**Spec**: [epic-commands.md](../cli/epic-commands.md)
**Test file**: `test/e2e/pmo-epic-commands.test.ts`

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt epic` | ❌ | Interactive menu |
| `prlt epic create` | 🚧 | Basic creation |
| `prlt epic list` | 🚧 | List with status filter |
| `prlt epic view` | ❌ | Show progress, linked tickets |

### Missing Tests
- [ ] Epic progress calculation
- [ ] Epic status transitions
- [ ] Linking epic to spec

---

## Work Commands

**Spec**: [execute-commands.md](../cli/execute-commands.md)
**Test file**: None (needs creation)

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt work start` | ❌ | Environment selection, display mode, permission mode |
| `prlt work ready` | ❌ | Move to review, mark execution completed |
| `prlt work complete` | ❌ | Move to done, update execution |
| `prlt work claim` | ❌ | Take ownership, assign to agent |
| `prlt work assign` | ❌ | Assign to agent |
| `prlt work own` | ❌ | Take accountability |

### Missing Tests (Priority: HIGH)
- [ ] `work start` with host environment
- [ ] `work start` permission mode selection
- [ ] `work ready` marks execution as completed
- [ ] `work complete` clears agent
- [ ] Agent busy checking prevents double-booking

---

## Execution Commands

**Spec**: [execute-commands.md](../cli/execute-commands.md)
**Test file**: None (needs creation)

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt execution list` | ❌ | List running, filter by status/agent |
| `prlt execution logs` | ❌ | View logs, --follow |
| `prlt execution stop` | ❌ | Stop by ID, --force |

### Missing Tests
- [ ] All execution commands need tests

---

## Agent Commands

**Spec**: [agent-commands.md](../cli/agent-commands.md)
**Test files**: `test/commands/agent.test.ts`, `test/commands/agent-commands.test.ts`

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt agents` | 🚧 | List agents |
| `prlt agents add` | 🚧 | Add agent with worktree |
| `prlt agents remove` | 🚧 | Remove with confirmation |

### Missing Tests
- [ ] Worktree creation/cleanup
- [ ] Agent busy state

---

## Init Commands

**Spec**: [init-commands.md](../cli/init-commands.md)
**Test file**: `test/commands/init.test.ts`

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt init` | 🚧 | Initialize workspace |

---

## Branch Commands

**Spec**: [branch-commands.md](../cli/branch-commands.md)
**Test file**: None

| Command | Status | Test Cases |
|---------|--------|------------|
| `prlt branch` | ❌ | Interactive menu |
| `prlt branch create` | ❌ | Create from ticket |

---

## Unit Tests

**Test directory**: `test/unit/`

| Module | Status | Test Cases |
|--------|--------|------------|
| `pmo-storage.ts` | 🚧 | CRUD operations, queries |
| `pmo-markdown.ts` | 🚧 | Parse/generate board.md |
| `pmo-templates.ts` | 🚧 | Spec templates |
| `pmo-utils.ts` | 🚧 | Utility functions |

### Missing Unit Tests
- [ ] `execution/storage.ts` - Execution CRUD
- [ ] `execution/runners.ts` - Runner functions
- [ ] `agents/commands.ts` - Agent operations

---

## Testing Priorities

### P0 - Critical (Test Now)
1. `work start` - Core agent execution flow
2. `work ready` / `work complete` - Execution lifecycle
3. Agent busy checking - Prevent double-booking

### P1 - Important
1. `execution list/logs/stop` - Execution management
2. `ticket list` - Basic querying
3. All interactive menus

### P2 - Nice to Have
1. Board view filters
2. Template variations
3. Platform-specific tests (terminal apps)

---

## Test Patterns

### E2E Test Structure

```typescript
describe('Command E2E Tests', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(() => {
    // Create temp directory
    // Initialize test database
    // Setup PMO structure
  });

  afterEach(() => {
    // Cleanup temp directory
    // Close database
  });

  it('should do something', () => {
    const output = exec('command args');
    expect(output).to.contain('expected');
    // Verify database state
  });
});
```

### Mocking Interactive Prompts

For testing interactive commands, use environment variables or test mode:

```typescript
// In test
process.env.PRLT_TEST_MODE = 'true';
process.env.PRLT_TEST_TICKET_ID = 'TKT-001';

// In command
if (process.env.PRLT_TEST_MODE) {
  ticketId = process.env.PRLT_TEST_TICKET_ID;
} else {
  // Interactive prompt
}
```

### Testing Execution Runners

Mock external commands (claude, docker, ssh):

```typescript
import * as sinon from 'sinon';
import * as child_process from 'child_process';

const spawnStub = sinon.stub(child_process, 'spawn');
spawnStub.returns({
  pid: 12345,
  on: (event, cb) => { /* mock */ }
});
```

---

## Adding New Tests

1. Create test file in appropriate directory (`test/unit/`, `test/e2e/`, `test/commands/`)
2. Reference the spec being tested in file header
3. Update this document with coverage status
4. Update SYSTEM_CARD.md 🧪 column

---

## CI Integration

Tests run on:
- Pre-commit hooks (unit tests only)
- Pull request (all tests)
- Main branch merge (all tests + coverage)

```yaml
# .github/workflows/test.yml
- run: pnpm test
- run: pnpm test:coverage
```
