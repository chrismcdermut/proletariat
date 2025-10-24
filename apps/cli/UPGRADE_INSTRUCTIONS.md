# Upgrading Your Existing Workspaces to v0.2.0

## Quick Steps for Each Repository

Since you have two repos with existing "workspace" setups, run these commands in each:

### Step 1: Update Each Repository
```bash
# For first repo
cd /path/to/first-repo
prlt upgrade    # Updates config from workspace → HQ terminology
prlt repair     # Fixes any broken worktree paths if repo was moved

# For second repo  
cd /path/to/second-repo
prlt upgrade    # Updates config from workspace → HQ terminology
prlt repair     # Fixes any broken worktree paths if repo was moved
```

### Step 2: Verify Everything Works
```bash
# Check your agents are working
prlt staff      # or prlt garage/portfolio depending on theme
git worktree list   # Should show all worktrees with correct paths
```

## What These Commands Do

### `prlt upgrade`
- Updates your `.proletariat/repo.json` configuration
- Changes `"workspace"` → `"hq"` in layout mode
- Renames `workspaceName` → `hqName` fields
- Fully automatic, no manual editing needed

### `prlt repair`
- Fixes broken `.git` file references in worktrees
- Updates paths if repository was moved
- Preserves all your work and branches
- Safe to run multiple times

## If You Want to Reorganize

If you want to move a repo into a proper HQ structure:
```bash
cd your-repo
prlt migrate your-company-hq
```

This will:
- Create `your-company-hq/` directory
- Move your repo into it
- Update all worktree references
- Keep all your work intact

## Troubleshooting

If agents show as broken after upgrade:
1. Run `prlt repair` first
2. Check with `git worktree list`
3. If still broken, you can remove and recreate:
   ```bash
   prlt fire broken-agent
   prlt hire broken-agent
   ```

The upgrade is designed to be seamless - your existing workspace layout continues working with the new HQ terminology!