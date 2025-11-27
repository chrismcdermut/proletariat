# Proletariat CLI - Test Suite Documentation

## Overview

This test suite provides comprehensive integration testing for all Proletariat CLI commands. Each command and its various scenarios are tested to ensure correct functionality.

## Test Structure

```
test/
├── integration/          # Integration tests for CLI commands
│   ├── init.integration.test.ts       # prlt init tests
│   ├── agent.integration.test.ts      # Agent management tests
│   ├── repo.integration.test.ts       # Repository management tests
│   ├── ticket.integration.test.ts     # Ticket/PMO tests
│   └── maintenance.integration.test.ts # Maintenance command tests
├── helpers/              # Test utilities
│   └── test-environment.ts   # Test environment setup helper
├── setup/               # Jest setup files
│   ├── integration.setup.ts   # Per-test setup
│   ├── global.setup.ts        # Global test setup
│   └── global.teardown.ts     # Global test cleanup
└── README.md           # This file
```

## Running Tests

### Quick Start
```bash
# Run all tests
npm run test:all

# Run only integration tests
npm run test:integration

# Run with coverage
npm run test:integration:coverage

# Watch mode for development
npm run test:integration:watch

# Using the test runner script
./scripts/run-tests.sh all
./scripts/run-tests.sh integration
./scripts/run-tests.sh coverage
```

### Test Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run test:all` | Run both unit and integration tests |
| `npm run test:integration:coverage` | Run integration tests with coverage |
| `npm run test:integration:watch` | Run integration tests in watch mode |
| `./scripts/run-tests.sh` | Comprehensive test runner with options |

## Test Coverage

### Commands Tested

✅ **Setup & Configuration**
- `prlt init` - All modes (simple, HQ, themes)
- `prlt upgrade` - Config version upgrades
- `prlt migrate` - Repository migration to HQ

✅ **Agent Management**
- `prlt agent add` - Single and multiple agents
- `prlt agent remove` - Agent removal
- `prlt agent list` - Status display
- `prlt agent grant` - Repository access
- `prlt agent revoke` - Access removal
- `prlt agent switch` - Workspace navigation

✅ **Repository Management**
- `prlt repo add` - Clone, import, create
- `prlt repo remove` - Repository removal
- `prlt repo list` - Repository listing

✅ **Ticket Management**
- `prlt pmo:init` - PMO initialization
- `prlt ticket create` - Ticket creation
- `prlt ticket claim` - Ticket assignment
- `prlt ticket complete` - Ticket completion
- `prlt ticket list` - Ticket display

✅ **Theme Commands**
- Billionaires: `hire`, `fire`, `staff`
- Cars: `drive`, `park`, `garage`
- Companies: `buy`, `sell`, `portfolio`

✅ **Maintenance**
- `prlt repair` - Worktree repair
- `prlt health` - Health checks
- `prlt go`/`switch` - Navigation
- `prlt access` - Access management
- `prlt themes` - Theme listing
- `prlt list` - Agent listing

### Scenarios Tested

Each command is tested for:
- ✅ Happy path scenarios
- ✅ Error handling
- ✅ Edge cases
- ✅ HQ vs Simple mode behavior
- ✅ Theme-specific behavior
- ✅ File system operations
- ✅ Git operations
- ✅ Configuration management

## Test Environment Helper

The `TestEnvironment` class provides utilities for:
- Creating isolated test directories
- Setting up git repositories
- Creating HQ structures
- Managing test files
- Executing CLI commands
- Cleaning up after tests

### Example Usage
```typescript
const env = new TestEnvironment('my-test');
env.initGit();
env.setupHQ('TestHQ', 'billionaires');
env.addRepoToHQ('TestHQ', 'test-repo');
env.createAgentWorkspace('TestHQ', 'bezos');

// Run CLI command
const output = env.prlt('agent list');

// Cleanup
env.cleanup();
```

## Writing New Tests

### Test Template
```typescript
describe('Command Name - Integration Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = new TestEnvironment('test-prefix');
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('specific feature', () => {
    it('should do something', () => {
      // Setup
      env.setupHQ('TestHQ', 'billionaires');
      
      // Execute
      const output = env.prlt('command args');
      
      // Assert
      expect(output).toContain('expected');
      expect(env.exists('path')).toBe(true);
    });
  });
});
```

### Best Practices

1. **Isolation**: Each test uses its own temp directory
2. **Cleanup**: Always cleanup in `afterEach`
3. **Real Operations**: Tests perform actual file/git operations
4. **Clear Assertions**: Test both output and file system state
5. **Error Testing**: Include negative test cases
6. **Documentation**: Comment complex test scenarios

## Coverage Goals

| Metric | Current | Target |
|--------|---------|--------|
| Line Coverage | ~60% | 80%+ |
| Function Coverage | ~70% | 90%+ |
| Branch Coverage | ~50% | 70%+ |
| Command Coverage | 100% | 100% |

## Continuous Integration

Add to your CI pipeline:
```yaml
# Example GitHub Actions
- name: Run Tests
  run: |
    npm ci
    npm run build
    npm run test:all
    
- name: Upload Coverage
  run: npm run test:integration:coverage
```

## Troubleshooting

### Common Issues

**Build not found**
```bash
# Solution: Build before testing
npm run build
npm run test:integration
```

**Permission errors**
```bash
# Solution: Ensure temp directory is writable
chmod -R 755 .test-tmp
```

**Git errors**
```bash
# Solution: Configure git for tests
git config --global user.email "test@example.com"
git config --global user.name "Test User"
```

## Future Improvements

- [ ] Add E2E tests with real git operations
- [ ] Add performance benchmarks
- [ ] Add stress tests for large HQs
- [ ] Add mutation testing
- [ ] Add visual regression tests for output
- [ ] Add cross-platform testing (Windows, Linux)
- [ ] Add parallel test execution
- [ ] Add test data generators

## Contributing

When adding new commands:
1. Add integration tests in appropriate test file
2. Update this README with new coverage
3. Ensure all scenarios are tested
4. Run full test suite before committing
5. Update COMMANDS.md if adding new commands