# `prlt agent` Specification

## Purpose
Individual agent operations focused on single-agent workflows. Provides detailed management and navigation for specific agents.

## Core Concepts
- **Individual Focus**: Operations on single agents
- **Interactive Selection**: Choose specific agent when not specified
- **Detailed Information**: In-depth status and configuration details
- **Navigation Support**: Directory switching and agent visiting

## Command Overview

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt agent`                 | Interactive individual operations menu | Menu        | ✅ Implemented |
| `prlt agent status [name]`   | Show detailed status for specific agent| Status     | ✅ Implemented |
| `prlt agent visit [name]`    | Navigate to agent directory            | Navigation  | ✅ Implemented |
| `prlt agent add`             | Add single agent (redirects to bulk)  | Creation    | ✅ Implemented |
| `prlt agent remove [name]`   | Remove specific agent                  | Management  | ✅ Implemented |

## Interactive Menu Structure

### `prlt agent`
**Purpose**: Display interactive menu for individual agent operations

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

**Behavior**:
- Shows interactive arrow-key navigation
- Executes selected command directly (no subprocess)
- Preserves workspace context across operations
- Uses centralized color scheme for readability

---s

## Command Specifications

### `prlt agent status [name]`
**Purpose**: Show detailed status for a specific agent

**Arguments**:
- `name` (optional): Agent name for detailed status. If omitted, shows interactive selection.

**Interactive Selection** (when no name provided):
```
? Select agent to view status:
❯ bezos
  gates  
  huang
  zuck
  ──────────────
  ❌ Cancel
```

**Detailed Output**:
```
🤖 Agent: bezos

🟢 Status: Active
📍 Location: /path/to/agents/staff/bezos
🌿 Branch: agent-bezos

📁 Repositories:
   • clevertap-react-native (clean)
   • integrated-ventures-infra (clean)  
   • tech-thought-portfolio (clean) 2 commits ahead
   • atlassian-cloud-for-gmail (clean)
   • new-repo-test (clean)

🎫 Tickets:
   No tickets assigned

⚡ Activity:
   Last activity: 1 hours ago
```

**Behavior**:
- Shows comprehensive agent information
- Lists all repository statuses with commit information
- Displays ticket assignments (if PMO enabled)
- Shows last activity timestamp
- Handles missing/inactive agents gracefully

---

### `prlt agent visit [name]`
**Purpose**: Navigate to agent directory for development work

**Arguments**:
- `name` (optional): Agent name to visit. If omitted, shows interactive selection.

**Interactive Selection** (when no name provided):
```
? Select agent to visit:
❯ bezos
  gates
  huang  
  zuck
  ──────────────
  ❌ Cancel
```

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
- Shows full path context for user orientation

---

### `prlt agent add`
**Purpose**: Add single agent (redirects to bulk add for consistency)

**Behavior**:
- Redirects to `agents add` command for unified experience
- Maintains consistency with bulk operations
- Allows selection of single or multiple agents
- Preserves workspace context during redirect

**Implementation**:
```typescript
case 'add': {
  const { default: AddCommand } = await import('./agents/add.js');
  const cmd = new AddCommand([], this.config);
  await cmd.run();
  break;
}
```

---

### `prlt agent remove [name]`
**Purpose**: Remove a specific agent from the workspace

**Arguments**:
- `name` (optional): Agent name to remove. If omitted, shows interactive selection.

**Interactive Selection** (when no name provided):
```
? Select agent to remove:
❯ bezos
  gates
  huang
  zuck
  ──────────────
  ❌ Cancel
```

**Confirmation Flow**:
```
? Are you sure you want to remove agent "bezos"? This will delete its worktree.
❯ ❌ No, cancel
  ⚠️  Yes, remove agent
```

**Success Output**:
```
Removing agent "bezos"...
✅ Agent bezos removed
```

**Behavior**:
- Focuses on single agent removal
- Provides clear cancel option in selection
- Uses interactive confirmation for destructive operation
- Shows detailed progress and results

---

## Design Principles

### Individual-Focused UX
- **Single Selection**: Use list prompts for choosing one item
- **Detailed Information**: Provide comprehensive status details
- **Interactive Fallback**: Always offer selection when argument missing
- **Clear Navigation**: Support directory switching workflows

### Development-Oriented Features
- **Status Detail**: Show repository states, commits, branches
- **Navigation Support**: Easy directory switching for development
- **Activity Tracking**: Last activity and work context
- **Integration Awareness**: Show tickets and assignments

### Consistent Interaction Patterns  
- **Optional Arguments**: All commands work with or without agent names
- **Interactive Selection**: Consistent selection UI across commands
- **Cancel Options**: Always available with clear visual separation
- **Status Validation**: Check agent existence before operations

---

## Architecture Integration

### Workspace Detection
```typescript
// Traverse upward to find workspace
export function getWorkspaceInfo(): WorkspaceInfo {
  let currentDir = process.cwd();
  
  while (currentDir !== '/') {
    const dbPath = path.join(currentDir, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      // Found workspace, return configuration
    }
    currentDir = path.dirname(currentDir);
  }
  
  throw new Error('Not in an HQ or workspace directory. Run "prlt init" first.');
}
```

### Agent Status Detection
```typescript
export function getAgentStatus(workspaceInfo: WorkspaceInfo, agentName: string): AgentStatus {
  const agentDir = path.join(workspaceInfo.agentsPath, agentName);
  const dirExists = fs.existsSync(agentDir);
  
  // Comprehensive validation of agent state
  const hasValidWorktrees = workspaceInfo.repositories.every(repo => {
    const repoWorktreePath = path.join(agentDir, repo.name);
    const gitFile = path.join(repoWorktreePath, '.git');
    return fs.existsSync(repoWorktreePath) && fs.existsSync(gitFile);
  });
  
  return {
    name: agentName,
    exists: dirExists && hasValidWorktrees,
    repositories: getRepositoryStatus(agentDir, workspaceInfo.repositories),
    assignedTickets: getAssignedTickets(workspaceInfo, agentName),
    lastActivity: getLastActivity(agentDir)
  };
}
```

### Interactive Selection Pattern
```typescript
// Consistent selection with cancel option
const choices = [
  ...workspaceInfo.agents.map(agent => ({ 
    name: agent.name, 
    value: agent.name 
  })),
  new inquirer.Separator(),
  { name: '❌ Cancel', value: 'cancel' }
];

const { selected } = await inquirer.prompt([{
  type: 'list',
  name: 'selected', 
  message: 'Select agent to visit:',
  choices
}]);

if (selected === 'cancel') {
  this.log(colors.textMuted('Operation cancelled.'));
  return;
}
```

---

## Error Handling

### Validation Scenarios
- **Agent Not Found**: Clear error with available alternatives
- **Missing Worktrees**: Detect and report incomplete agent setups
- **Permission Issues**: Handle file system access problems
- **Git State Issues**: Detect corrupted worktree states

### Recovery Guidance
```typescript
// Example error with recovery suggestion
if (!agent) {
  this.error(`Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ')}`);
}

// Missing directory guidance
if (!agentStatus.exists) {
  this.log(colors.error('   Agent directory not found'));
  this.log(colors.textSecondary('   Run "prlt agents add" to recreate'));
  return;
}
```

### Graceful Degradation
- **No Agents**: Guide to creation workflow
- **Inactive Agents**: Show status but suggest recreation
- **Partial Functionality**: Work with available information
- **Workspace Issues**: Clear diagnostic information

---

## Configuration and State

### Agent Directory Structure
```
agents/staff/bezos/
├── .proletariat/
│   └── config.json         # Agent-specific configuration
├── clevertap-react-native/ # Git worktree for repo 1
├── tech-thought-portfolio/ # Git worktree for repo 2
└── ...                     # Additional repository worktrees
```

### SQLite Integration
The agent commands integrate with the workspace SQLite database:

**Agent Data**:
```sql
SELECT name, theme, status, created_at, last_activity 
FROM agents 
WHERE name = ?
```

**Worktree Information**:
```sql
SELECT repo_name, worktree_path, branch, commits_ahead, is_clean
FROM agent_worktrees 
WHERE agent_name = ?
```

---

## Testing Strategy

### Individual Operations
- Test single agent status, visit, and remove
- Verify interactive selection for all commands
- Test argument handling (with/without agent names)
- Validate cancellation flows

### Status Accuracy
- Test repository status detection
- Verify commit ahead/behind calculations
- Test activity timestamp accuracy
- Validate PMO ticket integration

### Navigation Support
- Test path calculation from various directories
- Verify relative path accuracy
- Test with different workspace structures
- Validate cross-platform path handling

### Error Recovery
- Test missing agent scenarios
- Verify corrupted worktree detection
- Test permission handling
- Validate workspace traversal edge cases