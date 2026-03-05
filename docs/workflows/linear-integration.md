# Linear Integration – Operator Runbook

This runbook covers setup, daily operations, and troubleshooting for the Linear integration. It enables bidirectional issue tracking between Linear and the PMO.

## PMO Strategy: Mirrored-by-Default

Linear issues are **mirrored into the PMO as first-class tickets** — not bypassed. Every imported Linear issue becomes a full PMO ticket with:

- Title, description, and priority mapped from Linear
- Status mapped to the project's workflow
- Labels preserved
- Traceability metadata linking back to the original Linear issue

**Why mirrored-by-default?**

- The PMO remains the single source of truth for all work, regardless of origin.
- Agents and operators see a unified board — no need to context-switch between systems.
- Status changes in the PMO can be synced back to Linear so external stakeholders stay informed.
- Duplicate import is prevented via unique mapping records (one Linear issue maps to exactly one PMO ticket).

The sync direction defaults to **inbound** (Linear → PMO). Outbound sync (PMO → Linear) is available for status updates, PR links, and comments.

---

## Prerequisites

- A Linear workspace with at least one team
- A Linear personal API key (create at https://linear.app/settings/api)
- An initialized prlt HQ with a project (`prlt init` + `prlt project create`)

---

## Setup

### 1. Authenticate

```bash
# Interactive (prompts for API key and team selection)
prlt linear auth

# Non-interactive (e.g., CI or agent)
LINEAR_API_KEY=lin_api_... prlt linear auth --json
```

This stores credentials in the workspace database and sets a default team.

**Environment variables** (override stored key):
| Variable | Description |
|---|---|
| `LINEAR_API_KEY` | Linear personal API key |
| `PRLT_LINEAR_API_KEY` | Alternative env var for API key |

### 2. Verify connection

```bash
prlt linear auth --check
```

Expected output includes organization name, authenticated user, and default team.

### 3. Check integration status

```bash
prlt linear status
```

Shows connection info, default team, and count of mapped issues.

---

## Commands

### Import issues

Pull Linear issues into the PMO as tickets.

```bash
# Import specific issues
prlt linear import ENG-123 ENG-456

# Import from default team (interactive selection)
prlt linear import

# Import from a specific team, filter by state
prlt linear import --team ENG --state "In Progress"

# Import by label
prlt linear import --team ENG --label bug

# Import all matching issues (non-interactive)
prlt linear import --team ENG --all

# Dry run (preview without creating tickets)
prlt linear import --team ENG --dry-run

# JSON output for agent automation
prlt linear import --team ENG --all --json
```

**What happens during import:**
1. Linear issues are fetched via the API (with optional filters).
2. Already-imported issues are detected and skipped.
3. Each new issue is converted to a PMO ticket: priority, status, labels, and description are mapped.
4. A mapping record is created linking the Linear issue to the PMO ticket.

### Sync status back to Linear

Push PMO status changes back to the corresponding Linear issues.

```bash
# Sync all mapped tickets
prlt linear sync

# Sync a specific ticket
prlt linear sync --ticket TKT-001

# Attach a PR link to the Linear issue
prlt linear sync --ticket TKT-001 --pr-url https://github.com/org/repo/pull/42

# Dry run
prlt linear sync --dry-run

# JSON output
prlt linear sync --json
```

### Spawn agents from Linear issues

Create an agent to work on a Linear issue directly.

```bash
prlt work spawn --from-linear
```

This fetches the issue, normalizes it into a spawn context (prompt + metadata), creates a PMO ticket, and spawns an agent.

---

## Mapping Reference

### Priority mapping

| Linear | PMO |
|---|---|
| 0 (No priority) | P3 (Low) |
| 1 (Urgent) | P0 (Critical) |
| 2 (High) | P1 (High) |
| 3 (Medium) | P2 (Medium) |
| 4 (Low) | P3 (Low) |

### State mapping

| Linear state type | PMO category |
|---|---|
| `triage` | `triage` |
| `backlog` | `backlog` |
| `unstarted` | `unstarted` |
| `started` | `started` |
| `completed` | `completed` |
| `canceled` | `canceled` |

When importing, the PMO status is chosen from the project's workflow by matching the category. If no match exists, the default status is used.

---

## Troubleshooting

### "Linear is not configured"

Run `prlt linear auth` to set up credentials. If running non-interactively, ensure `LINEAR_API_KEY` or `PRLT_LINEAR_API_KEY` is set.

### "Stored Linear API key is invalid or expired"

Re-authenticate with `prlt linear auth --force`. API keys can be revoked or rotated in Linear settings.

### "No teams found in your Linear workspace"

The API key may not have team-level access. Verify the key has the correct scopes at https://linear.app/settings/api.

### "All matching issues are already imported"

Each Linear issue can only be imported once. The mapping is tracked by Linear issue ID. To re-import, you would need to delete the existing PMO ticket and its mapping first.

### Import creates tickets but sync doesn't update Linear

Sync requires the ticket to have a `statusCategory` that matches a Linear workflow state type. Verify:
1. The project workflow has statuses with valid categories (`backlog`, `started`, `completed`, etc.)
2. The ticket has been moved to a status with a recognized category

### Connection works but import returns no issues

Check your filters. The default team is used if no `--team` flag is provided. Verify the team key matches (`prlt linear status` shows the default team). Try `prlt linear import --team ENG --limit 10` explicitly.

### Disconnect and clean up

```bash
# Remove stored credentials
prlt linear auth --disconnect
```

This removes the API key, team, and org name from workspace settings. Existing ticket mappings are preserved (the PMO tickets remain).

---

## Architecture

```
prlt linear auth       →  config.ts      →  workspace_settings table
prlt linear import     →  client.ts      →  Linear API (read)
                       →  mapper.ts      →  issue → ticket conversion
                       →  storage        →  PMO ticket creation
                       →  mapper.ts      →  mapping record (pmo_linear_issue_map)

prlt linear sync       →  mapper.ts      →  lookup mapping
                       →  sync.ts        →  Linear API (write: state, comment, attachment)

prlt work spawn        →  external-issues/linear.ts  →  normalize to IssueEnvelope
  --from-linear        →  external-issues/mapper.ts  →  spawn context generation
                       →  mapper.ts                  →  PMO ticket + mapping
```

**Key files:**
- `src/lib/linear/client.ts` – Linear API wrapper
- `src/lib/linear/config.ts` – Credential storage
- `src/lib/linear/mapper.ts` – Issue↔ticket conversion and mapping CRUD
- `src/lib/linear/sync.ts` – Outbound sync (status, PR, comments)
- `src/lib/linear/types.ts` – Type definitions and mapping constants
- `src/lib/external-issues/linear.ts` – Normalized issue adapter for spawn
