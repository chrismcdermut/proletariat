# Git Subtree Setup for Public CLI

## Current Setup
- Private monorepo: `/Users/chrismcdermut/Projects/proletariat` (this repo)
- Public CLI repo: https://github.com/chrismcdermut/proletariat-cli
- Remote name: `cli-public`

## Commands

### Push CLI to public repo
```bash
pnpm push:cli
# or manually:
git subtree push --prefix=apps/cli cli-public main
```

### Force push (if history diverged)
```bash
pnpm push:cli:force
```

### Initial setup (already done)
```bash
# Add remote
git remote add cli-public git@github.com:chrismcdermut/proletariat-cli.git

# First push
git subtree push --prefix=apps/cli cli-public main
```

## How it works
- Git subtree extracts just the `apps/cli` folder
- Creates a synthetic history with only those files
- Pushes to the public repo as if it were the entire repository
- Public repo has no knowledge of the monorepo structure

## Workflow
1. Work normally in the monorepo
2. Commit changes
3. When ready to release: `pnpm push:cli`
4. Then publish to npm from `apps/cli`