# Specs

## Problem

Need a way to define the ideal state of the system and generate work from the gap between ideal and current.

## Solution

Specs are living documents that describe what the system should be. The codebase is what it currently is. LLM detects the delta and generates tickets.

- **Spec** = ideal state (what it should be)
- **Code** = current state (what it is)
- **LLM** = delta detection (compares spec vs code, generates tickets)

Specs are stored in the database. Files are exportable views for git sync.

## Decisions

- Specs are living documents - update in place, git history tracks evolution
- DB is source of truth, markdown files are views
- Simple format: Problem, Solution, Decisions, Not Now, Context
- Folder structure: product/, platform/, integrations/, infra/
- Prefixes only for root-level files: prod-, plat-, tech-

## Format

```markdown
# {Title}

## Problem

Why this exists. What pain point or need it addresses.

## Solution

High-level approach. What we're building and why this approach.

## Decisions

- Key decision 1
- Key decision 2
- Rationale for non-obvious choices

## Not Now

Things explicitly deferred. Prevents scope creep.

## Context

Optional. Background info, links, references.
```

## Data Model

```sql
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  problem TEXT,
  solution TEXT,
  decisions TEXT,
  not_now TEXT,
  context TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `prlt spec create` | Create a new spec |
| `prlt spec list` | List all specs |
| `prlt spec view <id>` | View a spec |
| `prlt spec analyze` | LLM compares spec vs codebase, generates tickets |
| `prlt spec export` | Export specs to markdown files |
| `prlt spec import` | Import specs from markdown files |

## Workflow

1. Write spec describing ideal state
2. `prlt spec analyze` - LLM compares spec vs codebase
3. Tickets generated for the delta
4. Agents work tickets
5. Code converges toward spec

## Not Now

- AI-assisted spec writing
- Spec templates
- Bidirectional sync (start with manual export/import)
