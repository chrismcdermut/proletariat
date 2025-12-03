# Product Specifications

This folder contains **living product definitions** - specs that define WHAT the product should do. These are updated in place as requirements evolve, not moved through a lifecycle.

## Key Principle

**Specs don't "complete" - they evolve.**

Unlike implementation work (epics/tickets) which flow through draft → active → complete, product specs stay in one place and get updated as requirements change.

## Folder Structure

Specs are organized by system layer:

```
specs/
├── cli/                    # CLI commands (presentation layer)
│   ├── init-commands.md    # prlt init, prlt pmo init
│   ├── agent-commands.md   # prlt agent commands
│   ├── pmo-board-commands.md
│   ├── pmo-project-commands.md
│   ├── pmo-spec-commands.md
│   ├── pmo-ticket-commands.md
│   └── pmo-work-commands.md
│
├── storage/                # Storage layer implementations
│   ├── pmo-storage-sqlite.md
│   ├── pmo-storage-git.md
│   ├── pmo-storage-cloud.md
│   └── pmo-storage-adapter.md
│
└── architecture/           # System-wide design
    └── pmo-interface.md    # Core PMO interface spec
```

## Spec Format

Each spec should include:

1. **Purpose** - What this feature/area does
2. **Requirements** - What it must do (testable criteria)
3. **Commands/API** - Interface specification
4. **Examples** - Usage examples
5. **Implementation Notes** - Technical considerations

## Relationship to Implementation

- **Specs define WHAT** → Lives here in `specs/`
- **Epics define HOW** to build it → Lives in `pmo/projects/{id}/epics/`
- **Tickets are atomic tasks** → Tracked on the board

When a spec changes (new requirements, bug fixes), create new tickets/epics to implement the changes. The spec itself gets updated to reflect the new expected behavior.

## Ownership

Specs are owned by the product/technical vision. They represent the canonical source of truth for what the system should do. Implementation may lag behind specs, but specs always represent the target state.
