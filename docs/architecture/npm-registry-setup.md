# Private NPM Registry for Agent Downloads

This document describes the dual registry architecture used to separate agent installs from real user downloads.

## Problem

When agents install `@proletariat/cli` from public npm, they inflate download counts, making it impossible to distinguish real user adoption from internal agent usage. This makes usage analytics inaccurate.

## Solution: Dual Registry Architecture

```
                          Real Users
                              |
                              v
                    ┌─────────────────┐
                    │  Public npm     │  <-- Real user installs
                    │  (npmjs.com)    │      (accurate download stats)
                    └─────────────────┘
                              ^
                              |
                    ┌─────────────────┐
                    │  CI/CD Release  │
                    │  (GitHub Actions)│
                    └─────────────────┘
                              |
                              v
                    ┌─────────────────┐
                    │ GitHub Packages │  <-- Agent installs
                    │ (npm.pkg.github)│      (doesn't count in npm stats)
                    └─────────────────┘
                              ^
                              |
                      Agent Containers
```

## How It Works

### Publishing (CI/CD)

When a new version is released, GitHub Actions publishes to both registries:

1. **Public npm** (for users): Uses `NPM_TOKEN` secret
2. **GitHub Packages** (for agents): Uses built-in `GITHUB_TOKEN`

See `.github/workflows/onRelease.yml` for the publish workflow.

### User Installs

Regular users install from public npm as usual:

```bash
npm install -g @proletariat/cli
```

This counts toward public npm download stats and reflects real adoption.

### Agent Installs

Agent containers use the `gh` channel to install from GitHub Packages:

```bash
# In .proletariat/config.json
{
  "prlt": {
    "channel": "gh"
  }
}
```

This installs from GitHub Packages, which doesn't inflate public npm stats.

## Configuration

### Setting the Agent Channel

Configure agents to use GitHub Packages in your workspace config:

```bash
# Edit .proletariat/config.json
{
  "type": "hq",
  "name": "my-workspace",
  "prlt": {
    "channel": "gh"
  }
}
```

### Channel Options

| Channel | Source | Use Case |
|---------|--------|----------|
| `npm` | Public npm (npmjs.com) | Default, for users |
| `npm:dev` | Public npm dev tag | Testing pre-release |
| `gh` | GitHub Packages | Agent containers |
| `gh:dev` | GitHub Packages dev tag | Agent testing |
| `mount` | Local build | Development |

### GitHub Token Requirements

Agent containers need a `GITHUB_TOKEN` with `packages:read` scope to pull from GitHub Packages:

```bash
# Set in your environment
export GITHUB_TOKEN=ghp_xxxx
```

The token is passed to the container via the devcontainer.json build args.

## Verifying Setup

### Check Agent is Using GitHub Packages

Inside an agent container:

```bash
# This should show GitHub Packages was used
npm list -g @proletariat/cli
```

### Verify Public npm Stats

Visit [npmjs.com/package/@proletariat/cli](https://www.npmjs.com/package/@proletariat/cli) to see download stats. These should only reflect real user installs.

## Troubleshooting

### Agent Can't Pull from GitHub Packages

1. Check `GITHUB_TOKEN` is set and has `packages:read` scope
2. Verify the token is passed to the container build:
   ```bash
   echo $GITHUB_TOKEN
   ```
3. Check GitHub Packages availability:
   ```bash
   curl -H "Authorization: Bearer $GITHUB_TOKEN" \
     https://npm.pkg.github.com/@proletariat/cli
   ```

### Fallback to Public npm

If GitHub Packages is unavailable, change the channel to `npm`:

```json
{
  "prlt": {
    "channel": "npm"
  }
}
```

This will work but will inflate npm download stats.

## Development Workflow

For local development, use the `mount` channel to avoid any registry:

```json
{
  "prlt": {
    "channel": "mount"
  }
}
```

This mounts your local prlt build from `PRLT_REPO_PATH`.

## Related Files

- `apps/cli/.github/workflows/onRelease.yml` - Publish workflow
- `apps/cli/src/lib/execution/devcontainer.ts` - Container template with registry logic
- `apps/cli/src/lib/workspace-config.ts` - Channel configuration types
- `specs/infra/devcontainer.md` - Full devcontainer specification
