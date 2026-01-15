# Proletariat Monorepo

Internal monorepo for Proletariat development.

## Public Package

The CLI is published separately via git subtree:

- **Public repo**: [proletariat-ai/proletariat](https://github.com/proletariat-ai/proletariat)
- **npm package**: `@proletariat/cli`
- **Documentation**: See [apps/cli/README.md](apps/cli/README.md)

## Structure

```
proletariat/
├── apps/
│   └── cli/           # Main CLI (published via subtree)
├── docs/              # Internal docs
├── specs/             # Internal specifications
├── scripts/           # Build utilities
├── pmo/               # PMO templates
└── ROADMAP.md         # Internal roadmap
```

## Development

```bash
# Install dependencies
pnpm install

# Build CLI
cd apps/cli && pnpm build

# Run locally
./apps/cli/bin/run.js <command>

# Run tests
pnpm test
```

## Publishing

Push CLI to public repo:

```bash
git subtree push --prefix=apps/cli public main
```

## Internal Docs

- [Roadmap](ROADMAP.md) - Internal roadmap with ticket details
- [CLI README](apps/cli/README.md) - Public-facing documentation
- [Data Model](docs/data-model.md) - Database schema
- [PMO Storage](docs/architecture/pmo-storage.md) - Storage architecture
