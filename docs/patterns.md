# Coding Patterns for Agents

Expected coding patterns for all agents working in this codebase. These rules are enforced by ESLint and CI.

## Error Handling

**Rule: Never swallow errors silently.**

Every `catch` block must either log the error, rethrow it, or include a comment explaining why the error is intentionally ignored.

```typescript
// BAD — silent failure, impossible to debug
try {
  await saveData()
} catch {}

// GOOD — log and continue
try {
  await saveData()
} catch (err) {
  log(`Failed to save data: ${err instanceof Error ? err.message : err}`)
}

// GOOD — rethrow with context
try {
  await saveData()
} catch (err) {
  throw new Error(`Save failed for ticket ${ticketId}: ${err}`)
}

// GOOD — intentional ignore with explanation
try {
  db.close()
} catch {
  /* best-effort cleanup during shutdown */
}
```

## Unused Code

**Rule: No unused imports, variables, or dead code.**

- Remove unused imports entirely — don't comment them out
- Prefix intentionally unused variables with `_` (e.g., `_unusedParam`)
- Delete unreachable code after `return`, `throw`, or `break`
- Delete commented-out code blocks — git history preserves them

```typescript
// BAD — unused import
import { helper } from './utils.js'

// BAD — unreachable code
function process() {
  return result
  cleanup() // never runs
}

// GOOD — prefix unused destructured vars
const { needed, ...rest: _rest } = options

// GOOD — prefix unused function params
function handler(req: Request, _res: Response) {
  // only uses req
}
```

## Return Patterns

**Rule: Use early returns for guard clauses, single return for logic.**

```typescript
// GOOD — early return guards
function getUser(id: string): User | null {
  if (!id) return null
  if (!isValid(id)) return null

  const user = db.findUser(id)
  return user
}
```

## Null Handling

**Rule: Prefer `undefined` over `null` for absent values. Use TypeScript strict null checks.**

- Use `undefined` for "not provided" / "not set"
- Use `null` only when interfacing with APIs that explicitly use null (e.g., JSON, database results)
- Never use empty string `''` as a sentinel for "no value"
- Use optional chaining and nullish coalescing over manual checks

```typescript
// BAD — mixed null semantics
function find(id: string): Item | null | undefined {
  if (!id) return null
  return items.get(id) || undefined
}

// GOOD — consistent undefined
function find(id: string): Item | undefined {
  if (!id) return undefined
  return items.get(id)
}

// GOOD — nullish coalescing
const name = user?.name ?? 'Anonymous'
```

## Naming

**Rule: No metadata in IDs or names. Use structured fields instead.**

Don't encode ticket IDs, roles, or HQ names into session IDs or variable names. Use separate fields or tags.

```typescript
// BAD — metadata stuffed into a name string, then regex-parsed out
const sessionName = `${ticketId}-${action}-${agentName}`
const parsed = sessionName.match(/^(TKT-\d+)-(\w+)-(.+)$/)

// GOOD — use the canonical parser
import { parseSessionName } from '../execution/session-utils.js'
const parsed = parseSessionName(sessionName)
if (parsed) {
  const { ticketId, action, agentName } = parsed
}
```

## Duplicate Code

**Rule: Use shared utilities. Don't re-implement existing helpers.**

Before writing a new helper, check if one already exists:

- **Session parsing**: Use `parseSessionName` from `lib/execution/session-utils.ts`
- **Database access**: Use the DAL from `lib/database/index.ts`
- **Ticket operations**: Use `TicketProvider` from `lib/providers/`
- **JSON mode output**: Use `outputPromptAsJson` / `buildPromptConfig` from `lib/utils/`

## ESLint Rules

The following rules are enforced as errors (CI will block PRs that violate them):

| Rule | What it catches |
|------|----------------|
| `no-empty` | Empty catch blocks |
| `no-unreachable` | Dead code after return/throw/break |
| `@typescript-eslint/no-unused-vars` | Unused imports, variables, parameters |

The `_` prefix convention marks intentionally unused variables:
- `_unusedVar` — acknowledged as unused
- `argsIgnorePattern: '^_'` — function params starting with `_` are allowed
