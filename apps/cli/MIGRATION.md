# PROLETARIAT CLI v0.2.0 Migration Guide

## Breaking Changes

Version 0.2.0 introduces clearer terminology to distinguish between the top-level organizational directory and individual agent workspaces:

### Terminology Changes

- **HQ (Headquarters)**: The top-level directory that contains your repositories and agent workspaces
- **Agent Workspace**: Individual git worktree directories where AI agents or you work

### Command Line Changes

#### Init Command
```bash
# Old (v0.1.x)
prlt init --workspace acme-corp
prlt init --workspace-root ~/code/agents

# New (v0.2.0)
prlt init --hq acme-corp
prlt init --hq-root ~/code/agents
```

#### Migrate Command
```bash
# Old (v0.1.x)
prlt migrate

# New (v0.2.0)
prlt migrate acme-corp-hq
```

### Configuration Changes

The configuration format has been updated to use HQ terminology:

```json
// Old (v0.1.x)
{
  "layout": {
    "mode": "workspace",
    "workspaceName": "acme-corp"
  }
}

// New (v0.2.0)
{
  "layout": {
    "mode": "hq",
    "hqName": "acme-corp"
  }
}
```

## Automatic Migration

When you run `prlt upgrade`, your configuration will be automatically updated:

1. Layout mode `"workspace"` becomes `"hq"`
2. Field `workspaceName` becomes `hqName`
3. All functionality remains the same

## Backwards Compatibility

For a smooth transition, v0.2.0 maintains backwards compatibility:

- Old `--workspace` flags still work (mapped to `--hq`)
- Old `--workspace-root` flags still work (mapped to `--hq-root`)
- Old configuration fields are automatically migrated

These legacy options will be removed in v1.0.0.

## Upgrade Steps

1. Update to v0.2.0:
   ```bash
   npm install -g @proletariat/cli@latest
   ```

2. Run upgrade in each repository:
   ```bash
   cd your-repo
   prlt upgrade
   ```

3. (Optional) If you want to move a repository into an HQ:
   ```bash
   prlt migrate your-company-hq
   ```

## What Stays the Same

- All your existing agent workspaces continue to work
- Theme commands (`hire`, `fire`, `drive`, `park`, etc.) remain unchanged
- Your git worktrees are unaffected
- The underlying functionality is identical

## Need Help?

If you encounter any issues during migration:

1. Check your configuration is updated: `.proletariat/repo.json`
2. Run `prlt upgrade` to ensure automatic migration
3. Report issues at: https://github.com/chrismcdermut/proletariat-cli/issues

## Summary

This update is purely about clarity:
- **HQ** = Your company/project headquarters directory
- **Agent Workspace** = Individual git worktree where work happens

The change prevents confusion between the organizational directory structure and the actual workspaces where code is edited.