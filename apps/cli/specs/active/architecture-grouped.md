# Architecture Matrix - Grouped by Work Setup

## Work Setup Combinations with PMO Viability

| ICP                         | Eng # | Repos | Host Nd | Wrkr/Host | SQLite | In-Repo Main | Out Repo | Cloud DB | PMO Tool | Best Choice   |
| --------------------------- | ----- | ----- | ------- | --------- | ------ | ------------ | -------- | -------- | -------- | ------------- |
| **Solo Mono Solo**          | 1     | Mono  | 1       | 1         | ✅      | ✅            | ✅        | ✅        | ✅        | SQLite        |
| **Solo Multi Solo**         | 1     | Multi | 1       | 1         | ✅      | ❌            | ✅        | ✅        | ✅        | SQLite        |
| **Solo Mono Wrkrs**         | 1     | Mono  | 1       | 2-5       | ✅ WAL  | ✅            | ✅        | ✅        | ✅        | SQLite WAL    |
| **Solo Multi Wrkrs**        | 1     | Multi | 1       | 2-5       | ✅ WAL  | ❌            | ✅        | ✅        | ✅        | SQLite WAL    |
| **Solo Mono Swarm**         | 1     | Mono  | 1       | 10+       | ✅ WAL  | ✅            | ✅        | ✅        | ✅        | SQLite WAL    |
| **Solo Multi Swarm**        | 1     | Multi | 1       | 10+       | ✅ WAL  | ❌            | ✅        | ✅        | ✅        | SQLite WAL    |
| **Solo Mono Distributed**   | 1     | Mono  | 2+      | Any       | ❌      | ✅            | ✅        | ✅        | ✅        | Separate Repo |
| **Solo Multi Distributed**  | 1     | Multi | 2+      | Any       | ❌      | ❌            | ✅        | ✅        | ✅        | Separate Repo |
| **Team Mono Wrkrs**         | 2-5   | Mono  | 2-5     | 1-5       | ❌      | ✅            | ✅        | ✅        | ✅        | Separate Repo |
| **Team Multi Wrkrs**        | 2-5   | Multi | 2-5     | 1-5       | ❌      | ❌            | ✅        | ✅        | ✅        | Separate Repo |
| **Team Any Scale**          | 2-5   | Any   | 5-10    | Any       | ❌      | ⚠️           | ✅        | ✅        | ✅        | Separate Repo |
| **Enterprise Mono Wrkrs**   | 6+    | Mono  | 6+      | 1-5       | ❌      | ⚠️           | ✅        | ✅        | ✅        | PMO Tool      |
| **Enterprise Multi Wrkrs**  | 6+    | Multi | 6+      | 1-5       | ❌      | ❌            | ✅        | ✅        | ✅        | PMO Tool      |
| **Enterprise Any Scale**    | 6+    | Any   | 10+     | Any       | ❌      | ❌            | ⚠️       | ✅        | ✅        | Hosted DB     |

## Legend
- ✅ = Viable and recommended
- ⚠️ = Possible but has issues
- ❌ = Not viable
- WAL = Requires Write-Ahead Logging mode for SQLite

## Key Patterns

### SQLite Viability
- ✅ **Single host node only** - Works great for local development
- ✅ **WAL mode for 2+ workers** - Handles concurrent access
- ✅ **10+ workers** - Fine with typical start/end work patterns
- ❌ **Multi-node** - Can't sync local files across nodes

### In-Repo Main Viability  
- ✅ **Monorepo only** - PMO lives alongside code
- ❌ **Multi-repo** - No single repo to put PMO in
- ⚠️ **Large teams** - PR conflicts become problematic
- ❌ **Enterprise scale** - Too many merge conflicts

### Separate Repo Viability
- ✅ **Always viable** - Works for any setup
- ✅ **Best for teams** - Clean separation of concerns
- ⚠️ **Enterprise scale** - Git might struggle with massive activity

### Hosted DB Viability
- ✅ **Always viable** - Can scale to any size
- 💰 **Cost consideration** - Overkill for solo devs
- ✅ **Best for enterprise** - Built for concurrent access

### PMO Tool Adapter Viability
- ✅ **Always viable** - SaaS handles scaling
- 💰 **Cost per seat** - Can get expensive
- ✅ **Best when already adopted** - Use existing Jira/Linear/Notion

## Work Setup Descriptions

| Setup | Description |
|-------|-------------|
| **Solo Simple** | One developer, one repo, one machine, one worker |
| **Solo Multi-Repo** | One developer managing multiple repositories |
| **Solo + Workers** | One developer with 2-5 AI agents/bots helping |
| **Solo Worker Swarm** | One developer with 10+ AI agents (heavy automation) |
| **Solo Distributed** | One developer using laptop + cloud VMs |
| **Small Team** | 2-5 developers collaborating |
| **Team Scale-Out** | Team with significant compute resources |
| **Enterprise** | 6+ developers, multiple teams |

## Recommendations by Scale

### Solo Developer Path
1. **Start**: SQLite (simple, local)
2. **Add workers**: SQLite with WAL mode
3. **Add VMs**: Migrate to Separate Repo
4. **Heavy automation**: Consider PMO Tool

### Team Path
1. **Start**: Separate Repo (git-based coordination)
2. **Scale compute**: Stay with Separate Repo
3. **Add teams**: Consider PMO Tool adapter
4. **Enterprise**: Hosted DB or PMO Tool

### Key Insights

1. **SQLite** dominates solo development until you go multi-node
2. **Separate Repo** is the universal solution - works everywhere
3. **In-Repo Main** only makes sense for monorepos with small teams
4. **PMO Tools** (Jira/Linear/Notion) are practical for teams already using them
5. **Hosted DB** is really only necessary at enterprise scale

## Migration Triggers

| From | To | Trigger |
|------|-----|---------|
| SQLite | Separate Repo | Adding second host node |
| SQLite | SQLite WAL | Adding 2+ workers |
| In-Repo Main | Separate Repo | Team growth or PR conflicts |
| Separate Repo | PMO Tool | Team already paying for Jira/Linear |
| Separate Repo | Hosted DB | 10+ engineers or real-time needs |
| Any | PMO Tool | Organization mandates standard tool |