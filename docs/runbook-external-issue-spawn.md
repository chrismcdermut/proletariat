# Operator Runbook: External Issue Spawn

This runbook covers setup, troubleshooting, and fallback modes for spawning work from external issue trackers (Linear and Jira) via the `prlt` CLI.

## Overview

External issue spawn lets operators pull issues from Linear or Jira and spawn agent work items in the PMO. The flow is:

1. Authenticate with the external source (Linear or Jira).
2. Fetch and normalize issues into a canonical `IssueEnvelope`.
3. Map the envelope to a spawn context (prompt + metadata).
4. Create a PMO ticket and start an execution.
5. Persist the external ↔ execution mapping for traceability.

## Prerequisites

- `prlt` CLI installed and configured (`prlt new` completed).
- An active HQ workspace with at least one project.
- Network access to the external issue tracker API.

---

## Setup

### Linear

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `LINEAR_API_KEY` or `PRLT_LINEAR_API_KEY` | Yes | Linear personal API key ([Settings → API](https://linear.app/settings/api)) |
| `PRLT_LINEAR_TEAM` or `LINEAR_TEAM_KEY` | For `list` | Team key (e.g., `ENG`) — not needed for single-issue lookup |
| `PRLT_LINEAR_API_URL` | No | Override API endpoint (default: `https://api.linear.app/graphql`) |

**Quick start:**

```bash
export LINEAR_API_KEY="lin_api_YOUR_KEY_HERE"
export PRLT_LINEAR_TEAM="ENG"

# List issues from the ENG team
prlt work linear

# Spawn work from a specific issue
prlt work linear --issue ENG-123
```

### Jira

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `PRLT_JIRA_BASE_URL` or `JIRA_BASE_URL` (or `*_HOST` variants) | Yes | Jira instance URL (e.g., `https://acme.atlassian.net`) |
| `PRLT_JIRA_API_TOKEN` or `JIRA_API_TOKEN` | Yes | Jira API token ([Manage API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)) |
| `PRLT_JIRA_EMAIL` or `JIRA_EMAIL` | Recommended | Email for Basic auth (if omitted, Bearer auth is used) |
| `PRLT_JIRA_PROJECT` or `JIRA_PROJECT_KEY` | For `list` | Default project key (e.g., `INFRA`) |
| `PRLT_JIRA_JQL` | No | Custom JQL query (overrides project filter) |

**Quick start:**

```bash
export PRLT_JIRA_BASE_URL="https://acme.atlassian.net"
export PRLT_JIRA_EMAIL="bot@acme.com"
export PRLT_JIRA_API_TOKEN="YOUR_JIRA_TOKEN"
export PRLT_JIRA_PROJECT="INFRA"

# List issues from the INFRA project
prlt work jira

# Spawn work from a specific issue
prlt work jira --issue INFRA-77
```

---

## Security: Credential Handling

**Credentials are never stored in cleartext metadata or logged to output.**

### How credentials flow

1. **Environment variables** → read at runtime by adapter config resolvers.
2. **HTTP headers** → `Authorization: Bearer <token>` or `Authorization: Basic <base64>` sent only to the external API.
3. **Metadata stored in DB** → contains only traceability fields (`external_source`, `external_key`, `external_id`, `external_url`, `external_status`). No tokens or credentials.
4. **Spawn context prompt** → contains issue title, description, priority, labels, and URL. No credentials.

### Redaction safeguards

The `redact.ts` module provides runtime credential detection:

- `redactCredentials(str)` — replaces known credential patterns with `[REDACTED]`.
- `detectCredentials(str)` — scans for known patterns (Linear keys, Bearer tokens, GitHub PATs, etc.).
- `detectEnvSecrets(str)` — checks if live env var values appear in output.
- `auditMetadata(record)` — scans metadata keys and values for credential leaks.

### Operator checklist

- [ ] Never pass API tokens as CLI flags — use environment variables.
- [ ] Ensure CI/CD pipelines use masked secrets for `LINEAR_API_KEY` and `PRLT_JIRA_API_TOKEN`.
- [ ] Review `prlt` output in verbose/debug mode before sharing logs externally.
- [ ] Rotate API tokens periodically and after any suspected exposure.

---

## Troubleshooting

### `MISSING_CONFIG` — Missing API key or base URL

**Symptoms:** Error message like `Missing Linear API key` or `Missing Jira base URL`.

**Cause:** Required environment variables are not set.

**Fix:**
1. Check which variables are needed (see Setup tables above).
2. Verify the variable is exported in your shell: `echo $LINEAR_API_KEY`
3. If running inside a container or CI, ensure the secret is injected into the environment.

### `AUTH_FAILED` — Authentication rejected

**Symptoms:** Error message like `Linear authentication failed` or `Jira authentication failed`.

**Cause:** Invalid or expired API token; insufficient permissions.

**Fix:**
1. Regenerate the API token from the provider's settings page.
2. Verify the token has the required scopes:
   - **Linear:** read access to issues.
   - **Jira:** `read:jira-work` scope.
3. Test the token directly:
   ```bash
   # Linear
   curl -H "Authorization: $LINEAR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"query": "{ viewer { id } }"}' \
     https://api.linear.app/graphql

   # Jira
   curl -u "$PRLT_JIRA_EMAIL:$PRLT_JIRA_API_TOKEN" \
     "$PRLT_JIRA_BASE_URL/rest/api/3/myself"
   ```

### `BAD_PAYLOAD` — Malformed API response

**Symptoms:** Error message like `Linear issue payload is missing required fields` or `Jira response was not valid JSON`.

**Cause:** The API returned unexpected data — usually due to API version changes, incomplete issue data, or network issues returning HTML error pages.

**Fix:**
1. Verify the issue exists and is accessible with your token.
2. Check if the external API is experiencing downtime.
3. If using a custom API URL, verify it's correct.
4. Try fetching a single issue to isolate the problem:
   ```bash
   prlt work linear --issue ENG-123
   prlt work jira --issue INFRA-77
   ```

### `REQUEST_FAILED` — HTTP error from external API

**Symptoms:** Error message mentioning a status code (e.g., `status 500`, `status 429`).

**Cause:** Server error or rate limiting.

**Fix:**
1. **429 (Rate Limited):** Wait and retry. Linear allows 400 req/min; Jira limits vary by plan.
2. **5xx (Server Error):** Check the provider's status page. Retry after a few minutes.
3. Reduce batch size with `--limit` flag if fetching many issues.

### Mapping not persisted

**Symptoms:** `prlt execution list` doesn't show the external issue link.

**Cause:** The spawn may have failed after normalization but before mapping persistence.

**Fix:**
1. Check if the execution was created: `prlt execution list`
2. Re-run the spawn command — the mapping store uses upsert, so re-running is safe.

---

## Fallback Modes

### Manual issue entry

If the external API is unavailable, create tickets manually:

```bash
prlt ticket create \
  --title "ENG-123: Fix flaky CI checks" \
  --description "Ported from Linear ENG-123. CI fails intermittently on macOS." \
  --priority P1 \
  --label bug
```

### Offline spawn with known metadata

If you have the issue details but can't reach the API:

```bash
prlt work start \
  --title "INFRA-77: Upgrade Kubernetes to 1.29" \
  --description "Rolling upgrade of k8s clusters." \
  --priority P1
```

### Switching between sources

Both Linear and Jira can be configured simultaneously. The environment variables are independent — having both sets configured does not cause conflicts.

```bash
# Spawn from Linear
prlt work linear --issue ENG-42

# Spawn from Jira
prlt work jira --issue INFRA-77
```

---

## Monitoring and Observability

### Verify external mappings

```bash
# Check mappings for a specific execution
prlt execution show WORK-12345678
```

### Database inspection (advanced)

The mapping data is stored in three SQLite tables:

- `pmo_external_execution_map` — master mapping (provider, external_id, external_key, state snapshot)
- `pmo_external_execution_links` — links to execution IDs
- `pmo_external_execution_prs` — links to PR URLs

```bash
# Query mappings directly (from HQ directory)
sqlite3 .proletariat/workspace.db "SELECT * FROM pmo_external_execution_map;"
```

---

## Related Documentation

- [CLI Reference](cli-reference.md) — Full command reference
- [Getting Started](getting-started.md) — Initial setup guide
- [Troubleshooting](troubleshooting.md) — General CLI troubleshooting
- [Ticket Lifecycle](workflows/ticket-lifecycle.md) — How tickets flow through the PMO
