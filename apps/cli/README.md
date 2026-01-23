```
██████╗ ██████╗  ██████╗ ██╗     ███████╗████████╗ █████╗ ██████╗ ██╗ █████╗ ████████╗
██╔══██╗██╔══██╗██╔═══██╗██║     ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗██║██╔══██╗╚══██╔══╝
██████╔╝██████╔╝██║   ██║██║     █████╗     ██║   ███████║██████╔╝██║███████║   ██║
██╔═══╝ ██╔══██╗██║   ██║██║     ██╔══╝     ██║   ██╔══██║██╔══██╗██║██╔══██║   ██║
██║     ██║  ██║╚██████╔╝███████╗███████╗   ██║   ██║  ██║██║  ██║██║██║  ██║   ██║
╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝   ╚═╝
```

### Seize the means of production - Ship 100x.

> 💡 *Paying for Claude Max but not maxing it out? You're leaving money on the table.*

> ⚠️ **Beta Software** — Use freely—things may change.

---

# TLDR

**prlt** coordinates AI coding agents from one CLI. Isolated workspaces, secure containers, persistent state.

```bash
npm install -g @proletariat/cli
prlt init
prlt ticket create --title "Add OAuth" --category feature
prlt work spawn   # Interactive: select tickets, environment, action
```

Agent spawns in its own branch, writes code, opens PR. You review and merge.

**Why prlt?**
- **Isolated** - Each agent gets its own git branch. No conflicts.
- **Secure** - Docker containers, sandboxed from your host.
- **Durable** - Tmux sessions persist. Close window, agent keeps working.
- **Trackable** - One database, one CLI, all your agents.
- **Ephemeral** - Spawn agents on demand. They work, they PR, they're done.
- **Structured** - Tickets provide structured context, not freeform chat.
- **Persistent** - Tickets accumulate context over time. Hand off between agents.
- **Agent-native** - `--json` mode lets AI agents drive the CLI programmatically.

---

# Quick Start

```bash
npm install -g @proletariat/cli    # Install
prlt init                          # Create HQ, add repos, choose theme
prlt ticket create --title "Add OAuth" --category feature
prlt work spawn                    # Interactive: select tickets, environment, action
# Agent creates PR → You review → Merge → Done
```

```
┌─────┐          ┌──────┐          ┌───────┐          ┌────────┐
│ You │          │ prlt │          │ Agent │          │ GitHub │
└──┬──┘          └──┬───┘          └───┬───┘          └───┬────┘
   │  ticket create │                  │                  │
   │───────────────>│                  │                  │
   │  work spawn    │                  │                  │
   │───────────────>│                  │                  │
   │                │  create branch   │                  │
   │                │  create workspace│                  │
   │                │  spawn agent     │                  │
   │                │─────────────────>│                  │
   │                │                  │  read ticket     │
   │                │                  │  write code      │
   │                │                  │  commit          │
   │                │                  │─────────────────>│
   │                │                  │  open PR         │
   │                │                  │─────────────────>│
   │                │   update status  │                  │
   │                │<─────────────────│                  │
   │   PR ready     │                  │                  │
   │<───────────────│                  │                  │
   │                      review & approve                │
   │─────────────────────────────────────────────────────>│
```

<details>
<summary>View interactive diagram (GitHub only)</summary>

```mermaid
sequenceDiagram
    participant You
    participant prlt
    participant Agent
    participant GitHub

    You->>prlt: prlt ticket create
    You->>prlt: prlt work spawn
    prlt->>prlt: Create branch
    prlt->>prlt: Create workspace
    prlt->>Agent: Spawn agent
    Agent->>Agent: Read ticket
    Agent->>Agent: Write code
    Agent->>GitHub: Commit
    Agent->>GitHub: Open PR
    Agent->>prlt: Update status
    prlt->>You: PR ready
    You->>GitHub: Review & approve
```

</details>

Spawn agents to implement, groom, or review—not just write code.

### Interactive Menus

`prlt work` guides you through project and ticket selection:

<p align="center">
  <img src="https://raw.githubusercontent.com/chrismcdermut/proletariat-cli/main/apps/cli/images/work/work-project-select.png" alt="Project Selection" width="600">
</p>

Choose your operation—start a single agent, batch spawn, or watch a column:

<p align="center">
  <img src="https://raw.githubusercontent.com/chrismcdermut/proletariat-cli/main/apps/cli/images/work/work-operations-menu.png" alt="Work Operations Menu" width="600">
</p>

Select tickets to spawn, grouped by priority:

<p align="center">
  <img src="https://raw.githubusercontent.com/chrismcdermut/proletariat-cli/main/apps/cli/images/work/work-ticket-select.png" alt="Ticket Selection" width="800">
</p>

---

# Deep Dive

| Problem | Solution |
| --- | --- |
| Agents conflict with each other's changes | **Isolated** - Each agent gets its own git branch and worktree |
| Agents run unsandboxed on your machine | **Secure** - Docker containers, sandboxed from your host (looking into host sandbox options) |
| You lose track of who's doing what | **Trackable** - All state in one SQLite database, one CLI |
| Sessions die when you close a window | **Durable** - Tmux sessions persist, detach/reattach anytime |
| Context scattered across chat windows | **Structured** - Tickets with requirements, acceptance criteria |
| Starting agents is heavyweight | **Ephemeral** - Spawn on demand, they work, they PR, they're done |
| Context lost between agent runs | **Persistent** - Tickets accumulate context, hand off between agents |

### Data Model

```
Workspace (HQ)
├── Projects
│   ├── Epics → Tickets
│   └── (references a Workflow)
├── Workflows → Phases → Statuses (can be shared across projects)
├── Specs (can span projects)
├── Actions (reusable templates)
├── Agents
│   ├── Staff (persistent, named)
│   └── Temp (ephemeral, per-ticket)
└── Executions (running sessions)
    ├── Docker
    │   ├── Tmux session
    │   ├── Terminal or Background display
    │   └── Safe or YOLO permissions
    └── Host
        ├── Tmux session
        ├── Terminal or Background display
        └── Safe or YOLO permissions
```

| Entity | Description |
| --- | --- |
| **Project** | Groups tickets and epics, references a workflow |
| **Epic** | Work container with lifecycle (draft → active → complete) |
| **Ticket** | Individual work item with requirements and acceptance criteria |
| **Spec** | Static documentation (can span projects, linked to epics) |
| **Workflow** | Status flow configuration (can be shared across projects) |
| **Phase** | Stage in a workflow |
| **Status** | Ticket state within a phase |
| **Action** | Reusable prompt/action templates |
| **Agent (Staff)** | Persistent named agent with dedicated workspace |
| **Agent (Temp)** | Ephemeral agent spawned for a single ticket |
| **Execution** | Running agent session on a ticket |
| **Display** | Terminal (new tab) or Background (detached) |

### Example Workflow

A workflow defines how tickets move through your process. Projects reference a workflow, and multiple projects can share the same one.

```
Kanban Workflow
├── Backlog       # New tickets land here
├── In Progress   # Agent working (prlt work spawn)
├── Review        # PR ready (prlt work ready)
└── Done          # Merged (prlt work complete)
```

```
Scrum Workflow
├── Backlog
├── Sprint
│   ├── To Do
│   ├── In Progress
│   └── In Review
└── Done
```

Tickets flow through statuses as work progresses. Agents automatically move tickets when they start work, open PRs, or complete tasks.

### Workspace Structure

Each agent gets a copy of all repos (repo scoping coming soon). Work happens on isolated branches.

```
my-project/
├── .proletariat/
│   └── workspace.db              # Tickets, executions, state
├── repos/
│   ├── frontend/                 # Your repos
│   ├── backend/
│   └── infra/
└── agents/
    ├── staff/
    │   └── alice/                # Named agent with persistent workspace
    │       ├── frontend/
    │       ├── backend/
    │       └── infra/
    └── temp/
        ├── agent-abc123/         # Ephemeral: Working on TKT-042 (OAuth)
        │   ├── frontend/         # All repos on branch: feat/TKT-042-oauth
        │   ├── backend/
        │   └── infra/
        └── agent-def456/         # Ephemeral: Working on TKT-043 (API)
            ├── frontend/         # All repos on branch: feat/TKT-043-api
            ├── backend/
            └── infra/
```

### Three Ways to Use Commands

#### 1. Interactive (Humans)

Run without flags—get guided prompts:

```bash
$ prlt ticket create

? Title: Add password reset
? Description: Email-based password reset flow
? Priority: P1
? Category: feature

✓ Created TKT-043
```

View ticket details with `prlt ticket`:

<p align="center">
  <img src="https://raw.githubusercontent.com/chrismcdermut/proletariat-cli/main/apps/cli/images/ticket/ticket-view.png" alt="Ticket View" width="600">
</p>

#### 2. JSON Mode (AI Agents)

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

#### 3. Flags (Scripts/CI)

Pass everything directly:

```bash
prlt ticket create \
  --title "Add OAuth" \
  --description "Google and GitHub OAuth" \
  --priority P1 \
  --category feature
```

### Execution Modes

**Environment** - where the agent runs:

| Environment | Flag | Best For |
| --- | --- | --- |
| 🐳 Docker | (default if devcontainer exists) | Safety—fully isolated container |
| 🏃 Host | `--run-on-host` | Speed—no container overhead |

**Display** - how you see it:

| Display | Flag | Best For |
| --- | --- | --- |
| 📺 Terminal | `--display terminal` | Watch in new terminal tab |
| 🔇 Background | `--display background` | Detached, reattach later |

**Permissions** - agent access level:

| Mode | Flag | Description |
| --- | --- | --- |
| 🔒 Safe | (default) | Agent prompts for permissions |
| 🕺 YOLO | `--skip-permissions` | No prompts, full access. Use with Docker for safe autonomy. |

All sessions run in tmux under the hood—close the window, agent keeps working.

```bash
# Default: Docker + terminal (if devcontainer exists)
prlt work start TKT-042

# Docker + background
prlt work start TKT-042 --display background

# Host + background (fast, no container)
prlt work start TKT-042 --run-on-host --display background

# Docker + YOLO (full autonomy, safely sandboxed)
prlt work start TKT-042 --skip-permissions
```

### Parallel Agents

Work on multiple tickets simultaneously.

**Interactive (humans):**
```bash
$ prlt work spawn

? Spawn mode: Select specific tickets
? Select tickets:
  ◉ [P1] TKT-042 - Add user authentication
  ◉ [P1] TKT-043 - Add API rate limiting
  ◯ [P2] TKT-044 - Add email notifications
? Action: implement
? Environment: docker

Spawning 2 tickets...
```

**JSON mode (AI agents):** *(multi-select WIP)*
```bash
$ prlt work spawn --json --many
```
```json
{
  "prompt": {
    "type": "checkbox",
    "message": "Select tickets to spawn:",
    "choices": [
      { "name": "[P1] TKT-042 - Add user authentication", "value": "TKT-042" },
      { "name": "[P1] TKT-043 - Add API rate limiting", "value": "TKT-043" }
    ]
  }
}
```

**Flags (scripts/CI):**
```bash
prlt work spawn TKT-042 TKT-043 --action implement --mode docker
```

Each agent works in its own branch. No conflicts.

> **Scaling:** The main limit is your machine. 50+ concurrent agents is achievable—depends on CPU, RAM, and whether you're running Docker or host mode.

Monitor running agents with `prlt execution`:

<p align="center">
  <img src="https://raw.githubusercontent.com/chrismcdermut/proletariat-cli/main/apps/cli/images/execution/execution-list.png" alt="Execution List" width="800">
</p>

```
┌─────────────────────┐      ┌─────────────────────┐      ┌──────────────────────────────┐
│         You         │      │       Agents        │      │           GitHub             │
├─────────────────────┤      ├─────────────────────┤      ├──────────────────────────────┤
│                     │      │  Agent 1            │      │  PR #101                     │
│  prlt work spawn ───┼─────>│  TKT-042 OAuth    ──┼─────>│  feat/TKT-042-oauth          │
│                     │      │                     │      │                              │
│                     │      │  Agent 2            │      │  PR #102                     │
│                  ───┼─────>│  TKT-043 Rate Limit─┼─────>│  feat/TKT-043-rate-limit     │
│                     │      │                     │      │                              │
│                     │      │  Agent 3            │      │  PR #103                     │
│                  ───┼─────>│  TKT-044 Notifs   ──┼─────>│  feat/TKT-044-notifications  │
└─────────────────────┘      └─────────────────────┘      └──────────────────────────────┘
```

<details>
<summary>View interactive diagram (GitHub only)</summary>

```mermaid
flowchart LR
    subgraph You
        spawn[prlt work spawn]
    end

    subgraph Agents
        A1[Agent 1<br/>TKT-042 OAuth]
        A2[Agent 2<br/>TKT-043 Rate Limit]
        A3[Agent 3<br/>TKT-044 Notifications]
    end

    subgraph GitHub
        PR1[PR #101<br/>feat/TKT-042-oauth]
        PR2[PR #102<br/>feat/TKT-043-rate-limit]
        PR3[PR #103<br/>feat/TKT-044-notifications]
    end

    spawn --> A1
    spawn --> A2
    spawn --> A3

    A1 --> PR1
    A2 --> PR2
    A3 --> PR3
```

</details>

Agent-created PRs ready for review:

<p align="center">
  <img src="https://raw.githubusercontent.com/chrismcdermut/proletariat-cli/main/apps/cli/images/execution/github-prs.png" alt="GitHub Pull Requests" width="800">
</p>

### Command Reference

<details>
<summary><b>Full Command Reference</b> (click to expand)</summary>

<table>
  <tr><th>Namespace</th><th>Command</th><th>Description</th></tr>
  <!-- ticket -->
  <tr><td rowspan="11"><b>ticket</b></td><td><code>prlt ticket create</code></td><td>Create new ticket</td></tr>
  <tr><td><code>prlt ticket list</code></td><td>List all tickets</td></tr>
  <tr><td><code>prlt ticket view &lt;id&gt;</code></td><td>View ticket details</td></tr>
  <tr><td><code>prlt ticket edit &lt;id&gt;</code></td><td>Edit ticket</td></tr>
  <tr><td><code>prlt ticket move &lt;id&gt; &lt;status&gt;</code></td><td>Change status</td></tr>
  <tr><td><code>prlt ticket delete &lt;id&gt;</code></td><td>Delete ticket</td></tr>
  <tr><td><code>prlt ticket complete &lt;id&gt;</code></td><td>Mark ticket complete</td></tr>
  <tr><td><code>prlt ticket bulk</code></td><td>Bulk ticket operations</td></tr>
  <tr><td><code>prlt ticket link block &lt;id&gt;</code></td><td>Link blocking ticket</td></tr>
  <tr><td><code>prlt ticket link relates &lt;id&gt;</code></td><td>Link related ticket</td></tr>
  <tr><td><code>prlt ticket template save</code></td><td>Save ticket as template</td></tr>
  <!-- work -->
  <tr><td rowspan="7"><b>work</b></td><td><code>prlt work start &lt;id&gt;</code></td><td>Spawn agent on ticket</td></tr>
  <tr><td><code>prlt work spawn</code></td><td>Batch spawn tickets</td></tr>
  <tr><td><code>prlt work spawn-all</code></td><td>Spawn all planned tickets</td></tr>
  <tr><td><code>prlt work complete &lt;id&gt;</code></td><td>Mark work done</td></tr>
  <tr><td><code>prlt work ready &lt;id&gt;</code></td><td>Mark ready for review</td></tr>
  <tr><td><code>prlt work revise &lt;id&gt;</code></td><td>Request revision</td></tr>
  <tr><td><code>prlt work watch</code></td><td>Watch work progress</td></tr>
  <!-- execution -->
  <tr><td rowspan="3"><b>execution</b></td><td><code>prlt execution list</code></td><td>List running agents</td></tr>
  <tr><td><code>prlt execution logs &lt;id&gt;</code></td><td>View agent output</td></tr>
  <tr><td><code>prlt execution stop &lt;id&gt;</code></td><td>Stop an agent</td></tr>
  <!-- agent -->
  <tr><td rowspan="11"><b>agent</b></td><td><code>prlt agent list</code></td><td>List all agents</td></tr>
  <tr><td><code>prlt agent status &lt;name&gt;</code></td><td>Check agent status</td></tr>
  <tr><td><code>prlt agent shell &lt;name&gt;</code></td><td>Shell into agent workspace</td></tr>
  <tr><td><code>prlt agent visit &lt;name&gt;</code></td><td>Navigate to workspace</td></tr>
  <tr><td><code>prlt agent login &lt;name&gt;</code></td><td>Auth Claude in container</td></tr>
  <tr><td><code>prlt agent rebuild &lt;name&gt;</code></td><td>Rebuild agent workspace</td></tr>
  <tr><td><code>prlt agent restart &lt;name&gt;</code></td><td>Restart agent</td></tr>
  <tr><td><code>prlt agent staff add &lt;names&gt;</code></td><td>Add named agents</td></tr>
  <tr><td><code>prlt agent staff list</code></td><td>List staff agents</td></tr>
  <tr><td><code>prlt agent temp list</code></td><td>List ephemeral agents</td></tr>
  <tr><td><code>prlt agent temp cleanup</code></td><td>Remove ephemeral agents</td></tr>
  <!-- agent themes -->
  <tr><td rowspan="4"><b>agent themes</b></td><td><code>prlt agent themes list</code></td><td>List available themes</td></tr>
  <tr><td><code>prlt agent themes set &lt;name&gt;</code></td><td>Set active theme</td></tr>
  <tr><td><code>prlt agent themes create &lt;name&gt;</code></td><td>Create custom theme</td></tr>
  <tr><td><code>prlt agent themes add-names</code></td><td>Add names to theme</td></tr>
  <!-- board -->
  <tr><td rowspan="2"><b>board</b></td><td><code>prlt board</code></td><td>View kanban board</td></tr>
  <tr><td><code>prlt board watch</code></td><td>Real-time updates</td></tr>
  <!-- project -->
  <tr><td rowspan="6"><b>project</b></td><td><code>prlt project create</code></td><td>Create project</td></tr>
  <tr><td><code>prlt project list</code></td><td>List projects</td></tr>
  <tr><td><code>prlt project view &lt;id&gt;</code></td><td>View project details</td></tr>
  <tr><td><code>prlt project archive &lt;id&gt;</code></td><td>Archive project</td></tr>
  <tr><td><code>prlt project unarchive &lt;id&gt;</code></td><td>Unarchive project</td></tr>
  <tr><td><code>prlt project delete &lt;id&gt;</code></td><td>Delete project</td></tr>
  <!-- epic -->
  <tr><td rowspan="10"><b>epic</b></td><td><code>prlt epic create</code></td><td>Create epic</td></tr>
  <tr><td><code>prlt epic list</code></td><td>List epics</td></tr>
  <tr><td><code>prlt epic view &lt;id&gt;</code></td><td>View epic details</td></tr>
  <tr><td><code>prlt epic ticket &lt;id&gt;</code></td><td>Add tickets to epic</td></tr>
  <tr><td><code>prlt epic progress &lt;id&gt;</code></td><td>View epic progress</td></tr>
  <tr><td><code>prlt epic move &lt;id&gt; &lt;status&gt;</code></td><td>Move epic status</td></tr>
  <tr><td><code>prlt epic archive &lt;id&gt;</code></td><td>Archive epic</td></tr>
  <tr><td><code>prlt epic activate &lt;id&gt;</code></td><td>Activate epic</td></tr>
  <tr><td><code>prlt epic reorder</code></td><td>Reorder epics</td></tr>
  <tr><td><code>prlt epic link block &lt;id&gt;</code></td><td>Link blocking epic</td></tr>
  <!-- spec -->
  <tr><td rowspan="6"><b>spec</b></td><td><code>prlt spec create</code></td><td>Create specification</td></tr>
  <tr><td><code>prlt spec list</code></td><td>List specifications</td></tr>
  <tr><td><code>prlt spec view &lt;id&gt;</code></td><td>View specification</td></tr>
  <tr><td><code>prlt spec plan &lt;id&gt;</code></td><td>Generate plan from spec</td></tr>
  <tr><td><code>prlt spec ticket &lt;id&gt;</code></td><td>Create ticket from spec</td></tr>
  <tr><td><code>prlt spec link relates &lt;id&gt;</code></td><td>Link related spec</td></tr>
  <!-- action -->
  <tr><td rowspan="6"><b>action</b></td><td><code>prlt action create</code></td><td>Create action template</td></tr>
  <tr><td><code>prlt action list</code></td><td>List actions</td></tr>
  <tr><td><code>prlt action show &lt;id&gt;</code></td><td>Show action details</td></tr>
  <tr><td><code>prlt action run &lt;id&gt;</code></td><td>Run action</td></tr>
  <tr><td><code>prlt action update &lt;id&gt;</code></td><td>Update action</td></tr>
  <tr><td><code>prlt action delete &lt;id&gt;</code></td><td>Delete action</td></tr>
  <!-- branch -->
  <tr><td rowspan="3"><b>branch</b></td><td><code>prlt branch create</code></td><td>Create branch</td></tr>
  <tr><td><code>prlt branch list</code></td><td>List branches</td></tr>
  <tr><td><code>prlt branch validate</code></td><td>Validate branch name</td></tr>
  <!-- status -->
  <tr><td rowspan="5"><b>status</b></td><td><code>prlt status list</code></td><td>List workflow statuses</td></tr>
  <tr><td><code>prlt status create</code></td><td>Create custom status</td></tr>
  <tr><td><code>prlt status update &lt;id&gt;</code></td><td>Update status</td></tr>
  <tr><td><code>prlt status move &lt;id&gt;</code></td><td>Reorder status</td></tr>
  <tr><td><code>prlt status delete &lt;id&gt;</code></td><td>Delete status</td></tr>
  <!-- workflow -->
  <tr><td rowspan="5"><b>workflow</b></td><td><code>prlt workflow list</code></td><td>List workflows</td></tr>
  <tr><td><code>prlt workflow create</code></td><td>Create workflow</td></tr>
  <tr><td><code>prlt workflow view &lt;id&gt;</code></td><td>View workflow</td></tr>
  <tr><td><code>prlt workflow switch &lt;id&gt;</code></td><td>Switch active workflow</td></tr>
  <tr><td><code>prlt workflow delete &lt;id&gt;</code></td><td>Delete workflow</td></tr>
  <!-- phase -->
  <tr><td rowspan="5"><b>phase</b></td><td><code>prlt phase list</code></td><td>List phases</td></tr>
  <tr><td><code>prlt phase create</code></td><td>Create phase</td></tr>
  <tr><td><code>prlt phase update &lt;id&gt;</code></td><td>Update phase</td></tr>
  <tr><td><code>prlt phase move &lt;id&gt;</code></td><td>Reorder phase</td></tr>
  <tr><td><code>prlt phase delete &lt;id&gt;</code></td><td>Delete phase</td></tr>
  <!-- template -->
  <tr><td rowspan="5"><b>template</b></td><td><code>prlt template list</code></td><td>List templates</td></tr>
  <tr><td><code>prlt template delete &lt;id&gt;</code></td><td>Delete template</td></tr>
  <tr><td><code>prlt template ticket list</code></td><td>List ticket templates</td></tr>
  <tr><td><code>prlt template ticket apply</code></td><td>Apply ticket template</td></tr>
  <tr><td><code>prlt template phase list</code></td><td>List phase templates</td></tr>
  <!-- pr -->
  <tr><td rowspan="3"><b>pr</b></td><td><code>prlt pr create</code></td><td>Create pull request</td></tr>
  <tr><td><code>prlt pr status &lt;id&gt;</code></td><td>Check PR status</td></tr>
  <tr><td><code>prlt pr link &lt;id&gt; &lt;url&gt;</code></td><td>Link PR to ticket</td></tr>
  <!-- gh -->
  <tr><td rowspan="3"><b>gh</b></td><td><code>prlt gh login</code></td><td>Login to GitHub</td></tr>
  <tr><td><code>prlt gh status</code></td><td>Check auth status</td></tr>
  <tr><td><code>prlt gh token</code></td><td>Get GitHub token</td></tr>
  <!-- repo -->
  <tr><td rowspan="4"><b>repo</b></td><td><code>prlt repo add &lt;url&gt;</code></td><td>Add repository</td></tr>
  <tr><td><code>prlt repo list</code></td><td>List repositories</td></tr>
  <tr><td><code>prlt repo view &lt;name&gt;</code></td><td>View repository details</td></tr>
  <tr><td><code>prlt repo remove &lt;name&gt;</code></td><td>Remove repository</td></tr>
  <!-- docker -->
  <tr><td rowspan="10"><b>docker</b></td><td><code>prlt docker list</code></td><td>List containers</td></tr>
  <tr><td><code>prlt docker status</code></td><td>Check Docker status</td></tr>
  <tr><td><code>prlt docker start &lt;name&gt;</code></td><td>Start container</td></tr>
  <tr><td><code>prlt docker stop &lt;name&gt;</code></td><td>Stop container</td></tr>
  <tr><td><code>prlt docker restart &lt;name&gt;</code></td><td>Restart container</td></tr>
  <tr><td><code>prlt docker logs &lt;name&gt;</code></td><td>View container logs</td></tr>
  <tr><td><code>prlt docker shell &lt;name&gt;</code></td><td>Shell into container</td></tr>
  <tr><td><code>prlt docker sync &lt;name&gt;</code></td><td>Sync container files</td></tr>
  <tr><td><code>prlt docker clean</code></td><td>Remove stopped containers</td></tr>
  <tr><td><code>prlt docker prune</code></td><td>Remove unused resources</td></tr>
  <!-- session -->
  <tr><td rowspan="2"><b>session</b></td><td><code>prlt session list</code></td><td>List active tmux sessions</td></tr>
  <tr><td><code>prlt session attach &lt;name&gt;</code></td><td>Attach to tmux session</td></tr>
  <!-- workspace -->
  <tr><td rowspan="4"><b>workspace</b></td><td><code>prlt init</code></td><td>Initialize workspace</td></tr>
  <tr><td><code>prlt workspace list</code></td><td>List workspaces</td></tr>
  <tr><td><code>prlt workspace add</code></td><td>Add workspace</td></tr>
  <tr><td><code>prlt workspace use &lt;name&gt;</code></td><td>Switch workspace</td></tr>
  <!-- utility -->
  <tr><td rowspan="3"><b>utility</b></td><td><code>prlt whoami</code></td><td>Show current context</td></tr>
  <tr><td><code>prlt commit</code></td><td>Conventional commit</td></tr>
  <tr><td><code>prlt autocomplete setup</code></td><td>Setup shell autocomplete</td></tr>
</table>

</details>

Run `prlt <command> --help` for flags and options.

### Use Cases

#### Parallel Feature Development

```bash
# Create tickets for each feature
prlt ticket create --title "Add OAuth" --category feature
prlt ticket create --title "Add API rate limiting" --category feature
prlt ticket create --title "Add email notifications" --category feature

# Spawn all three in parallel (Docker for isolation)
prlt work spawn TKT-001 TKT-002 TKT-003 --mode docker

# Watch the board as they work
prlt board watch
```

Three agents, three branches, three PRs. You review and merge.

#### Bug Bash

```bash
# Spawn all bugs at once
prlt work spawn --all --column Backlog --category bug

# Or pick specific ones
prlt work spawn TKT-010 TKT-011 TKT-012
```

#### Grooming Session

Have an agent refine ticket requirements:

```bash
prlt work start TKT-042 --action groom
```

Agent adds acceptance criteria, subtasks, estimates.

---

## Environment Variables

| Variable            | Purpose                       |
| ------------------- | ----------------------------- |
| `GITHUB_TOKEN`      | GitHub operations (PRs, etc.) |

Claude Code handles its own authentication via `claude login`.

---

## Requirements

- **Node.js 18+**
- **Git**
- **Claude Code** (`claude login` to authenticate)
- **SQLite**
- **Tmux** (session persistence)
- **Docker** (optional—for isolated execution)

---

## Support

- **Discord**: [discord.gg/tmZyjNNSvw](https://discord.gg/tmZyjNNSvw)
- **GitHub Issues**: [Report bugs or request features](https://github.com/chrismcdermut/proletariat-cli/issues)
- **LinkedIn**: [Christopher McDermut](https://www.linkedin.com/in/christopher-mcdermut/)

---

## License

Apache 2.0

---

[![npm version](https://img.shields.io/npm/v/@proletariat/cli.svg)](https://www.npmjs.com/package/@proletariat/cli)
[![Downloads](https://img.shields.io/npm/dm/@proletariat/cli.svg)](https://www.npmjs.com/package/@proletariat/cli)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

[Star on GitHub](https://github.com/chrismcdermut/proletariat) | [Install from NPM](https://www.npmjs.com/package/@proletariat/cli) | [Report Issues](https://github.com/chrismcdermut/proletariat/issues)

Made with ⚒️ by the proletariat.
