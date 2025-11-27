# Release Process for PROLETARIAT CLI

## Prerequisites

1. **npm account** with access to `@proletariat` org
2. **2FA enabled** on npm account
3. **Clean working tree** - all changes committed
4. **On main branch** with latest changes pulled

## Release Steps

### 1. Update Version

```bash
cd apps/cli

# Choose version bump type:
npm version patch  # 0.1.3 -> 0.1.4 (bug fixes)
npm version minor  # 0.1.3 -> 0.2.0 (new features)
npm version major  # 0.1.3 -> 1.0.0 (breaking changes)
```

### 2. Build & Test

```bash
# Clean and rebuild
npm run clean
npm run build

# Test locally
npm link
cd /tmp && mkdir test-prlt && cd test-prlt
git init
prlt init  # Test the CLI works
```

### 3. Publish to npm

```bash
# Publish publicly
npm publish --access public

# You'll be prompted for 2FA code
```

### 4. Git Tag & Push

```bash
# Commit version bump
git add package.json package-lock.json
git commit -m "Release v0.1.4"

# Create and push tag
git tag v0.1.4
git push origin main --tags
```

### 5. Update Subtree Repository

Since we maintain `proletariat-cli` as a subtree:

```bash
# Push to subtree repo
git subtree push --prefix=apps/cli origin-cli main

# Or if you have the remote set up:
npm run push:cli  # If you have this script
```

### 6. Create GitHub Release

1. Go to https://github.com/chrismcdermut/proletariat-cli/releases
2. Click "Create a new release"
3. Choose the tag you just created
4. Add release notes:

```markdown
## What's New in v0.1.4

### ✨ Features
- Workspace configuration support
- New `upgrade` command for config migration
- New `repair` command for fixing broken worktrees
- New `migrate` command for moving repos into workspaces

### 🐛 Bug Fixes
- Fixed worktree references after repository moves
- Backwards compatible with existing configs

### 📚 Documentation
- Clarified persistent workspace concept
- Added examples of multi-repo setups

### ⬆️ Upgrading
Run `prlt upgrade` to migrate your configuration to the latest format.
```

## Quick Release (Once you're comfortable)

```bash
# From apps/cli directory
./scripts/release.sh
```

This script will:
1. Check for clean working tree
2. Prompt for version bump type
3. Build the project
4. Update version
5. Publish to npm
6. Create git tag
7. Push to GitHub

## Rollback (If something goes wrong)

```bash
# Unpublish a broken version (within 72 hours)
npm unpublish @proletariat/cli@0.1.4

# Or deprecate it
npm deprecate @proletariat/cli@0.1.4 "Broken version, please use 0.1.5"
```

## Version Guidelines

- **Patch** (0.0.X): Bug fixes, documentation updates
- **Minor** (0.X.0): New features, backwards compatible
- **Major** (X.0.0): Breaking changes

Currently in `0.x.x` - we can make breaking changes in minor versions while in alpha/beta.

## Checklist

Before each release:
- [ ] All tests pass
- [ ] README is updated
- [ ] Version number updated
- [ ] Changelog updated (if maintaining one)
- [ ] Works with `npm link` locally
- [ ] No sensitive data in code

After release:
- [ ] Verify on npmjs.com
- [ ] Test with fresh install: `npm i -g @proletariat/cli`
- [ ] Create GitHub release
- [ ] Tweet/announce if significant changes

## Current Maintainers

- @chrismcdermut

---

## Notes

- MIT license for maximum adoption
- Config format version is tracked separately from CLI version
- GitHub releases should be created at https://github.com/chrismcdermut/proletariat-cli