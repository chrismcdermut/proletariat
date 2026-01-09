# Contributing to Proletariat

## Code Review for Agentic Development

When working with multiple AI agents producing PRs, traditional "review every line" doesn't scale. Here's the recommended approach:

### 1. Shift Left - Review the Plan, Not the Code

Review the approach **before** implementation. If the design is right, implementation details matter less. Use plan mode to align on architecture before agents start coding.

### 2. Trust the Test Suite

- If tests pass and coverage is good, that's your first gate
- Focus review time on **what's tested**, not how it's implemented
- Add tests for anything that worries you

### 3. Tiered Review Depth

| Tier | Review Depth | Examples |
|------|--------------|----------|
| **Critical** | Deep review | Security, auth, payments, data migrations |
| **Medium** | Spot check | Business logic, new features |
| **Low** | Skim | Refactors, tests, docs, formatting |

### 4. Review Diffs by Category, Not File Order

1. **Schema/DB changes first** - Hardest to undo
2. **API contracts second** - Breaking changes matter
3. **Implementation last** - Easiest to fix later

### 5. Use the Agent to Review Itself

Before reviewing, ask the agent:
- "What are the risks in this PR?"
- "What edge cases aren't handled?"
- "Summarize the changes for review"

This surfaces issues the agent is aware of but didn't fix.

### 6. Smaller PRs, Faster Merges

- One feature = one PR
- Merge fast, revert if needed (git makes this easy)
- Don't let PRs sit - stale PRs cause merge conflicts

### 7. Time-Box Reviews

- **10 minutes max** per PR
- If you can't understand it in 10 minutes, the PR is too big
- Request PR be split if it's not reviewable

### The Goal

The goal isn't to catch every bug - it's to catch **design mistakes** that are expensive to fix later. Implementation bugs get caught by tests or users and are cheap to fix.

## Development Setup

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Local development (from anywhere in workspace)
pnpm prlt <command>
```

### Native Module Issues

If you see errors like `dlopen(...better_sqlite3.node...): not a mach-o file`:

```bash
# Rebuild native modules
pnpm rebuild better-sqlite3

# Or nuke and reinstall
rm -rf node_modules && pnpm install
```

This happens when Node version changes or node_modules is copied from a different architecture.

## Commit Messages

End commit messages with:
```
[prlt] Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Pull Requests

- Link to ticket: `TKT-XXX` in PR title or description
- Include test plan or manual testing steps
- Keep PRs focused - one logical change per PR
