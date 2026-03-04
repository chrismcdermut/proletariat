# PRLT Data Model

Complete data model for the PRLT PMO and Agent/Execution systems.

## Overview

PRLT has two main subsystems:
1. **PMO System** - Project management (tickets, epics, specs, workflows)
2. **Agent System** - Execution and orchestration (agents, containers, work)

These connect via `agent_work.ticket_id` - when an agent works on a ticket.

---

## Complete Entity Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              PRLT COMPLETE DATA MODEL                                │
│                     (PMO + Agent/Execution + Proposed Changes)                       │
└─────────────────────────────────────────────────────────────────────────────────────┘



══════════════════════════════════════════════════════════════════════════════════════
                              WORKSPACE & CONFIGURATION
══════════════════════════════════════════════════════════════════════════════════════

┌───────────────────┐              ┌───────────────────┐
│     Workspace     │              │ Workspace Settings│
│───────────────────│              │───────────────────│
│ id (always 1)     │              │ key               │
│ type (hq/workspace│              │ value             │
│ theme             │              └───────────────────┘
│ workspace_name    │
│ has_pmo           │
│ active_theme_id ──┼──────────────────────────────────────────┐
│ created_at        │                                          │
└───────────────────┘                                          │
                                                               │
                                                               ▼
══════════════════════════════════════════════════════════════════════════════════════
                                 AGENT SYSTEM
══════════════════════════════════════════════════════════════════════════════════════

┌───────────────────┐         ┌───────────────────┐         ┌───────────────────┐
│   Agent Theme     │◀────────│      Agent        │────────▶│    Container      │
│───────────────────│  1:N    │───────────────────│   1:1   │───────────────────│
│ id                │         │ name (PK)         │         │ id                │
│ name              │         │ theme_id          │         │ agent_name        │
│ display_name      │         │ created_at        │         │ docker_id         │
│ description       │         └─────────┬─────────┘         │ docker_name       │
│ builtin           │                   │                   │ image             │
│ created_at        │                   │                   │ status            │
└─────────┬─────────┘                   │                   │ current_execution │
          │                             │                   │ created_at        │
          │ 1:N                         │                   │ last_seen_at      │
          ▼                             │                   └─────────┬─────────┘
┌───────────────────┐                   │                             │
│ Agent Theme Names │                   │                             │
│───────────────────│                   │                             │
│ theme_id          │                   │                             │
│ name              │                   │                             │
│ used              │                   │ 1:N                         │
└───────────────────┘                   │                             │
                                        ▼                             │
                              ┌───────────────────┐                   │
                              │  Agent Worktree   │                   │
                              │───────────────────│                   │
                              │ agent_name (PK)   │                   │
                              │ repo_name (PK)    │───────────────────┼───┐
                              │ worktree_path     │                   │   │
                              │ branch            │                   │   │
                              │ created_at        │                   │   │
                              │ last_commit_hash  │                   │   │
                              │ commits_ahead     │                   │   │
                              │ is_clean          │                   │   │
                              │ last_checked      │                   │   │
                              └───────────────────┘                   │   │
                                                                      │   │
                                                                      │   │
══════════════════════════════════════════════════════════════════════│═══│══════════
                              EXECUTION SYSTEM                        │   │
══════════════════════════════════════════════════════════════════════│═══│══════════
                                                                      │   │
┌───────────────────┐                                                 │   │
│    Agent Work     │◀────────────────────────────────────────────────┘   │
│   (Execution)     │    container.current_execution_id                   │
│───────────────────│                                                     │
│ id                │                                                     │
│ ticket_id      ───┼────────────────────────────────────────────┐        │
│ agent_name        │                                            │        │
│ executor          │  (claude-code, codex, etc.)                │        │
│ mode              │  (work, chat, autonomous)                  │        │
│ environment       │  (host, docker)                            │        │
│ display_mode      │  (terminal, background, tmux)              │        │
│ sandboxed         │                                            │        │
│ status            │  (starting, running, completed, failed)    │        │
│ branch            │                                            │        │
│ pid               │                                            │        │
│ container_id      │                                            │        │
│ session_id        │                                            │        │
│ host              │                                            │        │
│ log_path          │                                            │        │
│ started_at        │                                            │        │
│ completed_at      │                                            │        │
│ exit_code         │                                            │        │
└───────────────────┘                                            │        │
                                                                 │        │
                                                                 │        │
══════════════════════════════════════════════════════════════════│════════│══════════
                              REPOSITORY SYSTEM                   │        │
══════════════════════════════════════════════════════════════════│════════│══════════
                                                                 │        │
                              ┌───────────────────┐              │        │
                              │    Repository     │◀─────────────┼────────┘
                              │───────────────────│              │
                              │ name (PK)         │              │
                              │ path              │              │
                              │ type (main/dep)   │              │
                              │ source_url        │              │
                              │ action            │              │
                              │ added_at          │              │
                              └───────────────────┘              │
                                                                 │
                                                                 │
══════════════════════════════════════════════════════════════════│════════════════════
                              PMO SYSTEM                          │
══════════════════════════════════════════════════════════════════│════════════════════
                                                                 │
                                    ┌───────────────┐            │
                                    │  Initiative   │            │
                                    │   INIT-XXX    │            │
                                    └───────┬───────┘            │
                                            │ 1:N                │
                                            ▼                    │
┌───────────────┐                  ┌───────────────┐             │       ┌───────────────┐
│   Workflow    │                  │    Project    │             │       │     Phase     │
│   WKFL-XXX    │◀─────────────────│   PROJ-XXX    │─────────────┼──────▶│   (roadmap)   │
│   (NEW)       │   workflow_id    └───────┬───────┘             │       └───────────────┘
└───────┬───────┘                          │                     │
        │ 1:N                   ┌──────────┼──────────┐          │
        ▼                       │          │          │          │
┌───────────────┐               ▼          ▼          ▼          │
│    Status     │        ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│   (workflow)  │        │   Epic   │ │  Ticket  │◀┼──────────┼──┘
│───────────────│        │ EPIC-XXX │ │ TKT-XXX  │ │   Spec   │
│ category:     │        └────┬─────┘ └────┬─────┘ │ SPEC-XXX │
│ • backlog     │             │            │       └──────────┘
│ • unstarted   │             │            │
│ • started     │             ▼            ▼
│ • completed   │    ┌─────────────────────────────────────────────────┐
│ • canceled    │    │              DEPENDENCIES                        │
└───────────────┘    │  Epic ◀──blocks/relates/duplicates──▶ Epic      │
                     │  Ticket ◀──blocks──▶ Ticket                     │
                     │  Spec ◀──depends_on/relates/duplicates──▶ Spec  │
                     │  Project ◀── (not yet) ──▶ Project              │
                     └─────────────────────────────────────────────────┘
```

---

## Entity Relationships Summary

```
Workspace
    │
    ├──▶ Repositories (1:N)
    │        │
    │        └──▶ Agent Worktrees (1:N per agent)
    │
    ├──▶ Agent Themes (1:N)
    │        │
    │        ├──▶ Theme Names (1:N)
    │        │
    │        └──▶ Agents (1:N)
    │                 │
    │                 ├──▶ Containers (1:1)
    │                 │
    │                 ├──▶ Agent Worktrees (1:N per repo)
    │                 │
    │                 └──▶ Agent Work/Executions (1:N)
    │                              │
    │                              └──▶ Ticket (N:1)
    │
    └──▶ PMO (if has_pmo = true)
             │
             ├──▶ Initiatives (1:N)
             │        └──▶ Projects (1:N)
             │
             ├──▶ Workflows (1:N) ◀── PROPOSED (TKT-225)
             │        └──▶ Statuses (1:N)
             │
             ├──▶ Projects (1:N)
             │        ├──▶ Epics (1:N)
             │        │        └──▶ Tickets (1:N)
             │        │
             │        ├──▶ Tickets (1:N)
             │        │        ├──▶ Subtasks (1:N)
             │        │        ├──▶ Acceptance Criteria (1:N)
             │        │        ├──▶ Assignments (1:N)
             │        │        └──▶ Specs (N:M)
             │        │
             │        └──▶ Specs (N:M via project_specs)
             │                 ├──▶ Abilities (1:N)
             │                 ├──▶ Fields (1:N)
             │                 ├──▶ Rules (1:N)
             │                 └──▶ Implementations (1:N)
             │
             └──▶ Phases (1:N)
                      └──▶ Projects (1:N)
```

---

## Dependency System

| Entity  | Dependency Table       | Types                              |
|---------|------------------------|------------------------------------|
| Epic    | `epic_dependencies`    | blocks, relates_to, duplicates     |
| Ticket  | `ticket_dependencies`  | blocks                             |
| Spec    | `spec_dependencies`    | depends_on, relates_to, duplicates |
| Project | (not yet implemented)  | -                                  |

### Spec Relations

Specs also have a separate `spec_relations` table for relating specs to domains:

```sql
spec_relations (
  spec_id,
  related_domain,    -- e.g., "auth", "payments"
  relationship       -- e.g., "implements"
)
```

---

## Execution ↔ PMO Bridge

The Agent and PMO systems connect through ticket assignment:

```
┌───────────────┐                              ┌───────────────┐
│    Ticket     │                              │  Agent Work   │
│   TKT-XXX     │◀─────── ticket_id ──────────│  (Execution)  │
│───────────────│                              │───────────────│
│ branch        │◀─────── branch ─────────────│ branch        │
│ assignee      │◀─────── agent_name ─────────│ agent_name    │
│ status_id     │   (updates on completion)   │ status        │
└───────────────┘                              └───────────────┘
```

When agent work completes:
- `Ticket.branch` set from execution
- `Ticket.status_id` updated (e.g., to "in-progress" or "done")
- `Ticket.assignee` linked to agent

---

## ID Formats

### PMO Entities (Sequential)

| Format    | Entity     |
|-----------|------------|
| PROJ-001  | Project    |
| TKT-001   | Ticket     |
| EPIC-001  | Epic       |
| SPEC-001  | Spec       |
| WKFL-001  | Workflow   |
| INIT-001  | Initiative |

### Agent/Execution Entities (Slugs/UUIDs)

| Format      | Entity      |
|-------------|-------------|
| agent_name  | Agent (slug, e.g., "alice", "bezos") |
| uuid        | Container   |
| uuid        | Agent Work (execution) |
| repo_name   | Repository (slug) |
| theme_id    | Agent Theme (slug) |

---

## State Categories (Fixed in Code)

Workflow statuses must map to one of these categories:

| Category   | Description                        |
|------------|------------------------------------|
| backlog    | Not yet scheduled for work         |
| unstarted  | Scheduled but work hasn't begun    |
| started    | Work is actively in progress       |
| completed  | Work finished successfully         |
| canceled   | Work won't be done                 |

---

## Sort Order (TKT-227)

**Tickets:**
```sql
ORDER BY status_position, position, priority, created_at
```

**Projects:**
```sql
ORDER BY position, created_at
```

---

## Proposed Changes

### TKT-225: Workflow as Primitive

Currently, each project has its own copy of statuses. Proposed change:

**Current:**
```
Project ──1:N──▶ Status (per-project)
```

**Proposed:**
```
Workflow ──1:N──▶ Status
Project.workflow_id ──▶ Workflow
```

Benefits:
- Change workflow once → all projects update
- `prlt workflow` manages workflows
- `prlt status` becomes dashboard (like `git status`)

### TKT-227: Position Field

Add `position INTEGER` to:
- `pmo_tickets` - manual ordering within columns
- `pmo_projects` - roadmap ordering

---

## Database Tables

### Workspace & Config
- `workspace`
- `workspace_settings`

### Agent System
- `agents`
- `agent_themes`
- `agent_theme_names`
- `agent_worktrees`
- `agent_work`
- `containers`

### Repository System
- `repositories`

### PMO System
- `pmo_projects`
- `pmo_tickets`
- `pmo_epics`
- `pmo_specs`
- `pmo_statuses`
- `pmo_phases`
- `pmo_initiatives`
- `pmo_columns`
- `pmo_views`
- `pmo_settings`
- `pmo_templates`
- `pmo_actions`

### PMO Child Tables
- `pmo_subtasks`
- `pmo_ticket_acceptance_criteria`
- `pmo_ticket_assignments`
- `pmo_ticket_affected_paths`
- `pmo_ticket_metadata`
- `pmo_ticket_specs`
- `pmo_ticket_templates`
- `pmo_ticket_dependencies`
- `pmo_external_execution_map`
- `pmo_external_execution_links`
- `pmo_external_execution_prs`
- `pmo_project_specs`
- `pmo_spec_abilities`
- `pmo_spec_fields`
- `pmo_spec_rules`
- `pmo_spec_implementations`
- `pmo_spec_dependencies`
- `pmo_spec_relations`
- `pmo_epic_dependencies`
- `pmo_phase_templates`
- `pmo_board_tickets`
- `pmo_board_views`
- `pmo_cache_metadata`
