# `prlt agent` Specification

## Purpose
Manage AI agents (workers) within HQ and workspace-only environments. Agents are isolated development environments using git worktrees for parallel work on the same codebase.

## Core Concepts
- **Agent**: Named worker with dedicated git worktree and configuration
- **Worktree**: Separate working directory allowing parallel work on different branches
- **Theme Integration**: Agent names follow theme patterns (billionaires/toyotas/companies)
- **Dual Mode Support**: Works in both HQ and workspace-only setups

## Architecture

### HQ Mode Structure
```
my-project-hq/
├── agents/
│   └── garage/              # Theme workspace directory
│       ├── camry/           # Agent directory
│       │   ├── .proletariat/
│       │   │   └── config.json
│       │   ├── my-project/  # Git worktree (repo 1)
│       │   └── other-repo/  # Git worktree (repo 2)
│       └── tacoma/          # Another agent
│           ├── .proletariat/
│           └── my-project/
```

### Workspace-Only Mode Structure
```
parent-dir/
├── my-project/              # Original repository
└── my-project-garage/       # Workspace
    ├── camry/               # Agent directory
    │   ├── .proletariat/
    │   └── my-project/      # Git worktree
    └── tacoma/
        ├── .proletariat/
        └── my-project/
```

## Commands Overview

| Command                           | Purpose                      | Category    | Status            |
| --------------------------------- | ---------------------------- | ----------- | ----------------- |
| `prlt agent`                      | Show agent command help      | Help        | ✅ Implemented     |
| `prlt agent add [names...]`       | Create new agents            | CRUD        | ✅ Implemented     |
| `prlt agent list`                 | List all agents (overview)   | CRUD        | 🔄 Needs fixes    |
| `prlt agent remove [names...]`    | Delete agents                | CRUD        | 🔄 Needs fixes    |
| `prlt agent visit <name>`         | Navigate to agent directory  | Navigation  | ✅ Implemented     |
| `prlt agent status [name]`        | Show detailed agent status   | Status      | ❌ Not implemented |
| `prlt agent grant [permissions]`  | Grant repo/tool permissions  | Permissions | ⏳ Future          |
| `prlt agent revoke [permissions]` | Revoke repo/tool permissions | Permissions | ⏳ Future          |

## Proposed Command Changes

**Rename**: `switch` → `visit` (more descriptive for navigation)
**Add**: `status [name]` for detailed individual agent info
**Clarify**: `list` for overview, `status` for details
**Future**: `grant`/`revoke` for repo access, tool permissions, promote/demote

## Command Specifications

### `prlt agent`
**Purpose**: Display help and available commands

**Behavior**:
- Shows list of available agent commands
- Provides usage examples
- No arguments or flags

**Output**:
```
🤖 Agent Management

Available commands:
  prlt agent add [names...]     Add new agents
  prlt agent list               List all agents  
  prlt agent remove [names...]  Remove agents
  prlt agent switch <name>      Switch to agent directory

Run "prlt agent <command> --help" for more details
```

---

### `prlt agent add [names...]`
**Purpose**: Add new agents to the workspace

**Arguments**:
- `names` (optional): Space-separated agent names from theme

**Behavior**:
1. Detect workspace type (HQ vs workspace-only)
2. If no names provided, show theme-based agent selection
3. Filter out existing agents
4. Create git worktrees for each repository
5. Create agent configuration files
6. Update workspace config

**Examples**:
```bash
# Add specific agents
prlt agent add camry tacoma

# Interactive mode - shows theme agents
prlt agent add

# HQ mode: creates agents/garage/camry/, agents/garage/tacoma/
# Workspace mode: creates my-project-garage/camry/, my-project-garage/tacoma/
```

**Theme Integration**:
- Toyota theme: camry, tacoma, fj40, landcruiser...
- Billionaire theme: musk, bezos, gates, altman...
- Company theme: apple, google, meta, nvidia...

**Error Cases**:
- Not in HQ/workspace directory
- Agent name already exists
- Invalid agent name for theme
- Git worktree creation fails

---

### `prlt agent list`
**Purpose**: List all agents with status and activity info

**Behavior**:
1. Find workspace root and load config
2. Check each agent's directory exists
3. Show git branch info
4. Display last activity timestamp
5. Show ticket assignments (if PMO enabled)

**Output Format**:
```
👥 Active Agents:

🟢 camry - Active
   Branch: agent-camry
   Current tickets: #123, #124
   Working on: Fix authentication bug
   Last active: 2 hours ago

🔴 tacoma - Missing
   Worktree not found at: /path/to/tacoma
   Run "prlt agent add tacoma" to recreate

📊 Summary:
   Total agents: 2
   Active: 1
   Inactive: 1
   Tickets assigned: 2
```

---

### `prlt agent remove [names...]`
**Purpose**: Remove agents and clean up their worktrees

**Arguments**:
- `names` (optional): Space-separated agent names to remove

**Behavior**:
1. If no names, show interactive selection
2. Confirm removal (destructive operation)
3. Remove git worktrees using `git worktree remove`
4. Clean up agent directories
5. Update workspace configuration
6. Run `git worktree prune` for cleanup

**Examples**:
```bash
# Remove specific agents
prlt agent remove camry tacoma

# Interactive mode
prlt agent remove
```

**Confirmation**:
```
? Select agents to remove: (Use arrow keys, SPACE to select)
❯ ◯ camry
  ◯ tacoma

? Are you sure you want to remove 1 agent(s)? This will delete their worktrees. (y/N)
```

---

### `prlt agent visit <name>`
**Purpose**: Navigate to agent directory (renamed from switch)

**Arguments**:
- `name` (optional): Agent name to visit

**Behavior**:
1. If no name, show interactive agent selection
2. Validate agent exists and directory is accessible  
3. Calculate relative path from current location
4. Display `cd` command for user to run

**Examples**:
```bash
# Visit specific agent
prlt agent visit camry

# Interactive mode  
prlt agent visit
```

**Output**:
```
🤖 Visiting agent: camry
  cd ../agents/garage/camry

Note: Due to shell limitations, you need to run this command manually.
```

---

### `prlt agent status [name]`
**Purpose**: Show detailed status for specific agent or all agents

**Arguments**:
- `name` (optional): Specific agent name. If omitted, shows overview of all agents

**Behavior**:
- **With agent name**: Detailed view of single agent
- **Without name**: Summary status of all agents (similar to current `list`)

**Examples**:
```bash
# Detailed status for one agent
prlt agent status camry

# Overview status for all agents
prlt agent status
```

**Single Agent Output**:
```
🤖 Agent: camry

📍 Location: /path/to/agents/garage/camry
🌿 Branch: agent-camry
📁 Repositories:
   • my-project (active, 3 commits ahead)
   • other-repo (clean)

🎫 Tickets:
   • #123: Fix authentication bug (in-progress)
   • #124: Add user settings (todo)

⚡ Activity:
   Last commit: 2 hours ago
   Last file change: 30 minutes ago
   
🔑 Permissions:
   • my-project: write
   • other-repo: read
```

**All Agents Overview**:
```
📊 Agent Status Overview:

🟢 camry    - Active    - 2 tickets - 2h ago
🟢 tacoma   - Active    - 1 ticket  - 1d ago  
🔴 fj40     - Inactive  - 0 tickets - 1w ago

Summary: 3 agents (2 active, 1 inactive)
```

---

### `prlt agent grant` *(Future Feature)*
**Purpose**: Grant permissions or repository access to agents

**Behavior**:
- Assign agent to specific repositories
- Set permission levels (read/write/admin)
- Store permissions in agent config
- Support bulk operations

---

### `prlt agent revoke` *(Future Feature)*
**Purpose**: Revoke permissions or repository access from agents

**Behavior**:
- Remove repository access
- Clear permission levels
- Update agent configuration
- Support revoking all permissions

## Configuration Files

### Agent Config (`agents/garage/camry/.proletariat/config.json`)
```json
{
  "type": "agent",
  "agentName": "camry",
  "created": "2024-01-01T00:00:00Z",
  "workspacePath": "../../../",
  "repos": ["my-project", "other-repo"],
  "branch": "agent-camry",
  "permissions": {
    "repos": {
      "my-project": "write",
      "other-repo": "read"
    }
  },
  "lastPermissionUpdate": "2024-01-01T00:00:00Z"
}
```

### Workspace Config Updates
```json
{
  "type": "hq",
  "agents": ["camry", "tacoma", "fj40"],
  "repos": ["my-project", "other-repo"],
  "theme": "toyotas"
}
```

## Error Handling

### Common Error Cases
1. **Not in workspace**: "Not in an HQ or workspace directory. Run 'prlt init' first."
2. **No agents**: "No agents found. Add agents with 'prlt agent add'"
3. **Agent not found**: "Agent 'camry' not found. Available: tacoma, fj40"
4. **Git errors**: Handle worktree creation/removal failures gracefully
5. **Permission errors**: Handle file system permission issues

### Recovery Scenarios
- Missing agent directories → Suggest `prlt agent add` to recreate
- Corrupted config files → Provide manual repair instructions
- Git worktree issues → Offer `git worktree prune` and recreation

## Implementation Priority

### Phase 1: Core Functionality ✅
- [x] `prlt agent` base command
- [x] `prlt agent add` with theme integration
- [x] `prlt agent switch` for navigation

### Phase 2: Management ⏳
- [ ] Fix `prlt agent list` to align with new structure
- [ ] Fix `prlt agent remove` to align with new structure  
- [ ] Add comprehensive error handling

### Phase 3: Advanced Features ⏳
- [ ] `prlt agent grant` for permission management
- [ ] `prlt agent revoke` for access control
- [ ] Integration with PMO ticket system

## Testing Strategy

### Unit Tests
- Agent creation and configuration
- Theme-based name validation
- Config file management
- Path resolution for dual modes

### Integration Tests  
- Full workflow: init → add agents → list → remove
- Error scenarios and recovery
- HQ vs workspace-only mode differences

### Manual Testing
- Test in real HQ and workspace environments
- Verify git worktree operations
- Confirm theme integration works
- Test navigation and directory switching