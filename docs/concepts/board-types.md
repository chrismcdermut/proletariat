# Board Types & Transition Mapping

prlt supports any kanban/project board regardless of column names. This document catalogs real-world board configurations and how they map to prlt's abstract intent system.

## How it works

prlt uses **abstract intents** to decouple its workflow engine from provider-specific column names. The `pmo_transition_map` table maps each intent to the provider's actual state name and ID.

### Base intents (always present)

| Intent | Meaning | prlt actions that fire |
|--------|---------|----------------------|
| `backlog` | Work identified but not prioritized | — |
| `ready` | Prioritized, ready to start | `on_ticket_ready → spawn-agent` |
| `started` | Agent/human actively working | `on_agent_spawned → move-ticket` |
| `needs_review` | PR opened, awaiting review | `on_pr_opened → spawn-review-agent` |
| `completed` | Work merged and done | `on_pr_merged → move-ticket`, worktree cleanup |
| `dropped` | Canceled, won't do | — |

### Optional intents (added per board as needed)

| Intent | Meaning | When to add |
|--------|---------|-------------|
| `testing` | QA phase, post-review | Board has separate QA columns |
| `rework` | Changes requested, back to dev | Board has a "Returned" column |
| `blocked` | Waiting on external dependency | Board has "Awaiting Feedback" or similar |
| `paused` | Temporarily stopped | Board has a "Paused" column |

## Real-world board examples

### Board 1 — Trello (feature-focused team)

```
New Functionality Requests
New Issues
Working On
Needs Review
Done
Not Working On
```

**Mapping:**
| Column | Intent | Notes |
|--------|--------|-------|
| New Functionality Requests | `backlog` | Intake category — multiple columns can map to same intent |
| New Issues | `backlog` | Same intent, different intake source |
| Working On | `started` | |
| Needs Review | `needs_review` | |
| Done | `completed` | |
| Not Working On | `dropped` | |

### Board 2 — Trello (dev-focused team)

```
Backlog
Development Ready
In Progress
In Review
Done
```

**Mapping:**
| Column | Intent |
|--------|--------|
| Backlog | `backlog` |
| Development Ready | `ready` |
| In Progress | `started` |
| In Review | `needs_review` |
| Done | `completed` |

This board maps 1:1 to prlt's base intents. No custom intents needed.

### Board 3 — ClickUp (client services team)

```
Not started:
  BACKLOG
  TO DO

Active:
  IN PROGRESS
  AWAITING CLIENT FEEDBACK
  PAUSED

Closed:
  COMPLETE
```

**Mapping:**
| Column | Intent | Notes |
|--------|--------|-------|
| BACKLOG | `backlog` | |
| TO DO | `ready` | Or `backlog` — depends on team's usage |
| IN PROGRESS | `started` | |
| AWAITING CLIENT FEEDBACK | `blocked` | Custom intent — orthogonal to progress |
| PAUSED | `paused` | Custom intent |
| COMPLETE | `completed` | |

**Notes:** ClickUp groups states into categories (Not started / Active / Closed). prlt's intent categories map similarly: `backlog`+`ready` = unstarted, `started`+`needs_review`+`blocked`+`paused` = active, `completed`+`dropped` = closed.

### Board 4 — Enterprise QA-heavy workflow

```
To Do
Returned
In Progress
In Review
To Test
Testing
Done
Closed
```

**Mapping:**
| Column | Intent | Notes |
|--------|--------|-------|
| To Do | `ready` | |
| Returned | `rework` | Custom intent — changes requested, back to developer |
| In Progress | `started` | |
| In Review | `needs_review` | |
| To Test | `testing` | Custom intent — QA sub-phase |
| Testing | `testing` | Same intent, different sub-state |
| Done | `completed` | |
| Closed | `dropped` | Ambiguous — could mean completed OR canceled. Must ask during onboarding. |

**Notes:** This board has a 7-step pipeline with QA sub-phases and a rework loop. Requires custom intents: `rework`, `testing`. The `Returned` to `In Progress` loop means agents may be re-spawned for the same ticket.

### Board 5 — Linear (proletariat, current)

```
Triage
Backlog
Ready
In Progress
Review
Done
Canceled
Duplicate
```

**Mapping:**
| Column | Intent |
|--------|--------|
| Triage | `paused` |
| Backlog | `backlog` |
| Ready | `ready` |
| In Progress | `started` |
| Review | `needs_review` |
| Done | `completed` |
| Canceled | `dropped` |
| Duplicate | `dropped` |

**Notes:** `Duplicate` maps to `dropped` — same terminal effect, different reason. Two columns map to `dropped`.

## Onboarding design considerations

### Auto-matching heuristics

During `prlt init` or `prlt connect`, prlt should auto-match columns to intents using fuzzy string matching:

| Pattern | Auto-maps to |
|---------|-------------|
| Contains "progress" | `started` |
| Contains "review" | `needs_review` |
| Contains "done", "complete", "finished" | `completed` |
| Contains "backlog" | `backlog` |
| Contains "ready", "todo", "to do", "to-do" | `ready` |
| Contains "cancel", "archived", "won't" | `dropped` |
| Contains "test" | `testing` (custom) |
| Contains "block", "wait", "feedback" | `blocked` (custom) |
| Contains "pause", "hold", "on hold" | `paused` (custom) |
| Contains "return", "rework", "revision" | `rework` (custom) |

### Ambiguous states that MUST ask the user

- **"Closed"** — completed or dropped? Team-dependent.
- **"Not Working On"** — dropped permanently, or paused/deprioritized?
- **"TO DO" vs "BACKLOG"** — same intent, or is one prioritized (ready) and the other not (backlog)?
- **Multiple intake columns** (New Issues vs New Functionality Requests) — same intent or different categories?

### Many-to-one mapping

Multiple board columns can map to the same intent. The transition map must support this:

```sql
-- Board 1: two intake columns, same intent
INSERT INTO pmo_transition_map (provider, intent, provider_state_name) VALUES
  ('trello-board-1', 'backlog', 'New Functionality Requests'),
  ('trello-board-1', 'backlog', 'New Issues');
```

Current schema has `UNIQUE(provider, intent)` which prevents this. Needs migration to `UNIQUE(provider, intent, provider_state_name)`.

### States orthogonal to progress

Some states (PAUSED, AWAITING CLIENT FEEDBACK) can happen at any stage — they are not steps in a pipeline. Options:

1. **Model as custom intents** — simple, works for transition map, but loses the "which stage was it paused FROM" context
2. **Model as flags on the ticket** — `is_blocked: true` alongside the progress intent. More expressive but more complex.
3. **Model as sub-states** — `started.paused`, `needs_review.blocked`. Captures both dimensions. Most expressive, most complex.

Recommendation: start with option 1 (custom intents), upgrade to option 3 if users need the "resume to previous state" capability.
