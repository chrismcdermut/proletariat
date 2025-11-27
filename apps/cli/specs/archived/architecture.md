# Proletariat Architecture Specification

## Overview
This document defines the architectural patterns and decision matrix for Proletariat deployments across different scales and organizational structures.

## Dimensions

| Dimension | Options | Description |
|-----------|---------|-------------|
| **Engineers** | 1 Person, 2-5 People (Small Team), 6+ People (Large Team) | Humans managing/orchestrating the system |
| **Repository Structure** | Mono (Monorepo), Multi | Code organization approach |
| **Host Nodes** | 1, 2-5, 10+ | Physical or virtual machines (laptop, VM, container) |
| **Workers per Host** | 1, 2-5, 10+ | AI workers, human workers, or bots per host node |
| **PMO Storage** | SQLite (local), In-Repo Main, In-Repo Branch, Separate Repo, Hosted DB | Where project management data lives |

## Complete Use Case Matrix

### The Key Insight: Both Host Nodes AND Workers per Host Drive Architecture

| Engineers | Repos | Host Nodes | Workers/Host | PMO Storage | Viable? | Notes |
| --------- | ----- | ---------- | ------------ | ----------- | ------- | ----- |
| **1** | Mono | **1** | **1** | SQLite | ✅ Yes | Simple, no sync needed |
| **1** | Mono | **1** | **1** | In-Repo Main | ✅ Yes | Company-as-code |
| **1** | Mono | **1** | **1** | In-Repo Branch | ✅ Yes | Overkill for single dev |
| **1** | Mono | **1** | **1** | Separate Repo | ✅ Yes | Extra complexity |
| **1** | Mono | **1** | **1** | Hosted DB | ✅ Yes | Unnecessary cost |
| **1** | Multi | **1** | **1** | SQLite | ✅ Yes | Local coordination |
| **1** | Multi | **1** | **1** | In-Repo Main | ❌ No | No single repo for PMO |
| **1** | Multi | **1** | **1** | In-Repo Branch | ❌ No | No single repo for PMO |
| **1** | Multi | **1** | **1** | Separate Repo | ✅ Yes | Clean separation |
| **1** | Multi | **1** | **1** | Hosted DB | ✅ Yes | Unnecessary cost |
| **1** | Mono | **1** | **2-5** | SQLite | ✅ Yes | Use WAL mode for concurrency |
| **1** | Mono | **1** | **2-5** | In-Repo Main | ✅ Yes | Workers can coordinate via git |
| **1** | Mono | **1** | **2-5** | In-Repo Branch | ✅ Yes | Overkill for single dev |
| **1** | Mono | **1** | **2-5** | Separate Repo | ✅ Yes | Extra complexity |
| **1** | Mono | **1** | **2-5** | Hosted DB | ✅ Yes | Unnecessary cost |
| **1** | Multi | **1** | **2-5** | SQLite | ✅ Yes | Use WAL mode |
| **1** | Multi | **1** | **2-5** | In-Repo Main | ❌ No | No single repo |
| **1** | Multi | **1** | **2-5** | In-Repo Branch | ❌ No | No single repo |
| **1** | Multi | **1** | **2-5** | Separate Repo | ✅ Yes | Clean separation |
| **1** | Multi | **1** | **2-5** | Hosted DB | ✅ Yes | Unnecessary cost |
| **1** | Mono | **1** | **10+** | SQLite | ✅ Yes | Works with start/end access pattern |
| **1** | Mono | **1** | **10+** | In-Repo Main | ✅ Yes | Better for many workers |
| **1** | Mono | **1** | **10+** | In-Repo Branch | ✅ Yes | Could work |
| **1** | Mono | **1** | **10+** | Separate Repo | ✅ Yes | Clean separation |
| **1** | Mono | **1** | **10+** | Hosted DB | ✅ Yes | If you have the infrastructure |
| **1** | Multi | **1** | **10+** | SQLite | ✅ Yes | Works with start/end access pattern |
| **1** | Multi | **1** | **10+** | In-Repo Main | ❌ No | No single repo |
| **1** | Multi | **1** | **10+** | In-Repo Branch | ❌ No | No single repo |
| **1** | Multi | **1** | **10+** | Separate Repo | ✅ Yes | Only good option |
| **1** | Multi | **1** | **10+** | Hosted DB | ✅ Yes | If you have infrastructure |
| **1** | Mono | **2+** | **Any** | SQLite | ❌ No | Can't sync across nodes |
| **1** | Mono | **2+** | **Any** | In-Repo Main | ✅ Yes | Git syncs across nodes |
| **1** | Mono | **2+** | **Any** | In-Repo Branch | ✅ Yes | Avoids PR blocks |
| **1** | Mono | **2+** | **Any** | Separate Repo | ✅ Yes | Works well |
| **1** | Mono | **2+** | **Any** | Hosted DB | ✅ Yes | If you have infrastructure |
| **1** | Multi | **2+** | **Any** | SQLite | ❌ No | Can't sync across nodes |
| **1** | Multi | **2+** | **Any** | In-Repo Main | ❌ No | No single repo |
| **1** | Multi | **2+** | **Any** | In-Repo Branch | ❌ No | No single repo |
| **1** | Multi | **2+** | **Any** | Separate Repo | ✅ Yes | Only viable git option |
| **1** | Multi | **2+** | **Any** | Hosted DB | ✅ Yes | If you have infrastructure |
| **2-5** | Mono | **2-5** | **1-5** | SQLite | ❌ No | Multi-node needs sync |
| **2-5** | Mono | **2-5** | **1-5** | In-Repo Main | ✅ Yes | Team can coordinate |
| **2-5** | Mono | **2-5** | **1-5** | In-Repo Branch | ✅ Yes | Avoids PR conflicts |
| **2-5** | Mono | **2-5** | **1-5** | Separate Repo | ✅ Yes | Clean separation |
| **2-5** | Mono | **2-5** | **1-5** | Hosted DB | ✅ Yes | If you want real-time |
| **2-5** | Multi | **2-5** | **1-5** | SQLite | ❌ No | Multi-node needs sync |
| **2-5** | Multi | **2-5** | **1-5** | In-Repo Main | ❌ No | No single repo |
| **2-5** | Multi | **2-5** | **1-5** | In-Repo Branch | ❌ No | No single repo |
| **2-5** | Multi | **2-5** | **1-5** | Separate Repo | ✅ Yes | Only viable git option |
| **2-5** | Multi | **2-5** | **1-5** | Hosted DB | ✅ Yes | If you want real-time |
| **2-5** | Any | **5-10** | **Any** | SQLite | ❌ No | Can't sync |
| **2-5** | Any | **5-10** | **Any** | In-Repo Main | ⚠️ Maybe | PR conflicts likely |
| **2-5** | Any | **5-10** | **Any** | In-Repo Branch | ⚠️ Maybe | Could work |
| **2-5** | Any | **5-10** | **Any** | Separate Repo | ✅ Yes | Scales well |
| **2-5** | Any | **5-10** | **Any** | Hosted DB | ✅ Yes | Good for scale |
| **6+** | Mono | **6+** | **1-5** | SQLite | ❌ No | Can't sync |
| **6+** | Mono | **6+** | **1-5** | In-Repo Main | ⚠️ Maybe | Too many conflicts |
| **6+** | Mono | **6+** | **1-5** | In-Repo Branch | ⚠️ Maybe | Could work with discipline |
| **6+** | Mono | **6+** | **1-5** | Separate Repo | ✅ Yes | Clean separation |
| **6+** | Mono | **6+** | **1-5** | Hosted DB | ✅ Yes | Enterprise ready |
| **6+** | Any | **10+** | **Any** | SQLite | ❌ No | Can't sync |
| **6+** | Any | **10+** | **Any** | In-Repo Main | ❌ No | Won't scale |
| **6+** | Any | **10+** | **Any** | In-Repo Branch | ❌ No | Won't scale |
| **6+** | Any | **10+** | **Any** | Separate Repo | ⚠️ Maybe | Git might struggle |
| **6+** | Any | **10+** | **Any** | Hosted DB | ✅ Yes | Built for this scale |

### PMO Storage Constraints

| Constraint | Rule | Reason |
|------------|------|--------|
| **Multi-Repo** | ❌ No In-Repo (Main or Branch) | No single repo to put PMO in |
| **Multi Host Node** | ❌ No SQLite | Local files can't sync across host nodes |
| **Multi-Worker on Single Host** | ⚠️ SQLite needs locks | Concurrent worker access to same DB |
| **10+ Workers on Single Host** | ⚠️ Consider In-Repo or Separate | SQLite contention issues |
| **Multi Host + Monorepo** | ✅ In-Repo Branch works | Git sync via dedicated branch |
| **Single Host + Single Worker** | ✅ All options work | No coordination needed |

### Critical Patterns

| Pattern | Valid PMO Options | Best Choice | Why |
|---------|------------------|-------------|-----|
| **1 Engineer, 1 Host, 1 Worker, Monorepo** | All options | SQLite or In-Repo Main | Simple, local |
| **1 Engineer, 1 Host, 1 Worker, Multi-Repo** | SQLite, Separate Repo | SQLite | Local coordination |
| **1 Engineer, 1 Host, Multiple Workers** | SQLite (with locks), In-Repo, Separate | SQLite with WAL | Workers need coordination |
| **1 Engineer, Multi-Host, Monorepo** | In-Repo Main/Branch, Separate Repo | In-Repo Branch | Avoids PR blocks |
| **1 Engineer, Multi-Host, Multi-Repo** | Separate Repo only | Separate Repo | Only option |
| **Team (2+), Any Hosts, Monorepo** | In-Repo Branch, Separate Repo, Hosted DB | Separate Repo | Clean separation |
| **Team (2+), Any Hosts, Multi-Repo** | Separate Repo, Hosted DB | Separate Repo | Only git option |

## Detailed Scenarios

### Scenario 1: Solo Developer, Simple Project
```bash
# 1 engineer, 1 host node, 1 worker
my-blog-hq/
├── .proletariat/workspace.db    # SQLite PMO
├── workers/
│   └── writer/                  # Single AI worker
└── blog-repo/                   # Single repository

# Commands:
prlt init my-blog-hq
prlt worker add writer --type=ai
prlt ticket create "Write new post"
```

### Scenario 2: Solo Developer with AI Team
```bash
# 1 engineer, 1 host node (laptop), 5 workers
my-project-hq/
├── .proletariat/workspace.db    # SQLite with WAL for concurrency
├── workers/
│   ├── alice-human/             # Human worker (you)
│   ├── frontend-ai/             # AI worker for UI
│   ├── backend-ai/              # AI worker for API
│   ├── tester-ai/               # AI worker for tests
│   └── reviewer-ai/             # AI worker for reviews
└── project-repo/

# Coordination needed even on single host!
```

### Scenario 3: Solo Developer, Multi-Host Setup
```bash
# 1 engineer, 3 host nodes, multiple workers
laptop-host:my-project-hq/workers/
├── alice-human/                # You working locally
└── copilot-ai/                 # AI assistant

aws-vm-1-host:my-project-hq/workers/
├── backend-ai/                 # AI worker for heavy processing
└── tester-ai/                  # AI worker running tests

home-server-host:my-project-hq/workers/
└── monitor-bot/                # Bot monitoring deployments

# Needs external PMO coordination (Separate Repo or In-Repo Branch)
```

### Scenario 4: Solo Developer, Multi-Node Scaling
```bash
# Single person, single repo, multi-node
laptop:my-project/pmo/board.md      # Primary node
aws-vm:my-project/pmo/board.md      # Scaled node (git sync)

# Coordination via git
laptop$ prlt ticket assign T0001 gpu-agent --node=aws-vm
aws-vm$ git pull && prlt agent status gpu-agent
```

### Scenario 5: Solo Developer, Microservices
```bash
# Single person, multi-repo, single node
my-platform-hq/
├── .proletariat/workspace.db    # Central coordination
├── agents/staff/
│   ├── api-dev/                 # Works on API repo
│   └── ui-dev/                  # Works on UI repo
├── api-service/                 # Repo 1
├── ui-service/                  # Repo 2
└── shared-lib/                  # Repo 3
```

### Scenario 6: Team, Monorepo, Distributed
```bash
# Multi-person, single repo, multi-node
team-project/
├── src/                         # Shared codebase
├── pmo/
│   ├── board.md                 # Shared PMO (git)
│   └── tickets/
└── docs/

# Each team member's node
alice-laptop:team-project/agents/alice/
bob-aws-vm:team-project/agents/bob/
charlie-home:team-project/agents/charlie/

# Coordination via git
alice$ prlt ticket create "Add feature"
bob$ git pull && prlt ticket claim T0001
```

### Scenario 7: Enterprise, Multi-Everything
```bash
# Multi-person, multi-repo, multi-node, hosted coordination
org-platform-hq/                    # HQ structure
├── .proletariat/config.json        # Points to external PMO API
├── agents/                         # Local agent workspaces
└── repos/                          # Multiple repositories

# External coordination
api.pmo-server.com/projects/platform
├── tickets/                        # REST API
├── boards/                        # Real-time updates
└── analytics/                      # Team metrics

# Distributed nodes
us-east-1:org-platform-hq/          # Team in NYC
europe-1:org-platform-hq/           # Team in London  
asia-1:org-platform-hq/             # Team in Tokyo
```

## PMO Storage Decision Matrix

| Engineers | Nodes | Complexity | Recommended PMO | Why |
|-----------|-------|------------|-----------------|-----|
| **1** | 1 | Simple | SQLite | No coordination needed |
| **1** | 1 | Complex | In-Repo | Company-as-code benefits |
| **1** | Multi | Any | Separate Repo | Cross-node coordination required |
| **2-5** | 1 | Simple | In-Repo | Shared git workflow |
| **2-5** | Multi | Any | Separate Repo | Multi-node coordination |
| **6+** | 1 | Any | In-Repo + Locks | Conflict management needed |
| **6+** | Multi | Simple | Separate Repo | Distributed coordination |
| **6+** | Multi | Complex | Hosted DB | Real-time collaboration |

## Migration Paths

### Evolution Path 1: Growing Solo Developer
```bash
1. Start: SQLite (simple)
   ↓ Project grows complex
2. Migrate: In-Repo PMO (company-as-code)
   ↓ Need multi-node
3. Migrate: Separate Repo PMO (coordination)
   ↓ Team joins
4. Stay: Separate Repo PMO (scales well)
```

### Evolution Path 2: Growing Team
```bash
1. Start: In-Repo PMO (simple team)
   ↓ Multi-node needs
2. Migrate: Separate Repo PMO (coordination)
   ↓ Real-time needs
3. Migrate: Hosted DB (enterprise)
```

## Architecture Recommendations

### Start Here (90% of cases):
- **Solo, simple**: SQLite
- **Solo, complex**: In-Repo PMO  
- **Team, any**: Separate Repo PMO

### Special Cases:
- **Company-as-code philosophy**: In-Repo PMO
- **Enterprise/real-time needs**: Hosted DB PMO
- **Extreme scaling**: Hosted DB + API

## Key Insights

1. **Host node count drives PMO architecture more than team size**
   - Single host = can use local storage (SQLite/In-Repo)
   - Multi-host = MUST use external coordination (Separate Repo/Hosted)

2. **Worker count on single host also matters**
   - 1 worker = simple SQLite
   - 2-5 workers = SQLite with locks (WAL mode)
   - 10+ workers = Consider In-Repo or Separate for better concurrency

3. **1 Engineer + Multi-Host is a valid and common pattern**
   - Solo developer with laptop + cloud VMs
   - Needs same coordination as a distributed team
   
4. **Team size affects permissions/access patterns, not architecture**
   - 1 person = simple access control
   - 2-5 people = git-based permissions usually sufficient
   - 6+ people = may need more sophisticated access control

5. **Workers can be AI, human, or bots**
   - All need coordination when working concurrently
   - Type doesn't matter for architecture decisions

6. **In-repo PMO works best for monorepos with company-as-code philosophy**

7. **Separate repo PMO is the most flexible option for multi-host setups**

8. **SQLite is perfect for single-host development (with proper locking for multiple workers)**

9. **Hosted DB only needed for 6+ engineers with complex real-time needs**