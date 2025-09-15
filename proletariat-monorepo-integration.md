# Proletariat Monorepo Integration Spec

## Overview
Consolidate Proletariat into the main monorepo while maintaining npm package publishing.

## Proposed Structure

```
/your-monorepo
├── /apps
│   ├── careerops-web
│   ├── careerops-backend
│   └── careerops-extension
├── /packages
│   ├── proletariat/          # <-- Move here
│   │   ├── package.json      # npm publishable
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   ├── src/
│   │   └── dist/
│   └── other-shared-packages/
├── /pmo
├── pnpm-workspace.yaml
└── package.json
```

## Implementation Steps

### 1. Move Proletariat
```bash
# Copy proletariat into packages/
cp -r ~/Projects/proletariat ./packages/

# Update pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'  # <-- Includes proletariat
```

### 2. Update Proletariat package.json
```json
{
  "name": "@chrismcdermut/proletariat",
  "version": "2.0.0",
  "publishConfig": {
    "access": "public",
    "directory": "packages/proletariat"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "pnpm run build"
  }
}
```

### 3. Publishing Workflow
```bash
# From monorepo root
cd packages/proletariat
pnpm version patch
pnpm build
pnpm publish --access public

# Or from root with filter
pnpm -F @chrismcdermut/proletariat publish
```

### 4. CI/CD Integration
```yaml
# .github/workflows/publish-proletariat.yml
name: Publish Proletariat
on:
  push:
    paths:
      - 'packages/proletariat/**'
    tags:
      - 'proletariat-v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm -F @chrismcdermut/proletariat build
      - run: pnpm -F @chrismcdermut/proletariat publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Benefits

1. **Single repo**: Everything in one place
2. **Shared tooling**: Linting, formatting, CI/CD
3. **Dogfooding**: Use proletariat in the same repo
4. **Version control**: Git history in main repo
5. **npm package**: Still publishable independently

## Commands

```bash
# Install globally from npm
npm install -g @chrismcdermut/proletariat

# Or use locally in monorepo
pnpm -F careerops-extension exec prlt hire bezos

# Development
pnpm -F @chrismcdermut/proletariat dev
pnpm -F @chrismcdermut/proletariat test
```

## Considerations

- Keep README focused on public use
- Maintain backwards compatibility
- Consider workspace protocol: `"proletariat": "workspace:*"`
- Add to .npmignore: src/, tests/, .env files

This gives you the best of both worlds - monorepo benefits + npm package distribution!