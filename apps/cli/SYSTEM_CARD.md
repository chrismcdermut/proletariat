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

| Command | 📝 | ✅ | 🧪 SQL | 🧑‍💻 SQL | 🧪 Git-R | 🧑‍💻 Git-R | 🧪 Git-S | 🧑‍💻 Git-S | 🧪 Cloud | 🧑‍💻 Cloud | ✔️ | Description | Spec |
|---------|----|----|--------|----------|----------|-------------|----------|-------------|----------|-------------|----|----|------|
| `prlt pmo init` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Initialize PMO system (one-time) | [pmo-commands.md](specs/active/pmo-commands.md) |

#### Project Commands

| Command | 📝 | ✅ | 🧪 SQL | 🧑‍💻 SQL | 🧪 Git-R | 🧑‍💻 Git-R | 🧪 Git-S | 🧑‍💻 Git-S | 🧪 Cloud | 🧑‍💻 Cloud | ✔️ | Description | Spec |
|---------|----|----|--------|----------|----------|-------------|----------|-------------|----------|-------------|----|----|------|
| `prlt project create` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Create new project | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt project list` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | List all projects | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt project view [id]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | View project details | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt project delete [id]` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Delete project | [pmo-commands.md](specs/active/pmo-commands.md) |

#### Board Commands

| Command               | 📝  | ✅   | 🧪 SQL | 🧑‍💻 SQL | 🧪 Git-R | 🧑‍💻 Git-R | 🧪 Git-S | 🧑‍💻 Git-S | 🧪 Cloud | 🧑‍💻 Cloud | ✔️  | Description                                 | Spec                                            |
| --------------------- | --- | --- | ------ | --------- | -------- | ----------- | -------- | ----------- | -------- | ----------- | --- | ------------------------------------------- | ----------------------------------------------- |
| `prlt board` | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Interactive board menu | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt board view`     | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | View board in terminal                      | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt board open`     | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Open board in Obsidian                      | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt board markdown` | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Show board as markdown                      | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt board export`   | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Export board to file                        | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt board sync`     | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Sync between SQLite and board.md            | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt board watch`    | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Watch board.md for changes                  | [pmo-commands.md](specs/active/pmo-commands.md) |

#### Ticket Commands

| Command                           | 📝  | ✅   | 🧪 SQL | 🧑‍💻 SQL | 🧪 Git-R | 🧑‍💻 Git-R | 🧪 Git-S | 🧑‍💻 Git-S | 🧪 Cloud | 🧑‍💻 Cloud | ✔️  | Description                | Spec                                            |
| --------------------------------- | --- | --- | ------ | --------- | -------- | ----------- | -------- | ----------- | -------- | ----------- | --- | -------------------------- | ----------------------------------------------- |
| `prlt ticket`                     | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Interactive ticket menu    | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket create [title]`      | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Create new ticket          | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket list`                | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | List all tickets           | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket view [id]`           | ✅   | ⬜   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | View ticket details        | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket move [id] [column]`  | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Move ticket to column      | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket assign [id] [agent]` | ✅   | ⬜   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Assign ticket to agent     | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket claim [id]`          | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Claim ticket (self-assign) | [pmo-commands.md](specs/active/pmo-commands.md) |
| `prlt ticket delete [id]`         | ✅   | ✅   | ⬜      | ⬜         | ⬜        | ⬜           | ⬜        | ⬜           | ⬜        | ⬜           | ⬜   | Delete ticket              | [pmo-commands.md](specs/active/pmo-commands.md) |

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