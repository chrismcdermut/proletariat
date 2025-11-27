# Architecture Matrix - Grouped by Work Setup

## Work Setup Combinations with PMO Viability

| **ICP**                           | **Description**                                     | **Eng #** | **Repos** | **Host Nd** | **Wrkr/Host** | **SQLite** | **In-Repo** | **Out Repo** | **Cloud DB** | **PMO Tool** | **Best Choice** | **Why**                          |
| --------------------------------- | --------------------------------------------------- | --------- | --------- | ----------- | ------------- | ---------- | ----------- | ------------ | ------------ | ------------ | --------------- | -------------------------------- |
| **SoloDev MonoRepo SoloWrk**      | One developer, one repo, one machine, one worker    | 1         | Mono      | 1           | 1             | ✅          | ✅           | ✅            | ✅            | ✅            | SQLite          | No coordination needed           |
| **SoloDev MultiRepo SoloWrk**     | One developer managing multiple repositories        | 1         | Multi     | 1           | 1             | ✅          | ❌           | ✅            | ✅            | ✅            | SQLite          | No coordination needed           |
| **SoloDev MonoRepo MultiWrkr**    | One developer with 2-5 AI agents/bots helping       | 1         | Mono      | 1           | 2-5           | ✅ WAL      | ✅           | ✅            | ✅            | ✅            | SQLite WAL      | Worker coordination via WAL mode |
| **SoloDev MultiRepo MultiWrkr**   | One developer with 2-5 AI agents/bots, multi-repo   | 1         | Multi     | 1           | 2-5           | ✅ WAL      | ❌           | ✅            | ✅            | ✅            | SQLite WAL      | Worker coordination via WAL mode |
| **SoloDev MonoRepo Swarm**        | One developer with 10+ AI agents (heavy automation) | 1         | Mono      | 1           | 10+           | ✅ WAL      | ✅           | ✅            | ✅            | ✅            | SQLite WAL      | Worker coordination via WAL mode |
| **SoloDev MultiRepo Swarm**       | One developer with 10+ agents, multi-repo           | 1         | Multi     | 1           | 10+           | ✅ WAL      | ❌           | ✅            | ✅            | ✅            | SQLite WAL      | Worker coordination via WAL mode |
| **SoloDev MonoRepo Distributed**  | One developer using laptop + cloud VMs              | 1         | Mono      | 2+          | Any           | ❌          | ✅           | ✅            | ✅            | ✅            | Separate Repo   | Cross-node coordination required |
| **SoloDev MultiRepo Distributed** | One developer, multi-repo, distributed hosts        | 1         | Multi     | 2+          | Any           | ❌          | ❌           | ✅            | ✅            | ✅            | Separate Repo   | Cross-node coordination required |
| **Team Mono Wrkrs**               | 2-5 developers collaborating                        | 2-5       | Mono      | 2-5         | 1-5           | ❌          | ✅           | ✅            | ✅            | ✅            | Separate Repo   | Multi-node coordination          |
| **Team Multi Wrkrs**              | 2-5 developers, multi-repo                          | 2-5       | Multi     | 2-5         | 1-5           | ❌          | ❌           | ✅            | ✅            | ✅            | Separate Repo   | Multi-node coordination          |
| **Team Any Scale**                | Team with significant compute resources             | 2-5       | Any       | 5-10        | Any           | ❌          | ⚠️          | ✅            | ✅            | ✅            | Separate Repo   | Distributed coordination         |
| **Enterprise Mono Wrkrs**         | 6+ developers, multiple teams                       | 6+        | Mono      | 6+          | 1-5           | ❌          | ⚠️          | ✅            | ✅            | ✅            | PMO Tool        | Conflict management needed       |
| **Enterprise Multi Wrkrs**        | 6+ developers, multi-repo, multiple teams           | 6+        | Multi     | 6+          | 1-5           | ❌          | ❌           | ✅            | ✅            | ✅            | PMO Tool        | Conflict management needed       |
| **Enterprise Any Scale**          | 6+ developers, enterprise scale                     | 6+        | Any       | 10+         | Any           | ❌          | ❌           | ⚠️           | ✅            | ✅            | Hosted DB       | Real-time collaboration          |

## Legend

- ✅ = Viable and recommended
- ⚠️ = Possible but has issues
- ❌ = Not viable
- WAL = Requires Write-Ahead Logging mode for SQLite
## Migration Paths

### Evolution Path 1: Growing Solo Developer
```
1. Start: SQLite (simple)
   ↓ Project grows complex
2. Migrate: In-Repo PMO (company-as-code)
   ↓ Need multi-node
3. Migrate: Separate Repo PMO (coordination)
   ↓ Team joins
4. Stay: Separate Repo PMO (scales well)
```

### Evolution Path 2: Growing Team
```
1. Start: In-Repo PMO (simple team)
   ↓ Multi-node needs
2. Migrate: Separate Repo PMO (coordination)
   ↓ Real-time needs
3. Migrate: Hosted DB (enterprise)
```

## Migration Triggers

| From          | To            | Trigger                             |
| ------------- | ------------- | ----------------------------------- |
| SQLite        | Separate Repo | Adding second host node             |
| SQLite        | SQLite WAL    | Adding 2+ workers                   |
| In-Repo Main  | Separate Repo | Team growth or PR conflicts         |
| Separate Repo | PMO Tool      | Team already paying for Jira/Linear |
| Separate Repo | Hosted DB     | 10+ engineers or real-time needs    |
| Any           | PMO Tool      | Organization mandates standard tool |

## Storage Implementation Details

All CLI commands remain the same regardless of storage backend. The storage layer handles the differences:

```bash
# Commands are identical across all architectures
prlt project create my-project
prlt ticket create "Fix bug"
prlt board view
prlt board sync
prlt board watch
```

**What changes under the hood:**

### SQLite (Local)
- Writes to local `.proletariat/pmo.db`
- `prlt board sync` exports to/imports from `board.md`
- No network calls

### In-Repo PMO
- Writes to local SQLite + exports to `pmo/board.md` in current repo
- User commits/pushes separately via git
- Syncs via git pull/push

### Separate Repo PMO
- Writes to local SQLite + exports to separate PMO repo
- User commits/pushes to PMO repo separately
- Syncs via git pull/push

### Hosted DB (Future)
- API calls to remote database
- Real-time sync
- No local SQLite file

## Detailed Scenarios

### Scenario 1: Solo Developer, Simple Project
```bash
# Use Case: SoloDev MonoRepo SoloWrk
# 1 engineer, 1 host node, 1 worker
my-blog-hq/
├── .proletariat/pmo.db      # SQLite PMO
└── blog-repo/               # Single repository

# Commands:
prlt project create my-blog
prlt ticket create "Write new post"
```

### Scenario 2: Solo Developer with AI Team
```bash
# Use Case: SoloDev MonoRepo MultiWrkr
# 1 engineer, 1 host node (laptop), 2-5 workers
my-project-hq/
├── .proletariat/pmo.db      # SQLite with WAL for concurrency
└── project-repo/

# Multiple agents working concurrently
prlt ticket create "Build API" --assign agent-1
prlt ticket create "Write tests" --assign agent-2
```

### Scenario 3: Solo Developer, Multi-Host Setup
```bash
# Use Case: SoloDev MonoRepo Distributed
# 1 engineer, 2+ host nodes, multiple workers

# Laptop
laptop:my-project/pmo/board.md       # Git-synced board

# AWS VM
aws-vm:my-project/pmo/board.md       # Syncs via git

# Coordination via git
laptop$ prlt ticket create "Train model" --assign gpu-agent
laptop$ git commit -m "Add ticket" && git push
aws-vm$ git pull && prlt board view
```

### Scenario 4: Solo Developer, Microservices
```bash
# Use Case: SoloDev MultiRepo MultiWrkr
# 1 engineer, multi-repo, 1 host, 2-5 workers
my-platform-hq/
├── .proletariat/pmo.db      # Central coordination
├── api-service/             # Repo 1
├── ui-service/              # Repo 2
└── shared-lib/              # Repo 3

# Tickets span multiple repos
prlt ticket create "Update API endpoint" --project api
prlt ticket create "Update UI component" --project ui
```

### Scenario 5: Team, Monorepo, Distributed
```bash
# Use Case: Team Mono Wrkrs
# 2-5 engineers, monorepo, distributed hosts
team-project/
├── src/                     # Shared codebase
└── pmo/
    └── board.md             # Git-synced PMO

# Each team member's machine
alice$ prlt ticket create "Add feature"
bob$ git pull && prlt ticket claim TICK-001
```

### Scenario 6: Enterprise, Multi-Everything
```bash
# Use Case: Enterprise Any Scale
# 6+ engineers, multi-repo, distributed, hosted DB

# External coordination
api.pmo-server.com/
├── projects/platform
├── tickets/
└── boards/

# Distributed teams
us-east$ prlt ticket create "Feature A"   # → API call
europe$ prlt ticket claim TICK-001        # → API call
asia$ prlt board watch                    # → WebSocket updates
```
