# ⚒️ prlt

> **Turn tickets into pull requests with AI agents**
> *Spawn agents on tickets, they write code, you review PRs*

---

## What Is This?

**prlt** orchestrates AI coding agents working on your codebase in parallel. You create tickets describing what to build, spawn agents to work on them, and they deliver pull requests.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   You                    prlt                     Agents         │
│                                                                  │
│   Create ticket    →    Spawn session    →    Write code         │
│   "Add OAuth"           Branch created        Commits made       │
│                         Agent working         PR opened          │
│                                                                  │
│   Review PR        ←    PR ready          ←   Work complete      │
│   Merge                                                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Each agent gets:
- 🔀 **Its own git branch** - No conflicts between agents
- 📦 **Isolated session** - Docker, tmux, or terminal
- 📋 **Ticket context** - Knows exactly what to build

---

## 🚀 Quick Start

```bash
# Install
npm install -g @proletariat/cli

# Initialize workspace
prlt init

# Create a ticket
prlt ticket create --title "Add user authentication" --priority P1 --category feature

# Spawn an agent to work on it
prlt work start TKT-001

# Watch it work
prlt board
```

The agent reads your ticket, writes the code, and opens a PR. You review and merge.

---

## 💡 The Design Pattern

**Problem:** AI coding assistants are powerful but chaotic at scale:
- Multiple agents overwrite each other's changes
- "Which branch has the auth code?"
- "Did that agent finish?"
- Context scattered across chat windows

**Solution:** prlt gives each agent an isolated workspace:

```
my-project/
├── .proletariat/
│   └── workspace.db          # Tickets, executions, state
├── agents/
│   └── temp/
│       ├── agent-abc123/     # Agent 1: Working on TKT-042 (OAuth)
│       │   └── repo/         # Its own branch: feat/TKT-042-oauth
│       └── agent-def456/     # Agent 2: Working on TKT-043 (API)
│           └── repo/         # Its own branch: feat/TKT-043-api
└── repos/
    └── my-repo/              # Your original repo
```

**Result:** Parallel agents, zero conflicts. Each works independently, creates its own PR.

---

## 🎯 Three Ways to Use Commands

### 1. Interactive (Humans)

Run without flags—get guided prompts:

```bash
$ prlt ticket create

? Title: Add password reset
? Description: Email-based password reset flow
? Priority: P1
? Category: feature

✓ Created TKT-043
```

### 2. JSON Mode (AI Agents)

Add `--json` for machine-readable output:

```bash
$ prlt work start --json
```

```json
{
  "prompt": {
    "type": "list",
    "message": "Select ticket to work on:",
    "choices": [
      {
        "name": "[P1] TKT-042 - Add user authentication",
        "value": "TKT-042",
        "command": "prlt work start TKT-042 --json"
      }
    ]
  }
}
```

AI agents parse this, make selections, call the next command.

### 3. Flags (Scripts/CI)

Pass everything directly:

```bash
prlt ticket create \
  --title "Add OAuth" \
  --description "Google and GitHub OAuth" \
  --priority P1 \
  --category feature
```

---

## ⚡ Execution Modes

Where does the agent run?

| Mode | Flag | Best For |
|------|------|----------|
| 🐳 Docker | `--mode docker` | Safety—fully isolated container |
| 🖥️ Tmux | `--mode tmux` | Multiple agents, attach/detach |
| 📺 Terminal | `--mode terminal` | New window per agent |
| 👀 Foreground | `--mode foreground` | Watch output directly |
| 🏃 Host | `--run-on-host` | Speed—no container overhead |

```bash
# Safe and isolated
prlt work start TKT-042 --mode docker

# Attachable sessions (can detach and reattach)
prlt work start TKT-042 --mode tmux

# Fast, direct execution
prlt work start TKT-042 --run-on-host
```

Sessions are like threads—close the window, agent keeps working.

---

## 🔥 Parallel Agents

Work on multiple tickets simultaneously:

```bash
# Spawn all planned tickets at once
prlt work spawn --all --column Planned

# Spawn specific tickets
prlt work spawn TKT-042 TKT-043 TKT-044

# Preview first (dry run)
prlt work spawn --all --dry-run
```

Each agent works in its own branch. No conflicts.

---

## 📚 Command Reference

### Tickets

| Command | Description |
|---------|-------------|
| `prlt ticket create` | Create new ticket (interactive) |
| `prlt ticket list` | List all tickets |
| `prlt ticket view TKT-042` | View ticket details |
| `prlt ticket edit TKT-042` | Edit ticket |
| `prlt ticket move TKT-042 Done` | Change status |

### Work

| Command | Description |
|---------|-------------|
| `prlt work start TKT-042` | Spawn agent on single ticket |
| `prlt work spawn --all` | Batch spawn multiple tickets |
| `prlt execution list` | List running agents |
| `prlt execution logs` | View agent output |
| `prlt execution stop <id>` | Stop an agent |

### Board

| Command | Description |
|---------|-------------|
| `prlt board` | View kanban board |
| `prlt board watch` | Real-time board updates |

### Setup

| Command | Description |
|---------|-------------|
| `prlt init` | Initialize workspace |
| `prlt repo add <url>` | Add repository |
| `prlt repo list` | List repositories |

---

## 💡 Use Cases

### Parallel Feature Development

```bash
# Create tickets for each feature
prlt ticket create --title "Add OAuth" --category feature
prlt ticket create --title "Add API rate limiting" --category feature
prlt ticket create --title "Add email notifications" --category feature

# Spawn all three in parallel
prlt work spawn TKT-001 TKT-002 TKT-003 --mode tmux

# Watch the board as they work
prlt board watch
```

Three agents, three branches, three PRs. You review and merge.

### Bug Bash

```bash
# Spawn all bugs at once
prlt work spawn --all --column Backlog --category bug

# Or pick specific ones
prlt work spawn TKT-010 TKT-011 TKT-012
```

### Grooming Session

Have an agent refine ticket requirements:

```bash
prlt work start TKT-042 --action groom
```

Agent adds acceptance criteria, subtasks, estimates.

---

## ⚙️ Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `GITHUB_TOKEN` | GitHub operations (PRs, etc.) |
| `PRLT_HQ_PATH` | Custom workspace location |

---

## 🔧 Requirements

- **Node.js 18+**
- **Git**
- **Docker** (optional—for isolated execution)

---

## 📄 License

Apache 2.0

---

Made with ⚒️ for the AI-assisted developer.
