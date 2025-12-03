# Agent Commands Specification

## Purpose
Commands for managing agents (worker worktrees) in an HQ workspace. Split between individual operations (`prlt agent`) and bulk operations (`prlt agents`).

## Core Concepts
- **Agent**: A named worktree containing all repository clones, representing a "worker"
- **Theme**: Agent naming scheme (tech founders, scientists, philosophers, etc.)
- **Worktree**: Git worktree for each repository, isolated per agent
- **Individual vs Bulk**: Singular `agent` for one-at-a-time, plural `agents` for batch

## Command Overview

### Individual Operations (`prlt agent`)
| Command                    | Purpose                               | Status         |
| -------------------------- | ------------------------------------- | -------------- |
| `prlt agent`               | Interactive menu for agent operations | ✅ Implemented |
| `prlt agent status [name]` | Show detailed status for one agent    | ✅ Implemented |
| `prlt agent visit [name]`  | Navigate to agent directory           | ✅ Implemented |
| `prlt agent add`           | Add single agent (redirects to bulk)  | ✅ Implemented |
| `prlt agent remove [name]` | Remove specific agent                 | ✅ Implemented |

### Bulk Operations (`prlt agents`)
| Command                      | Purpose                          | Status         |
| ---------------------------- | -------------------------------- | -------------- |
| `prlt agents`                | Interactive menu for bulk ops    | ✅ Implemented |
| `prlt agents list`           | List all agents with status      | ✅ Implemented |
| `prlt agents status`         | Show status overview for all     | ✅ Implemented |
| `prlt agents add [names...]` | Add multiple agents              | ✅ Implemented |
| `prlt agents remove`         | Remove multiple agents           | ✅ Implemented |

---

## Individual Command Specifications

### `prlt agent`
**Purpose**: Interactive menu for individual agent operations

**Menu Options**:
```
🤖 Individual Agent Operations

? What would you like to do?
❯ 📊 Show agent status
  📁 Visit agent directory
  ➕ Add new agent
  🗑️  Remove agent
  ──────────────
  ❌ Cancel
```

---

### `prlt agent status [name]`
**Purpose**: Show detailed status for a specific agent

**Arguments**:
- `name` (optional): Agent name. If omitted, shows interactive selection.

**Output**:
```
🤖 Agent: bezos

🟢 Status: Active
📍 Location: /path/to/agents/staff/bezos
🌿 Branch: agent-bezos

📁 Repositories:
   • clevertap-react-native (clean)
   • integrated-ventures-infra (clean)
   • tech-thought-portfolio (clean) 2 commits ahead

🎫 Tickets:
   Active: TICK-001, TICK-003
   Completed: 5 ticket(s)

⚡ Activity:
   Last activity: 1 hour ago
```

**Behavior**:
- Shows comprehensive agent information
- Lists all repository statuses with commit information
- Displays ticket assignments (if PMO enabled)
- Shows last activity timestamp

---

### `prlt agent visit [name]`
**Purpose**: Navigate to agent directory for development work

**Arguments**:
- `name` (optional): Agent name. If omitted, shows interactive selection.

**Output**:
```
🤖 Visiting agent: bezos
  cd ../../../agents/staff/bezos

Note: Due to shell limitations, you need to run this command manually.
```

**Behavior**:
- Calculates relative path from current directory
- Validates agent exists before providing navigation
- Provides clear instructions for manual execution

---

### `prlt agent add`
**Purpose**: Add single agent (redirects to bulk add)

**Behavior**:
- Redirects to `agents add` command for unified experience
- Allows selection of single or multiple agents

---

### `prlt agent remove [name]`
**Purpose**: Remove a specific agent from the workspace

**Arguments**:
- `name` (optional): Agent name. If omitted, shows interactive selection.

**Confirmation Flow**:
```
? Are you sure you want to remove agent "bezos"? This will delete its worktree.
❯ ❌ No, cancel
  ⚠️  Yes, remove agent

Removing agent "bezos"...
✅ Agent bezos removed
```

---

## Bulk Command Specifications

### `prlt agents`
**Purpose**: Interactive menu for bulk agent operations

**Menu Options**:
```
👥 Agents Management (Bulk Operations)

? What would you like to do?
❯ 📋 List all agents
  📊 Show status overview
  ➕ Add agents (bulk)
  ➖ Remove agents (bulk)
  ──────────────
  ❌ Cancel
```

---

### `prlt agents list`
**Purpose**: List all agents with their current status

**Output**:
```
👥 Active Agents:

🟢 bezos - Active
   Branch: agent-bezos
   Repositories: 5 repo(s), 1 dirty, commits ahead: tech-thought-portfolio(+2)
   Current tickets: TICK-001, TICK-003
   Completed: 5 ticket(s)
   Last active: 1 hour ago

🟢 gates - Active
   Branch: agent-gates
   Repositories: 5 repo(s)
   No active tickets
   Last active: 3 days ago

🔴 zuck - Missing
   Agent directory not found
   Run "prlt agent add" to recreate

📊 Summary:
   Total agents: 3
   Active: 2
   Inactive: 1
   Tickets assigned: 2
```

---

### `prlt agents status`
**Purpose**: Show compact status overview for all agents

**Output**:
```
📊 Agent Status Overview:

🟢 bezos       - Active   - 2 tickets - 1 hour ago
🟢 gates       - Active   - 0 tickets - 3 days ago
🔴 zuck        - Inactive

Summary:
  3 agents (2 active, 1 inactive)
  2 active tickets assigned
```

---

### `prlt agents add [names...]`
**Purpose**: Add multiple agents to the workspace

**Arguments**:
- `names` (optional): Space-separated agent names. If omitted, shows interactive multi-select.

**Interactive Selection**:
```
? Select agents to add: (Use space to select)
  ◯ bezos
  ◉ gates
  ◉ zuck
  ◯ musk
  ──────────────
  ❌ Cancel
```

**Output**:
```
🎉 Successfully added 2 agent(s): gates, zuck
```

**Behavior**:
- Validates names against current theme
- Creates agent directories with worktrees for all repos
- Skips agents that already exist

---

### `prlt agents remove`
**Purpose**: Remove multiple agents from the workspace

**Interactive Selection**:
```
? Select agents to remove: (Use space to select)
  ◯ bezos
  ◉ gates
  ◉ zuck
  ──────────────
  ❌ Cancel

⚠️ You are about to remove 2 agents. This will delete their worktrees.

? Are you sure?
❯ ❌ No, cancel
  ⚠️  Yes, remove agents

Removing agents...
✅ Removed 2 agent(s): gates, zuck
```

---

## Design Principles

### Individual vs Bulk Pattern
- **Singular (`agent`)**: Operations on one agent at a time with detailed output
- **Plural (`agents`)**: Batch operations with summary output
- **Consistent UX**: Both use interactive selection when arguments omitted

### Interactive Defaults
- All commands prompt for missing arguments
- Arrow key navigation with cancel option
- Multi-select checkboxes for bulk operations

### Status Information
- Repository states (clean, dirty, missing)
- Commit ahead/behind counts
- Ticket assignments (when PMO enabled)
- Last activity timestamps

### Agent Directory Structure
```
agents/staff/bezos/
├── .proletariat/
│   └── config.json         # Agent-specific configuration
├── clevertap-react-native/ # Git worktree for repo 1
├── tech-thought-portfolio/ # Git worktree for repo 2
└── ...                     # Additional repository worktrees
```
