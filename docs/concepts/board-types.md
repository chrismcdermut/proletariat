# Board Types & Intent Mapping

Actions reference **intents** (semantic stages) instead of provider-specific state names.
The `pmo_transition_map` table maps each intent to the correct column name for the connected board.

## Canonical Intents

| Intent | Description | Work Command |
|--------|-------------|-------------|
| `backlog` | Triaged but not ready to start | `work groom` |
| `ready` | Groomed and ready for development | `work groom` (to_intent) |
| `started` | Work has begun | `work start` |
| `needs_review` | Code complete, awaiting review | `work ready` |
| `completed` | Merged and done | `work ship` |
| `paused` | Temporarily blocked | `work stop` |
| `dropped` | Canceled / won't do | - |

## Real-World Board Examples

### Board 1: Linear (5-column)

| Intent | Provider State |
|--------|---------------|
| backlog | Backlog |
| ready | Todo |
| started | In Progress |
| needs_review | Review |
| completed | Done |

### Board 2: Trello (4-column)

| Intent | Provider State |
|--------|---------------|
| backlog | Backlog |
| ready | Development Ready |
| started | Working On |
| completed | Done |

`needs_review` has no column -- tickets stay in "Working On" until moved to "Done".

### Board 3: ClickUp (5-column)

| Intent | Provider State |
|--------|---------------|
| backlog | BACKLOG |
| ready | TO DO |
| started | IN PROGRESS |
| needs_review | IN REVIEW |
| completed | COMPLETE |

### Board 4: Enterprise QA-Heavy (7-column)

| Intent | Provider State |
|--------|---------------|
| backlog | Backlog |
| ready | Ready for Dev |
| started | In Development |
| needs_review | Code Review |
| testing | QA Testing |
| completed | Released |
| dropped | Won't Fix |

Custom `test` action: `to_intent='testing', from_intent='needs_review'`

### Board 5: Simple 3-Column

| Intent | Provider State |
|--------|---------------|
| backlog | To Do |
| ready | To Do |
| started | In Progress |
| needs_review | In Progress |
| completed | Done |

Multiple intents collapse to the same column. Actions still fire --
the ticket just doesn't visually move to a different column.

## How It Works

1. Action defines `to_intent='started'`
2. System looks up `pmo_transition_map` for the provider + intent
3. Gets provider state name (e.g., "Working On" for Trello)
4. Moves ticket to that state via the provider API

Same action definition works on every board.
