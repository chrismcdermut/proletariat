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

## Local Development Testing

When dogfooding prlt to build prlt with multiple agent worktrees on different feature branches, you need isolation to prevent database conflicts. The CLI supports the `PRLT_HOME` environment variable to override the default `.proletariat` directory location.

### Quick Local Testing

Test your local build with the shared database:

```bash
# Run from anywhere in the workspace - pnpm finds root automatically
pnpm prlt ticket list
pnpm prlt work start TKT-XXX
```

### Isolated Testing (No Conflicts)

For testing without affecting the shared database:

```bash
# Uses an ephemeral database in /tmp
pnpm prlt:test init my-test-workspace
pnpm prlt:test ticket create "Test ticket"
```

### Manual Isolation

Override the `.proletariat` directory location manually:

```bash
# All data goes to /tmp/my-test instead of ~/.proletariat
PRLT_HOME=/tmp/my-test pnpm prlt ticket create "Isolated test"

# Or for persistent test databases
export PRLT_HOME=/tmp/prlt-dev
pnpm prlt init my-dev-hq
pnpm prlt ticket list
```

### Multi-Agent/Branch Development

When multiple agents are building prlt on different branches:

1. Each agent can use a unique `PRLT_HOME` to avoid database conflicts
2. The global `prlt` command always uses `~/.proletariat` (shared HQ)
3. Local `pnpm prlt` uses the local build but respects `PRLT_HOME`

```bash
# Agent 1 on branch feature-a
export PRLT_HOME=/tmp/prlt-agent1
pnpm prlt:test init test-hq

# Agent 2 on branch feature-b (different terminal)
export PRLT_HOME=/tmp/prlt-agent2
pnpm prlt:test init test-hq
```

### Environment Variable Reference

| Variable | Purpose | Default |
|----------|---------|---------|
| `PRLT_HOME` | Override global `.proletariat` directory | `~/.proletariat` |
| `PRLT_HQ_PATH` | Specify HQ workspace location | Auto-detected from cwd |

`PRLT_HOME` affects:
- Global config (`config.json`)
- Logs directory
- Scripts directory

`PRLT_HQ_PATH` affects:
- Workspace discovery (skips directory tree walk)
- PMO resolution

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
