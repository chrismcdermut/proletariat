---
sidebar_position: 2
title: Quick Start
---

# Quick Start

This guide walks you through creating your first agent workflow in under 5 minutes.

## 1. Initialize Your Workspace

Navigate to your project's root directory and run:

```bash
cd ~/projects/my-app
prlt init
```

This interactive wizard will:
- Create the `.proletariat/` directory with your workspace database
- Add your repositories
- Let you choose an agent naming theme (billionaires, toyotas, companies, or custom)

## 2. Create a Ticket

Create a ticket describing the work you want done:

```bash
prlt ticket create
```

Or use flags for non-interactive mode:

```bash
prlt ticket create \
  --title "Add user authentication" \
  --description "Implement login/logout with session management" \
  --priority P1 \
  --category feature
```

This creates `TKT-001` and adds it to your backlog.

## 3. Spawn an Agent

Start an agent to work on your ticket:

```bash
prlt work spawn
```

The interactive menu will:
1. Let you select tickets to work on
2. Choose the execution environment (Docker or host)
3. Select the action (implement, groom, review)

Or spawn directly:

```bash
prlt work start TKT-001
```

## 4. Monitor Progress

Watch your agent's progress:

```bash
# View running executions
prlt execution list

# See real-time board updates
prlt board watch

# Attach to the agent's tmux session
prlt session attach <agent-name>
```

## 5. Review the PR

When the agent completes work, it will:
1. Commit changes
2. Open a pull request
3. Update the ticket status to "In Review"

Review and merge as you would any PR:

```bash
# View PR status
prlt pr status TKT-001
```

## Complete Workflow Example

```bash
# Initialize (once per project)
prlt init

# Create multiple tickets
prlt ticket create --title "Add OAuth" --category feature
prlt ticket create --title "Fix login bug" --category bug
prlt ticket create --title "Improve performance" --category enhancement

# Spawn agents in parallel
prlt work spawn TKT-001 TKT-002 TKT-003

# Monitor
prlt board watch

# When ready, review PRs and merge
```

## What's Next?

- [Core Concepts](/getting-started/core-concepts) - Understand how prlt works
- [Spawning Agents](/guides/spawning-agents) - Deep dive into agent management
- [Docker Setup](/guides/docker-setup) - Run agents in containers
- [Command Reference](/commands) - Full CLI documentation
