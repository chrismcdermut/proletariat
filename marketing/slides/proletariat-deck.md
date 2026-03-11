---
marp: true
theme: default
paginate: true
backgroundColor: #0d1117
color: #e6edf3
style: |
  section {
    font-family: 'Inter', 'SF Pro Display', -apple-system, sans-serif;
  }
  h1 {
    color: #58a6ff;
  }
  h2 {
    color: #58a6ff;
  }
  h3 {
    color: #79c0ff;
  }
  a {
    color: #58a6ff;
  }
  code {
    background: #161b22;
    color: #e6edf3;
    border-radius: 4px;
    padding: 2px 6px;
  }
  pre {
    background: #161b22;
    border-radius: 8px;
    border: 1px solid #30363d;
  }
  table {
    color: #e6edf3;
  }
  th {
    background: #161b22;
    color: #58a6ff;
  }
  td {
    background: #0d1117;
    border-color: #30363d;
  }
  strong {
    color: #f0f6fc;
  }
  blockquote {
    border-left: 4px solid #58a6ff;
    color: #8b949e;
  }
  em {
    color: #8b949e;
  }
  section.lead h1 {
    font-size: 2.5em;
  }
  section.lead h2 {
    color: #8b949e;
    font-weight: 400;
  }
  .columns {
    display: flex;
    gap: 2em;
  }
  .columns > div {
    flex: 1;
  }
---

<!-- _class: lead -->

# ⚒️ Proletariat

## AI Agent Orchestration for Engineering Teams

**Spawn, manage, and monitor multiple AI coding agents in parallel.**

*Seize the means of production — Ship 100x.*

---

# The Problem

### Single-agent development doesn't scale

- **One agent at a time** — You babysit a single AI coding session while 10 tickets wait
- **Context switching** — Jumping between tasks, re-explaining context each time
- **No isolation** — Agents step on each other's code, create merge conflicts
- **Manual task management** — Copy-pasting requirements from Linear/Jira into chat windows
- **Lost context** — Close a window, lose your agent's progress
- **No visibility** — "What's my agent doing right now?" is unanswerable

> Engineering teams are bottlenecked by sequential AI workflows.

---

# The Solution

### `prlt` — Multi-agent orchestration from one CLI

```bash
brew install chrismcdermut/proletariat/prlt

prlt new                                # Create HQ workspace
prlt ticket create --title "Add OAuth"  # Create tickets
prlt work spawn TKT-001 TKT-002 TKT-003  # Spawn 3 agents
```

**Each agent gets:**
- Its own git branch (no conflicts)
- Docker sandbox (secure isolation)
- Persistent tmux session (survives disconnects)
- Structured ticket context (not freeform chat)

**Result:** 3 agents, 3 branches, 3 PRs. You review and merge.

---

# Key Features

| Feature | Description |
|---------|-------------|
| **Multi-agent parallel execution** | Spawn 50+ agents simultaneously |
| **Ticket-based task management** | Structured requirements with acceptance criteria |
| **Docker sandboxing** | Isolated containers per agent |
| **Session persistence** | Tmux sessions survive disconnects |
| **Git worktree isolation** | Each agent works on its own branch |
| **PR creation workflow** | Agents create PRs when done |
| **MCP server** | 100+ tools for AI client integration |
| **Agent-native JSON mode** | AI agents can drive the CLI programmatically |

---

# Multi-Agent Parallel Execution

```
  ┌──────────┐
  │ prlt CLI │
  │  spawn   │
  └────┬─────┘
       │
  ┌────┴────────────────────────────────┐
  │              │                      │
  ▼              ▼                      ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Agent 1  │  │ Agent 2  │  │   Agent 3    │
│ TKT-001  │  │ TKT-002  │  │   TKT-003    │
│ OAuth    │  │ Rate Lim │  │ Notifications │
└────┬─────┘  └────┬─────┘  └──────┬───────┘
     │              │               │
     ▼              ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│  PR #101 │  │  PR #102 │  │   PR #103    │
│feat/oauth│  │feat/rate │  │feat/notif    │
└──────────┘  └──────────┘  └──────────────┘
```

**One command. Three agents. Three PRs. You review.**

---

# Ticket-Based Task Management

### Structured context, not freeform chat

```bash
prlt ticket create \
  --title "Add OAuth" \
  --description "Google and GitHub OAuth" \
  --priority P1 \
  --category feature

prlt ticket edit TKT-001 \
  --add-ac "Users can sign in with Google" \
  --add-ac "Users can sign in with GitHub" \
  --add-subtask "Create OAuth callback route"
```

Tickets provide:
- **Requirements** — What to build
- **Acceptance criteria** — How to verify
- **Subtasks** — Step-by-step breakdown
- **Persistent context** — Accumulates across agent sessions

---

# Integrations Ecosystem

### Import tickets from your existing tools

```
  ┌─────────┐  ┌───────┐  ┌─────────┐
  │  Linear  │  │ Jira  │  │  Asana  │
  └────┬─────┘  └───┬───┘  └────┬────┘
       │            │            │
       └────────┬───┴────────────┘
                │
         ┌──────▼──────┐
         │   prlt CLI  │
         │   Unified   │
         │  Interface  │
         └──────┬──────┘
                │
       ┌────────┴─────────┐
       │                  │
  ┌────▼────┐      ┌─────▼─────┐
  │Shortcut │      │  Trello   │
  └─────────┘      └───────────┘
```

| Integration | Status |
|-------------|--------|
| **Linear** | Sync issues, bi-directional |
| **Jira** | Import and spawn |
| **Asana** | End-to-end integration |
| **Shortcut** | Import and spawn |
| **Trello** | Import and spawn |
| **GitHub** | PRs, reviews, auth |

---

# Docker Sandboxing & Isolation

### Every agent runs in its own secure container

```
┌─────────────────────────────────────────┐
│              Host Machine               │
│                                         │
│  ┌───────────┐ ┌───────────┐ ┌────────┐│
│  │ Container │ │ Container │ │Container││
│  │  Agent 1  │ │  Agent 2  │ │Agent 3 ││
│  │           │ │           │ │        ││
│  │ ┌───────┐ │ │ ┌───────┐ │ │┌──────┐││
│  │ │Claude │ │ │ │Claude │ │ ││Claude│││
│  │ │Session│ │ │ │Session│ │ ││Sessn │││
│  │ └───────┘ │ │ └───────┘ │ │└──────┘││
│  │ ┌───────┐ │ │ ┌───────┐ │ │┌──────┐││
│  │ │ Git   │ │ │ │ Git   │ │ ││ Git  │││
│  │ │Branch │ │ │ │Branch │ │ ││Branch│││
│  │ └───────┘ │ │ └───────┘ │ │└──────┘││
│  └───────────┘ └───────────┘ └────────┘│
└─────────────────────────────────────────┘
```

**Modes:** Docker (isolated) | Host (fast) | YOLO (full autonomy in Docker)

---

# Architecture

```
┌─────────────────────────────────────────────────┐
│                  HQ Workspace                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Projects │  │ Tickets  │  │    Specs       │  │
│  │ Epics    │  │ AC, Tasks│  │ Documentation  │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Repos    │  │ Agents   │  │  Executions    │  │
│  │ Git URLs │  │ Staff    │  │  Docker/Host   │  │
│  │          │  │ Temp     │  │  Tmux sessions │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Workflows │  │ Actions  │  │  Integrations  │  │
│  │ Phases   │  │Templates │  │  Linear, Jira  │  │
│  │ Statuses │  │          │  │  Asana, GitHub │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │           SQLite Database                │    │
│  │     All state in one .proletariat/       │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

# Live Demo: Kvia Cowork

### 3 agents, 3 tickets, start to PR in under 10 minutes

```bash
# Step 1: Create tickets
prlt ticket create --title "Add OAuth"          --priority P1
prlt ticket create --title "Add rate limiting"  --priority P1
prlt ticket create --title "Add email notifs"   --priority P1

# Step 2: Spawn all three agents in parallel
prlt work spawn TKT-001 TKT-002 TKT-003

# Step 3: Watch the board as they work
prlt board watch

# Step 4: Review the PRs
# → 3 PRs created, ready for review
```

**What happened:**
1. Three agents spawned in isolated Docker containers
2. Each created its own git branch
3. Each read its ticket, wrote code, committed, opened a PR
4. Total time: **under 10 minutes**

---

# Before & After

<div class="columns">
<div>

### Before (Traditional)

```
 Developer
    │
    ├─ Open chat
    ├─ Paste requirements
    ├─ Wait for code...
    ├─ Review output
    ├─ Copy to project
    ├─ Fix conflicts
    ├─ Commit & PR
    │
    ├─ Open new chat
    ├─ Paste next task
    ├─ Wait again...
    │
    └─ (repeat for each task)

 ⏱  ~30 min per task
 📋  3 tasks = 90+ min
```

</div>
<div>

### After (prlt)

```
 Developer
    │
    ├─ prlt ticket create (×3)
    ├─ prlt work spawn
    │
    │   ┌─ Agent 1 → PR #1
    │   ├─ Agent 2 → PR #2
    │   └─ Agent 3 → PR #3
    │
    ├─ Review 3 PRs
    └─ Merge

 ⏱  ~10 min total
 📋  3 tasks = still 10 min
```

</div>
</div>

> **9x faster** — Ship a sprint's worth of features in one sitting.

---

# Three Ways to Use prlt

### Human, AI, and Script interfaces

| Mode | How | Best For |
|------|-----|----------|
| **Interactive** | `prlt work spawn` | Humans — guided prompts |
| **JSON mode** | `prlt work spawn --json` | AI agents — machine-readable |
| **Flags** | `prlt work spawn TKT-001 TKT-002` | Scripts & CI |

```bash
# JSON mode returns structured prompts for AI agents
$ prlt work start --json
{
  "prompt": {
    "type": "list",
    "message": "Select ticket to work on:",
    "choices": [
      { "name": "[P1] TKT-042 - Add OAuth", "value": "TKT-042" }
    ]
  }
}
```

---

# Agent Naming Themes

### Because naming things should be fun

| Theme | Names | Vibe |
|-------|-------|------|
| **billionaires** | `musk`, `gates`, `bezos` | Finally, they work for us |
| **toyotas** | `camry`, `supra`, `tacoma` | Reliable workhorses |
| **companies** | `stripe`, `vercel`, `linear` | Tech all-stars |
| **custom** | *anything you want* | Your imagination |

```bash
prlt agent themes set billionaires

# Spawn agents:
# → bold-bezos is working on TKT-001
# → keen-musk is working on TKT-002
# → swift-gates is working on TKT-003
```

> *billionaires* — Finally, they work for us.

---

# Workspace Structure

```
my-project/
├── .proletariat/
│   └── workspace.db           ← All state in one DB
├── repos/
│   ├── frontend/              ← Your repositories
│   ├── backend/
│   └── infra/
└── agents/
    ├── staff/
    │   └── alice/             ← Persistent named agent
    │       ├── frontend/
    │       └── backend/
    └── temp/
        ├── bold-bezos/        ← Working on TKT-001
        │   ├── frontend/        (own branch, own code)
        │   └── backend/
        └── keen-musk/         ← Working on TKT-002
            ├── frontend/        (own branch, own code)
            └── backend/
```

**Each agent gets a full copy of all repos, on its own branch.**

---

# Workflow Automation

### Tickets move automatically as agents work

```
   Backlog         In Progress        Review           Done
  ┌─────────┐    ┌─────────────┐   ┌──────────┐   ┌─────────┐
  │ TKT-004 │    │  TKT-001    │   │ TKT-002  │   │ TKT-003 │
  │ TKT-005 │    │  Agent: musk│   │ PR #102  │   │ Merged  │
  │ TKT-006 │    │  Coding...  │   │ Reviewing│   │         │
  └─────────┘    └─────────────┘   └──────────┘   └─────────┘

  prlt work spawn ──→  Agent starts ──→  PR created ──→  Merged
   (auto-move)         (auto-move)       (auto-move)    (complete)
```

Customizable workflows: Kanban, Scrum, or your own.

---

# Roadmap

### What's coming next

| Feature | Description |
|---------|-------------|
| **Web Dashboard** | Real-time browser UI for monitoring agents |
| **Media Source Types** | Rich media attachments on tickets |
| **Auto-Release** | Automated versioning and deployment |
| **Agent-to-Agent Communication** | Agents collaborate on dependent tasks |
| **Host Sandboxing** | macOS sandbox for non-Docker execution |
| **Repo Scoping** | Assign specific repos to specific agents |

---

<!-- _class: lead -->

# Get Started Today

### Install in 30 seconds

```bash
brew install chrismcdermut/proletariat/prlt
```

```bash
npm install -g @proletariat/cli
```

---

### Links

**GitHub** — github.com/chrismcdermut/proletariat
**npm** — npmjs.com/package/@proletariat/cli
**MCP Registry** — registry.modelcontextprotocol.io
**Discord** — discord.gg/tmZyjNNSvw
**Book a call** — cal.com/chrismcdermut

---

<!-- _class: lead -->

# ⚒️ Proletariat

## Seize the means of production. Ship 100x.

**Star on GitHub** | **Install from NPM** | **Join Discord**

*Made with ⚒️ by the proletariat.*
