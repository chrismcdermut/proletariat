# `prlt pmo` Specification

## Overview
Project Management Office (PMO) functionality for Proletariat, split into two complementary specifications:

### 📋 [Team PMO](team-pmo.md)
**For: 1-6 engineers, single team/motion**
- Simple ticket numbering (T001, T002)
- Single kanban board
- SQLite or Git-based storage
- Current implementation focus

### 🏢 [Org PMO](org-pmo.md)
**For: 7+ engineers, multiple teams/motions**
- Team-namespaced tickets (FE-001, BE-002)
- Multiple boards with rollup views
- Cross-team dependencies
- Hosted database storage
- Future roadmap

## Quick Start
For most users, start with [Team PMO](team-pmo.md). Organizations with multiple teams should review [Org PMO](org-pmo.md) for scaling patterns.

## Current Implementation Status
The current `prlt pmo` and `prlt ticket` commands implement Team PMO functionality. See below for detailed status.

## Command Overview

### PMO Commands

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt pmo`                   | Interactive PMO operations menu        | Menu        | ❌ Not Implemented |
| `prlt pmo init`              | Initialize PMO structure in HQ         | Setup       | ✅ Implemented |
| `prlt pmo board [action]`    | View/edit/open kanban board            | Board       | ✅ Implemented |

### Board Commands

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt pmo board list`        | List all boards                        | Board       | ❌ Not Implemented |
| `prlt pmo board create <name>` | Create new board                      | Board       | ❌ Not Implemented |
| `prlt pmo board view [name]` | View specific board (default: main)   | Board       | ✅ Implemented |
| `prlt pmo board edit [name]` | Edit board in editor                   | Board       | ✅ Implemented |
| `prlt pmo board delete <name>` | Delete a board                       | Board       | ❌ Not Implemented |
| `prlt pmo board set-default <name>` | Set default board               | Board       | ❌ Not Implemented |

### Ticket Commands

| Command                      | Purpose                                | Category    | Status        |
| ---------------------------- | -------------------------------------- | ----------- | ------------- |
| `prlt ticket`                | Interactive ticket operations menu     | Menu        | ❌ Not Implemented |
| `prlt ticket create [title]` | Create new ticket with Ink UI          | Creation    | ✅ Implemented |
| `prlt ticket list`           | List all tickets                       | Overview    | ❌ Not Implemented |
| `prlt ticket status [id] [status]` | Update ticket status             | Management  | ✅ Implemented |
| `prlt ticket claim [id]`     | Claim ticket with Ink UI               | Assignment  | ✅ Implemented |
| `prlt ticket complete [id]`  | Mark ticket as complete                | Management  | ✅ Implemented |
| `prlt ticket assign [id] [agent]` | Assign ticket to agent            | Assignment  | ❌ Not Implemented |
| `prlt ticket reassign [id] [agent]` | Reassign to different agent     | Assignment  | ❌ Not Implemented |
| `prlt ticket unassign [id]`  | Remove assignment                      | Assignment  | ❌ Not Implemented |

---

## Interactive Menu Structure

### `prlt pmo` (Not Implemented)
**Purpose**: Display interactive menu for PMO operations

**Menu Options**:
```
🎯 Project Management Office (PMO)

? What would you like to do?
❯ 📋 View kanban board
  ✏️  Edit kanban board  
  📊 Open in Obsidian
  🎫 Manage tickets
  ⚙️  PMO settings
  ──────────────
  ❌ Cancel
```

**Behavior**:
- Shows interactive arrow-key navigation
- Executes selected command directly (no subprocess)
- Preserves workspace context across operations
- Uses centralized color scheme for readability

### `prlt ticket` (Not Implemented)
**Purpose**: Display interactive menu for ticket operations

**Menu Options**:
```
🎫 Ticket Management

? What would you like to do?
❯ ➕ Create new ticket
  📋 List all tickets
  🎯 Claim ticket  
  📝 Update ticket status
  ✅ Complete ticket
  👥 Assign ticket
  ──────────────
  ❌ Cancel
```

---

## Command Specifications

### `prlt pmo init`
**Purpose**: Initialize PMO structure in the current HQ

**Current Implementation**: ✅ **Complete**
- Creates `pmo/` directory structure
- Generates Obsidian-compatible kanban board
- Sets up git repository for PMO
- Creates configuration and README files
- Updates HQ config to include PMO

**Directory Structure Created**:
```
pmo/
├── .git/                    # Git repository for PMO
├── .gitignore              # Obsidian-specific ignores
├── board.md                # Main kanban board
├── config.json             # PMO configuration  
├── README.md               # Documentation
└── specs/                  # Ticket specifications
    ├── backlog/            # Unstarted tickets
    ├── active/             # In-progress tickets
    └── completed/          # Finished tickets
```

**Interactive Prompts**:
- Board name configuration
- Queue/category selection (feature, bug, refactor, docs, devops, research)
- Git repository initialization option

**Output**:
```
🎯 Initializing PMO...
✅ PMO initialized successfully!

Next steps:
  1. Open pmo/ folder in Obsidian
  2. Install Kanban plugin
  3. Open board.md in Kanban view
  4. Create your first ticket: prlt ticket create
```

---

### `prlt pmo board [action]`
**Purpose**: Manage kanban board viewing and editing

**Current Implementation**: ✅ **Complete**

**Arguments**:
- `action` (optional): `view`, `edit`, or `open`. Defaults to `view`.

**Actions**:

#### `view` (Default)
- Displays board content with color-coded sections
- Shows ticket counts per column
- Highlights assignees, priorities, and ticket IDs
- Provides summary statistics

**Sample Output**:
```
# Project Board

## 📥 Backlog
- [ ] [[specs/T0001-fix-login-bug]] T0001 Fix login bug #high +bug @unassigned

## 🚀 In Progress  
- [ ] [[specs/T0002-add-dashboard]] T0002 Add dashboard #medium +feature @bezos

## 👀 In Review
## ✅ Done
- [x] [[specs/T0003-setup-tests]] T0003 Setup testing #low +devops @gates

─────────────────────
Summary:
  Backlog: 1
  In Progress: 1  
  In Review: 0
  Done: 1
```

#### `edit`
- Opens board in system editor ($EDITOR or vi)
- Auto-commits changes to git
- Handles git push to remote

#### `open`
- Opens PMO directory in Obsidian via protocol handler
- Cross-platform support (macOS, Linux, Windows)
- Fallback to showing directory path

---

### `prlt ticket create [title]`
**Purpose**: Create new ticket with comprehensive specification

**Current Implementation**: ✅ **Complete**
- Uses Ink UI for interactive ticket creation
- Auto-generates sequential ticket IDs (T0001, T0002, etc.)
- Creates markdown specification file
- Adds ticket to kanban board
- Commits changes to git

**Interactive Flow** (Ink UI):
```
┌─ Create New Ticket ─────────────────────────┐
│                                             │
│ Title: Fix login authentication bug         │
│                                             │
│ Priority: ❯ High   Medium   Low             │
│                                             │
│ Queue:    ❯ Bug     Feature   Refactor      │
│           Docs     DevOps    Research       │
│                                             │
│ Description:                                │
│ ┌─────────────────────────────────────────┐ │
│ │ Users cannot login with valid           │ │
│ │ credentials after the recent auth       │ │  
│ │ update. Need to investigate session     │ │
│ │ handling.                               │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│           [Create Ticket] [Cancel]          │
└─────────────────────────────────────────────┘
```

**Generated Files**:
- `specs/backlog/T0001-fix-login-bug.md`: Detailed specification
- Updates `board.md` with new ticket card
- Updates `config.json` with incremented ticket ID

**Success Output**:
```
✅ Created ticket T0001
   Title: Fix login authentication bug  
   Priority: high
   Queue: bug
   Spec: /path/to/pmo/specs/backlog/T0001-fix-login-bug.md

   View board: prlt pmo board
```

---

### `prlt ticket claim [id]`
**Purpose**: Claim unassigned ticket using interactive UI

**Current Implementation**: ✅ **Complete**
- Uses Ink UI for ticket selection and claiming
- Moves ticket spec from `backlog/` to `active/`
- Updates board with agent assignment
- Commits changes to git

**Interactive Flow**:
```
┌─ Claim Ticket ──────────────────────────────┐
│                                             │
│ Available Tickets:                          │
│                                             │
│ ❯ T0001 - Fix login bug (high, bug)        │
│   T0003 - Add dashboard (medium, feature)  │ 
│   T0005 - Update docs (low, docs)          │
│                                             │
│ Agent: bezos                                │
│                                             │
│           [Claim Ticket] [Cancel]           │
└─────────────────────────────────────────────┘
```

**Behavior**:
- Automatically detects current agent from workspace context
- Filters to show only unassigned/unclaimed tickets
- Moves ticket to "In Progress" column
- Updates ticket spec with assignment and timestamps

---

### `prlt ticket status [id] [status]`
**Purpose**: Update ticket status and board position

**Current Implementation**: ✅ **Complete**
- Supports status transitions: backlog → in-progress → in-review → done
- Moves ticket spec files between directories
- Updates kanban board accordingly
- Validates status transitions

**Arguments**:
- `id` (required): Ticket ID (e.g., T0001)
- `status` (required): New status (`backlog`, `in-progress`, `in-review`, `done`)

**Status Mapping**:
- `backlog` → `specs/backlog/` → `## 📥 Backlog`
- `in-progress` → `specs/active/` → `## 🚀 In Progress`
- `in-review` → `specs/active/` → `## 👀 In Review`  
- `done` → `specs/completed/` → `## ✅ Done`

**Example**:
```bash
prlt ticket status T0001 in-progress
```

**Output**:
```
✅ Ticket T0001 moved to in-progress
   Board updated: 📥 Backlog → 🚀 In Progress
```

---

### `prlt ticket complete [id]`
**Purpose**: Mark ticket as complete with finalization

**Current Implementation**: ✅ **Complete**
- Moves ticket to "Done" column
- Moves spec to `completed/` directory  
- Updates completion timestamp
- Commits final state to git

**Arguments**:
- `id` (required): Ticket ID to complete

**Completion Process**:
1. Validates ticket exists and is in progress
2. Updates ticket spec with completion timestamp
3. Moves spec file to `completed/` directory
4. Updates board.md to mark as `[x]` completed
5. Commits all changes with descriptive message

**Output**:
```
✅ Ticket T0001 completed successfully
   Moved to: specs/completed/T0001-fix-login-bug.md
   Board status: ✅ Done
```

---

## Missing Implementation Details

### `prlt ticket list` (Not Implemented)
**Purpose**: List all tickets with filtering and status overview

**Proposed Output**:
```
🎫 All Tickets:

📥 Backlog (2):
   T0004 - Setup monitoring #high +devops @unassigned
   T0005 - Update docs #low +docs @unassigned

🚀 In Progress (1):  
   T0001 - Fix login bug #high +bug @bezos (started 2 hours ago)

👀 In Review (0):

✅ Done (1):
   T0002 - Add dashboard #medium +feature @gates (completed 1 day ago)

📊 Summary:
   Total tickets: 4
   Backlog: 2 | In Progress: 1 | In Review: 0 | Done: 1
   High priority: 2 | Medium: 1 | Low: 1
```

### `prlt ticket assign [id] [agent]` (Not Implemented)
**Purpose**: Assign ticket to specific agent

**Behavior**:
- Validates agent exists in workspace
- Updates ticket assignee in board and spec
- Moves to appropriate status if needed
- Supports reassignment

### Interactive Selection Patterns (Not Implemented)
**Pattern for missing commands**:
```typescript
// Example for ticket assign
const { agent } = await inquirer.prompt([{
  type: 'list',
  name: 'agent',
  message: 'Assign ticket to which agent?',
  choices: [
    ...workspaceAgents.map(agent => ({ name: agent.name, value: agent.name })),
    new inquirer.Separator(),
    { name: '❌ Cancel', value: 'cancel' }
  ]
}]);
```

---

## Architecture Integration

### PMO Discovery
**Workspace Traversal**:
```typescript
function findPMO(): string | null {
  let currentDir = process.cwd();
  
  while (currentDir !== '/') {
    // Check for HQ with PMO
    const configPath = path.join(currentDir, '.proletariat', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.type === 'hq') {
        const pmoPath = path.join(currentDir, 'pmo');
        if (fs.existsSync(pmoPath)) return pmoPath;
      }
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}
```

### SQLite Integration (Future)
**Current**: File-based with JSON config
**Future**: SQLite integration for ticket management
```sql
-- Future ticket schema
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,           -- T0001, T0002, etc.
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT,                 -- high, medium, low
  queue TEXT,                    -- feature, bug, etc.
  status TEXT,                   -- backlog, in-progress, etc.
  assigned_agent TEXT,
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT,
  spec_path TEXT
);
```

### Git Integration
**Current Implementation**:
- Automatic commits for all ticket operations
- Git pull before operations (if remote configured)
- Git push after changes (optional)
- Descriptive commit messages per operation

### Agent Context Detection
```typescript
// Detect current agent from workspace location
function getCurrentAgent(workspaceInfo: WorkspaceInfo): string | null {
  const currentPath = process.cwd();
  const agentsPath = workspaceInfo.agentsPath;
  
  if (currentPath.startsWith(agentsPath)) {
    const relativePath = path.relative(agentsPath, currentPath);
    const agentName = relativePath.split(path.sep)[0];
    return workspaceInfo.agents.find(a => a.name === agentName)?.name || null;
  }
  
  return null;
}
```

---

## Design Principles

### Obsidian-First Approach
- **Native Integration**: Uses Obsidian Kanban plugin format
- **File-based Storage**: Markdown files for specifications  
- **Linking**: `[[specs/T0001-title]]` format for cross-references
- **Metadata**: YAML frontmatter and inline tags (#priority, @assignee, +queue)

### Git-centric Workflow
- **Version Control**: All ticket changes are committed
- **Collaboration**: Multiple agents can work on same PMO
- **History**: Full audit trail of ticket lifecycle
- **Remote Sync**: Optional remote repository for team coordination

### Agent-aware Operations
- **Context Detection**: Automatically detect current agent
- **Workspace Integration**: Seamless integration with agent commands
- **Assignment Tracking**: Show agent assignments in board views
- **Activity History**: Track agent activity on tickets

### Consistent Color Scheme
```typescript
// PMO-specific colors (extending centralized colors)
const pmoColors = {
  ...colors,
  ticket: chalk.cyan,
  priority: {
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.gray
  },
  status: {
    backlog: chalk.blue,
    progress: chalk.yellow,
    review: chalk.magenta,
    done: chalk.green
  }
};
```

---

## Error Handling

### Common Scenarios
- **PMO Not Found**: Clear guidance to run `prlt pmo init`
- **Invalid Ticket ID**: Show available tickets with suggestions
- **Git Conflicts**: Graceful handling of merge conflicts
- **Missing Obsidian**: Fallback to text-based board viewing
- **Permission Issues**: Clear error messages with solutions

### Recovery Actions
```typescript
// Example error handling
if (!pmoPath) {
  this.error(`PMO not found. Run "prlt pmo init" to create one.`);
}

if (!ticketExists) {
  const availableTickets = getAvailableTickets(pmoPath);
  this.error(`Ticket ${ticketId} not found. Available tickets: ${availableTickets.join(', ')}`);
}

// Graceful git failures
try {
  execSync('git push', { cwd: pmoPath, stdio: 'pipe' });
} catch {
  this.log(colors.warning('Unable to push changes. You may need to push manually.'));
}
```

---

## File Structure & Templates

### PMO Directory Structure
```
pmo/
├── .git/                           # Git repository
├── .gitignore                      # Obsidian-specific ignores
├── board.md                        # Main kanban board
├── config.json                     # PMO configuration
├── README.md                       # Usage documentation  
└── specs/                          # Ticket specifications
    ├── backlog/                    # Unstarted tickets
    │   ├── T0001-fix-login-bug.md
    │   └── T0004-setup-monitoring.md
    ├── active/                     # In-progress tickets
    │   └── T0002-add-dashboard.md
    └── completed/                  # Finished tickets
        └── T0003-setup-tests.md
```

### Ticket Specification Template
```markdown
# T0001: Fix login authentication bug

**Priority:** high
**Queue:** bug
**Created:** 2024-01-15T10:30:00.000Z
**Status:** In Progress
**Assigned:** bezos
**Started:** 2024-01-15T14:20:00.000Z

## Description
Users cannot login with valid credentials after the recent auth update. Need to investigate session handling and token validation.

## Acceptance Criteria
- [ ] Identify root cause of login failures
- [ ] Fix authentication logic
- [ ] Add tests for edge cases
- [ ] Update documentation

## Work Log
- Created: 2024-01-15T10:30:00.000Z
- Claimed by bezos: 2024-01-15T14:20:00.000Z
- Started investigation: 2024-01-15T14:25:00.000Z

## Notes
Initial investigation shows token validation may be failing. Checking JWT decode logic.
```

### Board Template (Obsidian Kanban)
```markdown
---
kanban-plugin: obsidian-kanban
---

## 📥 Backlog
- [ ] [[specs/backlog/T0004-setup-monitoring]] T0004 Setup monitoring #high +devops @unassigned

## 🚀 In Progress
- [ ] [[specs/active/T0001-fix-login-bug]] T0001 Fix login bug #high +bug @bezos

## 👀 In Review

## ✅ Done
- [x] [[specs/completed/T0003-setup-tests]] T0003 Setup tests #low +devops @gates

---
*Queues: feature, bug, refactor, docs, devops*
*Created: 2024-01-15T09:00:00.000Z*
```

---

## Testing Strategy

### PMO Initialization
- Test PMO creation in various HQ configurations
- Verify git repository initialization
- Test Obsidian configuration generation
- Validate directory structure creation

### Ticket Lifecycle
- Test complete ticket creation → assignment → progress → completion flow
- Verify file system operations (move specs between directories)
- Test board updates for each status change
- Validate git commits at each stage

### Agent Integration
- Test ticket claiming from agent workspaces
- Verify agent context detection
- Test assignment workflows
- Validate agent-specific ticket views

### Error Recovery
- Test PMO operations without git
- Test handling of corrupted config files
- Test operations with missing Obsidian
- Verify graceful handling of file permission issues

### Multi-user Scenarios
- Test concurrent ticket operations
- Test git conflicts during board updates
- Test remote repository synchronization
- Validate merge conflict resolution

---

## Configuration Schema

### PMO Config (`pmo/config.json`)
```typescript
interface PMOConfig {
  boardTitle: string;           // "Project Board"
  queues: string[];            // ["feature", "bug", "refactor", "docs", "devops"]
  lastTicketId: number;        // Auto-incrementing ticket counter
  columns: string[];           // ["Backlog", "In Progress", "In Review", "Done"]
  created: string;             // ISO timestamp of PMO creation
  defaultBoard?: string;       // Default board name (for multi-board support)
  gitRemote?: string;         // Optional remote repository URL
}
```

### HQ Config Integration
```typescript
// Updates to .proletariat/config.json when PMO is initialized
interface HQConfig {
  // ... existing HQ config
  pmoPath: string;            // "./pmo" 
  pmoInitialized: string;     // ISO timestamp
  hasPMO: boolean;           // true when PMO exists
}
```

---

## Future Enhancements

### Multi-board Support
- Multiple kanban boards per PMO
- Board-specific configurations
- Cross-board ticket movement
- Board templates and themes

### Advanced Ticket Features
- Sub-tickets and dependencies
- Time tracking and estimates
- Labels and custom fields
- Ticket templates by queue

### Reporting & Analytics  
- Velocity tracking
- Agent performance metrics
- Queue analysis
- Completion time analytics

### Integration Enhancements
- GitHub issue sync
- Slack notifications
- Email reminders
- Calendar integration

### Cloud Features
- Real-time collaboration
- Cloud-based boards
- Mobile access
- Team dashboards