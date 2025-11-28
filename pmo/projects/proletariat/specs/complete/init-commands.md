# Initialization Commands Specification

## Purpose
Commands for initializing workspaces, HQs, PMO systems, and related configuration. These are typically one-time setup commands that establish the foundational structure.

## Core Concepts
- **HQ (Headquarters)**: Full workspace with repositories, agents, and optional PMO
- **Workspace-Only**: Lightweight setup without repository management
- **PMO Initialization**: Project management office setup with board templates
- **Theme Selection**: Agent personality/naming theme for the workspace

## Command Overview

| Command           | Purpose                                    | Category | Status        |
| ----------------- | ------------------------------------------ | -------- | ------------- |
| `prlt init`       | Initialize HQ or workspace                 | Setup    | ✅ Implemented |
| `prlt pmo init`   | Initialize PMO system                      | PMO      | ✅ Implemented |
| `prlt theme`      | Select or change theme                     | Config   | ⬜ Not Implemented |

---

## Command Specifications

### `prlt init`
**Purpose**: Interactive wizard to initialize an HQ (headquarters) or workspace-only setup

**Workflow Types**:
1. **Full HQ**: Repositories + Agents + Optional PMO
2. **Workspace-Only**: Just agents without repository management

**Interactive Flow**:
```
🚀 Welcome to Proletariat...

? What type of workspace do you want to create?
  ❯ Full HQ (repositories + agents + PMO)
    Workspace-only (just agents, no repos)

[If Full HQ selected:]

🏢 Setting up workspace...

? What would you like to call your HQ? my-startup

? Add '-hq' suffix to directory name?
  ❯ Yes (my-startup-hq)
    No (my-startup)

? Where should the HQ be created?
  ❯ Current directory (/path/to/current)
    Custom location...

? Choose a theme for your agents:
  ❯ Tech Founders (bezos, gates, zuck, etc.)
    Scientists (einstein, curie, tesla, etc.)
    Philosophers (plato, socrates, nietzsche, etc.)

? Select agents to include (space to select, enter to continue):
  ◯ bezos
  ◉ gates
  ◉ zuck
  ◯ musk

? Add repositories to manage:
  [Shows interactive repository selection]

? Include PMO (Project Management Office)?
  ❯ Yes
    No

[If PMO selected:]

? Choose storage backend:
  ❯ SQLite (local only, fast, no sync)
    Git (markdown file + cache, sync via git)

? Choose board template:
  ❯ Kanban (Backlog, In Progress, Done)
    Scrum (+ In Review, Blocked)
    5-Tool Founder (BUILD/GROW/SUPPORT/BIZOPS/STRATEGY + workflow)
    Custom (define your own columns)

✅ HQ initialized successfully!
   Location: /path/to/my-startup-hq
   Theme: Tech Founders
   Agents: 2 (gates, zuck)
   Repositories: 3
   PMO: Enabled (SQLite, Kanban)

Next steps:
  1. Navigate to HQ: cd my-startup-hq
  2. View agent status: prlt agents status
  3. Create your first ticket: prlt ticket create
```

**Behavior**:
- Interactive prompts guide through entire setup process
- Validates inputs before proceeding
- Creates directory structure
- Initializes SQLite database
- Sets up agent worktrees
- Optionally initializes PMO
- Shows next steps after completion

**Directory Structure Created**:
```
my-startup-hq/
├── .proletariat/
│   ├── config.json          # HQ configuration
│   └── workspace.db         # SQLite database
├── agents/
│   └── staff/
│       ├── gates/           # Agent worktree
│       └── zuck/            # Agent worktree
├── pmo/                     # (if PMO enabled)
│   ├── config.json
│   ├── board.md
│   └── board.db
└── repos/                   # Repository clones
```

---

### `prlt pmo init`
**Purpose**: Initialize PMO (Project Management Office) system in current directory or HQ

**Arguments**: None (fully interactive)

**Flags**:
- `--storage, -s <type>`: Storage backend (sqlite, git)
- `--template, -t <template>`: Board template (kanban, scrum, founder, custom)
- `--name, -n <name>`: Board name

**Interactive Flow**:
```
🎯 Initializing PMO...

? Choose storage backend:
  ❯ SQLite (local only, fast, no sync)
    Git (markdown file + cache, sync via git)

? Choose board template:
  ❯ Kanban (Backlog, In Progress, Done)
    Scrum (+ In Review, Blocked)
    5-Tool Founder (BUILD/GROW/SUPPORT/BIZOPS/STRATEGY + workflow)
    Custom (define your own columns)

? Board name: Project Board

[If SQLite selected:]
  ✓ board.md created
  ✓ SQLite database created

[If Git selected:]
  ✓ board.md created
  ✓ SQLite cache created

? Initialize git repository for PMO?
  ❯ Yes
    No

[If Yes:]
  ✓ Git repository initialized

? Add a git remote?
  ❯ No
    Yes

[If Yes:]
? Remote URL: https://github.com/user/pmo.git
  ✓ Remote added: https://github.com/user/pmo.git

✅ PMO initialized successfully!

Next steps:
  1. Create your first ticket: prlt ticket create
  2. View the board: prlt board view
  [If git: 3. Open in Obsidian for visual kanban]
  [If git: 4. Push to remote: prlt board push]
```

**Example**:
```bash
prlt pmo init
prlt pmo init --storage sqlite --template kanban
prlt pmo init --storage git --template founder --name "Startup Board"
```

**Behavior**:
- Detects if in HQ (uses `hq/pmo/`) or standalone (uses `.pmo/`)
- Prevents re-initialization if PMO already exists
- Creates board.md for Obsidian compatibility
- SQLite storage: Database is source of truth
- Git storage: board.md is source of truth, SQLite is cache
- Optionally initializes git repository with proper .gitignore
- Creates README.md with usage instructions

**Storage Backends**:

**SQLite**:
- Source of truth: `board.db`
- View file: `board.md` (exported for Obsidian)
- Fast local operations
- No sync capabilities

**Git**:
- Source of truth: `board.md`
- Cache: `.cache.db` (gitignored)
- Sync via git push/pull
- Team collaboration ready
- Obsidian compatible

**Templates**:

**Kanban**: Backlog, In Progress, Done
**Scrum**: Backlog, In Progress, In Review, Blocked, Done
**Founder**: BUILD, GROW, SUPPORT, BIZOPS, STRATEGY (with sub-workflows)
**Custom**: User-defined columns

**PMO Directory Structure**:
```
pmo/  (or .pmo/ if standalone)
├── config.json          # PMO configuration
├── board.md             # Kanban board (Obsidian compatible)
├── board.db             # SQLite database (if storage=sqlite)
├── .cache.db            # SQLite cache (if storage=git, gitignored)
├── .gitignore           # (if git init selected)
├── README.md            # Usage instructions
└── specs/               # Detailed ticket specs
```

---

### `prlt theme` (Not Implemented)
**Purpose**: Select or change the current workspace theme

**Arguments**: None (interactive) or theme name

**Interactive Flow**:
```
? Choose a theme for your agents:
  ❯ Tech Founders (bezos, gates, zuck, etc.)
    Scientists (einstein, curie, tesla, etc.)
    Philosophers (plato, socrates, nietzsche, etc.)
    Custom (define your own)

✅ Theme changed to: Tech Founders

Note: Existing agents are not renamed. Use 'prlt agents add' to create agents from new theme.
```

**Example**:
```bash
prlt theme
prlt theme scientists
```

**Behavior**:
- Shows available themes
- Updates workspace configuration
- Does NOT rename existing agents
- Affects future agent creation
- Warns about existing agents

---

## Design Principles

### One-Time Setup Commands
- **Interactive by Default**: Guide users through complex setup
- **Validation**: Check prerequisites before execution
- **Clear Feedback**: Show what's being created in real-time
- **Next Steps**: Always provide guidance after completion
- **Idempotent**: Prevent accidental re-initialization

### Progressive Disclosure
- **Simple Path**: Default choices for quick setup
- **Advanced Options**: Flags for automation and customization
- **Contextual Help**: Explain choices during prompts
- **Sensible Defaults**: Zero-config option for common use cases

### Configuration Management
- **Centralized Config**: `.proletariat/config.json` for workspace
- **Module Configs**: Separate configs for PMO, themes, etc.
- **Version Tracking**: Track configuration schema versions
- **Migration Support**: Handle config upgrades gracefully

---

## Integration Points

### Workspace Detection
All commands detect workspace context:
```typescript
// Check for HQ root
private findHQRoot(): string | null {
  let currentDir = process.cwd();

  while (currentDir !== '/') {
    const configPath = path.join(currentDir, '.proletariat', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.type === 'hq') {
        return currentDir;
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}
```

### Database Initialization
```typescript
// Initialize workspace database
const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
const storage = new SQLiteStorage(dbPath);

await storage.init({
  workspaceType: 'hq',
  theme,
  agents: selectedAgents,
  repositories: repos,
  hasPMO: includePMO,
});
```

### Agent Worktree Creation
```typescript
// Create worktrees for each agent across all repos
for (const agent of selectedAgents) {
  const agentDir = path.join(hqPath, 'agents', 'staff', agent.name);
  fs.mkdirSync(agentDir, { recursive: true });

  for (const repo of repos) {
    await createWorktree(repo.path, agent.name, agentDir);
  }
}
```

---

## Error Handling

### Common Scenarios
- **Already Initialized**: Detect existing workspace/PMO and prevent re-init
- **Missing Dependencies**: Check for git, node, required tools
- **Permission Issues**: Handle file system access problems
- **Invalid Paths**: Validate directory locations before creation
- **Git Failures**: Graceful degradation if git operations fail

### Recovery Guidance
```typescript
// Example error with recovery
if (fs.existsSync(path.join(pmoPath, '.pmo'))) {
  this.error('PMO already initialized. Use "prlt pmo status" to check.');
}

// Directory creation failure
try {
  fs.mkdirSync(hqPath, { recursive: true });
} catch (error) {
  this.error(`Failed to create directory: ${error.message}\n` +
             `Check permissions for: ${hqPath}`);
}
```

---

## Testing Strategy

### Setup Validation
- Test full HQ initialization flow
- Test workspace-only flow
- Test PMO initialization (both storage types)
- Verify directory structures created correctly
- Validate database initialization

### Error Cases
- Test re-initialization prevention
- Test invalid paths and permissions
- Test git failures with graceful fallback
- Test missing dependencies

### Integration
- Test theme integration with agent creation
- Test repository worktree creation
- Test PMO + HQ combined setup
- Test configuration persistence

---

## Configuration Files

### `.proletariat/config.json` (HQ)
```json
{
  "type": "hq",
  "name": "my-startup",
  "theme": "tech-founders",
  "created": "2025-01-27T10:00:00Z",
  "version": "1.0.0",
  "hasPMO": true,
  "repositories": [
    {
      "name": "main-app",
      "path": "/path/to/repos/main-app",
      "remote": "https://github.com/user/main-app.git"
    }
  ],
  "agents": [
    { "name": "gates", "theme": "tech-founders" },
    { "name": "zuck", "theme": "tech-founders" }
  ]
}
```

### `pmo/config.json` (PMO)
```json
{
  "storage": "sqlite",
  "template": "kanban",
  "boardName": "Project Board",
  "columns": ["Backlog", "In Progress", "Done"],
  "created": "2025-01-27T10:05:00Z",
  "gitRemote": "https://github.com/user/pmo.git",
  "autoSync": false
}
```

---

## Future Enhancements

### Cloud Initialization
```bash
prlt pmo init --storage cloud --provider notion
prlt pmo init --storage cloud --provider linear
```

### Templates Marketplace
```bash
prlt template list
prlt template install agile-with-sprints
prlt pmo init --template agile-with-sprints
```

### Bulk Import
```bash
prlt init --from-config workspace.yaml
prlt pmo init --import-from jira
```
