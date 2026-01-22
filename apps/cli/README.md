# prlt

> Turn tickets into pull requests with AI agents

```
prlt work start TKT-042
```

An AI agent reads your ticket, writes the code, and creates a PR. You review and merge.

## The Problem

AI coding assistants are powerful, but managing them is chaos:
- Multiple agents overwrite each other's work
- No clear tracking of who's doing what
- Context scattered across chat windows
- "Did the agent finish? What branch is it on?"

## The Solution

**prlt** gives each AI agent its own git branch and tracks work through tickets:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Ticket    │ ──▶ │   Agent     │ ──▶ │   PR Ready  │
│   TKT-042   │     │  Working... │     │   Review ✓  │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## Install

```bash
npm install -g @proletariat/cli
```

---

## Quick Start

```bash
# 1. Initialize
prlt init

# 2. Create a ticket
prlt ticket create --title "Add user auth" --priority P1 --category feature

# 3. Spawn an agent
prlt work start TKT-001

# 4. Agent works → PR appears
```

---

## What You See

### Ticket View

```
📄 Ticket TKT-042

Title:       Add user authentication
Status:      In Progress
Priority:    P1
Category:    feature

Description:
  Implement JWT-based authentication with refresh tokens.

Acceptance Criteria:
  • Users can log in with email/password
  • JWT tokens expire after 1 hour
  • Refresh tokens handled automatically
```

### Spawning Work

```bash
$ prlt work start TKT-042

? Select execution mode:
❯ docker      - Isolated container (safe)
  tmux        - Attachable session
  terminal    - New window
  foreground  - Current terminal

? Select action:
❯ implement   - Write code for this ticket
  groom       - Refine ticket requirements
  review      - Review existing code

✓ Agent spawned on branch feat/TKT-042-user-auth
✓ Session started in docker container
```

---

## Three Ways to Use Commands

### 1. Interactive (Humans)

Run without arguments—guided prompts:

```bash
$ prlt ticket create

? Title: Add password reset
? Description: Allow users to reset forgotten passwords
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
    "name": "selection",
    "message": "Select ticket to work on:",
    "choices": [
      {
        "name": "[P1] TKT-042 - Add user authentication",
        "value": "TKT-042",
        "command": "prlt work start TKT-042 --json"
      },
      {
        "name": "[P0] TKT-043 - Fix login crash",
        "value": "TKT-043",
        "command": "prlt work start TKT-043 --json"
      }
    ]
  }
}
```

AI agents parse this JSON, make selections, and call the next command.

### 3. Flags (Scripts/CI)

Pass everything directly:

```bash
prlt ticket create \
  --title "Add password reset" \
  --description "Email-based password reset flow" \
  --priority P1 \
  --category feature
```

---

## Execution Modes

Where does the agent run?

| Mode | Command | Best For |
|------|---------|----------|
| Docker | `--mode docker` | Safety—isolated container |
| Tmux | `--mode tmux` | Multiple agents, attach/detach |
| Terminal | `--mode terminal` | Single agent, new window |
| Foreground | `--mode foreground` | Debugging, watch output |
| Host | `--run-on-host` | Speed—no container overhead |

```bash
# Safe and isolated
prlt work start TKT-042 --mode docker

# Multiple agents in tmux sessions
prlt work start TKT-042 --mode tmux
prlt work start TKT-043 --mode tmux

# Direct execution (fastest)
prlt work start TKT-042 --run-on-host
```

Sessions are like threads—attach, detach, close the window, agent keeps working.

---

## Parallel Agents

Work on multiple tickets at once:

```bash
# Spawn all planned tickets
prlt work spawn --all --column Planned

# Spawn specific tickets
prlt work spawn TKT-042 TKT-043 TKT-044

# Preview first
prlt work spawn --all --dry-run
```

---

## Core Commands

### Tickets

```bash
prlt ticket create              # Create new ticket
prlt ticket list                # List all tickets
prlt ticket view TKT-042        # View ticket details
prlt ticket edit TKT-042        # Edit ticket
prlt ticket move TKT-042 Done   # Change status
```

### Work

```bash
prlt work start TKT-042         # Spawn agent on ticket
prlt work spawn --all           # Batch spawn
prlt execution list             # List running agents
prlt execution logs             # View agent output
prlt execution stop <id>        # Stop an agent
```

### Board

```bash
prlt board                      # View kanban board
prlt board watch                # Real-time updates
```

### Setup

```bash
prlt init                       # Initialize workspace
prlt repo add <url>             # Add repository
```

---

## How It Works

```
You                          prlt                         Agent
 │                            │                            │
 │  prlt work start TKT-042   │                            │
 │ ─────────────────────────▶ │                            │
 │                            │  Create branch             │
 │                            │  feat/TKT-042-user-auth    │
 │                            │ ──────────────────────────▶│
 │                            │                            │
 │                            │  Start session             │
 │                            │  (docker/tmux/terminal)    │
 │                            │ ──────────────────────────▶│
 │                            │                            │
 │                            │        Read ticket         │
 │                            │◀──────────────────────────│
 │                            │                            │
 │                            │        Write code          │
 │                            │        Commit              │
 │                            │        Create PR           │
 │                            │◀──────────────────────────│
 │                            │                            │
 │  PR ready for review       │                            │
 │◀───────────────────────────│                            │
```

---

## Requirements

- Node.js 18+
- Git
- Docker (optional—for isolated execution)

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `GITHUB_TOKEN` | GitHub operations |
| `PRLT_HQ_PATH` | Custom workspace location |

---

## License

Apache 2.0
