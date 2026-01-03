---
title: Hooks
domain: hooks
---

# Hooks

## Overview

Event-based hooks that trigger actions when specific events occur in the system. Hooks fire inline during CLI command execution (no server required) and enable automation like auto-spawning agents when tickets enter a column.

## Abilities

| Ability | Storage | CLI | API |
|---------|---------|-----|-----|
| Configure hooks | `setHook()` | `prlt config set hooks.<event> <action>` | - |
| List hooks | `getHooks()` | `prlt config get hooks` | - |
| Remove hook | `removeHook()` | `prlt config unset hooks.<event>` | - |
| Fire hook | `fireHook()` | (internal) | - |

## Events

| Event | Trigger | Context Available |
|-------|---------|-------------------|
| `ticket.created` | After `prlt ticket create` | ticketId, title, column, priority, category |
| `ticket.moved` | After ticket moves to column | ticketId, fromColumn, toColumn |
| `ticket.status_changed` | After status update | ticketId, fromStatus, toStatus |
| `ticket.assigned` | After assignee changes | ticketId, fromAgent, toAgent |
| `execution.started` | After agent spawned | executionId, ticketId, agentName |
| `execution.completed` | After agent finishes | executionId, ticketId, agentName, success |
| `pr.created` | After PR created | ticketId, prUrl, branch |

## Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `spawn` | Spawn agent for ticket | agent (optional), skip-permissions, create-pr |
| `notify` | Send notification | channel, message (template) |
| `move` | Move ticket to column | column |
| `shell` | Run shell command | command (template) |

## Data Model

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| event | enum | ✓ | | Event type to trigger on |
| action | enum | ✓ | | Action to execute |
| condition | string | | | Optional condition (e.g., `column == 'Ready'`) |
| params | json | | `{}` | Action-specific parameters |
| enabled | boolean | | `true` | Whether hook is active |

## Configuration

Hooks can be configured via:

1. **Workspace settings** (simple):
```bash
prlt config set hooks.auto-spawn-column "Ready"
prlt config set hooks.auto-spawn-on-create true
```

2. **Hooks file** (advanced):
```yaml
# .proletariat/hooks.yaml
hooks:
  - event: ticket.moved
    condition: "toColumn == 'Ready'"
    action: spawn
    params:
      skip-permissions: false
      create-pr: true

  - event: ticket.created
    action: spawn
    params:
      agent: damodei
```

## Business Rules

- **Inline execution**: Hooks fire synchronously during command execution, not via file watching or polling
- **Fail-safe**: Hook failures log warnings but don't fail the triggering command
- **No recursion**: Actions that would trigger the same hook are skipped to prevent infinite loops
- **Condition evaluation**: Conditions use simple expression syntax with event context variables

## Related Domains

- [Work](work.md) - spawn action triggers work start
- [Tickets](tickets.md) - ticket events trigger hooks
- [Settings](settings.md) - hook configuration stored in settings
