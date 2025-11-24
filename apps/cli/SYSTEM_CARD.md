f# Proletariat CLI System Specification

## Purpose
Multi-agent development orchestration system for managing distributed AI-powered development teams.

## Core Capabilities

### 1. Workspace Management (HQ)
- Initialize headquarters (HQ) for centralized control
- Support single-repo and multi-repo modes
- Theme-based agent naming (cars, billionaires, companies, custom)

### 2. Agent Management
- Add/remove agents as git worktrees
- List agents with current status and assignments
- Track agent activity and completed work
- Each agent has isolated workspace in ../garage/

### 3. Ticket Management (PMO)
- Create tickets with priority and queue assignment
- Assign tickets to specific agents
- Agents can claim tickets from their worktree
- Track ticket lifecycle (todo → in-progress → done)
- Multiple kanban boards with filtering (see [BOARD_SPEC.md](./BOARD_SPEC.md))

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
| `prlt init <hq-name>` | ✅   | ✅   | ✅   | ✅   | ✅   | Initialize new HQ workspace | [init.md](./specs/init.md) |
| `prlt help [command]` | ⬜   | ⬜   | ⬜   | ⬜   | ⬜   | Show help for commands      | -                          |
| `prlt --version`      | ⬜   | ⬜   | ⬜   | ⬜   | ⬜   | Show CLI version            | -                          |

#### Agent Commands

| Command                        | 📝  | ✅   | 🧪  | 🧑‍💻 | ✔️  | Description                 |
| ------------------------------ | --- | --- | --- | ----- | --- | --------------------------- |
| `prlt agent`                   | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | Interactive agent menu      |
| `prlt agent add [names...]`    | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | Add new agents              |
| `prlt agent list`              | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | List all agents with status |
| `prlt agent remove [names...]` | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | Remove agents               |
| `prlt agent grant`             | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | Grant repo access to agents |
| `prlt agent revoke`            | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | Revoke repo access          |
| `prlt agent switch <name>`     | ⬜   | ⬜   | ⬜   | ⬜     | ⬜   | Switch to agent's worktree  |

#### PMO Commands

| Command | 📝 | ✅ | 🧪 | 🧑‍💻 | ✔️ | Description |
|---------|----|----|----|----|----|----|
| `prlt pmo` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Interactive PMO menu |
| `prlt pmo init` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Initialize PMO structure |
| `prlt pmo board` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Interactive board menu (view/edit/open) |
| `prlt pmo board list` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | List all boards |
| `prlt pmo board create <name>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Create new board |
| `prlt pmo board view [name]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | View board (default: main) |
| `prlt pmo board edit [name]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Edit board in editor |
| `prlt pmo board delete <name>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Delete a board |
| `prlt pmo board set-default <name>` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Set default board |

#### Ticket Commands

| Command | 📝 | ✅ | 🧪 | 🧑‍💻 | ✔️ | Description |
|---------|----|----|----|----|----|----|
| `prlt ticket` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Interactive ticket menu |
| `prlt ticket create` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Create new ticket (Ink UI) |
| `prlt ticket list` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | List all tickets |
| `prlt ticket status [id] [status]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Update ticket status |
| `prlt ticket claim [id]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Claim ticket (Ink UI) |
| `prlt ticket complete [id]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Mark ticket as complete |
| `prlt ticket assign [id] [agent]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Assign ticket to agent |
| `prlt ticket reassign [id] [agent]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Reassign to different agent |
| `prlt ticket unassign [id]` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Remove assignment |

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

**Completed (Implemented with Ink UI):**
- ✅ `prlt init` - Initialize HQ
- ✅ `prlt pmo init` - Initialize PMO structure
- ✅ `prlt pmo board` - View/edit/open board
- ✅ `prlt ticket create` - Create tickets with Ink UI
- ✅ `prlt ticket claim` - Claim tickets with Ink UI
- ✅ `prlt ticket status` - Update ticket status
- ✅ `prlt ticket complete` - Mark tickets complete
- ✅ `prlt agent add` - Add agents
- ✅ `prlt agent list` - List agents
- ✅ `prlt agent remove` - Remove agents

**Priority 1 - Critical (needed for basic functionality):**
- ⬜ `prlt agent` - Interactive menu
- ⬜ `prlt ticket` - Interactive menu  
- ⬜ `prlt ticket assign` - Direct assignment
- ⬜ `prlt ticket reassign` - Change assignment
- ⬜ `prlt ticket unassign` - Remove assignment

**Priority 2 - Important (enhance usability):**
- ⬜ `prlt agent switch` - Quick navigation
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