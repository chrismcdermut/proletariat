---
sidebar_position: 3
title: Core Concepts
---

# Core Concepts

Understanding these core concepts will help you use prlt effectively.

## Workspace (HQ)

Your **workspace** (also called HQ - headquarters) is the root of your prlt setup. It contains:

- `.proletariat/workspace.db` - SQLite database with all state
- `repos/` - Your source repositories
- `agents/` - Agent workspaces (git worktrees)

```
my-project/
├── .proletariat/
│   └── workspace.db
├── repos/
│   ├── frontend/
│   ├── backend/
│   └── infra/
└── agents/
    ├── staff/
    │   └── alice/           # Named persistent agent
    └── temp/
        └── agent-abc123/    # Ephemeral ticket agent
```

## Tickets

**Tickets** are the unit of work. Each ticket has:

- Title and description
- Priority (P0-P4)
- Category (feature, bug, enhancement, etc.)
- Acceptance criteria
- Status (follows workflow phases)

Tickets provide structured context that agents read to understand their task.

```bash
prlt ticket create --title "Add OAuth" --category feature
prlt ticket view TKT-001
prlt ticket edit TKT-001 --add-ac "Must support Google login"
```

## Agents

**Agents** are Claude Code instances that work on tickets. There are two types:

### Staff Agents

Persistent named agents with dedicated workspaces. Use for ongoing work:

```bash
prlt staff add alice bob charlie
prlt work start TKT-001 --agent alice
```

### Temp Agents

Ephemeral agents spawned per-ticket. They work, create a PR, and can be cleaned up:

```bash
prlt work spawn TKT-001  # Creates temporary agent
prlt agent cleanup       # Remove old temp agents
```

## Agent Naming Themes

Themes control how agents are named:

| Theme | Example Names |
|-------|---------------|
| `billionaires` | musk, gates, bezos |
| `toyotas` | camry, supra, tacoma |
| `companies` | stripe, vercel, linear |
| Custom | Your own names |

```bash
prlt theme list
prlt theme set billionaires
prlt theme create mytheme
prlt theme add-names mytheme
```

## Workflows

**Workflows** define how tickets move through your process. A workflow has:

- **Phases** - Major stages (Backlog, Active, Complete)
- **Statuses** - States within phases (To Do, In Progress, In Review)

```
Kanban Workflow
├── Backlog       # New tickets land here
├── In Progress   # Agent working
├── Review        # PR ready
└── Done          # Merged
```

## Executions

An **execution** is a running agent session. It tracks:

- Which agent is running
- Which ticket it's working on
- The tmux session for attaching
- Start time and status

```bash
prlt execution list      # View running agents
prlt execution logs abc  # See agent output
prlt execution stop abc  # Stop an agent
```

## Actions

**Actions** are reusable prompt templates. Built-in actions include:

| Action | Purpose |
|--------|---------|
| `implement` | Write code to fulfill ticket requirements |
| `groom` | Add acceptance criteria, estimate, break down |
| `review` | Review code and suggest improvements |

```bash
prlt action list
prlt action create
prlt work start TKT-001 --action implement
```

## Execution Modes

### Environment

Where the agent runs:

| Environment | Best For |
|------------|----------|
| **Docker** | Safety - fully isolated containers |
| **Host** | Speed - no container overhead |

### Display

How you see output:

| Display | Best For |
|---------|----------|
| **Terminal** | Watch in new terminal tab |
| **Background** | Detached, reattach later |

### Permissions

Agent access level:

| Mode | Description |
|------|-------------|
| **Safe** | Agent prompts for permissions |
| **YOLO** | No prompts, full access (use with Docker) |

## Three Ways to Use Commands

### 1. Interactive (Humans)

Run without flags for guided prompts:

```bash
prlt ticket create
# Interactive prompts guide you through
```

### 2. JSON Mode (AI Agents)

Add `--json` for machine-readable output:

```bash
prlt work start --json
# Returns structured JSON for programmatic parsing
```

### 3. Flags (Scripts/CI)

Pass everything directly:

```bash
prlt ticket create --title "Add OAuth" --priority P1
```

## Data Model Summary

```
Workspace (HQ)
├── Projects
│   ├── Epics → Tickets
│   └── (references a Workflow)
├── Workflows → Phases → Statuses
├── Specs
├── Actions
├── Agents (Staff + Temp)
└── Executions
```

## Next Steps

- [Creating Tickets](/guides/creating-tickets) - Ticket management best practices
- [Spawning Agents](/guides/spawning-agents) - Run agents effectively
- [Docker Setup](/guides/docker-setup) - Container-based execution
