# `prlt init` Specification

## Purpose
Initialize an HQ (headquarters) structure for managing repositories, AI agents, and development projects.

## Core Concepts
- **HQ (Headquarters)**: A standardized umbrella directory containing repos/, agent workspace, and optionally PMO
- **Workspace-Only**: Lightweight agent workspace next to current repository (no repos/ or PMO)
- **Theme**: Determines agent workspace folder name (garage/staff/portfolio), available agents, and command aliases
- **PMO**: Optional project management office for ticket tracking (HQ mode only)
- **Two Modes**: Users choose between full HQ or lightweight workspace-only setup

## Themes

| Theme | Workspace Folder | Add Command | Remove Command | Example Agents |
|-------|-----------------|-------------|----------------|----------------|
| 💰 Billionaires | `staff/` | `hire` | `fire` | altman, musk, bezos, gates... |
| 🚗 Toyotas | `garage/` | `drive` | `park` | camry, tacoma, fj40, landcruiser... |
| 🏢 Companies | `portfolio/` | `buy` | `sell` | apple, google, meta, nvidia... |

## Usage Pattern
`prlt init` - Interactive workspace initialization with two modes:
- **Full HQ**: Complete headquarters with repos/, agents, and PMO
- **Workspace Only**: Just agent workspace next to current repo

## Process Flow

### Step 1: Workspace Type Selection
**Prompt**: "What type of workspace do you want to create?"
- 🏢 Full HQ (headquarters) - Complete setup with repos/, agents, and PMO
- 🔧 Agent workspace only - Just create agent workspace next to current repo

*Note: Workspace-only option only available when inside a git repository*

### Full HQ Flow (8 steps)

1. **HQ name** - Company/organization name
2. **HQ suffix** - Add "-hq" suffix? (Y/n)
3. **Location** - Where to create HQ (validates not inside git repo)
4. **Theme** - Agent naming theme (billionaires/toyotas/companies)
5. **Agents** - Add agents now? Select from theme
6. **Repositories** - Add current/other repos to HQ
7. **PMO** - Include project management office?
8. **Create** - Build complete HQ structure

### Workspace-Only Flow (4 steps)

1. **Theme** - Agent naming theme (billionaires/toyotas/companies)
2. **Location** - Where to create workspace (default: `../garage/`)
3. **Agents** - Add agents now? Select from theme
4. **Create** - Build workspace structure

## Created Structures

### Full HQ Structure:
```
my-project-hq/
├── .proletariat/
│   └── config.json      # type: "hq", theme, repos list
├── repos/               # All managed repositories
│   └── my-project/      # Cloned/moved repos
├── agents/              # Agent management directory
│   └── garage/          # Agent workspace (name from theme)
│       ├── camry/       # Agent directory
│       │   ├── .proletariat/
│       │   │   └── config.json
│       │   └── my-project/  # Git worktree for agent camry
│       └── tacoma/      # Agent directory
│           ├── .proletariat/
│           │   └── config.json
│           └── my-project/  # Git worktree for agent tacoma
└── pmo/                 # Optional project management
    ├── .git/
    ├── config.json
    ├── board.md
    └── specs/
```

### Workspace-Only Structure:
```
parent-dir/
├── my-project/          # Original repository
└── my-project-garage/   # Workspace (clearly linked to repo)
    ├── .proletariat/
    │   └── config.json  # type: "workspace", mainRepo, agents
    ├── camry/           # Agent directory
    │   ├── .proletariat/
    │   │   └── config.json
    │   └── my-project/  # Git worktree for agent camry
    └── tacoma/          # Agent directory
        ├── .proletariat/
        │   └── config.json
        └── my-project/  # Git worktree for agent tacoma
```


## Interactive Prompts

### Initial Choice (Step 1)
- **Workspace Type** (only if in git repo):
  - "What type of workspace do you want to create?"
    - 🏢 Full HQ (headquarters) - Complete setup with repos/, agents, and PMO
    - 🔧 Agent workspace only - Just create agent workspace next to current repo

### HQ Flow Prompts
1. **HQ Name**: "Workspace name (company, project, or team name recommended):"
2. **HQ Suffix**: "Add \"-hq\" suffix to folder name?" (arrow key selection)
3. **Location**: "Where to create HQ [press Enter for ../name-hq]:"
4. **Theme**: "Choose agent naming theme:" (billionaires/toyotas/companies)
5. **Agents**: "Add agents now? (y/N)" → Select from theme list
6. **Repositories**: Interactive repo addition (current + others)
7. **PMO**: "Include project management office (PMO)? (Y/n)"

### Workspace-Only Flow Prompts  
1. **Theme**: "Choose agent naming theme:" (billionaires/toyotas/companies)
2. **Location**: "Where to create workspace [press Enter for ../repo-garage]:"
3. **Agents**: "Add agents now? (y/N)" → Select from theme list

## Error Cases
- Directory already exists
- Trying to create HQ inside a git repository ("That's jail!")
- Invalid HQ name characters

## Config File Schemas

### HQ Config (.proletariat/config.json)
```json
{
  "type": "hq",
  "created": "2024-01-01T00:00:00Z",
  "theme": "toyotas",        // or "billionaires", "companies"
  "workspaceName": "garage",  // or "portfolio", "staff"
  "hasPMO": true,
  "agents": [],               // Will be populated as agents are added
  "repos": []                 // Will be populated as repos are added
}
```

### Workspace-Only Config (.proletariat/config.json)
```json
{
  "type": "workspace",
  "created": "2024-01-01T00:00:00Z",
  "theme": "toyotas",
  "mainRepo": "/path/to/main/repo",
  "agents": ["camry", "tacoma"]
}
```

### PMO Config (pmo/config.json)
```json
{
  "boardTitle": "Project Board",
  "queues": ["feature", "bug", "refactor", "docs", "devops"],
  "lastTicketId": 0,
  "columns": ["Backlog", "In Progress", "In Review", "Blocked", "Done"]
}
```

## Implementation Status
- [x] Spec complete
- [x] Implementation matches spec
- [ ] Tests written
- [ ] Documentation updated