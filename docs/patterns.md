# Coding Patterns Guide

Expected coding patterns for agents and contributors. Enforced by ESLint where possible; the rest is convention.

## Error Handling

**Rule: Never swallow errors silently. Always log or rethrow.**

```typescript
// GOOD: Log the error
try {
  await riskyOperation()
} catch (err) {
  logger.warn(`Operation failed: ${err instanceof Error ? err.message : String(err)}`)
}

// GOOD: Rethrow with context
try {
  await riskyOperation()
} catch (err) {
  throw new Error(`Failed to do X: ${err instanceof Error ? err.message : String(err)}`)
}

// GOOD: Intentional ignore with comment explaining why
try { db.close() } catch { /* db handle may already be invalid — safe to ignore during cleanup */ }

// BAD: Silent swallow — debugging nightmare
try {
  await riskyOperation()
} catch {}

// BAD: Catch and ignore without explanation
try {
  await riskyOperation()
} catch (err) {
  // do nothing
}
```

**When it's okay to ignore errors:** Only in cleanup/teardown code where:
1. The error is expected (e.g., closing an already-closed handle)
2. There's a comment explaining why it's safe
3. The surrounding context already handles the primary error

## Return Patterns

**Rule: Use early returns for guard clauses, single return for logic.**

```typescript
// GOOD: Early returns for guards
function processTicket(ticket: Ticket | null): Result {
  if (!ticket) return { error: 'not found' }
  if (ticket.status === 'done') return { error: 'already done' }

  // Main logic with single return
  const result = doWork(ticket)
  return { data: result }
}

// BAD: Deeply nested conditionals
function processTicket(ticket: Ticket | null): Result {
  if (ticket) {
    if (ticket.status !== 'done') {
      const result = doWork(ticket)
      return { data: result }
    } else {
      return { error: 'already done' }
    }
  } else {
    return { error: 'not found' }
  }
}
```

## Null Handling

**Rule: Use TypeScript strict null checks. Prefer `undefined` over `null` for optional values.**

```typescript
// GOOD: Use undefined for optional values
interface Options {
  timeout?: number      // undefined when not set
  label?: string
}

// GOOD: Nullish coalescing for defaults
const timeout = options.timeout ?? 30_000

// BAD: Mix of null, undefined, empty string
if (value === null || value === undefined || value === '') { ... }

// GOOD: Falsy check when appropriate
if (!value) { ... }
```

**Exception:** Use `null` when interfacing with external APIs or database layers that return `null`.

## Unused Code

**Rule: Delete it. Don't comment it out, don't prefix with underscore to "keep around."**

```typescript
// BAD: Commented-out code
// function oldParser(input: string) {
//   return input.split('-')
// }

// BAD: Keeping "just in case"
const _legacyFormatter = (x: string) => x.toUpperCase()

// GOOD: Just delete it. Git has the history.
```

**Unused function parameters** are the exception — prefix with `_` when the parameter is required by an interface but not used in the implementation:

```typescript
// GOOD: Interface requires the param but this implementation doesn't need it
function onEvent(_eventName: string, data: EventData): void {
  process.stdout.write(JSON.stringify(data))
}
```

## Import Hygiene

**Rule: No unused imports. ESLint enforces this (`@typescript-eslint/no-unused-vars`).**

- Remove imports when you remove the code that uses them
- Use `import type` for type-only imports — they're erased at compile time and signal intent
- Don't import entire modules when you only need one function

```typescript
// GOOD: Type-only import
import type { Ticket } from '../pmo/types.js'

// GOOD: Named import of what you need
import { parseSessionName } from '../execution/session-utils.js'

// BAD: Import entire module
import * as sessionUtils from '../execution/session-utils.js'
```

## Naming

**Rule: No metadata encoded in identifiers. Use structured fields instead.**

```typescript
// BAD: Encoding ticket + role + HQ in a session name, then regex-parsing it
const sessionId = `${ticketId}-${role}-${hqName}-${agentName}`
const parsed = sessionId.match(/^(TKT-\d+)-(\w+)-(.+)-(.+)$/)

// GOOD: Use structured data
interface SessionInfo {
  ticketId: string
  role: string
  hqName: string
  agentName: string
}
```

**When naming is unavoidable** (e.g., tmux session names): centralize the parser in one place and reuse it. See `parseSessionName()` in `session-utils.ts`.

## Duplicate Code

**Rule: If the same logic exists in two places, extract it.**

Before duplicating:
1. Search for existing implementations (`grep`, `parseSessionName`, etc.)
2. If one exists, import it
3. If none exists but the logic is reusable, extract to a shared module

Shared utilities belong in `src/lib/` under the appropriate domain directory.

## Process Exit

**Rule: Services never call `process.exit()`. Only CLI entry points may exit.**

```typescript
// BAD: In a service or library function
function validateInput(input: string): void {
  if (!input) {
    console.error('Input required')
    process.exit(1)
  }
}

// GOOD: Throw a typed error, let the caller decide
function validateInput(input: string): void {
  if (!input) {
    throw new ServiceError('VALIDATION', 'Input required')
  }
}
```

## ESLint Rules

The following rules are enforced as errors in CI:

| Rule | What it catches |
|------|----------------|
| `no-empty` | Empty catch/if/else blocks |
| `no-unreachable` | Code after return/throw/break |
| `@typescript-eslint/no-unused-vars` | Unused imports, variables, parameters |
| `no-useless-return` | Unnecessary return statements |
| `@typescript-eslint/no-explicit-any` | Explicit `any` types (warning) |

The `_` prefix convention is allowed for intentionally unused variables (`varsIgnorePattern: '^_'`).
