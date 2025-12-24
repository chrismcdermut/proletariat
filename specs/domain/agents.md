---
title: Agents
domain: agents
---

# Agents

## Overview

Agents are AI coding assistants that can be assigned to work on tickets. Each agent has its own git worktree for isolated work, and can run in various environments (host, devcontainer, docker, vm).

## Abilities

### Add agent

Register a new agent in the workspace.

| Modality | Signature |
|----------|-----------|
| storage | `createAgent()` |
| cli | `prlt agent add` |
| api | `POST /api/agents` |
| web | `AddAgentModal` |

### Remove agent

Remove an agent from the workspace.

| Modality | Signature |
|----------|-----------|
| storage | `deleteAgent()` |
| cli | `prlt agent remove` |
| api | `DELETE /api/agents/:name` |
| web | `RemoveButton` |

### List agents

List all registered agents and their status.

| Modality | Signature |
|----------|-----------|
| storage | `listAgents()` |
| cli | `prlt agent list` |
| api | `GET /api/agents` |
| web | `AgentList` |

### View agent

View details and current status of an agent.

| Modality | Signature |
|----------|-----------|
| storage | `getAgent()` |
| cli | `prlt agent status` |
| api | `GET /api/agents/:name` |
| web | `/agents/:name` |

### Start work

Start an agent working on a ticket.

| Modality | Signature |
|----------|-----------|
| storage | `createExecution()` |
| cli | `prlt work start` |
| api | `POST /api/work/start` |
| web | `StartButton` |

### Mark ready

Mark agent's work as ready for review.

| Modality | Signature |
|----------|-----------|
| storage | `updateExecution()` |
| cli | `prlt work ready` |
| api | `POST /api/work/ready` |
| web | `ReadyButton` |

### Complete work

Mark agent's work as complete.

| Modality | Signature |
|----------|-----------|
| storage | `updateExecution()` |
| cli | `prlt work complete` |
| api | `POST /api/work/complete` |
| web | `CompleteButton` |

### Claim ticket

Claim ownership of a ticket (human accountability).

| Modality | Signature |
|----------|-----------|
| storage | `updateTicket()` |
| cli | `prlt work claim` |
| api | `POST /api/work/claim` |
| web | `ClaimButton` |

### Assign ticket

Assign a ticket to an agent for execution.

| Modality | Signature |
|----------|-----------|
| storage | `updateTicket()` |
| cli | `prlt work assign` |
| api | `POST /api/work/assign` |
| web | `AssignDropdown` |

### Stop execution

Stop a running agent execution.

| Modality | Signature |
|----------|-----------|
| storage | `updateExecution()` |
| cli | `prlt execution stop` |
| api | `POST /api/executions/:id/stop` |
| web | `StopButton` |

### List executions

List all work executions.

| Modality | Signature |
|----------|-----------|
| storage | `listExecutions()` |
| cli | `prlt execution list` |
| api | `GET /api/executions` |
| web | `ExecutionList` |

### View logs

View logs from an agent execution.

| Modality | Signature |
|----------|-----------|
| storage | `getExecutionLogs()` |
| cli | `prlt execution logs` |
| api | `GET /api/executions/:id/logs` |
| web | `LogViewer` |

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
| executor | enum | | claude-code | claude-code, codex, aider |
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
