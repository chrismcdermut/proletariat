# Test Coverage Assessment for Proletariat CLI

## Current Test Status

### ✅ What's Currently Tested
- **`initProject` function** (`src/lib/worktree/__tests__/init.test.ts`)
  - HQ mode initialization
  - Simple mode initialization
  - Directory structure creation
  - Config file generation
  - PMO initialization
  - Git remote cloning
  - Error handling
  - Backwards compatibility

### ❌ What's NOT Currently Tested

#### 1. Manager Classes (NEW - No tests yet)
- [ ] `AgentManager` 
  - [ ] add()
  - [ ] remove()
  - [ ] list()
  - [ ] grant()
  - [ ] revoke()
  - [ ] switch()
- [ ] `RepoManager`
  - [ ] add() with different sources (clone/existing/new)
  - [ ] remove()
  - [ ] list()
- [ ] `TicketManager`
  - [ ] create()
  - [ ] claim()
  - [ ] complete()
  - [ ] list()
- [ ] Factory function `getManagers()`

#### 2. CLI Commands (`src/bin/prlt.ts`)
- [ ] Standard commands (agent, repo, ticket)
- [ ] Theme aliases (hire/fire, drive/park, buy/sell)
- [ ] Interactive mode prompts
- [ ] Command routing and argument parsing
- [ ] Error handling for missing HQ

#### 3. Core Functionality
- [ ] Worktree operations (create, remove, repair)
- [ ] Config management (load, save, upgrade)
- [ ] Theme system
- [ ] Agent access control
- [ ] PMO operations
- [ ] Git operations

#### 4. Utilities
- [ ] Logger functions
- [ ] Helper functions
- [ ] Path resolution
- [ ] Git utilities

## Test Coverage Gaps by Priority

### 🔴 Critical (Should test immediately)
1. **Manager Classes** - Core business logic, newly refactored
2. **Worktree Operations** - Can break git repos if buggy
3. **Config Management** - Can corrupt user data

### 🟡 Important (Should test soon)
1. **CLI Command Routing** - User-facing functionality
2. **Agent Access Control** - Security/permissions
3. **PMO Ticket Management** - Data integrity

### 🟢 Nice to Have
1. **Theme System** - Mostly cosmetic
2. **Interactive Prompts** - UI/UX
3. **Logger/Display** - Output formatting

## Recommended Test Implementation Plan

### Phase 1: Core Manager Tests
```typescript
// src/lib/managers/__tests__/AgentManager.test.ts
// src/lib/managers/__tests__/RepoManager.test.ts  
// src/lib/managers/__tests__/TicketManager.test.ts
```

### Phase 2: Integration Tests
```typescript
// src/bin/__tests__/prlt.test.ts - CLI command integration
// src/lib/worktree/__tests__/operations.test.ts
```

### Phase 3: E2E Tests
```typescript
// e2e/hq-workflow.test.ts - Full HQ setup and usage
// e2e/simple-workflow.test.ts - Simple mode workflow
```

## Test Infrastructure Needed

### 1. Test Utilities
```typescript
// test/utils/fixtures.ts
export const createTestHQ = () => { /* ... */ }
export const createTestRepo = () => { /* ... */ }
export const mockGitOperations = () => { /* ... */ }
```

### 2. Mock Data
```typescript
// test/mocks/configs.ts
export const mockHQConfig = { /* ... */ }
export const mockAgents = [ /* ... */ ]
export const mockTickets = [ /* ... */ ]
```

### 3. Test Scripts
```json
// package.json additions
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:e2e": "jest --config jest.e2e.config.js"
  }
}
```

## Coverage Metrics

### Current Coverage (Estimated)
- **Lines**: ~5% (only initProject tested)
- **Functions**: ~3% (1 of ~30 main functions)
- **Branches**: ~10% (basic paths in initProject)
- **Files**: ~5% (1 test file out of ~20 source files)

### Target Coverage
- **Lines**: 80%+
- **Functions**: 90%+
- **Branches**: 70%+
- **Files**: 100% (all have tests)

## Action Items

### Immediate Actions
1. [ ] Set up Jest configuration for managers
2. [ ] Create test fixtures and utilities
3. [ ] Write tests for AgentManager
4. [ ] Write tests for RepoManager
5. [ ] Write tests for TicketManager

### Short-term Actions
1. [ ] Add CLI command tests
2. [ ] Add integration tests
3. [ ] Set up CI/CD test pipeline
4. [ ] Add coverage reporting

### Long-term Actions
1. [ ] Add E2E tests
2. [ ] Add performance tests
3. [ ] Add mutation testing
4. [ ] Achieve 80%+ coverage

## Testing Commands Checklist

### Setup & Configuration
- [ ] `prlt init`
- [ ] `prlt init --hq`
- [ ] `prlt init --theme`
- [ ] `prlt upgrade`
- [ ] `prlt migrate`

### Agent Management
- [ ] `prlt agent` (interactive)
- [ ] `prlt agent add`
- [ ] `prlt agent remove`
- [ ] `prlt agent list`
- [ ] `prlt agent grant`
- [ ] `prlt agent revoke`
- [ ] `prlt agent switch`

### Repository Management
- [ ] `prlt repo` (interactive)
- [ ] `prlt repo add` (clone)
- [ ] `prlt repo add` (existing)
- [ ] `prlt repo add` (new)
- [ ] `prlt repo remove`
- [ ] `prlt repo list`

### Ticket Management
- [ ] `prlt ticket` (interactive)
- [ ] `prlt ticket create`
- [ ] `prlt ticket claim`
- [ ] `prlt ticket complete`
- [ ] `prlt ticket list`

### Theme Commands
- [ ] `prlt hire` / `prlt fire` / `prlt staff`
- [ ] `prlt drive` / `prlt park` / `prlt garage`
- [ ] `prlt buy` / `prlt sell` / `prlt portfolio`

### Maintenance
- [ ] `prlt repair`
- [ ] `prlt health`
- [ ] `prlt access`
- [ ] `prlt go`

### Information
- [ ] `prlt list`
- [ ] `prlt themes`
- [ ] `prlt --version`
- [ ] `prlt --help`

## Summary

**Current State**: Minimal test coverage (~5%), only one test file exists

**Main Gap**: The newly refactored manager classes have NO tests

**Recommendation**: Prioritize testing the manager classes first, then CLI integration, then E2E workflows

**Risk**: Without tests, refactoring could introduce regressions that aren't caught until production