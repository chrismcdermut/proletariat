# `prlt agents` Specification

## Purpose
Manage AI agents in bulk with overview and batch operations. Provides high-level agent management for multiple agents at once.

## Core Concepts
- **Bulk Operations**: Handle multiple agents simultaneously
- **Overview Status**: See all agents at a glance  
- **Interactive Selection**: Use checkboxes for multi-select operations
- **Batch Creation**: Add multiple agents from theme in one operation

## Command Overview

| Command                      | Purpose                                | Category | Status        |
| ---------------------------- | -------------------------------------- | -------- | ------------- |
| `prlt agents`                | Interactive bulk operations menu       | Menu     | ✅ Implemented |
| `prlt agents list`           | List all agents with overview status   | Overview | ✅ Implemented |
| `prlt agents status`         | Show status overview for all agents   | Overview | ✅ Implemented |
| `prlt agents add`            | Add multiple agents (bulk)             | Bulk     | ✅ Implemented |
| `prlt agents remove`         | Remove multiple agents (bulk)          | Bulk     | ✅ Implemented |

## Interactive Menu Structure

### `prlt agents`
**Purpose**: Display interactive menu for bulk agent operations

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

**Behavior**:
- Shows interactive arrow-key navigation
- Executes selected command directly (no subprocess)
- Preserves workspace context across operations
- Uses centralized color scheme for readability

---

## Command Specifications

### `prlt agents list`
**Purpose**: List all agents with overview information

**Output Format**:
```
👥 Active Agents:

🟢 bezos - Active
   Repositories: 5 repo(s), commits ahead: tech-thought-portfolio(+2)
   No active tickets
   Last active: 1 hours ago

🟢 gates - Active
   Repositories: 5 repo(s), commits ahead: tech-thought-portfolio(+2)
   No active tickets
   Last active: 1 hours ago

🔴 huang - Inactive
   Agent directory not found
   Run "prlt agents add huang" to recreate

📊 Summary:
   Total agents: 3
   Active: 2
   Inactive: 1
   Tickets assigned: 0
```

**Behavior**:
- Shows repository status per agent
- Displays commit status for repositories with changes
- Shows ticket assignments (if PMO enabled)
- Includes activity timestamps
- Provides summary statistics

---

### `prlt agents status`
**Purpose**: Show comprehensive status overview for all agents

**Output Format**:
```
📊 Agent Status Overview:

🟢 bezos        - Active    - 0 tickets - 1 hours ago
🟢 gates        - Active    - 0 tickets - 1 hours ago
🔴 huang        - Inactive  - 0 tickets - No activity
🟢 zuck         - Active    - 0 tickets - < 1 hour ago

Summary:
  4 agents (3 active, 1 inactive)
  0 active tickets assigned
```

**Behavior**:
- Condensed view of all agents in table format
- Status indicators (🟢 Active, 🔴 Inactive)
- Ticket counts per agent
- Last activity timestamps
- Summary statistics

---

### `prlt agents add`
**Purpose**: Add multiple agents in bulk operation

**Behavior**:
1. Show interactive checkbox selection of available theme agents
2. Filter out already existing agents
3. Allow multiple selections with spacebar
4. Cancel option available (press Enter without selections)
5. Create all selected agents simultaneously

**Interactive Flow**:
```
? Select agents to add: (Press <space> to select, <a> to toggle all, <i> to invert selection)
❯ ◯ altman
  ◯ damodei  
  ◯ andreesen
  ◯ huang
```

**Success Output**:
```
✅ Successfully added 3 agent(s): altman, damodei, andreesen

Created worktrees for 3 agents across 5 repositories:
• altman: 5 worktrees created
• damodei: 5 worktrees created  
• andreesen: 5 worktrees created
```

---

### `prlt agents remove`
**Purpose**: Remove multiple agents in bulk operation

**Behavior**:
1. Show interactive checkbox selection of existing agents
2. Allow multiple selections with spacebar
3. Explicit cancel handling - no selections = cancelled
4. Interactive confirmation before destructive operation
5. Remove all selected agents simultaneously

**Interactive Flow**:
```
? Select agents to remove (or press Enter to cancel):
❯ ◯ gates
  ◯ huang
  ◯ zuck
```

**Cancellation**:
```bash
# If no agents selected:
No agents selected. Operation cancelled.
```

**Confirmation**:
```
? Are you sure you want to remove 2 agent(s)? This will delete their worktrees.
❯ ❌ No, cancel
  ⚠️  Yes, remove agents
```

**Success Output**:
```
✅ Successfully removed 2 agent(s): gates, huang
```

---

## Design Principles

### Bulk-Focused UX
- **Multi-selection**: Use checkboxes for selecting multiple items
- **Batch Processing**: Process all selections together
- **Clear Feedback**: Show results for each agent individually
- **Cancellation**: Always provide clear cancel options

### Overview-Oriented Display  
- **Summary Information**: Focus on key status indicators
- **Tabular Format**: Present multiple agents in scannable format
- **Status Aggregation**: Provide meaningful summaries
- **Visual Hierarchy**: Use icons and colors for quick recognition

### Consistent Interaction Patterns
- **Arrow Navigation**: Use list prompts for single selections
- **Checkbox Selection**: Use for multi-item operations  
- **Separator Lines**: Visual grouping with `new inquirer.Separator()`
- **Cancel Options**: Always at bottom with clear icons

---

## Error Handling

### Common Scenarios
- **No agents exist**: Guide user to add agents first
- **No available agents**: All theme agents already added
- **Selection cancelled**: Graceful exit without error
- **Partial failures**: Report success/failure per agent

### Recovery Actions
- **Missing agents**: Suggest recreation with `prlt agents add`
- **Corrupted data**: Provide repair guidance
- **Theme exhaustion**: Suggest custom agents or different themes

---

## Implementation Notes

### Direct Command Execution
```typescript
// Execute commands directly, not as subprocesses
const { default: ListCommand } = await import('./agents/list.js');
const cmd = new ListCommand([], this.config);
await cmd.run();
```

### Centralized Color Scheme
```typescript
import { colors, format } from '../../lib/colors.js';

// Use consistent readable colors
this.log(colors.textSecondary('No tickets assigned'));
this.log(format.success('Agent added successfully'));
```

### Interactive Patterns
```typescript
// Checkbox for multi-select
type: 'checkbox',
message: 'Select agents to remove (or press Enter to cancel):',
choices: agents.map(agent => ({ name: agent.name, value: agent.name }))

// Handle cancellation
if (selected.length === 0) {
  this.log(colors.textMuted('No agents selected. Operation cancelled.'));
  return;
}
```

---

## Testing Strategy

### Bulk Operations
- Test multi-agent add/remove operations
- Verify partial success/failure handling  
- Test cancellation at each interaction point
- Validate workspace consistency after bulk operations

### Interactive Flows
- Test arrow navigation and selection
- Verify checkbox multi-select behavior
- Test separator display and cancel options
- Validate color scheme readability

### Integration
- Test with various workspace states (empty, full, mixed)
- Verify theme integration works correctly
- Test PMO integration for ticket display
- Validate error handling across all commands