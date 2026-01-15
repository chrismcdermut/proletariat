# Core Concepts

This document explains the fundamental concepts and architecture of Proletariat. Understanding these concepts will help you use the tool effectively and make the most of multi-agent development workflows.

## Table of Contents

- [Workspace](#workspace)
- [PMO (Project Management Office)](#pmo-project-management-office)
- [Tickets](#tickets)
- [Agents](#agents)
- [Work and Execution](#work-and-execution)
- [Specs (Specifications)](#specs-specifications)
- [Epics](#epics)
- [Projects](#projects)
- [Board and Workflow](#board-and-workflow)
- [Entity Relationships](#entity-relationships)

---

## Workspace

A **workspace** is a directory that organizes all the repositories needed for a project, workstream, or entire business. It's your central command center for managing agents and work.

### Structure

```
my-workspace/
├── .proletariat/           # Configuration and database
│   ├── config.json         # Workspace settings
│   └── workspace.db        # SQLite database
├── repos/                  # Git repositories
│   ├── backend-api/        # Could be one repo
│   ├── frontend-web/       # or many repos
│   └── mobile-app/         # for your business
├── agents/                 # Agent workspaces
│   └── staff/
│       ├── altman/         # Each agent's worktree
│       ├── bezos/
│       └── musk/
└── pmo/                    # Project Management Office
    ├── board.md            # Markdown board export
    └── specs/              # Specification files
```

### Use Cases

A workspace can organize:

- **Single project** - One repo, a few agents working on features
- **Full product** - Multiple repos (frontend, backend, mobile), coordinated work
- **Entire business** - All company repos, multiple teams worth of agents

### Creating a Workspace

```bash
mkdir my-workspace
cd my-workspace
prlt init
```

---

## PMO (Project Management Office)

**PMO** is the work management system within your workspace. It tracks tickets, specs, epics, and projects.

### Components

| Component | Description |
|-----------|-------------|
| **Tickets** | Individual work items |
| **Specs** | Detailed requirement documents |
| **Epics** | Collections of related tickets |
| **Projects** | Organizational containers |
| **Board** | Visual workflow representation |

### Data Storage

PMO data is stored in SQLite (`workspace.db`) with optional markdown export:

- **Database** - Source of truth for all PMO entities
- **board.md** - Synced markdown representation for Obsidian/editors
- **specs/** - Markdown specification files

### Philosophy

PMO follows a ticket-driven workflow:

1. **Specs** define what needs to be built
2. **Tickets** break specs into actionable work
3. **Epics** group tickets for larger features
4. **Projects** organize epics and tickets by domain

---

## Tickets

**Tickets** are the atomic units of work in Proletariat. They represent specific tasks that agents complete.

### Ticket Lifecycle

```
┌──────────┐   ┌─────────┐   ┌─────────────┐   ┌───────────┐   ┌──────┐
│ Backlog  │ → │ Planned │ → │ In Progress │ → │ In Review │ → │ Done │
└──────────┘   └─────────┘   └─────────────┘   └───────────┘   └──────┘
                                                                  ↓
                                                            ┌───────────┐
                                                            │ Canceled  │
                                                            └───────────┘
```

### Ticket Properties

| Property | Description | Example |
|----------|-------------|---------|
| **ID** | Unique identifier | TKT-001 |
| **Title** | Short description | "Add login endpoint" |
| **Description** | Detailed requirements | Markdown content |
| **Priority** | Urgency level | P0, P1, P2, P3 |
| **Category** | Work type | feature, bug, docs |
| **Status** | Workflow state | backlog, in-progress |
| **Assignee** | Assigned agent | altman, bezos |

### Priority Levels

| Priority | Meaning | Usage |
|----------|---------|-------|
| **P0** | Critical | Blockers, production issues |
| **P1** | High | Important features, major bugs |
| **P2** | Medium | Normal priority work |
| **P3** | Low | Nice-to-have, future work |

### Categories

| Category | Description |
|----------|-------------|
| `feature` | New functionality |
| `bug` | Bug fixes |
| `docs` | Documentation |
| `refactor` | Code improvements |
| `test` | Testing work |
| `chore` | Maintenance tasks |

---

## Agents

**Agents** are AI coding assistants that work on tickets. Each agent operates in an isolated environment and uses billionaire-themed names by default for fun!

### Agent Characteristics

- **Named identity** - altman, bezos, musk, gates, etc.
- **Isolated workspace** - Separate git worktree per agent
- **Docker container** - Optional containerized execution
- **Assigned work** - Works on tickets assigned to them

### Default Agent Names (Billionaire Theme)

- altman (Sam Altman)
- bezos (Jeff Bezos)
- musk (Elon Musk)
- gates (Bill Gates)
- zuck (Mark Zuckerberg)
- nadella (Satya Nadella)
- pichai (Sundar Pichai)
- cook (Tim Cook)
- brin (Sergey Brin)
- page (Larry Page)
- ellison (Larry Ellison)
- ballmer (Steve Ballmer)

### Agent Isolation Model

```
┌─────────────────────────────────────┐
│            Workspace                 │
│  ┌─────────┐   ┌─────────┐          │
│  │ Agent   │   │ Agent   │          │
│  │ altman  │   │ bezos   │          │
│  │ ┌─────┐ │   │ ┌─────┐ │          │
│  │ │ Git │ │   │ │ Git │ │  Repos   │
│  │ │Work-│ │   │ │Work-│ │  ┌─────┐ │
│  │ │tree │ │   │ │tree │ │  │main │ │
│  │ └─────┘ │   │ └─────┘ │  └─────┘ │
│  │ branch: │   │ branch: │          │
│  │ feat/   │   │ fix/    │          │
│  │ TKT-001 │   │ TKT-002 │          │
│  └─────────┘   └─────────┘          │
└─────────────────────────────────────┘
```

### Why Isolation Matters

1. **No conflicts** - Agents can't overwrite each other's work
2. **Clean branches** - Each ticket gets its own branch
3. **Safe execution** - Docker containers protect your host
4. **Parallel work** - Multiple agents work simultaneously

### Agent Lifecycle

```bash
# Add agent
prlt agent add altman

# Agent works on ticket
prlt work spawn TKT-001 altman

# Agent finishes, creates PR
# Review and merge PR

# Agent available for next ticket
```

---

## Work and Execution

**Work** represents an agent actively working on a ticket. **Execution** is the running instance of that work.

### Work States

| State | Description |
|-------|-------------|
| `assigned` | Ticket assigned to agent |
| `in-progress` | Agent actively working |
| `ready` | Work complete, PR created |
| `in-review` | PR under review |
| `complete` | Work merged and done |

### Execution Model

When you spawn work:

1. **Container created** - Docker container starts
2. **Context loaded** - Ticket info injected into agent
3. **Agent works** - Claude Code (or other AI) runs
4. **PR created** - Agent commits and creates PR
5. **Container exits** - Execution complete

### Execution Commands

```bash
# View active executions
prlt work list

# View execution logs
prlt work logs TKT-001

# Stop execution
prlt execution stop <execution-id>
```

---

## Specs (Specifications)

**Specs** are detailed requirement documents that describe features or systems in depth.

### Spec vs Ticket

| Aspect | Spec | Ticket |
|--------|------|--------|
| **Purpose** | Define requirements | Define work |
| **Detail** | Comprehensive | Focused |
| **Lifecycle** | Long-lived | Completed |
| **Relationship** | 1 spec → many tickets | 1 ticket → 1 agent |

### Spec Types

| Type | Description |
|------|-------------|
| `product` | User-facing features |
| `platform` | System capabilities |
| `infra` | Infrastructure and DevOps |
| `integration` | External system integrations |

### Spec Workflow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Create Spec  │ →   │ Generate     │ →   │ Work on      │
│ with details │     │ Tickets      │     │ Tickets      │
└──────────────┘     └──────────────┘     └──────────────┘
```

```bash
# Create detailed spec
prlt spec create

# Generate implementation tickets
prlt spec ticket SPEC-001

# Generate implementation plan
prlt spec plan SPEC-001
```

---

## Epics

**Epics** group related tickets for larger features that span multiple work items.

### Epic Structure

```
┌─────────────────────────────────────┐
│         EPIC-001                    │
│    "User Authentication"            │
│                                     │
│  ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ TKT-001 │ │ TKT-002 │ │TKT-003│ │
│  │ Login   │ │ Logout  │ │ JWT   │ │
│  └─────────┘ └─────────┘ └───────┘ │
└─────────────────────────────────────┘
```

### Epic Properties

| Property | Description |
|----------|-------------|
| **ID** | Unique identifier (EPIC-001) |
| **Name** | Epic title |
| **Description** | Detailed description |
| **Tickets** | Child tickets |
| **Specs** | Related specifications |
| **Progress** | Completion percentage |

### Epic Workflow

```bash
# Create epic
prlt epic create --name "User Auth"

# Add tickets to epic
prlt epic ticket EPIC-001 TKT-001 TKT-002 TKT-003

# Track progress
prlt epic progress EPIC-001
```

---

## Projects

**Projects** are top-level organizational containers that group tickets, epics, and specs.

### Project Purpose

- **Organization** - Group related work
- **Filtering** - View work by project
- **Workflows** - Each project can have custom statuses
- **Isolation** - Keep different initiatives separate

### Project Hierarchy

```
┌────────────────────────────────────────────┐
│              PROJECT                        │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │              EPICS                   │   │
│  │  ┌──────────┐  ┌──────────┐         │   │
│  │  │ EPIC-001 │  │ EPIC-002 │         │   │
│  │  └──────────┘  └──────────┘         │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │             TICKETS                  │   │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐│   │
│  │  │001 │ │002 │ │003 │ │004 │ │005 ││   │
│  │  └────┘ └────┘ └────┘ └────┘ └────┘│   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │              SPECS                   │   │
│  │  ┌──────────┐  ┌──────────┐         │   │
│  │  │ SPEC-001 │  │ SPEC-002 │         │   │
│  │  └──────────┘  └──────────┘         │   │
│  └─────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

---

## Board and Workflow

The **Board** visualizes tickets across workflow statuses in a kanban-style view.

### Default Workflow

```
Backlog → Planned → In Progress → In Review → Done
                                      ↓
                                  Canceled
```

### Status Categories

| Category | Statuses | Meaning |
|----------|----------|---------|
| **Unstarted** | Backlog, Planned | Work not yet begun |
| **Started** | In Progress | Active work |
| **Completed** | In Review, Done | Work finished |
| **Canceled** | Canceled | Work abandoned |

### Board View

```bash
prlt board
```

Output:

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│   Backlog    │   Planned    │ In Progress  │  In Review   │     Done     │
├──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ TKT-005      │ TKT-003      │ TKT-001      │ TKT-002      │ TKT-004      │
│ P3 docs      │ P2 feature   │ altman       │ bezos        │ completed    │
│              │ TKT-004      │ P0 feature   │ P1 bug       │              │
│              │ P2 refactor  │              │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

### Custom Workflows

Projects can have custom workflow statuses:

```bash
# Create custom status
prlt status create --name "QA Testing"

# Reorder statuses
prlt status move --id 5 --position 3

# Use status templates
prlt status template apply --name "agile"
```

---

## Entity Relationships

### Relationship Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                           PROJECT                                 │
│                              │                                    │
│           ┌──────────────────┼──────────────────┐                │
│           │                  │                  │                │
│           ▼                  ▼                  ▼                │
│        ┌──────┐          ┌──────┐          ┌──────┐             │
│        │ EPIC │          │TICKET│          │ SPEC │             │
│        └──────┘          └──────┘          └──────┘             │
│           │                  │                  │                │
│           │                  │                  │                │
│           └──────────────────┼──────────────────┘                │
│                              │                                    │
│                              ▼                                    │
│                          ┌──────┐                                │
│                          │AGENT │                                │
│                          └──────┘                                │
│                              │                                    │
│                              ▼                                    │
│                          ┌──────┐                                │
│                          │ WORK │                                │
│                          └──────┘                                │
│                              │                                    │
│                              ▼                                    │
│                          ┌──────┐                                │
│                          │  PR  │                                │
│                          └──────┘                                │
└──────────────────────────────────────────────────────────────────┘
```

### Relationship Types

| Relationship | Description |
|--------------|-------------|
| Project → Tickets | Project contains tickets |
| Project → Epics | Project contains epics |
| Project → Specs | Project contains specs |
| Epic → Tickets | Epic groups tickets |
| Spec → Tickets | Spec generates tickets |
| Ticket → Agent | Agent works on ticket |
| Ticket → Work | Work represents active execution |
| Work → PR | Work produces pull request |

### Dependency Types

Entities can have dependencies:

| Type | Description |
|------|-------------|
| **blocks** | A must complete before B starts |
| **duplicates** | A is duplicate of B |
| **relates** | A is related to B |

```bash
# Ticket A blocks ticket B
prlt ticket link block TKT-001 TKT-002

# Spec A depends on spec B
prlt spec link depends SPEC-001 SPEC-002
```

---

## Mental Model Summary

1. **Workspace** organizes repos for a project, workstream, or business
2. **PMO** manages all work items
3. **Projects** organize work into domains
4. **Epics** group related tickets
5. **Specs** define detailed requirements
6. **Tickets** are atomic work units
7. **Agents** (altman, bezos, musk...) work on tickets in isolation
8. **Work/Execution** is the active running of ticket work
9. **Board** visualizes workflow status

---

See also:
- [Getting Started](getting-started.md) - Quick start guide
- [Features](features.md) - Feature documentation
- [Command Reference](commands/README.md) - All commands
- [README](../README.md) - Project overview
