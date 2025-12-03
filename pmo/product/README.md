# Product Specifications

This folder contains **living product definitions** - specs, requirements, and architecture docs that define WHAT the product should do.

## Key Principle

**Specs don't "complete" - they evolve.**

Unlike implementation work (epics/tickets) which flow through draft → active → complete, product specs stay in one place and get updated as requirements change.

## Folder Structure

Organize specs by domain/area:

```
product/
├── cli/                    # CLI command specs
│   ├── init-commands.md    # prlt init, prlt pmo init
│   ├── ticket-commands.md  # prlt ticket create, list, move
│   └── board-commands.md   # prlt board view, sync
│
├── frontend/               # Frontend specs (if applicable)
│   ├── dashboard.md
│   └── kanban-view.md
│
├── backend/                # Backend/API specs
│   └── api.md
│
└── architecture.md         # System-wide design
```

## Spec Format

Each spec should include:

1. **Purpose** - What this feature/area does
2. **Requirements** - What it must do (testable criteria)
3. **Commands/API** - Interface specification
4. **Examples** - Usage examples
5. **Implementation Notes** - Technical considerations

## Relationship to Implementation

- Specs define WHAT → Lives here in `product/`
- Epics define HOW to build it → Lives in `projects/{id}/epics/`
- Tickets are atomic tasks → Tracked on the board

When a spec changes (new requirements, bug fixes), create new tickets/epics to implement the changes. The spec itself gets updated to reflect the new expected behavior.
