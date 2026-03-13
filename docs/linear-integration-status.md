# Linear Integration Status Report

**Date:** 2026-03-13
**Ticket:** TKT-103
**Tested against:** v0.3.61

---

## Summary

The Linear integration is **architecturally complete** with solid test coverage across all five flows tested. The integration supports listing, spawning from external issues, multi-source routing, and outbound sync. The one notable gap is that `prlt ticket create` cannot write directly to Linear — issue creation flows through `prlt linear import` (Linear → PMO) rather than PMO → Linear.

| Flow | Status | Test Coverage |
|------|--------|---------------|
| `prlt ticket list --source linear` | **Works** | 42 unit tests |
| `prlt ticket create` → Linear | **Not supported** | N/A — by design |
| `prlt work start --from linear:KEY` | **Works** | 34 adapter + 2 command tests |
| Multi-source provider config | **Works** | 31 unit tests |
| Outbound sync hooks | **Works** | 11 unit tests + 34 adapter sync tests |

**Total Linear-related tests: 120 — all passing.**

---

## Flow 1: `prlt ticket list --source linear`

### What was tested

The `ticket list` command accepts a `--source` flag with values `auto`, `pmo`, or `linear` (default: `auto`).

### How it works

1. `--source linear` forces Linear API fetching; `--source auto` uses Linear when configured (`isLinearConfigured()` checks for `linear.api_key` in `workspace_settings`).
2. `runLinear()` loads the Linear config, resolves team from `--team` flag / config / `PRLT_LINEAR_TEAM` env var, and calls `listLinearIssues()`.
3. Issues are fetched via GraphQL, normalized into `NormalizedIssueEnvelope` objects, then converted to `Ticket` shape via `envelopeToTicket()`.
4. Client-side filters (`--priority`, `--column`, `--category`, `--search`, `--label`) are applied post-fetch.
5. Output renders in table, compact, or JSON format using the cross-project view (no local board columns).

### Verdict: **Works**

- API key resolution: env vars (`PRLT_LINEAR_API_KEY`, `LINEAR_API_KEY`) → `workspace_settings['linear.api_key']`.
- Error handling covers: missing config, auth failures (401/403), rate limiting (429), bad payloads.
- All 42 unit tests pass (normalization, error codes, spawn context generation).

### Key files

- `apps/cli/src/commands/ticket/list.ts` — command with `shouldUseLinear()` routing
- `apps/cli/src/lib/external-issues/linear.ts` — `listLinearIssues()` adapter
- `apps/cli/test/unit/linear-issues.test.ts` — 42 passing tests

---

## Flow 2: `prlt ticket create` with Linear as target

### What was tested

Whether `prlt ticket create` can write a new ticket directly to Linear.

### How it works

It **doesn't**. The `ticket create` command (`apps/cli/src/commands/ticket/create.ts`) is PMO-only — it creates tickets in the local SQLite database. There is no `--target linear` or `--destination` flag. The word "linear" does not appear anywhere in the file.

### The actual Linear write path

To get issues into Linear's system from prlt, the flow is:

1. Issues are created in Linear directly (via Linear's UI/API).
2. `prlt linear import` fetches Linear issues and creates corresponding PMO tickets with full metadata mapping (priority, state, labels, assignee).
3. `prlt linear sync` pushes PMO status changes back to Linear (outbound sync).

This is a **deliberate architectural choice**: Linear is treated as a source-of-truth for issue creation, and prlt mirrors/syncs rather than creating upstream.

### Verdict: **Not supported (by design)**

- There is no mechanism to create a new issue in Linear via `prlt ticket create`.
- The integration is uni-directional for creation: Linear → PMO via `prlt linear import`.
- Status changes flow back via outbound sync (PMO → Linear), but new issue creation does not.

---

## Flow 3: `prlt work start --from linear:PRLT-931`

### What was tested

The `--from` shorthand for spawning work from a Linear issue.

### How it works

1. `--from linear:PRLT-931` is parsed: `source = "linear"`, `key = "PRLT-931"`.
2. Cannot be combined with `--from-issue`, `--source`, or `--key` (returns `CONFLICTING_FLAGS` error).
3. `resolveIssueSourceAndKey()` resolves the source with fallback precedence: flag → workspace active source → prompt.
4. `fetchExternalIssue('linear', 'PRLT-931')` calls `getLinearIssueByIdentifier()`, which:
   - Sends a GraphQL query using the `issue(id:)` endpoint.
   - Does **not** require a team key (unlike `listLinearIssues`).
   - Returns `NormalizedIssueEnvelope` or `null`.
5. If mirror-to-PMO is enabled (default: configurable), creates/updates a linked PMO ticket.
6. Builds spawn context message with external issue metadata.
7. Spawns the ephemeral agent with the issue context.

### The `--from-issue` legacy path

The older `--from-issue --source linear --key PRLT-931` syntax also works. `--from` is the unified shorthand that replaces it.

### Verdict: **Works**

- Full pipeline: Linear API → normalize → PMO ticket → spawn context → agent.
- Error handling: auth failures, rate limiting, not-found, bad payloads all produce structured error responses.
- 34 adapter flow tests + 2 command tests pass.

### Key files

- `apps/cli/src/commands/work/start.ts:568-682` — `--from` flag parsing and external issue flow
- `apps/cli/src/lib/external-issues/linear.ts:293-361` — `getLinearIssueByIdentifier()`
- `apps/cli/test/e2e/linear-adapter-flows.test.ts` — 34 passing tests

---

## Flow 4: Multi-source provider config

### What was tested

Whether multiple external ticket providers (e.g., Linear for engineering, Jira for product) can be configured simultaneously with prefix-based routing.

### How it works

**Storage:** JSON array in `workspace_settings['work.provider_sources']`.

**`ProviderSourceEntry` shape:**
```typescript
{
  id: 'eng-linear',           // Unique slug
  provider: 'linear',         // Provider type
  apiKeyRef: 'linear.api_key', // Settings key or env var name
  teamProjectId: 'ENG',       // Linear team key
  prefix: 'ENG-',             // Routing prefix
  label: 'Engineering',       // Display label
}
```

**Prefix-based routing:** `resolveProviderByPrefix(db, 'ENG-123')` matches ticket keys against configured prefixes (case-insensitive, longest-prefix-wins).

**API key resolution:** `resolveApiKey()` checks env vars first, then `workspace_settings`.

**CRUD operations:** `addProviderSource`, `updateProviderSource`, `removeProviderSource`, `getProviderSourceById` — all with validation (slug format, uniqueness of id and prefix).

**Integration with work commands:** `work spawn` and `work source set` consume the multi-source config. `getRegisteredWorkSources()` returns all configured providers. `getRoutingTable()` displays all routing rules.

### Verdict: **Works**

- Full CRUD with validation.
- Prefix routing correctly handles multiple providers.
- 31 unit tests pass covering validation, persistence, routing, and API key resolution.

### Key files

- `apps/cli/src/lib/work-source/provider-sources.ts` — full implementation
- `apps/cli/src/lib/work-source/config.ts` — `WorkSourceProvider` type, parse/format refs
- `apps/cli/test/unit/provider-sources.test.ts` — 31 passing tests

---

## Flow 5: Outbound sync hooks on ticket status change

### What was tested

Whether status changes on PMO tickets fire outbound sync to Linear.

### How it works

**Event-driven architecture:**

1. `OutboundSyncHandler` subscribes to the global `EventBus` for two events:
   - `ticket:status_changed` — when a PMO ticket moves to a different status.
   - `ticket:pr_linked` — when a PR URL is attached to a ticket.

2. On status change (`handleStatusChanged`):
   - Checks if Linear is configured and the ticket has a Linear mapping (`pmo_linear_issue_map` table).
   - Skips `inbound`-only sync mappings (only processes `outbound` or `bidirectional`).
   - Maps PMO status category to Linear workflow state type (e.g., `started` → `started`).
   - Calls `client.updateIssueState()` to update the Linear issue.
   - Posts a comment: `"Status updated to **In Progress** (via prlt)"`.
   - Updates sync timestamp.

3. On PR link (`handlePRLinked`):
   - Calls `client.attachUrl()` to add a URL attachment to the Linear issue.
   - Posts a comment: `"Pull request created: [title](url)"`.

4. Fire-and-forget: sync errors are caught and logged but never block the caller.

**Manual sync command:** `prlt linear sync` provides explicit control:
- `prlt linear sync --ticket TKT-001` — sync a single ticket.
- `prlt linear sync` — bulk sync all mapped tickets.
- `prlt linear sync --pr-url URL --ticket TKT-001` — attach a PR link.
- `--dry-run` for preview.

**Dual mapping tables:**
- `pmo_linear_issue_map` — Linear-specific with `sync_direction`, `linear_identifier`, `linear_team_key`.
- `pmo_external_execution_map` — provider-agnostic with `latest_state_snapshot` JSON.

### Verdict: **Works**

- Event-driven sync fires automatically when the `OutboundSyncHandler` is initialized via `initOutboundSync(db)`.
- Singleton pattern prevents duplicate subscriptions.
- Manual `prlt linear sync` command provides explicit control and dry-run capability.
- 11 outbound sync unit tests + 34 adapter sync tests pass.

### Key files

- `apps/cli/src/lib/external-issues/outbound-sync.ts` — event handler (singleton)
- `apps/cli/src/lib/linear/sync.ts` — `LinearSync` class
- `apps/cli/src/lib/linear/mapper.ts` — mapping CRUD
- `apps/cli/src/commands/linear/sync.ts` — manual sync command
- `apps/cli/src/lib/events/events.ts` — event type definitions
- `apps/cli/test/unit/outbound-sync.test.ts` — 11 passing tests

---

## Known Limitations & Recommendations

### Limitations

1. **No direct issue creation in Linear.** `prlt ticket create` is PMO-only. To create issues in Linear, use Linear's UI/API and then `prlt linear import`.

2. **`getLinearIssueByIdentifier` uses `issue(id:)` query.** The GraphQL query in `external-issues/linear.ts:52` uses `issue(id: $id)` rather than filter-by-identifier. This works because Linear resolves identifiers like `ENG-123` as IDs, but it's an undocumented API behavior that could break.

3. **Team key required for listing, not for single-issue fetch.** `listLinearIssues()` requires a team key; `getLinearIssueByIdentifier()` does not. This asymmetry could confuse users who set up `--source linear` for listing but forget to set a team.

4. **Client-side filtering for `ticket list --source linear`.** Filters like `--priority`, `--category`, `--label` are applied after fetch. With large issue counts this means fetching more data than needed (capped at 50 by default).

5. **Sync direction defaults to `inbound`.** The adapter flow tests confirm `sync_direction` defaults to `'inbound'` when importing, meaning outbound sync won't fire for imported issues unless the mapping is explicitly updated to `'outbound'` or `'bidirectional'`.

### Recommendations

1. Consider adding `--target linear` support to `ticket create` if bidirectional creation is desired.
2. Document the sync direction configuration — users may import issues expecting outbound sync to "just work" but it defaults to inbound-only.
3. Consider server-side filtering for `ticket list --source linear` by pushing supported filters into the GraphQL query.
