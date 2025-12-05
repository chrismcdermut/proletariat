# Execute Commands Specification

## Purpose

Commands for executing work by spinning up coding agents. This spec covers **how and where** work runs, separate from ownership and assignment (see [ticket-commands.md](ticket-commands.md)).

## Core Concepts

- **Executor**: The coding tool (claude-code, codex, aider, custom)
- **Runtime Mode**: Where/how the agent runs (foreground, background, tmux, docker, vm)
- **Execution**: A tracked instance of an agent working on a ticket
- **Context**: Ticket details, spec content, worktree path injected into agent

## Command Overview

| Command | Purpose |
|---------|---------|
| `prlt ticket execute [id]` | Start the assigned agent working on a ticket |
| `prlt execution list` | List running/recent executions |
| `prlt execution logs [id]` | View execution logs |
| `prlt execution stop [id]` | Stop a running execution |

---

## Runtime Modes

| Mode | How it runs | Use case |
|------|-------------|----------|
| `foreground` | Subprocess in current terminal | Debugging, watching agent work |
| `background` | Detached process, logs to file | Local async work |
| `tmux` | New tmux pane/window | Multiple agents visible side-by-side |
| `terminal` | New Terminal.app window (macOS) | Visual separation, easy monitoring |
| `docker` | Container with worktree mounted | Isolated environment, reproducible |
| `vm` | Remote VM via SSH | Cloud scale, parallel execution |

**Default mode** can be configured:
```bash
prlt config set execution.default_mode background
```

---

## Command Specifications

### `prlt ticket execute [id]`

**Purpose**: Start the assigned agent working on a ticket

**Prerequisites**:
- Ticket must have an `assignee` set
- Assignee should be an agent (not human)

**Arguments**:
- `id` (optional): Ticket ID - prompts with dropdown if not provided

**Options**:
- `--mode <mode>`: Runtime mode (foreground, background, tmux, docker, vm)
- `--executor <name>`: Override executor (claude-code, codex, aider)
- `--watch, -w`: Stream output in real-time (implies foreground or attaches to background)
- `--force, -f`: Execute even if already in progress

**Interactive Flow** (if id not provided):
```
? Select ticket to execute:
  ❯ TKT-001 - Add login screen (assignee: alice)
    TKT-002 - Setup CI/CD (assignee: bob)
    TKT-003 - Implement auth (assignee: charlie)

🚀 Executing TKT-001: Add login screen
   Agent: alice
   Executor: claude-code
   Mode: background
   Worktree: /path/to/agents/alice/repo

   ✓ Work started (WORK-001)

   View logs: prlt execution logs WORK-001
   Stop: prlt execution stop WORK-001
```

**Example**:
```bash
prlt ticket execute TKT-001                     # Use defaults
prlt ticket execute TKT-001 --mode foreground   # Watch in terminal
prlt ticket execute TKT-001 --mode tmux         # New tmux pane
prlt ticket execute TKT-001 --mode docker       # Run in container
prlt ticket execute TKT-001 --watch             # Stream output
prlt ticket execute                             # Interactive
```

---

### Execution Process

When `execute` is called:

1. **Validate**
   - Check ticket exists
   - Check assignee is set
   - Check agent exists in workspace

2. **Prepare Context**
   - Gather ticket: id, title, description
   - Gather epic: title, description (if linked)
   - Gather spec: content (if epic linked to spec)
   - Locate worktree: agent's worktree path

3. **Setup Worktree**
   - cd into agent's worktree directory
   - Create branch: `{type}/{agent}/{ticket-id}-{slug}` (see [branch-commands.md](branch-commands.md#agent-workflow-integration))
   - Type is inferred from ticket category (see category→type mapping)

4. **Build Prompt**
   ```
   You are working on ticket {TICKET_ID}: {TITLE}

   Epic: {EPIC_TITLE}
   Spec: {SPEC_PATH}

   Description:
   {DESCRIPTION}

   When complete, run: prlt ticket complete {TICKET_ID}
   ```

   Note: Worktree path and branch name are NOT included in prompt since the agent
   is spawned directly in the worktree with the branch already checked out.

5. **Launch Executor**
   - Select executor (claude-code, codex, aider)
   - Select runtime mode
   - Start process in worktree directory with prompt injected
   - Agent wakes up already in correct directory on correct branch

6. **Track Execution**
   - Create execution record in database
   - Store PID / container ID / session ID
   - Move ticket to "In Progress"

---

## Runtime Mode Details

### Foreground

Runs in current terminal, blocks until complete.

```bash
prlt ticket execute TKT-001 --mode foreground
```

**Implementation**:
```typescript
spawn('claude', ['--prompt', prompt], {
  stdio: 'inherit',
  cwd: worktreePath
});
```

### Background

Detached process, logs to file.

```bash
prlt ticket execute TKT-001 --mode background
```

**Implementation**:
```typescript
const logFile = `${HQ_PATH}/logs/work-${workId}.log`;
spawn('claude', ['--prompt', prompt], {
  detached: true,
  stdio: ['ignore', logFile, logFile],
  cwd: worktreePath
});
```

**Log location**: `{HQ}/.proletariat/logs/work-{WORK_ID}.log`

### Tmux

Creates new tmux window/pane with working directory set to worktree.

```bash
prlt ticket execute TKT-001 --mode tmux
```

**Implementation**:
```bash
# New window - starts in worktree directory
tmux new-window -c "{worktree}" -n "TKT-001" "claude --print '{prompt}'"

# Or split pane - starts in worktree directory
tmux split-window -c "{worktree}" -h "claude --print '{prompt}'"
```

The `-c` flag sets the working directory for the new window/pane, so the agent
spawns directly in the worktree without needing `cd`.

**Configuration**:
```bash
prlt config set execution.tmux.session proletariat  # Session name
prlt config set execution.tmux.layout split         # split or window
```

### Terminal (macOS)

Opens a new Terminal.app window with working directory set to worktree.

```bash
prlt ticket execute TKT-001 --mode terminal
```

**Implementation**:
```typescript
import { execSync } from 'child_process';

// Build the command to run in the new terminal
const cmd = `cd '${worktreePath}' && claude --print '${prompt}'`;

// Use osascript to open new Terminal window
execSync(`osascript -e '
  tell application "Terminal"
    do script "${cmd.replace(/'/g, "'\\''")}"
    activate
  end tell
'`);
```

Alternative using iTerm2:
```typescript
execSync(`osascript -e '
  tell application "iTerm"
    create window with default profile
    tell current session of current window
      write text "cd '${worktreePath}' && claude --print '${prompt}'"
    end tell
  end tell
'`);
```

**Configuration**:
```bash
prlt config set execution.terminal.app Terminal  # Terminal or iTerm
```

**Benefits**:
- Each agent gets its own window
- Easy to arrange/monitor visually
- Works without tmux installed
- macOS-native integration

### Docker

Container with worktree mounted, working directory set to /workspace.

```bash
prlt ticket execute TKT-001 --mode docker
```

**Implementation**:
```bash
docker run -d \
  --name work-{WORK_ID} \
  -v {WORKTREE}:/workspace \
  -w /workspace \
  -e TICKET_ID={TICKET_ID} \
  -e TICKET_PROMPT="{PROMPT}" \
  {DOCKER_IMAGE} \
  claude --print "{PROMPT}"
```

The `-w /workspace` flag sets the working directory inside the container,
so the agent spawns in the mounted worktree.

**Configuration**:
```bash
prlt config set execution.docker.image claude-code:latest
prlt config set execution.docker.network host
prlt config set execution.docker.memory 4g
prlt config set execution.docker.cpus 2
```

**Benefits**:
- Isolated node_modules/dependencies per agent
- Reproducible environment
- Resource limits (CPU, memory)
- Easy cleanup

### VM

Remote execution via SSH. Assumes worktree is synced to remote host.

```bash
prlt ticket execute TKT-001 --mode vm --host agent-pool.internal
```

**Implementation**:
```bash
# Sync worktree to remote (rsync or git push)
rsync -avz {WORKTREE}/ {USER}@{HOST}:/workspace/{AGENT}/

# Execute in remote worktree
ssh {USER}@{HOST} "cd /workspace/{AGENT} && claude --print '{PROMPT}'"
```

For git-based sync:
```bash
# Push branch to remote, then clone/pull on VM
git push origin {BRANCH}
ssh {USER}@{HOST} "cd /workspace/{AGENT} && git fetch && git checkout {BRANCH} && claude --print '{PROMPT}'"
```

**Configuration**:
```bash
prlt config set execution.vm.default_host agent-pool.internal
prlt config set execution.vm.user agent
prlt config set execution.vm.key_path ~/.ssh/agent_key
prlt config set execution.vm.sync_method rsync  # rsync or git
```

**Use cases**:
- Cloud-based agent pool
- GPU-enabled VMs for large models
- Multi-host parallel execution

---

## Executor Types

### claude-code (default)

Anthropic's Claude Code CLI.

```bash
claude --prompt "{PROMPT}" --dangerously-skip-permissions
```

### codex

OpenAI Codex / ChatGPT CLI.

```bash
codex --prompt "{PROMPT}"
```

### aider

Aider coding assistant.

```bash
aider --message "{PROMPT}"
```

### Custom

User-defined executor.

```bash
prlt config set execution.executor.custom "/path/to/my-agent --prompt"
prlt ticket execute TKT-001 --executor custom
```

---

## Execution Tracking

### Database Schema

```sql
CREATE TABLE agent_work (
  id TEXT PRIMARY KEY,           -- WORK-001
  ticket_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  executor TEXT NOT NULL,        -- claude-code, codex, aider
  mode TEXT NOT NULL,            -- foreground, background, tmux, docker, vm
  status TEXT NOT NULL,          -- running, completed, failed, stopped
  branch TEXT,                   -- Git branch created for this work
  pid TEXT,                      -- Process ID (background)
  container_id TEXT,             -- Docker container ID
  session_id TEXT,               -- Tmux session/window
  host TEXT,                     -- VM hostname
  log_path TEXT,                 -- Path to log file
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  exit_code INTEGER,
  FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id),
  FOREIGN KEY (agent_name) REFERENCES agents(name)
);

CREATE INDEX idx_agent_work_agent ON agent_work(agent_name);
CREATE INDEX idx_agent_work_status ON agent_work(status);
CREATE INDEX idx_agent_work_ticket ON agent_work(ticket_id);
```

### Checking Agent Availability

To find available agents (not currently working on anything):

```sql
SELECT a.name
FROM agents a
LEFT JOIN agent_work w ON a.name = w.agent_name AND w.status = 'running'
WHERE w.id IS NULL;
```

### `prlt execution list`

**Purpose**: List running and recent executions

**Options**:
- `--status <status>`: Filter by status (running, completed, failed)
- `--agent <name>`: Filter by agent
- `--limit <n>`: Number of results (default: 20)

**Output**:
```
🚀 Agent Work
═══════════════════════════════════════════════════════════════
ID        Ticket    Agent    Mode        Status     Started
───────────────────────────────────────────────────────────────
WORK-003  TKT-001   alice    docker      running    2 min ago
WORK-002  TKT-005   bob      background  completed  1 hour ago
WORK-001  TKT-003   charlie  tmux        failed     2 hours ago
═══════════════════════════════════════════════════════════════

Commands:
  prlt execution logs WORK-003    View logs
  prlt execution stop WORK-003    Stop execution
```

### `prlt execution logs [id]`

**Purpose**: View execution logs

**Arguments**:
- `id` (optional): Execution ID - prompts if not provided

**Options**:
- `--follow, -f`: Stream logs in real-time
- `--tail <n>`: Show last n lines

**Example**:
```bash
prlt execution logs WORK-003
prlt execution logs WORK-003 --follow
prlt execution logs WORK-003 --tail 50
```

### `prlt execution stop [id]`

**Purpose**: Stop a running execution

**Arguments**:
- `id` (optional): Execution ID - prompts if not provided

**Options**:
- `--force, -f`: Force kill (SIGKILL instead of SIGTERM)

**Behavior by mode**:
- `background`: Kill process by PID
- `docker`: `docker stop {container_id}`
- `tmux`: `tmux kill-window -t {window}`
- `vm`: SSH and kill remote process

---

## Configuration

### Default Settings

```bash
# Default runtime mode
prlt config set execution.default_mode background

# Default executor
prlt config set execution.default_executor claude-code

# Auto-execute on claim (when agent selected)
prlt config set execution.auto_execute true
```

### Docker Settings

```bash
prlt config set execution.docker.image proletariat/agent:latest
prlt config set execution.docker.network bridge
prlt config set execution.docker.memory 4g
prlt config set execution.docker.cpus 2
```

### Tmux Settings

```bash
prlt config set execution.tmux.session proletariat
prlt config set execution.tmux.layout split  # split, window
```

### VM Settings

```bash
prlt config set execution.vm.default_host agent-pool.internal
prlt config set execution.vm.pool_size 5
```

---

## Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                      TICKET LIFECYCLE                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Backlog ──→ In Progress ──→ Review ──→ Done                │
│               ↑                                              │
│               │                                              │
│         ┌─────┴─────┐                                        │
│         │  EXECUTE  │                                        │
│         └─────┬─────┘                                        │
│               │                                              │
│               ▼                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  EXECUTION LIFECYCLE                   │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │                                                        │  │
│  │  starting ──→ running ──→ completed                   │  │
│  │                  │             │                       │  │
│  │                  ▼             ▼                       │  │
│  │               failed       (ticket moves              │  │
│  │                  │          to Done)                   │  │
│  │                  ▼                                     │  │
│  │               stopped                                  │  │
│  │                                                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Agent Completion

When agent completes work, it should run:
```bash
prlt ticket complete {TICKET_ID}
```

This:
1. Moves ticket to "Done" column
2. Updates execution status to "completed"
3. Records completion timestamp

### Agent Failure

If agent exits with non-zero code:
1. Execution status set to "failed"
2. Ticket remains in "In Progress"
3. Owner notified (if configured)

---

## Future Enhancements

### Agent Pooling
```bash
prlt agent pool create --size 5 --mode docker
prlt ticket execute TKT-001 --pool default
```

### Parallel Execution
```bash
prlt tickets execute --column Backlog --parallel 3
```

### Execution Metrics
```bash
prlt execution stats
# Average completion time, success rate, etc.
```

### Auto-Retry
```bash
prlt config set execution.auto_retry true
prlt config set execution.retry_count 3
```

### Webhooks
```bash
prlt config set execution.webhook.on_complete https://api.example.com/notify
prlt config set execution.webhook.on_fail https://api.example.com/alert
```
