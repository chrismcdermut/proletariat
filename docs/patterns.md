# Coding Patterns for Agents

This document defines expected coding patterns for the proletariat codebase. AI agents and human contributors should follow these patterns to maintain code quality and consistency.

## Error Handling

### Never swallow errors silently

Every `catch` block must have a body. At minimum, include a comment explaining why the error is intentionally ignored.

```typescript
// BAD — silent error swallowing
try {
  await riskyOperation()
} catch {}

// BAD — catches error but does nothing
try {
  await riskyOperation()
} catch (err) {}

// GOOD — log and continue
try {
  await riskyOperation()
} catch (err) {
  log(`riskyOperation failed: ${err instanceof Error ? err.message : String(err)}`)
}

// GOOD — intentional ignore with explanation
try {
  db.close()
} catch {
  /* db handle may already be closed — safe to ignore */
}

// GOOD — rethrow after logging
try {
  await criticalOperation()
} catch (err) {
  log(`Critical failure: ${err}`)
  throw err
}
```

### Error handling strategy by context

| Context | Pattern |
|---------|---------|
| Command entry point | Log the error, show user-friendly message, return (don't `process.exit()`) |
| Library function | Throw the error (let caller decide) |
| Cleanup/finally | Catch and comment why it's safe to ignore |
| Background process | Log the error, continue running |
| Provider call | Return `{ success: false, error: message }` |

### Never call `process.exit()` in command code

Let oclif handle the lifecycle. Use `this.error()` for fatal errors or `return` for early exits.

## Return Patterns

### Early returns for guards, then main logic

```typescript
// GOOD — guard clauses at the top
function processTicket(ticket: Ticket | null): Result {
  if (!ticket) return { success: false, error: 'No ticket' }
  if (ticket.status === 'done') return { success: true, skipped: true }

  // Main logic here
  const result = doWork(ticket)
  return { success: true, data: result }
}
```

### No unreachable code

Never leave code after a `return`, `throw`, or `this.error()` statement.

```typescript
// BAD
if (jsonMode) {
  outputErrorAsJson(...)
  return
  db.close()    // unreachable
  this.exit(1)  // unreachable
}

// GOOD
if (jsonMode) {
  outputErrorAsJson(...)
  return
}
```

## Import Hygiene

### Remove unused imports

Every import must be used. The ESLint rule `@typescript-eslint/no-unused-vars` enforces this.

```typescript
// BAD
import { foo, bar, baz } from './utils.js'
// only foo is used

// GOOD
import { foo } from './utils.js'
```

### Use `import type` for type-only imports

When importing types that are only used in type positions (type annotations, interfaces), use `import type`.

```typescript
// GOOD
import type { Ticket, TicketProvider } from './types.js'
import { resolveProvider } from './resolver.js'
```

## Null Handling

### Prefer `undefined` over `null` for absent values

TypeScript's strict null checks work better with `undefined`. Use `null` only when interfacing with external APIs that return `null`.

```typescript
// GOOD
function findTicket(id: string): Ticket | undefined {
  return tickets.get(id)
}

// OK — when external API returns null
const linearIssue = await linearClient.issue(id) // returns null if not found
```

### Use optional chaining and nullish coalescing

```typescript
// GOOD
const name = ticket?.assignee?.name ?? 'unassigned'

// BAD
const name = ticket && ticket.assignee && ticket.assignee.name ? ticket.assignee.name : 'unassigned'
```

## Naming Conventions

### No metadata in IDs

Don't encode structured data into string identifiers. Use separate fields/tags instead.

```typescript
// BAD — encoding ticket, action, and agent into session name
const sessionName = `${ticketId}-${action}-${agentName}`
// then parsing it back with regex

// BETTER — use structured data
interface SessionInfo {
  ticketId: string
  action: string
  agentName: string
}
```

### Prefix unused parameters with `_`

When a function signature requires a parameter but the implementation doesn't use it, prefix with `_`.

```typescript
// GOOD
function onChange(_event: Event, data: Data): void {
  process(data)
}
```

## Dead Code

### Remove commented-out code

Don't leave commented-out code blocks in the codebase. Use git history to recover old code if needed.

### Remove unused functions and exports

If a function or export is no longer referenced, delete it. Don't leave it "in case we need it later."

## Duplicate Code

### Consolidate duplicate logic

When two functions do the same thing, consolidate them into one and re-export from a shared location.

Check `apps/cli/src/lib/` for shared utilities before writing new helper functions.

## ESLint Rules

The following rules are enforced as errors (will block CI):

| Rule | Purpose |
|------|---------|
| `no-empty` (allowEmptyCatch: false) | No empty catch blocks |
| `no-unreachable` | No dead code after return/throw |
| `@typescript-eslint/no-unused-vars` | No unused imports, variables, or parameters |

The following rules are enforced as warnings (won't block CI, but should be fixed):

| Rule | Purpose |
|------|---------|
| `@typescript-eslint/no-explicit-any` | Avoid `any` type — use specific types |
| `no-await-in-loop` | Consider `Promise.all()` for parallel operations |

Run `pnpm lint` in `apps/cli/` before committing to catch violations early.
