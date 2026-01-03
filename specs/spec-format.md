# Spec Format

Specs define the **ideal state** of the system. The codebase is the current state. The delta between them is work to be done.

## Paradigm

- **Spec** = ideal state (what it should be)
- **Code** = current state (what it is)
- **LLM** = delta detection (compares spec vs code, generates tickets)

Specs are living documents. Update them in place. Git history tracks evolution.

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

## Naming Convention

`{type}-{name}.md`

| Prefix | Type | Example |
|--------|------|---------|
| `prod-` | Product/feature specs | `prod-user-auth.md` |
| `plat-` | Platform/infrastructure | `plat-database.md` |
| `tech-` | Technical/architectural | `tech-api-design.md` |

## Storage

Specs are stored in the database. Files are exportable views for git sync.

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

## Workflow

1. Write spec describing ideal state
2. `prlt spec analyze` - LLM compares spec vs codebase
3. Tickets generated for the delta
4. Agents work tickets
5. Code converges toward spec
