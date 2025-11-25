# Proletariat Architecture Matrix

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

| Engineers | Repos | Host Nodes | Workers/Host | PMO Storage Options           | Best Choice       | Use Case                             |
| --------- | ----- | ---------- | ------------ | ----------------------------- | ----------------- | ------------------------------------ |
| **1**     | Mono  | **1**      | **1**        | SQLite, In-Repo Main          | SQLite            | Solo dev, single worker, monorepo    |
| **1**     | Multi | **1**      | **1**        | SQLite, Separate Repo         | SQLite            | Solo dev, single worker, multi-repo  |
| **1**     | Mono  | **1**      | **2-5**      | SQLite, In-Repo Main          | SQLite with locks | Solo dev, multiple workers on laptop |
| **1**     | Multi | **1**      | **2-5**      | SQLite, Separate Repo         | SQLite with locks | Solo dev, workers on multi-repo      |
| **1**     | Mono  | **1**      | **10+**      | SQLite, In-Repo Main          | In-Repo Main      | Solo dev, worker swarm on laptop     |
| **1**     | Multi | **1**      | **10+**      | Separate Repo                 | Separate Repo     | Solo dev, worker swarm, multi-repo   |
| **1**     | Mono  | **2+**     | **Any**      | In-Repo Branch, Separate Repo | In-Repo Branch    | Solo + VMs, monorepo                 |
| **1**     | Multi | **2+**     | **Any**      | Separate Repo                 | Separate Repo     | Solo + VMs, multi-repo               |
| **2-5**   | Mono  | **2-5**    | **1-5**      | In-Repo Branch, Separate Repo | In-Repo Branch    | Team, monorepo                       |
| **2-5**   | Multi | **2-5**    | **1-5**      | Separate Repo                 | Separate Repo     | Team, multi-repo                     |
| **2-5**   | Any   | **5-10**   | **Any**      | Separate Repo                 | Separate Repo     | Team + compute scaling               |
| **6+**    | Mono  | **6+**     | **1-5**      | Separate Repo, Hosted DB      | Separate Repo     | Enterprise monorepo                  |
| **6+**    | Any   | **10+**    | **Any**      | Hosted DB                     | Hosted DB         | Enterprise scale                     |

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

### Scenario 3: Solo Developer, Multi-Node Scaling
```bash
# Single person, single repo, multi-node
laptop:my-project/pmo/board.md      # Primary node
aws-vm:my-project/pmo/board.md      # Scaled node (git sync)

# Coordination via git
laptop$ prlt ticket assign T0001 gpu-agent --node=aws-vm
aws-vm$ git pull && prlt agent status gpu-agent
```

### Scenario 4: Solo Developer, Microservices
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

### Scenario 5: Team, Monorepo, Distributed
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

### Scenario 6: Enterprise, Multi-Everything
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

## Command Variations by Architecture

### SQLite (Local) - Single Host Node Only
```bash
prlt ticket create "Fix bug"        # → Local SQLite
prlt agents status                  # → Local SQLite
prlt pmo board                      # → Generate from SQLite
# No sync needed - single node
```

### In-Repo Main Branch PMO - Monorepo Only
```bash
git checkout main && git pull
prlt ticket create "Fix bug"        # → main:pmo/board.md
git commit -m "Add ticket" && git push
# Updates go through PR workflow
```

### In-Repo Branch PMO - Monorepo + Multi-Node
```bash
git checkout pmo && git pull
prlt ticket create "Fix bug"        # → pmo:pmo/board.md  
git commit -m "Add ticket" && git push origin pmo
# Direct updates to PMO branch, no PR needed
```

### Separate Repo PMO - Works for All
```bash
cd ../project-pmo && git pull
prlt ticket create "Fix bug"        # → project-pmo/board.md
git commit -m "Add ticket" && git push
# Independent PMO repo
```

### Hosted DB PMO - Enterprise Scale
```bash
prlt ticket create "Fix bug"        # → API call to central server
prlt agents status                  # → API call for real-time data
prlt pmo watch                      # → WebSocket for live updates
```

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

## Multi-Team/Motion Coordination Matrix

### When Multiple Teams or Motions Emerge

| Teams/Motions | PMO Structure | Ticket Naming | Board Organization | Rollup Strategy | Example |
|---------------|---------------|---------------|-------------------|-----------------|---------|
| **1 Team, 1 Motion** | Single PMO | Simple (T001) | One board | Not needed | Startup building MVP |
| **1 Team, Multi-Motion** | Single PMO + Labels | Motion prefix (Q4-001, DEBT-002) | Filtered views | By motion label | Team juggling feature work + tech debt |
| **Multi-Team, 1 Motion** | Namespaced PMO | Team prefix (FE-001, BE-002) | Team boards | Program board | Frontend/Backend teams on same project |
| **Multi-Team, Multi-Motion** | Hierarchical PMO | Team+Motion (FE-Q4-001) | Team × Motion matrix | Executive dashboard | Enterprise with multiple initiatives |

### Coordination Patterns

| Pattern | Storage Approach | Sync Method | Best For |
|---------|-----------------|-------------|----------|
| **Shared Board** | Single PMO location | All teams edit same board | Small, high-trust teams |
| **Federated Boards** | Separate team PMOs | Rollup script/tool | Independent teams |
| **Hierarchical** | Team PMOs + Program PMO | Automated aggregation | Large orgs with PMO team |
| **Tagged/Labeled** | Single PMO with metadata | Filter/query views | Flexible team boundaries |

### Cross-Team Dependency Tracking

| Dependency Type | Implementation | PMO Storage Impact |
|-----------------|----------------|-------------------|
| **Blocks** | Link tickets with BLOCKS-T123 | Same PMO or cross-PMO refs |
| **Depends On** | Parent-child relationships | Needs relational storage |
| **Shared Work** | Multi-assignee tickets | Requires team field |
| **Handoffs** | Status transitions between teams | Team-specific status columns |

### Questions for Multi-Team Design

1. **Autonomy vs Coordination**: How much independence should teams have?
2. **Rollup Frequency**: Real-time, daily, weekly executive views?
3. **Ticket Ownership**: Can tickets move between teams?
4. **Cross-Team Planning**: How to handle dependencies in planning?
5. **Permissions**: Should teams see/edit other teams' tickets?

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