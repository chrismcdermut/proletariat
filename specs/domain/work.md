---
title: Work
domain: work
---

# Work

## Overview

Work tracks the execution of tickets by agents. It includes claiming tickets, starting agent sessions, and tracking execution status. Combines ownership (human accountability) with assignment (who does the work).

## Abilities

| Ability | Description | storage | cli | api | web | obsidian |
|---------|-------------|---------|-----|-----|-----|----------|
| Claim ticket | Claim ownership of a ticket, making the user accountable | `updateTicket()` | `prlt work claim` | `POST /api/work/claim` | `ClaimButton` | - |
| Assign ticket | Assign a ticket to an agent or human for execution | `updateTicket()` | `prlt work assign` | `POST /api/work/assign` | `AssignDropdown` | `frontmatter` |
| Start work | Start an agent session to work on a ticket | `createExecution()` | `prlt work start` | `POST /api/work/start` | `StartButton` | - |
| Mark ready | Mark agent's work as ready for human review | `updateExecution()` | `prlt work ready` | `POST /api/work/ready` | `ReadyButton` | - |
| Revise work | Spawn an agent to address PR feedback | `createExecution()` | `prlt work revise [ticketId]` | - | - | - |
| Complete work | Mark the execution as complete and close the session | `updateExecution()` | `prlt work complete` | `POST /api/work/complete` | `CompleteButton` | - |
| Stop execution | Stop a running agent execution before completion | `updateExecution()` | `prlt execution stop` | `POST /api/executions/:id/stop` | `StopButton` | - |
| List executions | List all work executions with filtering options | `listExecutions()` | `prlt execution list` | `GET /api/executions` | `ExecutionList` | - |
| View logs | View the output logs from an agent execution | `getExecutionLogs()` | `prlt execution logs` | `GET /api/executions/:id/logs` | `LogViewer` | - |

### CLI Flags

**Mark ready** (`prlt work ready`):
- `--pr`: Create a pull request for this work
- `--draft`: Create PR as draft (only with --pr)
- `--no-pr`: Skip PR creation prompt

**Revise work** (`prlt work revise`):
- `--force`, `-f`: Proceed even if no pending feedback
- `--agent`, `-a`: Agent to perform the work

### Revise Work Flow

1. Fetches PR feedback from ticket's linked PR
2. Checks for pending feedback (changes requested, comments)
3. Moves ticket back to In Progress column
4. Spawns agent with PR feedback context in prompt
5. Agent addresses feedback, commits, and pushes

## Data Model

### Work Execution

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | WORK-001 format |
| ticket_id | ref | ✓ | - | Ticket being worked on |
| agent_name | ref | ✓ | - | Agent doing the work |
| executor | enum | | claude-code | claude-code, codex, aider |
| mode | enum | | interactive | interactive, autonomous |
| environment | enum | | host | host, devcontainer, docker, vm |
| display_mode | enum | | terminal | terminal, foreground, background, tmux |
| sandboxed | boolean | | true | Whether permissions restricted |
| status | enum | | starting | starting, running, completed, failed, stopped |
| branch | string | | null | Git branch for this work |
| pid | string | | null | Process ID |
| container_id | string | | null | Docker container ID |
| session_id | string | | null | Session identifier |
| host | string | | null | Remote host if VM |
| log_path | string | | null | Path to log file |
| started_at | timestamp | auto | now | Start time |
| completed_at | timestamp | | null | End time |
| exit_code | number | | null | Process exit code |
| create_pr | boolean | | false | Whether to create PR when ready |
| pr_feedback | string | | null | Formatted PR feedback (for revisions) |
| is_revision | boolean | | false | Whether this is a revision execution |

## Business Rules

- **Owner vs Assignee**: Owner is accountable (human), Assignee does work (agent or human)
- **One task at a time**: Agent can only work on one ticket at a time
- **Branch naming**: Work branches follow `agent/{name}/{ticket-id}` pattern
- **Worktree isolation**: Each agent gets isolated git worktree per repo
- **Status transitions**: starting → running → completed/failed/stopped

## Column Configuration

Work commands automatically move tickets between columns. Column mappings are configurable via [Settings](settings.md).

| Command | Setting | Default | Description |
|---------|---------|---------|-------------|
| `work start` | `column_in_progress` | In Progress | Active work |
| `work ready` | `column_review` | Review | Awaiting review |
| `work complete` | `column_done` | Done | Completed |

See [Settings](settings.md) for template-specific defaults and configuration details.

## Execution Environments

| Environment | Description | Isolation | Use Case |
|-------------|-------------|-----------|----------|
| host | Direct on machine | None | Fast startup |
| devcontainer | VS Code devcontainer | Container | Recommended |
| docker | Raw Docker container | Container | Reproducible |
| vm | Remote VM via SSH | Full | Cloud scale |

## Display Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| terminal | New terminal window | See agent work separately |
| foreground | Current terminal | Debug, watch agent |
| background | Detached, logs to file | Async work |
| tmux | New tmux pane | Multiple agents side-by-side |

## Related Domains

- [Tickets](tickets.md) - Work executes tickets
- [Agents](agents.md) - Agents perform work
- [Settings](settings.md) - Column configuration for work lifecycle
- [Pull Requests](pull-requests.md) - PR creation and feedback handling
