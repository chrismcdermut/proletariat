# ⚒️ PROLETARIAT CLI

> **Workspace Manager for Parallel AI Development**  
> *Run multiple Cursor sessions, Claude Code instances, or CLI agents simultaneously on one machine - each working on different features without conflicts*

**Scale your solo development: Multiple AI sessions, parallel workspaces, all on your local machine!** 

---

## What Is This?

**PROLETARIAT CLI** implements the design pattern for running multiple AI coding sessions in parallel on a single machine. Each "agent" gets a persistent workspace (a git worktree - but I call them workspaces because it's clearer) where you or your AI tools can work continuously, switching between features as needed:

- 🤖 **Persistent AI workspaces** - Let one Claude Code instance live in "bezos" while another Claude Code instance works in "musk" - each for weeks at a time
- 🔀 **Branch without context switching** - Each workspace can switch branches to work on new features while keeping its workspace directory intact
- 🎯 **Parallel AI work streams** - Multiple AI agents can work simultaneously on different features for the same repo, each in their own branch and workspace

Using memorable themes, you manage your agent workforce:
- 💰 **Billionaires** become your coding workforce (Bezos, Musk, Gates)
- 🚗 **Toyotas** drive your development forward (Prius, Tacoma, Tundra)
- 🏢 **Companies** form your development portfolio (Apple, Google, Microsoft)

Each workspace is a dedicated git worktree on your local machine. Run as many AI coding sessions as there are agents in your theme (40 billionaires!) - Cursor, Claude Code, Aider, etc. - editing different features, or quickly switch between workspaces without losing context!

---

## 💡 The Design Pattern

**Problem:** AI coding tools work in a single directory. Want to work on multiple features? You're stuck with stashing, branching, and context switching.

**Solution:** PROLETARIAT creates isolated agent workspaces on your machine where you can run multiple AI sessions:

```
your-company-hq/  (recommended layout)
├── your-repo/              # Your original repo
├── your-repo-staff/
│   ├── bezos/    → Claude Code 1: Building authentication
│   ├── musk/     → Claude Code 2: Implementing AI features  
│   ├── gates/    → Cursor: Refactoring database
│   ├── jobs/     → Codex CLI 1: Writing test suite
│   └── cook/     → Codex CLI 2: Fixing security issues
```

**Result:** One developer, 5 agent directories, 0 conflicts. Work on multiple features simultaneously or let AI agents handle different tasks!

---

## 🚀 Quick Start

### Installation

```bash
npm install -g @proletariat/cli
# or
pnpm add -g @proletariat/cli
```

### HQ Mode (Multi-Agent Headquarters)

```bash
# Initialize HQ with a theme
prlt init --hq MyCompany --theme billionaires

# Add agents to your workforce
prlt agent add elon jeff          # or: prlt hire elon jeff

# Add repositories to manage
prlt repo add https://github.com/user/repo

# Create and assign work
prlt ticket create
prlt ticket assign T0001 elon

# Switch to agent workspace and claim ticket
prlt agent switch elon
prlt ticket claim T0001           # Launches Claude with context

# View status
prlt ticket list                  # All tickets
prlt agent list                   # All agents and their repos
```

### Simple Mode (Single Repo)

```bash
# In any git repository
prlt init --theme billionaires

# Create agent workspaces
prlt hire bezos musk gates

# List your workforce
prlt staff
```

---

## 📚 Command Reference

### Core Commands

#### Initialize & Setup
| Command | Description | Example |
|---------|-------------|---------|
| `prlt init` | Initialize workspace | `prlt init --theme billionaires` |
| `prlt init --hq <name>` | Create headquarters | `prlt init --hq MyCompany --theme toyotas` |
| `prlt upgrade` | Upgrade config to latest | `prlt upgrade` |

#### Agent Management
| Command | Description | Example |
|---------|-------------|---------|
| `prlt agent` | Interactive menu | `prlt agent` |
| `prlt agent add [names]` | Add agents | `prlt agent add elon jeff` |
| `prlt agent remove [names]` | Remove agents | `prlt agent remove gates` |
| `prlt agent list` | Show all agents | `prlt agent list` |
| `prlt agent switch <name>` | Go to agent workspace | `prlt agent switch elon` |
| `prlt agent grant` | Grant repo access | `prlt agent grant` |
| `prlt agent revoke` | Revoke repo access | `prlt agent revoke` |

#### Repository Management (HQ Mode)
| Command | Description | Example |
|---------|-------------|---------|
| `prlt repo` | Interactive menu | `prlt repo` |
| `prlt repo add [path/url]` | Add repository | `prlt repo add ./frontend` |
| `prlt repo remove [name]` | Remove repository | `prlt repo remove backend` |
| `prlt repo list` | List repositories | `prlt repo list` |

#### Ticket/PMO Management (HQ Mode)
| Command | Description | Example |
|---------|-------------|---------|
| `prlt pmo:init` | Initialize PMO | `prlt pmo:init` |
| `prlt ticket` | Interactive menu | `prlt ticket` |
| `prlt ticket create` | Create new ticket | `prlt ticket create` |
| `prlt ticket list` | View all tickets | `prlt ticket list` |
| `prlt ticket claim [id]` | Claim & start work | `prlt ticket claim T0001` |
| `prlt ticket assign [id] [agent]` | Assign to agent | `prlt ticket assign T0001 elon` |
| `prlt ticket reassign [id] [agent]` | Change assignment | `prlt ticket reassign T0001 jeff` |
| `prlt ticket unassign [id]` | Remove assignment | `prlt ticket unassign T0001` |
| `prlt ticket complete <id>` | Mark as done | `prlt ticket complete T0001` |

### Theme Commands (Aliases)

#### 💰 Billionaires Theme
| Command | Description | Standard Command |
|---------|-------------|-----------------|
| `prlt hire [names]` | Hire billionaires | `agent add` |
| `prlt fire [names]` | Fire billionaires | `agent remove` |
| `prlt staff` | Show staff | `agent list` |

#### 🚗 Toyotas Theme
| Command | Description | Standard Command |
|---------|-------------|-----------------|
| `prlt drive [names]` | Drive cars | `agent add` |
| `prlt park [names]` | Park cars | `agent remove` |
| `prlt garage` | Show garage | `agent list` |

#### 🏢 Companies Theme
| Command | Description | Standard Command |
|---------|-------------|-----------------|
| `prlt buy [names]` | Buy companies | `agent add` |
| `prlt sell [names]` | Sell companies | `agent remove` |
| `prlt portfolio` | Show portfolio | `agent list` |

### Utility Commands
| Command | Description | Example |
|---------|-------------|---------|
| `prlt repair` | Fix broken worktrees | `prlt repair` |
| `prlt health` | Check workspace health | `prlt health` |
| `prlt list --theme=<name>` | List agents in theme | `prlt list --theme=toyotas` |
| `prlt themes` | Show available themes | `prlt themes` |
| `prlt --version` | Show version | `prlt --version` |
| `prlt --help` | Show help | `prlt --help` |

---

## 🏗️ HQ Mode vs Simple Mode

### Simple Mode (Default)
- Single repository management
- Agents are worktrees in `.proletariat/` folder
- Great for solo projects

### HQ Mode (Multi-Repo)
- Central headquarters managing multiple repositories
- PMO ticket system for task management
- Agent access control per repository
- Ideal for managing multiple projects or microservices

```
MyCompanyHQ/
├── .proletariat/          # HQ configuration
│   └── agents/
│       └── billionaires/
│           ├── elon/     # Worktrees for each repo
│           ├── jeff/
│           └── bill/
├── pmo/                   # Project Management Office
│   ├── kanban.md         # Kanban board
│   └── tickets.json      # Ticket database
└── repos/                 # Managed repositories
    ├── frontend/
    ├── backend/
    └── mobile/
```

---

## 🎨 Themes & Agents

### Available Themes

**Billionaires (40 agents)**
```
elon, jeff, bill, warren, mark, sergey, larry, tim, satya, jensen...
```

**Toyotas (33 agents)**
```
camry, corolla, prius, tacoma, tundra, highlander, sienna, avalon...
```

**Companies (40 agents)**
```
apple, google, microsoft, amazon, meta, nvidia, tesla, netflix...
```

View all agents: `prlt list --theme=billionaires`

---

## 💡 Use Cases

### Parallel AI Development
Run multiple AI coding sessions simultaneously:
```bash
# Terminal 1: Claude on authentication
cd MyHQ/.proletariat/agents/billionaires/elon
claude "implement OAuth2"

# Terminal 2: Cursor on database
cd MyHQ/.proletariat/agents/billionaires/jeff
cursor .

# Terminal 3: Aider on tests
cd MyHQ/.proletariat/agents/billionaires/bill
aider --message "write unit tests"
```

### Feature Branch Isolation
Each agent can work on different features:
```bash
prlt ticket create  # Create feature tickets
prlt ticket assign T0001 elon
prlt ticket assign T0002 jeff
prlt ticket assign T0003 bill
```

### Context Preservation
Agents maintain their own:
- Git branches
- Uncommitted changes
- Build artifacts
- Node modules
- Environment state

---

## ⚙️ Configuration

### Config File Location
- Simple mode: `.proletariat/repo.json`
- HQ mode: `HQ/.proletariat/config.json`

### Environment Variables
```bash
PRLT_THEME=billionaires       # Default theme
PRLT_HQ_ROOT=/path/to/hq      # HQ location
```

---

## 🐛 Troubleshooting

### Broken Worktrees
```bash
prlt repair                    # Fix all worktree issues
prlt health                    # Check workspace health
```

### Permission Issues
```bash
# Ensure git directory is accessible
chmod -R u+rw .git
```

### Agent Not Found
```bash
prlt list --theme=billionaires  # Verify agent name
prlt agent list                 # Show current agents
```

---

## 📝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

---

## 📄 License

MIT - See LICENSE file

---

## 🔗 Links

- [GitHub Repository](https://github.com/chrismcdermut/proletariat-cli)
- [NPM Package](https://www.npmjs.com/package/@proletariat/cli)
- [Issue Tracker](https://github.com/chrismcdermut/proletariat-cli/issues)

---

Made with ⚒️ by the coding proletariat, for the coding proletariat.