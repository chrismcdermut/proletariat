f# Proletariat CLI System Specification

## Purpose
Multi-agent development orchestration system for managing distributed AI-powered development teams.

## Core Capabilities

### 1. Workspace Management (HQ)
- Initialize headquarters (HQ) for centralized control
- Support single-repo and multi-repo modes
- Theme-based agent naming (cars, billionaires, companies, custom)

### 2. Agent Management
- **Dual Command Structure**: `prlt agent` (individual) and `prlt agents` (bulk)
- **Individual Operations**: Focus on single agent workflows (status, visit, remove)
- **Bulk Operations**: Multi-agent management with checkbox selection
- **Git Worktree Integration**: Each agent has isolated workspace with proper cleanup
- **Interactive Menus**: Arrow-key navigation with cancel options
- **Status Tracking**: Repository states, commits, activity, and ticket assignments
- **Navigation Support**: Directory switching and path calculation
- **Theme Integration**: Billionaires, cars, companies, or custom agent names

### 3. Ticket Management (PMO)
- Create tickets with priority and queue assignment
- Assign tickets to specific agents
- Agents can claim tickets from their worktree
- Track ticket lifecycle (todo → in-progress → done)
- Obsidian-compatible kanban boards (see [PMO spec](pmo.md))

### 4. Command Specification

This is the authoritative list of commands that MUST exist in the CLI.
✅ = Implemented | ❌ = Not yet migrated | 🔄 = Partially implemented

### 4.1 Complete Command Reference

**Legend:**
- 📝 Spec Defined
- ✅ Implemented 
- 🧪 Tested
- 🧑‍💻 Manual Testing
- ✔️ Done (all checkmarks)

#### Core Commands

| Command               | 📝  | ✅   | 🧪  | 🧑‍💻  | ✔️  | Description                 | Spec                       |
| --------------------- | --- | --- | --- | --- | --- | --------------------------- | -------------------------- |
| `prlt init <hq-name>` | ✅   | ✅   | ✅   | ✅   | ✅   | Initialize new HQ workspace | [init.md](init.md) |
| `prlt help [command]` | ⬜   | ⬜   | ⬜   | ⬜   | ⬜   | Show help for commands      | -                          |
| `prlt --version`      | ⬜   | ⬜   | ⬜   | ⬜   | ⬜   | Show CLI version            | -                          |

#### Agent Commands (Individual Operations)

| Command                    | 📝  | ✅   | 🧪  | 🧑‍💻 | ✔️  | Description                    | Spec                         |
| -------------------------- | --- | --- | --- | ----- | --- | ------------------------------ | ---------------------------- |
| `prlt agent`               | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Interactive individual menu    | [agent.md](agent.md) |
| `prlt agent status [name]` | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Show detailed agent status     | [agent.md](agent.md) |
| `prlt agent visit [name]`  | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Navigate to agent directory    | [agent.md](agent.md) |
| `prlt agent add`           | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Add agent (redirects to bulk)  | [agent.md](agent.md) |
| `prlt agent remove [name]` | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Remove specific agent          | [agent.md](agent.md) |
| `prlt agent grant`         | ✅   | ⬜   | ⬜   | ⬜     | ⬜   | Grant repo access to agents    | [agent.md](agent.md) |
| `prlt agent revoke`        | ✅   | ⬜   | ⬜   | ⬜     | ⬜   | Revoke repo access             | [agent.md](agent.md) |

#### Agents Commands (Bulk Operations)

| Command                   | 📝  | ✅   | 🧪  | 🧑‍💻 | ✔️  | Description                     | Spec                           |
| ------------------------- | --- | --- | --- | ----- | --- | ------------------------------- | ------------------------------ |
| `prlt agents`             | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Interactive bulk operations menu | [agents.md](agents.md) |
| `prlt agents list`        | ✅   | ✅   | ⬜   | ⬜    | ⬜   | List all agents with overview   | [agents.md](agents.md) |
| `prlt agents status`      | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Status overview for all agents  | [agents.md](agents.md) |
| `prlt agents add`         | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Add multiple agents (bulk)      | [agents.md](agents.md) |
| `prlt agents remove`      | ✅   | ✅   | ⬜   | ⬜    | ⬜   | Remove multiple agents (bulk)   | [agents.md](agents.md) |

#### PMO Commands

| Command | 📝 | ✅ | 🧪 | 🧑‍💻 | ✔️ | Description | Spec |
|---------|----|----|----|----|----|----|----|
| `prlt pmo` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Interactive PMO menu | [pmo.md](pmo.md) |
| `prlt pmo init` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | Initialize PMO structure | [pmo.md](pmo.md) |
| `prlt pmo board [action]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | View/edit/open kanban board | [pmo.md](pmo.md) |
| `prlt pmo board list` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | List all boards | [pmo.md](pmo.md) |
| `prlt pmo board create <name>` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Create new board | [pmo.md](pmo.md) |
| `prlt pmo board view [name]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | View board (default: main) | [pmo.md](pmo.md) |
| `prlt pmo board edit [name]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | Edit board in editor | [pmo.md](pmo.md) |
| `prlt pmo board delete <name>` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Delete a board | [pmo.md](pmo.md) |
| `prlt pmo board set-default <name>` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Set default board | [pmo.md](pmo.md) |

#### Ticket Commands

| Command | 📝 | ✅ | 🧪 | 🧑‍💻 | ✔️ | Description | Spec |
|---------|----|----|----|----|----|----|----| 
| `prlt ticket` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Interactive ticket menu | [pmo.md](pmo.md) |
| `prlt ticket create [title]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | Create new ticket (Ink UI) | [pmo.md](pmo.md) |
| `prlt ticket list` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | List all tickets | [pmo.md](pmo.md) |
| `prlt ticket status [id] [status]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | Update ticket status | [pmo.md](pmo.md) |
| `prlt ticket claim [id]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | Claim ticket (Ink UI) | [pmo.md](pmo.md) |
| `prlt ticket complete [id]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | Mark ticket as complete | [pmo.md](pmo.md) |
| `prlt ticket assign [id] [agent]` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Assign ticket to agent | [pmo.md](pmo.md) |
| `prlt ticket reassign [id] [agent]` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Reassign to different agent | [pmo.md](pmo.md) |
| `prlt ticket unassign [id]` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | Remove assignment | [pmo.md](pmo.md) |

#### Maintenance Commands

| Command | 📝 | ✅ | 🧪 | 🧑‍💻 | ✔️ | Description |
|---------|----|----|----|----|----|----|
| `prlt themes` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | List available themes |
| `prlt repair` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Repair broken worktrees |
| `prlt health` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Check worktree health |
| `prlt migrate <hq-name>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Migrate repo into HQ |
| `prlt upgrade` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Upgrade config format |

#### Plugin Commands (Oclif Built-in)

| Command | 📝 | ✅ | 🧪 | 🧑‍💻 | ✔️ | Description |
|---------|----|----|----|----|----|----|
| `prlt plugins` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | List installed plugins |
| `prlt plugins install <plugin>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Install a plugin |
| `prlt plugins uninstall <plugin>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Remove a plugin |
| `prlt plugins update` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Update all plugins |
| `prlt plugins link <path>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Link local plugin |
| `prlt plugins reset` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Remove all user plugins |
| `prlt plugins inspect <plugin>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Show plugin details |

### 4.2 Implementation Summary

**Completed (Implemented with SQLite & DRY Architecture):**

**Core Workspace:**
- ✅ `prlt init` - Initialize HQ with SQLite database

**PMO System:**
- ✅ `prlt pmo init` - Initialize PMO structure
- ✅ `prlt pmo board` - View/edit/open board
- ✅ `prlt ticket create` - Create tickets with Ink UI
- ✅ `prlt ticket claim` - Claim tickets with Ink UI
- ✅ `prlt ticket status` - Update ticket status
- ✅ `prlt ticket complete` - Mark tickets complete

**Individual Agent Operations:**
- ✅ `prlt agent` - Interactive menu for individual operations
- ✅ `prlt agent status [name]` - Detailed status for specific agent
- ✅ `prlt agent visit [name]` - Navigate to agent directory
- ✅ `prlt agent add` - Add agent (redirects to bulk operations)
- ✅ `prlt agent remove [name]` - Remove specific agent

**Bulk Agent Operations:**
- ✅ `prlt agents` - Interactive menu for bulk operations
- ✅ `prlt agents list` - List all agents with overview status
- ✅ `prlt agents status` - Status overview for all agents
- ✅ `prlt agents add` - Add multiple agents with theme integration
- ✅ `prlt agents remove` - Remove multiple agents with confirmation

**Key Features:**
- ✅ SQLite database for concurrent access and data integrity
- ✅ Interactive menus with arrow-key navigation
- ✅ Centralized color scheme for dark terminal readability
- ✅ Workspace traversal (works from any subdirectory)
- ✅ Git worktree management with comprehensive cleanup
- ✅ Theme-based agent naming and validation
- ✅ PMO integration for ticket assignments
- ✅ Direct command execution (no subprocess issues)

**Priority 1 - Critical (needed for basic functionality):**
- ⬜ `prlt ticket` - Interactive menu  
- ⬜ `prlt ticket assign` - Direct assignment
- ⬜ `prlt ticket reassign` - Change assignment
- ⬜ `prlt ticket unassign` - Remove assignment

**Priority 2 - Important (enhance usability):**
- ⬜ `prlt pmo` - Interactive PMO menu
- ⬜ `prlt ticket list` - List all tickets

**Priority 3 - Nice to have (maintenance/advanced):**
- ⬜ `prlt themes` - Theme management
- ⬜ `prlt repair` - Worktree repair
- ⬜ `prlt health` - Health checks
- ⬜ `prlt migrate` - Migration tool
- ⬜ `prlt upgrade` - Config upgrades
- ⬜ `prlt agent grant/revoke` - Repo access control

## Theme System

See [THEME_SPEC.md](./THEME_SPEC.md) for complete theme command specification.

**Key principle**: Base commands always work. Theme commands are optional aliases.

Examples:
- Base: `prlt agent add alice`
- Cars theme: `prlt drive camry` (alias for agent add)
- Billionaires theme: `prlt hire elon` (alias for agent add)

## Architecture Decisions

### SQLite Database Migration (v2.0)

**Major architectural improvement:** Migrated from JSON config files to SQLite database for better team coordination and data consistency.

**Benefits:**
- **Concurrent Access**: Multiple team members can safely read/write workspace data
- **ACID Transactions**: Data integrity for agent and repository operations
- **Structured Queries**: Efficient filtering and reporting of agent status
- **Schema Evolution**: Database migrations for future feature additions
- **Performance**: Fast lookups for large workspaces with many agents

**Database Schema:**
```sql
-- Core workspace metadata
workspace (id, type, theme, workspace_name, has_pmo, created_at)

-- Agent instances  
agents (name, theme, status, current_task, created_at, last_activity)

-- Agent-owned worktrees
agent_worktrees (agent_name, repo_name, worktree_path, branch, created_at, commits_ahead, is_clean)

-- Repository management
repositories (name, path, type, source_url, action, added_at)

-- Theme configurations
themes (name, workspace_dir, add_command, remove_command, agents)
```

**DRY Architecture:**
- Shared utilities in `lib/agents/commands.ts`
- Single source of truth for workspace detection
- Unified status and validation logic
- Eliminating code duplication across commands

### Why Oclif?
- **Auto-documentation**: Commands self-document from code
- **Plugin system**: Future extensibility for cloud features
- **Hooks**: Pre/post command execution for validation
- **Testing**: Built-in testing helpers
- **TypeScript**: Full type safety

### File Structure
```
apps/cli/
├── src/commands/       # Oclif commands (single source of truth)
│   ├── init.ts
│   ├── agent/
│   │   ├── add.ts
│   │   ├── list.ts
│   │   └── remove.ts
│   ├── pmo/
│   │   ├── init.ts
│   │   └── board.ts
│   ├── ticket/
│   │   ├── create.ts   # Uses Ink for UI
│   │   ├── claim.ts    # Uses Ink for UI
│   │   ├── status.ts
│   │   └── complete.ts
│   └── lib/
│       └── ui/         # Ink UI components
│           ├── CreateTicketUI.tsx
│           ├── ClaimTicketUI.tsx
│           └── BoardUI.tsx
├── test/              # Integration tests
├── README.md          # User documentation
└── SYSTEM.md          # This file - system context
```

### Documentation Strategy
1. **Code is truth**: Each command's `static description` and `static examples` in the TypeScript files
2. **README**: Generated from code + manual additions for concepts
3. **Tests**: Validate commands work as documented
4. **No drift**: Oclif generates help from the actual code

## Command Specifications

Detailed specifications for each command are in the `specs/` directory.

## Future Features (Cloud)
- Docker containers for agents
- Distributed execution
- Web dashboard
- Agent collaboration
- Automated work distribution

## Testing Commands
```bash
# Build
pnpm build

# Test help
prlt --help
prlt ticket --help

# Run integration tests  
pnpm test
```

## For AI Assistants
When modifying this CLI:
1. Commands are in `src/commands/` - this is the source of truth
2. Update command's `static description` and `static examples` 
3. Run `npm run build` after changes
4. README should reflect major features but not duplicate command details
5. Integration tests should verify critical paths work