# Changelog Fragments

This directory holds per-PR changelog fragments that are aggregated into `CHANGELOG.md` during a release.

## Fragment Format

Each fragment is a YAML file named `<ticket-id>.yaml` (e.g., `TKT-1175.yaml`).

```yaml
# Required: one of added, fixed, changed, removed
type: added

# Required: one-line description of the change (include ticket ID prefix)
description: "TKT-1175: Add fragment-based changelog workflow"
```

### Valid `type` values

| Type | When to use |
|------|-------------|
| `added` | New feature or capability |
| `fixed` | Bug fix |
| `changed` | Change to existing behavior, refactor, dependency update |
| `removed` | Removed feature or deprecated code |

### Multiple entries

If a PR includes changes spanning multiple types, use a list:

```yaml
entries:
  - type: added
    description: "TKT-100: Add user search endpoint"
  - type: fixed
    description: "TKT-100: Fix pagination in user list"
```

## Skipping

If a PR does not require a changelog entry (e.g., docs-only, CI config, tests), add the `skip-changelog` label to the PR. The CI check will pass without a fragment.

## How It Works

1. Feature/fix PRs add a `.changelog/<ticket-id>.yaml` file
2. At release time, `scripts/aggregate-changelog.mjs` collects all fragments
3. Fragments are grouped by type and prepended to `CHANGELOG.md` as a new version section
4. Consumed fragment files are deleted in the release PR

See [docs/changelog-workflow.md](../docs/changelog-workflow.md) for full details.
