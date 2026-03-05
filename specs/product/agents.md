---
title: Agents
domain: agents
---

# Agents

## Overview

Agents are AI coding assistants that can be assigned to work on tickets. Each agent has its own git worktree for isolated work, and can run in various environments (host, devcontainer, docker, vm).

## Abilities

| Ability | Description | storage | cli | api | web |
|---------|-------------|---------|-----|-----|-----|
| Add agent | Register a new agent in the workspace | `createAgent()` | `prlt agent add` | `POST /api/agents` | `AddAgentModal` |
| Remove agent | Remove an agent from the workspace | `deleteAgent()` | `prlt agent remove` | `DELETE /api/agents/:name` | `RemoveButton` |
| List agents | List all registered agents and their status | `listAgents()` | `prlt agent list` | `GET /api/agents` | `AgentList` |
| View agent | View details and current status of an agent | `getAgent()` | `prlt agent status` | `GET /api/agents/:name` | `/agents/:name` |
| Start work | Start an agent working on a ticket | `createExecution()` | `prlt work start` | `POST /api/work/start` | `StartButton` |
| Mark ready | Mark agent's work as ready for review | `updateExecution()` | `prlt work ready` | `POST /api/work/ready` | `ReadyButton` |
| Complete work | Mark agent's work as complete | `updateExecution()` | `prlt work complete` | `POST /api/work/complete` | `CompleteButton` |
| Claim ticket | Claim ownership of a ticket (human accountability) | `updateTicket()` | `prlt work claim` | `POST /api/work/claim` | `ClaimButton` |
| Assign ticket | Assign a ticket to an agent for execution | `updateTicket()` | `prlt work assign` | `POST /api/work/assign` | `AssignDropdown` |
| Stop execution | Stop a running agent execution | `updateExecution()` | `prlt execution stop` | `POST /api/executions/:id/stop` | `StopButton` |
| List executions | List all work executions | `listExecutions()` | `prlt execution list` | `GET /api/executions` | `ExecutionList` |
| View logs | View logs from an agent execution | `getExecutionLogs()` | `prlt execution logs` | `GET /api/executions/:id/logs` | `LogViewer` |

## Data Model

### Agents

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | ✓ | - | Unique agent name (e.g., altman) |
| theme | string | | null | Agent theme/personality |
| status | enum | | idle | idle, busy, offline |
| current_task | ref | | null | Current ticket ID if busy |
| created_at | timestamp | auto | now | Creation time |
| last_activity | timestamp | auto | now | Last activity time |

### Agent Work (Executions)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | WORK-001 format |
| ticket_id | ref | ✓ | - | Ticket being worked on |
| agent_name | ref | ✓ | - | Agent doing the work |
| executor | enum | | claude-code | claude-code, codex, custom |
| environment | enum | | host | host, devcontainer, docker, vm |
| display_mode | enum | | terminal | terminal, foreground, background, tmux |
| sandboxed | boolean | | true | Whether permissions are restricted |
| status | enum | | running | running, completed, failed, stopped |
| branch | string | | null | Git branch for this work |
| pid | string | | null | Process ID |
| started_at | timestamp | auto | now | Start time |
| completed_at | timestamp | | null | End time |

## Business Rules

- **Unique names**: Agent names must be unique within workspace
- **One task at a time**: Agent can only work on one ticket (busy checking)
- **Worktree per repo**: Each agent gets isolated git worktree
- **Branch naming**: Work branches follow `agent/{name}/{ticket-id}` pattern
- **Owner vs Assignee**: Owner is accountable (human), Assignee does work (agent)

## Execution Environments

| Environment | Description | Use Case |
|-------------|-------------|----------|
| host | Runs directly on machine | Fast startup, no isolation |
| devcontainer | VS Code devcontainer | Sandboxed, recommended |
| docker | Raw Docker container | Reproducible, isolated |
| vm | Remote VM via SSH | Cloud scale, parallel |

## Display Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| terminal | New terminal window | See agent work separately |
| foreground | Current terminal | Debug, watch agent |
| background | Detached, logs to file | Async work |
| tmux | New tmux pane | Multiple agents side-by-side |

## Work Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                      TICKET LIFECYCLE                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Backlog ──▶ In Progress ──▶ In Review ──▶ Done              │
│               ↑    (agent)      ↑   (human)                   │
│               │                 │                             │
│         ┌─────┴─────┐     ┌─────┴─────┐                       │
│         │  START    │     │  REVIEW   │                       │
│         └─────┬─────┘     └───────────┘                       │
│               │                                               │
│               ▼                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                  EXECUTION LIFECYCLE                   │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │  running ──▶ completed                                │   │
│  │     │            │                                    │   │
│  │     ▼            ▼                                    │   │
│  │  failed      (ticket moves to In Review)              │   │
│  │     │                                                 │   │
│  │     ▼                                                 │   │
│  │  stopped                                              │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Related Domains

- [Tickets](tickets.md) - Agents work on tickets
- [Projects](projects.md) - Agents belong to workspace
