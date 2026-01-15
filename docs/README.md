# Proletariat Documentation

Welcome to the Proletariat documentation. This guide covers everything you need to know about using `prlt` for multi-agent development orchestration.

## Getting Started

New to Proletariat? Start here:

1. **[Getting Started Guide](getting-started.md)** - Install prlt and complete your first ticket lifecycle in under 5 minutes
2. **[Core Concepts](concepts.md)** - Understand HQ, PMO, tickets, agents, and the mental model

## Core Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](getting-started.md) | Step-by-step installation and onboarding |
| [Features](features.md) | Complete feature overview and capabilities |
| [Concepts](concepts.md) | Architecture, mental model, and terminology |
| [Command Reference](commands/README.md) | All commands with examples |

## Quick Links

### Common Tasks

| Task | Guide |
|------|-------|
| Install prlt | [Getting Started](getting-started.md#step-1-install-proletariat) |
| Create first ticket | [Getting Started](getting-started.md#step-3-create-your-first-ticket) |
| Add agents | [Getting Started](getting-started.md#step-4-add-ai-agents) |
| Spawn work | [Getting Started](getting-started.md#step-5-start-work) |

### Command Namespaces

| Namespace | Description |
|-----------|-------------|
| [ticket](commands/README.md#ticket) | Create and manage work tickets |
| [work](commands/README.md#work) | Spawn and monitor agent work |
| [agent](commands/README.md#agent) | Manage AI coding agents |
| [board](commands/README.md#board) | Visualize work in kanban board |
| [pr](commands/README.md#pr) | Create and manage pull requests |
| [spec](commands/README.md#spec) | Manage detailed specifications |
| [epic](commands/README.md#epic) | Manage epics (ticket groups) |
| [project](commands/README.md#project) | Organize work into projects |

## Architecture & Reference

| Document | Description |
|----------|-------------|
| [Data Model](data-model.md) | Database schema and entity relationships |
| [PMO Storage](architecture/pmo-storage.md) | Storage architecture design |
| [Code Review](CODE-REVIEW.md) | Code review guidelines |

## Additional Resources

- [README](../README.md) - Project overview and quick start
- [ROADMAP](../ROADMAP.md) - Upcoming features and releases
- [CONTRIBUTING](../CONTRIBUTING.md) - Contribution guidelines

## Getting Help

- Run `prlt --help` for CLI help
- Run `prlt <command> --help` for command-specific help
- [GitHub Issues](https://github.com/proletariat-ai/proletariat/issues) - Report bugs and request features

---

## Document Map

```
docs/
├── README.md                 # This file - documentation index
├── getting-started.md        # Installation and onboarding
├── features.md               # Feature overview
├── concepts.md               # Core concepts and architecture
├── commands/
│   └── README.md            # Command reference
├── data-model.md            # Database schema
├── data-model-current.md    # Current data model state
├── architecture/
│   └── pmo-storage.md       # Storage architecture
└── CODE-REVIEW.md           # Code review guidelines
```
