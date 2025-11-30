# Org PMO Specification

## Purpose
Multi-team Project Management Office functionality for enterprise organizations with multiple teams, motions, and complex coordination needs. Designed for 7+ engineers across multiple teams or initiatives.

## Scope
- **Organization Size**: 7+ engineers (typically 2+ teams)
- **Team Structure**: Multiple teams with separate backlogs
- **Motions**: Multiple concurrent initiatives/projects
- **Ticket Namespace**: Team-prefixed (FE-001, BE-002, INFRA-003)
- **Board Structure**: Team boards + rollup views
- **Storage Options**: Separate Repo or Hosted Database

## Core Concepts
- **Hierarchical Organization**: Teams → Programs → Portfolio
- **Cross-Team Dependencies**: Blocking, handoffs, shared work
- **Rollup Dashboards**: Executive visibility across teams
- **Team Autonomy**: Each team manages their own backlog
- **Namespace Isolation**: Prevent ticket ID collisions

## Architecture Patterns for Org PMO

### Decision Matrix (Org PMO Subset)

Focus on 6+ engineers (multiple teams), showing each PMO storage option as a separate row.

| Engineers | Repos | Host Nodes | Workers/Host | PMO Storage | Viable? | Notes |
| --------- | ----- | ---------- | ------------ | ----------- | ------- | ----- |
| **6+** | Mono | **6+** | **1-5** | In-Repo Main | ⚠️ Maybe | Too many conflicts |
| **6+** | Mono | **6+** | **1-5** | In-Repo Branch | ⚠️ Maybe | Could work with discipline |
| **6+** | Mono | **6+** | **1-5** | Separate Repo | ✅ Yes | Clean separation |
| **6+** | Mono | **6+** | **1-5** | Hosted DB | ✅ Yes | Enterprise ready |
| **6+** | Multi | **6+** | **1-5** | Separate Repo | ✅ Yes | Only git option |
| **6+** | Multi | **6+** | **1-5** | Hosted DB | ✅ Yes | Enterprise ready |
| **6+** | Any | **10+** | **Any** | Separate Repo | ⚠️ Maybe | Git might struggle at scale |
| **6+** | Any | **10+** | **Any** | Hosted DB | ✅ Yes | Built for this scale |

### Multi-Team Storage Requirements
- **Namespace Isolation**: Prevent ticket ID collisions
- **Team Autonomy**: Each team manages own backlog
- **Cross-Team Visibility**: Read access across teams
- **Rollup Capability**: Aggregate views for executives
- **Dependency Tracking**: Cross-team relationships

## Multi-Team/Motion Coordination

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

---

## Command Overview (Future)

### Team Commands

| Command | Purpose | Status |
|---------|---------|--------|
| `prlt team list` | List all teams in org | 🔮 Future |
| `prlt team create <name>` | Create new team namespace | 🔮 Future |
| `prlt team board <team>` | View team's board | 🔮 Future |
| `prlt team capacity <team>` | Show team capacity/velocity | 🔮 Future |
| `prlt team members <team>` | List team members | 🔮 Future |

### Program Commands  

| Command | Purpose | Status |
|---------|---------|--------|
| `prlt program dashboard` | Executive rollup view | 🔮 Future |
| `prlt program dependencies` | Cross-team dependency graph | 🔮 Future |
| `prlt program timeline` | Gantt/timeline view | 🔮 Future |
| `prlt program risks` | Risk registry across teams | 🔮 Future |

### Dependency Commands

| Command | Purpose | Status |
|---------|---------|--------|
| `prlt dependency add <from> <to>` | Create dependency link | 🔮 Future |
| `prlt dependency list [ticket]` | Show dependencies | 🔮 Future |
| `prlt dependency graph` | Visualize dependency tree | 🔮 Future |
| `prlt dependency blocked` | List blocked tickets | 🔮 Future |

---

## Storage Architecture

### Federated Repos Pattern
Each team has their own PMO repo with automated rollup.

```
org-pmo-frontend/           # Frontend team PMO
├── board.md
├── config.json
└── specs/

org-pmo-backend/            # Backend team PMO
├── board.md  
├── config.json
└── specs/

org-pmo-rollup/             # Automated aggregation
├── dashboard.md            # Executive view
├── dependencies.json       # Cross-team deps
└── teams/
    ├── frontend.md         # Pulled from frontend PMO
    └── backend.md          # Pulled from backend PMO
```

### Hosted Database Pattern
Centralized database with API access for all teams.

```
┌─────────────────────┐
│   PostgreSQL/MySQL  │
├─────────────────────┤
│ Tables:             │
│ - teams             │
│ - tickets           │
│ - dependencies      │
│ - team_members      │
│ - sprint_planning   │
└─────────────────────┘
         ↑
         │ API
         ↓
┌─────────────────────┐
│   PMO API Server    │
├─────────────────────┤
│ /api/teams          │
│ /api/tickets        │
│ /api/dashboard      │
│ /api/dependencies   │
└─────────────────────┘
         ↑
         │ HTTPS
         ↓
┌──────────┬──────────┐
│ Team A   │ Team B   │
│ prlt CLI │ prlt CLI │
└──────────┴──────────┘
```

---

## Ticket Namespacing

### Team-Based Prefixes
```
Frontend:  FE-001, FE-002, FE-003
Backend:   BE-001, BE-002, BE-003  
Infra:     INFRA-001, INFRA-002
Mobile:    MOB-001, MOB-002
QA:        QA-001, QA-002
```

### Motion-Based Prefixes
```
Q4 Launch:    Q4-FE-001, Q4-BE-001
Tech Debt:    DEBT-FE-001, DEBT-BE-001
Customer X:   CUSTX-001, CUSTX-002
```

### Hierarchical Prefixes
```
Program/Team/Number:  PLATFORM-FE-001
Division/Program/Team: ENG-PLATFORM-FE-001
```

---

## Cross-Team Dependencies

### Dependency Types

| Type | Description | Implementation |
|------|-------------|----------------|
| **Blocks** | Ticket A must complete before B starts | `blocks: [BE-042]` |
| **Depends On** | Ticket A needs output from B | `depends_on: [FE-101]` |
| **Parent/Child** | Epic broken into team tasks | `parent: PLATFORM-001` |
| **Handoff** | Work passes between teams | `handoff_to: QA-201` |

### Dependency Tracking
```json
{
  "ticket": "FE-042",
  "title": "Implement login UI",
  "dependencies": {
    "blocks": [],
    "blocked_by": ["BE-018"],
    "parent": "PLATFORM-001",
    "children": [],
    "handoff_from": null,
    "handoff_to": "QA-051"
  }
}
```

### Dependency Visualization
```
PLATFORM-001 (Epic)
├── FE-042: Login UI
│   ├── blocked_by: BE-018
│   └── handoff_to: QA-051
├── BE-018: Auth API
│   └── blocks: FE-042
└── QA-051: Login Testing
    └── handoff_from: FE-042
```

---

## Rollup Views

### Executive Dashboard
```markdown
# Organization PMO Dashboard
*Updated: 2024-01-15 14:00 UTC*

## 📊 Overall Progress
- Total Tickets: 142
- Completed This Sprint: 28 (20%)
- In Progress: 45 (32%)
- Blocked: 8 (6%)

## 👥 Team Status

### Frontend Team
- Sprint Progress: 18/25 points (72%)
- Blocked: 2 tickets
- At Risk: Login UI (FE-042) blocked by backend

### Backend Team  
- Sprint Progress: 22/30 points (73%)
- Blocked: 0 tickets
- On Track: Auth API (BE-018) in review

### Infrastructure Team
- Sprint Progress: 8/15 points (53%)
- Blocked: 1 ticket
- Behind Schedule: Database migration delayed

## 🚨 Risks & Blockers
1. **FE-042 blocked by BE-018** - Auth API needed for login UI
2. **INFRA-005 resource constraints** - Need additional AWS capacity
3. **Cross-team dependency chain** - 5 tickets in critical path

## 📈 Velocity Trends
- Frontend: ▲ 25 pts/sprint (+3)
- Backend: ▼ 30 pts/sprint (-2)
- Infra: ═ 15 pts/sprint (0)
```

### Program Board
```markdown
# Q4 Platform Initiative

## Week 1-2
| Frontend | Backend | Infra | QA |
|----------|---------|-------|-----|
| FE-040: Design | BE-015: API Planning | INFRA-001: Setup | QA-001: Test Plan |
| FE-041: Prototype | BE-016: Database | INFRA-002: CI/CD | QA-002: Automation |

## Week 3-4  
| Frontend | Backend | Infra | QA |
|----------|---------|-------|-----|
| FE-042: Login UI ⚠️ | BE-018: Auth API | INFRA-003: Deploy | QA-050: Integration |
| FE-043: Dashboard | BE-019: Data API | INFRA-004: Monitor | QA-051: Login Tests |

## Dependencies
- FE-042 → BE-018 (blocked)
- FE-043 → BE-019 (depends on)
- QA-051 → FE-042 (handoff)
```

---

## Team Capacity Planning

### Capacity Model
```json
{
  "team": "frontend",
  "sprint": 14,
  "capacity": {
    "total_points": 30,
    "committed_points": 25,
    "buffer_points": 5,
    "members": [
      {"name": "alice", "points": 10, "focus": "FE-042"},
      {"name": "bob", "points": 8, "focus": "FE-043"},
      {"name": "charlie", "points": 7, "focus": "FE-044"}
    ]
  },
  "velocity": {
    "average": 27,
    "last_3_sprints": [25, 28, 28]
  }
}
```

### Load Balancing
```bash
prlt team capacity frontend
┌─────────┬────────┬──────────┬─────────┐
│ Member  │ Capacity│ Assigned │ Available│
├─────────┼────────┼──────────┼─────────┤
│ Alice   │ 10 pts │ 8 pts    │ 2 pts   │
│ Bob     │ 8 pts  │ 8 pts    │ 0 pts   │
│ Charlie │ 7 pts  │ 5 pts    │ 2 pts   │
└─────────┴────────┴──────────┴─────────┘
⚠️ Bob at capacity, consider reassignment
```

---

## Configuration

### Organization Config
```json
{
  "version": "1.0.0",
  "organization": "acme-corp",
  "teams": [
    {
      "id": "frontend",
      "name": "Frontend Team",
      "prefix": "FE",
      "pmo_repo": "git@github.com:acme/pmo-frontend.git",
      "members": ["alice", "bob", "charlie"]
    },
    {
      "id": "backend",
      "name": "Backend Team",
      "prefix": "BE",
      "pmo_repo": "git@github.com:acme/pmo-backend.git",
      "members": ["david", "eve", "frank"]
    }
  ],
  "programs": [
    {
      "id": "platform",
      "name": "Platform Initiative",
      "teams": ["frontend", "backend", "infra"],
      "start_date": "2024-01-01",
      "end_date": "2024-03-31"
    }
  ]
}
```

### Team Config
```json
{
  "team": "frontend",
  "prefix": "FE",
  "lastTicketNumber": 142,
  "sprint": {
    "number": 14,
    "start": "2024-01-15",
    "end": "2024-01-29",
    "capacity_points": 30
  },
  "board_columns": [
    "Backlog",
    "Sprint Ready",
    "In Progress",
    "In Review",
    "QA Handoff",
    "Done"
  ],
  "labels": ["P0", "P1", "P2", "tech-debt", "bug", "feature"]
}
```

---

## Permissions & Access Control

### Role-Based Access
```
Admin:
  - Create/delete teams
  - Modify cross-team dependencies
  - Edit any ticket

Team Lead:
  - Edit team config
  - Assign tickets within team
  - Create dependencies

Team Member:
  - Create tickets in team namespace
  - Claim/complete own tickets
  - View other teams' boards (read-only)

Observer:
  - View all boards
  - View dashboards
  - No edit permissions
```

### Audit Trail
```json
{
  "action": "ticket.update",
  "ticket": "FE-042",
  "user": "alice",
  "timestamp": "2024-01-15T14:30:00Z",
  "changes": {
    "status": {"from": "in_progress", "to": "in_review"},
    "assignee": {"from": "alice", "to": "bob"}
  },
  "team": "frontend",
  "ip": "10.0.1.42"
}
```

---

## Integration Points

### CI/CD Integration
```yaml
# .github/workflows/pmo-sync.yml
on:
  pull_request:
    types: [opened, closed]

jobs:
  update-pmo:
    steps:
      - name: Link PR to tickets
        run: |
          prlt ticket link-pr ${{ github.event.number }}
      
      - name: Update ticket status
        if: github.event.pull_request.merged
        run: |
          prlt ticket auto-complete
```

### Slack/Discord Notifications
```javascript
// When ticket blocked
{
  "channel": "#platform-blockers",
  "message": "🚨 FE-042 blocked by BE-018\nFrontend team waiting on Auth API",
  "mentions": ["@backend-team"]
}
```

### JIRA/Linear Sync (Optional)
```bash
# Bi-directional sync with existing tools
prlt org sync jira --map=config/jira-mapping.json
prlt org sync linear --project=PLATFORM
```

---

## Migration Path

### From Team PMO to Org PMO

1. **Assess Current State**
   ```bash
   prlt pmo analyze
   Teams detected: 3
   Tickets: 142
   Recommendation: Migrate to Org PMO with team namespaces
   ```

2. **Create Team Namespaces**
   ```bash
   prlt org migrate start
   Creating team: frontend (FE-)
   Creating team: backend (BE-)
   Creating team: infra (INFRA-)
   ```

3. **Migrate Tickets**
   ```bash
   prlt org migrate tickets
   T001 → FE-001 (assigned to alice)
   T002 → BE-001 (assigned to david)
   ...
   ```

4. **Setup Rollup**
   ```bash
   prlt org setup-dashboard
   Dashboard created at: org-pmo-rollup/dashboard.md
   Sync schedule: Every 15 minutes
   ```

---

## Best Practices

### Team Autonomy
- Each team owns their namespace
- Teams manage own sprint planning
- Cross-team items need explicit handoff

### Dependency Management  
- Identify dependencies early in planning
- Use blocking tickets sparingly
- Regular dependency review meetings

### Scaling Considerations
- Start with federated repos, move to hosted DB at 50+ engineers
- Implement caching for dashboard queries
- Consider read replicas for large organizations

### Communication Patterns
- Daily standups per team
- Weekly cross-team sync
- Sprint planning includes dependency review
- Retrospectives capture cross-team issues