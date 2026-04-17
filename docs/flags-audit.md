# CLI Flags Audit: All Namespaces

> **Date:** 2026-04-05
> **Ticket:** PRLT-313
> **Status:** Audit only — no changes implemented. Product decisions required.

---

## Table of Contents

1. [Command Inventory](#1-command-inventory)
2. [Flag Inconsistencies](#2-flag-inconsistencies)
3. [Flag Redundancies](#3-flag-redundancies)
4. [Overlapping Commands](#4-overlapping-commands)
5. [Non-Interactive / Headless Gaps](#5-non-interactive--headless-gaps)
6. [Missing --json Support](#6-missing---json-support)
7. [Namespace Bloat & Consolidation Candidates](#7-namespace-bloat--consolidation-candidates)
8. [process.exit() Violations](#8-processexit-violations)
9. [Recommendations Summary](#9-recommendations-summary)

---

## 1. Command Inventory

### 1.1 `work` namespace (24 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `work` | Interactive menu | (base only) |
| `work:start` | Start work on a ticket (core engine) | `--all`, `--executor -e`, `--display -d`, `--permission-mode`, `--skip-permissions`, `--create-pr`, `--force -f`, `--run-on-host`, `--watch -w`, `--clone`, `--session`, `--agent`, `--ephemeral`, `--from`, `--source`, `--key`, `--review-gate`, `--verify-ci`, `--output -o`, `--focus`, `--prompt -p`, `--message`, `--action` (hidden), `--from-issue`, `--mirror-to-pmo`, `--vm-host`, `--reconfigure`, `--no-pr` (deprecated) |
| `work:groom` | Enrich ticket with AC/subtasks | `--json/-m` |
| `work:implement` | Spawn agent for implementation | `--message/-M`, `--json/-m` |
| `work:review` | Evaluate PR/output | `--json/-m` |
| `work:resolve` | Resolve ambiguity questions | `--json/-m` |
| `work:peek` | View agent output | `--lines/-l`, `--full`, `--follow/-f`, `--since`, `--json/-m` |
| `work:poke` | Send message to agent | `--file/-F`, `--wait/-w`, `--timeout`, `--json/-m` |
| `work:stop` | Stop agent on ticket | `--no-transition`, `--json/-m` |
| `work:spawn` | Batch spawn agents | `--all/-a`, `--many`, `--column/-c`, `--strategy/-s`, `--dry-run`, `--display/-d`, `--executor/-e`, `--force/-f`, `--run-on-host`, `--limit/-l`, `--skip-permissions`, etc. |
| `work:ready` | Mark ready for review | `--pr`, `--draft-pr`, `--no-pr`, `--no-transition` |
| `work:ship` | Merge PR, move to Done | `--pr`, `--method`, `--wait`, `--when-green`, `--all`, `--no-rebase`, `--dry-run`, `--delete-branch`, `--admin`, `--rebase-siblings`, `--no-transition` |
| `work:propose` | Create PR + move to Review | (base only) |
| `work:complete` | Move ticket to Done | `--no-transition` |
| `work:rebase` | Rebase PR branches | `--pr`, `--all`, `--dry-run` |
| `work:drop` | Kill agent + close PR | `--no-transition`, `--json/-m` |
| `work:run` | Ticketless work mode | `--prompt/-p` (required), `--dir/-d`, `--repo/-r`, `--no-worktree`, `--create-pr`, `--keep-alive/-k`, `--environment/-e`, `--executor`, `--mode`, `--name`, `--json`, `--machine/-m` |
| `work:watch` | Auto-spawn on column changes | `--column/-c`, `--strategy/-s`, `--agent/-a`, `--limit/-l`, `--interval/-i`, `--once`, `--mode/-d`, `--skip-permissions`, `--create-pr` |
| `work:status` | Show in-progress tickets | (base only) |
| `work:source` | Show default work source | (base only) |
| `work:source:set` | Set default work source | (arg: source ref) |
| `work:hooks` | Hooks menu | (base only) |
| `work:hooks:add` | Add lifecycle hook | `--name`, `--event`, `--action-type`, `--action-value`, `--description` |
| `work:hooks:list` | List hooks | `--event` |
| `work:hooks:remove` | Remove hook | (arg: name) |
| `work:hooks:toggle` | Enable/disable hook | `--enable`, `--disable` |
| `work:asana` | Spawn from Asana | `--task`, `--limit/-l`, `--executor/-e`, `--display/-d`, `--action/-A`, `--message`, `--run-on-host`, `--skip-permissions`, `--create-pr`, `--yes/-y` |
| `work:jira` | Spawn from Jira | `--host`, `--email`, `--token`, `--project-key`, `--jql`, `--issue`, `--limit/-l`, `--executor/-e`, `--display/-d`, `--action/-A`, `--message`, `--run-on-host`, `--skip-permissions`, `--create-pr`, `--yes/-y` |
| `work:shortcut` | Spawn from Shortcut | `--issue`, `--limit/-l`, `--executor/-e`, `--display/-d`, `--action/-A`, `--message`, `--run-on-host`, `--skip-permissions`, `--create-pr`, `--yes/-y` |
| `work:linear` | Spawn from Linear | Similar to above |

### 1.2 `session` namespace (14 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `session` | Interactive menu | (base only) |
| `session:list` | List active sessions | `--all/-a`, `--orphans` |
| `session:attach` | Attach to session | `--new-tab/-n`, `--current-terminal/-c` (deprecated), `--terminal/-t` |
| `session:create` | Create tmux session | `--command/-c`, `--detach/-d` |
| `session:peek` | View pane content | `--lines/-l`, `--full`, `--since`, `--follow/-f`, `--interval` |
| `session:poke` | Send message to agent | `--file/-F`, `--wait/-w`, `--timeout` |
| `session:exec` | Run command in context | `--timeout/-t` |
| `session:health` | Check/recover agents | `--fix`, `--poke-idle`, `--watch`, `--interval`, `--threshold` |
| `session:inspect` | Full agent status dump | `--lines/-l` |
| `session:prune` | Clean up stale sessions | `--dry-run/-d`, `--force/-f`, `--yes/-y`, `--age` |
| `session:restart` | Restart stuck agent | `--fresh`, `--resume`, `--timeout` |
| `session:cleanup` | Stop/remove Docker containers | `--dry-run/-d`, `--force/-f`, `--yes/-y` |
| `session:report` | Report lifecycle events | `--agent` (required), `--status` (required) |
| `session:watch` | Auto-recover crashed agents | `--interval`, `--timeout`, `--kill`, `--recover`, `--once` |

### 1.3 `ticket` namespace (8 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `ticket` | Interactive menu | (base only) |
| `ticket:create` | Create ticket | `--title/-t`, `--column/-c`, `--priority/-p`, `--category`, `--description/-d`, `--description-file/-D`, `--id`, `--interactive/-i`, `--epic/-e`, `--template/-T`, `--labels/-l`, `--dry-run`, `--source`, `--team` |
| `ticket:list` | List tickets | `--column/-c`, `--priority/-p`, `--category`, `--search/-s`, `--format/-f`, `--all/-a`, `--label`, `--group-by/-g`, `--limit/-l`, `--offset`, `--source`, `--team` |
| `ticket:show` | View ticket | (arg: ticketId) |
| `ticket:edit` | Edit ticket | `--title/-t`, `--description/-d`, `--priority/-p`, `--category`, `--owner/-o`, `--assignee/-a`, `--add-subtask`, `--clear-subtasks`, `--add-label`, `--remove-label`, `--add-ac`, `--clear-ac`, `--interactive/-i` |
| `ticket:move` | Move ticket to column | `--status/-s`, `--position`, `--to-project`, `--bulk/-b`, `--force/-f` |
| `ticket:update` | Update ticket fields | `--title/-t`, `--description/-d`, `--description-file`, `--priority/-p`, `--category/-c`, `--labels/-l`, `--status/-s`, `--bulk/-b`, `--force/-f` |
| `ticket:delete` | Delete ticket | `--force/-f`, `--bulk/-b` |

### 1.4 `orchestrate` namespace (2 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `orchestrate` | Start pipeline daemon | `--preset`, `--load-yaml`, `--poll-interval`, `--once`, `--ticket/-t`, `--pr`, `--branch`, `--agent`, `--verbose/-v` |
| `orchestrate:machine` | Machine-level orchestrator | `--prompt/-p`, `--name/-n`, `--background/-b`, `--foreground/-f`, `--executor/-e` |

### 1.5 `orchestrator` namespace (5 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `orchestrator` | Interactive menu | (base only) |
| `orchestrator:start` | Start orchestrator | `--prompt/-p`, `--action/-A`, `--executor/-e`, `--skip-permissions`, `--permission-mode`, `--name/-n`, `--background/-b`, `--foreground/-f`, `--docker`, `--run-on-host` |
| `orchestrator:attach` | Attach to orchestrator | `--name/-n`, `--new-tab`, `--terminal/-t`, `--current-terminal/-c` (deprecated) |
| `orchestrator:status` | Check orchestrator status | `--name/-n`, `--peek`, `--lines` |
| `orchestrator:stop` | Stop orchestrator | `--name/-n`, `--force` |

### 1.6 `pr` namespace (8 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `pr` | Interactive menu | `--action/-a` |
| `pr:create` | Create GitHub PR | `--base/-b`, `--draft/-d`, `--no-link`, `--title/-t`, `--body`, `--ticket` |
| `pr:list` | List PRs | `--state/-s`, `--format/-f`, `--limit/-l` |
| `pr:merge` | Merge PR | `--method`, `--delete-branch`, `--admin` |
| `pr:close` | Close PR | `--comment/-c` |
| `pr:checks` | View CI checks | (arg: prNumber) |
| `pr:link` | Link PR to ticket | `--pr/-p`, `--url/-u`, `--ticket`, `--confirm` |
| `pr:status` | View PR status for ticket | `--ticket` |

### 1.7 `agent` namespace (18 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `agent` | Management hub | (base only) |
| `agent:list` | List agents | `--type/-t` |
| `agent:status` | Show agent status | (arg: name) |
| `agent:visit` | Navigate to agent dir | (arg: name) |
| `agent:remove` | Remove agent | `--force/-f` |
| `agent:shell` | Open interactive shell | (arg: name) |
| `agent:cleanup` | Clean up resources | `--temp`, `--all`, `--dry-run`, `--yes/-y`, `--force/-f`, `--push`, `--keep-dir`, `--no-interactive` |
| `agent:restart` | Restart container | (arg: name) |
| `agent:rebuild` | Rebuild image | `--no-cache` |
| `agent:login` | Authenticate Claude in container | (arg: name) |
| `agent:discover` | Discover unregistered agents | `--dry-run` |
| `agent:gc` | Garbage collect records | `--days/-d`, `--dry-run`, `--all` |
| `agent:auth` | Setup container auth | `--check`, `--force`, `--api-key` |
| `agent:staff` | Staff agent hub | `--no-interactive` |
| `agent:staff:add` | Add staff agents | `--no-container`, `--theme/-t`, `--clone` |
| `agent:staff:remove` | Remove staff agent | `--force/-f` |
| `agent:staff:list` | List staff agents | (base only) |
| `agent:themes` | Theme management hub | (base only) |

### 1.8 `hook` namespace (5 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `hook` | Interactive menu | (base only) |
| `hook:export` | Export hooks as YAML | (base only) |
| `hook:fire` | Fire orchestrate event | `--ticket`, `--pr`, `--branch`, `--agent`, `--action`, `--pr-url`, `--dry-run` |
| `hook:list` | List hooks | `--event`, `--mode`, `--source` |
| `hook:preset` | Apply preset | (arg: preset name) |

### 1.9 `notify` namespace (7 commands)

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `notify:connect` | Connect provider | `--name`, `--webhook-url`, `--channel`, `--username`, `--provider`, `--api-key`, `--from`, `--to`, `--account-sid`, `--auth-token` |
| `notify:disconnect` | Remove provider | (arg: name) |
| `notify:list` | List providers/rules | `--type`, `--rules` |
| `notify:test` | Test notification | (arg: name) |
| `notify:rules:add` | Add notification rule | `--provider` (required), `--priority`, `--delay`, `--escalation-group` |
| `notify:rules:list` | List rules | `--event` |
| `notify:rules:remove` | Remove rule | (arg: id) |

### 1.10 Other namespaces

| Namespace | Commands | Notes |
|-----------|----------|-------|
| `action` | 7 (index, list, show, create, edit, delete, run) | Action management |
| `db` | 1 (index) | Database management |
| `docker` | 12 (index, start, stop, restart, list, logs, shell, status, clean, prune, sync, rebuild-cache) | Full container management |
| `execution` | 6 (index, list, view, logs, stop, config) | Execution lifecycle |
| `gateway` | 1+ | Gateway management |
| `branch` | 5 (index, create, list, validate, where) | Branch naming |
| `sync` | 7 (index, start, stop, status, pause, resume, queue) | Board sync daemon |
| `config` | 1 | Workspace settings |
| `project` | 1 (configure) | Workflow mapping |
| `linear` | 5 (auth, connect, import, status, sync) | Linear integration |
| `asana` | 3 (connect, import, sync) | Asana integration |
| `gh` | 4 (index, login, token, status) | GitHub CLI setup |
| `repo` | 7 (index, add, create, fix-remotes, list, remove, view) | Repository management |
| `workspace` | 5 (add, list, prune, remove, use) | Workspace registry |
| `theme` | 5 (index, create, list, add-names, set) | Agent naming themes |
| `tools` | 5 (index, add, check, detect, remove) | MCP/CLI tool registry |
| `docker` | 12 | Container management |
| `telemetry` | 4 (index, enable, disable, status) | Telemetry controls |
| `caffeinate` | 4 (index, start, status, stop) | macOS sleep prevention |
| `feedback` | 4 (index, submit, list, view) | Bug reports/feedback |
| `support` | 6 (index, book, discord, docs, issues, logs) | Help & community |
| `qa` | 1 | Exploratory QA agent |
| `run` | 1 | Quick agent spawn |
| `claude` | 2 (index, open) | Quick Claude session |
| Standalone | 18 (commit, diet, gc, init, logs, mcp-server, new, peek, poke, ps, pull, self-update, stop, update, web, whoami, claude-yolo, codex-yolo) | Top-level commands |
| External integrations | monday (2), shortcut (1), trello (3) | Additional integrations |

**Total: ~170+ commands**

---

## 2. Flag Inconsistencies

### 2.1 `--display` vs `--display-mode` vs `--mode`

The display/output mode flag is named differently across commands:

| Flag Name | Used By |
|-----------|---------|
| `--display` (`-d`) | `work:start`, `work:spawn`, `work:asana`, `work:jira`, `work:shortcut`, `work:linear` |
| `--display-mode` (`-d`) | `claude`, `qa` |
| `--mode` | `work:run`, `work:watch` |

**Values also differ:**
- `work:start/spawn`: `foreground`, `terminal`, `background`
- `claude/qa`: `terminal`, `background`, `foreground`
- `work:run`: `terminal`, `background`, `foreground`
- `work:watch`: `terminal`, `background`

**Recommendation:** Standardize on `--display` with char `-d` everywhere. Use consistent value set: `terminal`, `foreground`, `background`.

### 2.2 `--skip-permissions` vs `--permission-mode`

| Flag | Used By |
|------|---------|
| `--skip-permissions` | `work:start`, `work:spawn`, `work:watch`, `work:asana`, `work:jira`, `work:shortcut`, `work:linear` |
| `--permission-mode` | `work:start`, `orchestrator:start`, `claude`, `run`, `qa`, `codex` |
| Both coexist | `work:start` (with explicit conflict detection + error) |

`--skip-permissions` is a boolean shorthand for `--permission-mode danger`. Having both flags creates confusion, especially since `work:start` has to reject them used together.

**Recommendation:** Deprecate `--skip-permissions` everywhere. Standardize on `--permission-mode danger|safe`. The boolean flag saves 5 characters but adds cognitive overhead.

### 2.3 `--executor` vs `--runner`

| Flag | Used By | Values |
|------|---------|--------|
| `--executor` (`-e`) | `work:start`, `work:spawn`, `orchestrator:start`, `orchestrate:machine`, `work:run` | `claude-code`, `codex`, `custom` |
| `--runner` (`-r`) | `run` | (dynamic from registry) |

The standalone `run` command uses `--runner` while every other command uses `--executor`.

**Recommendation:** Standardize on `--executor` everywhere. If `run` loads from a registry, `--executor` can accept the same values.

### 2.4 `-e` char conflict: `--executor` vs `--environment` vs `--epic`

The `-e` shorthand is overloaded across commands:

| Command | `-e` maps to |
|---------|-------------|
| `work:start`, `work:spawn`, `orchestrator:start`, `orchestrate:machine` | `--executor` |
| `work:run`, `claude`, `qa`, `run` | `--environment` |
| `ticket:create` | `--epic` |
| `branch:create` | `--empty-commit` |

**Recommendation:** This is a problem for users who switch between commands. Pick one meaning for `-e` globally (probably `--executor` since it's the most common). Give `--environment` a different char (e.g., `-E` or `--env`).

### 2.5 `-d` char conflict: `--display` vs `--dry-run` vs `--description` vs others

| Command | `-d` maps to |
|---------|-------------|
| `work:start`, `work:spawn` | `--display` |
| `session:prune`, `session:cleanup`, `docker:clean`, `docker:prune` | `--dry-run` |
| `ticket:create`, `ticket:edit`, `ticket:update` | `--description` |
| `work:run` | `--dir` |
| `agent:gc` | `--days` |
| `qa`, `claude` | `--display-mode` |

**Recommendation:** This is heavily overloaded but may be acceptable since the commands are in different namespaces. However, within the `work` namespace, `-d` means both `--display` (start/spawn) and `--dir` (run), which is confusing.

### 2.6 `--yes` / `-y` flag usage

Per CLAUDE.md, `--yes` (Y/n confirm) is being removed in favor of list selection. But `--yes/-y` still exists in:

- `work:asana`, `work:jira`, `work:shortcut`, `work:linear`
- `session:prune`, `session:cleanup`
- `agent:cleanup`

**Recommendation:** Audit whether these `--yes` flags are used to skip list prompts (acceptable for scripting) or to bypass confirm prompts (should be `--force`). Standardize: `--force` for destructive confirmation skips, remove `--yes` from interactive prompts.

### 2.7 `--force` / `-f` semantics vary

| Command | `--force` means |
|---------|----------------|
| `work:start` | Start even if work in progress |
| `agent:cleanup` | Force cleanup even with uncommitted work |
| `session:prune` | Force cleanup even with uncommitted/unpushed work |
| `ticket:move` | Skip confirmation (bulk mode) |
| `ticket:delete` | Skip confirmation |
| `docker:stop/restart` | Skip confirmation (aliases: yes, y) |
| `orchestrator:stop` | Skip confirmation |

These are all reasonable but inconsistent. In `docker:stop`, `--force` has aliases `yes` and `y`, conflating two concepts.

**Recommendation:** Reserve `--force` for "override safety checks." Use `--yes/-y` or `--confirm` for "skip confirmation prompt." Don't alias them to each other.

### 2.8 `--follow` / `-f` char conflict with `--force`

| Command | `-f` maps to |
|---------|-------------|
| `session:peek`, `work:peek` | `--follow` |
| `work:start`, `work:spawn`, `agent:cleanup` | `--force` |
| `docker:logs` | `--follow` |
| `docker:clean` | (no -f) |

**Recommendation:** Use `-F` for `--follow` (consistent with `work:poke --file/-F`), keep `-f` for `--force`.

### 2.9 `--all` / `-a` inconsistency

| Command | `--all` means |
|---------|--------------|
| `work:start`, `work:spawn` | All tickets in column |
| `work:ship` | All green PRs |
| `work:rebase` | All PRs with conflicts |
| `session:list` | Include stale records |
| `agent:cleanup` | All ephemeral agents |
| `docker:clean/prune` | All containers/resources |
| `ticket:list` | All projects |

The `-a` char is shared between `--all` and `--assignee` (`ticket:edit`). This is fine since they're in different commands.

### 2.10 `--no-transition` flag

Only present on `work:stop`, `work:ready`, `work:ship`, `work:complete`, `work:drop`. This is consistent — it's on all state-transition commands and nowhere else. **No issues.**

---

## 3. Flag Redundancies

### 3.1 `--json` and `--machine` / `-m`

Every command that supports JSON output has **both** `--json` and `--machine/-m`. They do the exact same thing:

```typescript
json: Flags.boolean({ description: 'Output as JSON for AI agents/scripts' })
machine: Flags.boolean({ char: 'm', description: 'Output as JSON for AI agents/scripts' })
```

This doubles the flag surface area for identical behavior. The only difference is `-m` shorthand.

**Recommendation:** Keep `--json` (standard oclif convention). Deprecate `--machine/-m` with a warning. This affects every command (~170+).

### 3.2 `ticket:edit` vs `ticket:update`

Both commands update ticket fields with nearly identical flags:

| Flag | `ticket:edit` | `ticket:update` |
|------|--------------|----------------|
| `--title/-t` | Yes | Yes |
| `--description/-d` | Yes | Yes |
| `--description-file` | No | Yes |
| `--priority/-p` | Yes | Yes |
| `--category` | Yes (no char) | Yes (`-c`) |
| `--labels/-l` | No (uses --add-label/--remove-label) | Yes (replaces all) |
| `--status/-s` | No | Yes |
| `--owner/-o` | Yes | No |
| `--assignee/-a` | Yes | No |
| `--add-subtask` | Yes | No |
| `--add-ac` | Yes | No |
| `--bulk/-b` | No | Yes |
| `--interactive/-i` | Yes | No |

**Recommendation:** Merge into a single `ticket:edit` command. `ticket:update` adds `--bulk`, `--status`, `--description-file`, and replace-all label semantics, but these could be flags on `ticket:edit`. Two commands for "change ticket fields" is confusing.

### 3.3 `work:ready` + `work:propose` overlap

`work:propose` is a thin wrapper that calls `work:ready --pr`. Both move a ticket to Review and optionally create a PR. The only difference is `work:propose` auto-detects the ticket and always creates a PR.

**Recommendation:** Keep both — `work:propose` is the agent-friendly shorthand, `work:ready` is the flexible version. This is acceptable duplication. Document that `work:propose` = `work:ready --pr`.

### 3.4 Top-level shortcuts duplicate `work:*` and `session:*`

| Top-level | Equivalent to |
|-----------|--------------|
| `peek <agent>` | `session:peek <target>` |
| `poke <agent> <message>` | `session:poke <agent> <message>` |
| `stop <agent>` | Kills tmux session (simpler than `work:stop`) |
| `logs <agent>` | `session:peek --lines 10000` (full scrollback) |
| `ps` | `session:list` (but works without HQ) |

And `work:peek`/`work:poke` also wrap `session:peek`/`session:poke` with ticket-based lookup.

So there are **three layers**: `peek` → `work:peek` → `session:peek`.

**Recommendation:** Keep all three layers — they serve different audiences:
- `peek/poke/stop/ps` = quick admin (no HQ required, agent-name based)
- `work:peek/poke/stop` = ticket-based lookup (HQ required)
- `session:peek/poke` = low-level session management

Document the relationship clearly.

### 3.5 `gc` vs `agent:gc` vs `agent:cleanup` vs `session:prune` vs `session:cleanup` vs `docker:clean` vs `docker:prune`

Seven different cleanup commands:

| Command | Cleans up |
|---------|-----------|
| `gc` | Agent worktrees, containers, branches for merged/closed PRs |
| `agent:gc` | Stale agent DB records |
| `agent:cleanup` | Containers, directories, tmux sessions for specific agents |
| `session:prune` | Stale sessions, orphan tmux, dead containers, idle agents |
| `session:cleanup` | Docker containers for completed agents |
| `docker:clean` | Orphaned containers |
| `docker:prune` | Unused Docker resources (images, volumes, networks) |

**Recommendation:** This is the most confusing area. Consider consolidating into:
- `prlt cleanup` — unified entry point that delegates to appropriate sub-cleanup
- `prlt cleanup --agents` (= agent:cleanup)
- `prlt cleanup --sessions` (= session:prune)
- `prlt cleanup --docker` (= docker:clean + docker:prune)
- `prlt cleanup --gc` (= gc + agent:gc)
- `prlt cleanup --all` (= everything)

Or at minimum, add a `prlt cleanup` command that explains what each sub-command does.

### 3.6 `init` and `new`

`init` is a deprecated alias for `new`. Both create a new HQ workspace.

**Recommendation:** Remove `init` in next major version. It already forwards to `new`.

---

## 4. Overlapping Commands

### 4.1 `work:start` vs `work:spawn` vs `work:run` vs `run`

| Command | Ticket required | Batch mode | External sources | HQ required |
|---------|----------------|------------|-----------------|-------------|
| `work:start` | Yes (or external) | Yes (`--all`) | Yes (via `--from`) | Yes |
| `work:spawn` | Yes | Yes (`--all`, `--many`) | Yes (Linear, Jira, Shortcut) | Yes |
| `work:run` | No (ticketless) | No | No | Yes |
| `run` | No | No | No | No |

`work:start` and `work:spawn` have significant overlap — both can start work on multiple tickets with batch mode. The key differences:
- `work:spawn` has `--strategy` (round-robin, least-busy, random)
- `work:spawn` supports `--many` for multi-select
- `work:start` is the core engine with more execution options

**Recommendation:** Consider whether `work:spawn` should be the batch-only interface while `work:start` is single-ticket only. Currently `work:start --all` does batch too.

### 4.2 `orchestrate` vs `orchestrator` namespaces

Two separate namespaces for orchestration:
- `orchestrate` = event-driven hook daemon
- `orchestrator` = AI agent that makes decisions

Despite different purposes, the names are too similar. Users will confuse them.

**Recommendation:** Rename one. Options:
- `orchestrate` → `daemon` or `hooks` (since `hook` namespace already exists, maybe `pipeline`)
- `orchestrator` → keep as-is (it's the agent, the noun)

Alternatively, merge `hook` into `orchestrate` since they're tightly coupled.

### 4.3 `work:hooks:*` vs `hook:*`

Both manage hooks but at different scopes:
- `work:hooks:*` = work lifecycle hooks (work:started, work:completed, etc.)
- `hook:*` = orchestrate hooks (broader event system)

**Recommendation:** Merge into a single `hook` namespace. The work lifecycle hooks are a subset of the orchestrate hook system. Having both is confusing.

### 4.4 `work:asana` / `work:jira` / `work:shortcut` / `work:linear` vs `work:start --from`

`work:start` already supports `--from linear:ENG-123` to start from external issues. The dedicated `work:asana`, `work:jira`, etc. commands provide browsing/selection UX but ultimately delegate to `work:start`.

**Recommendation:** These are fine as convenience commands. They provide discovery UX that `--from` can't. Consider consolidating to `work:external` with `--source` flag for the browsing UX.

### 4.5 `linear:auth` vs `linear:connect`

`linear:auth` is an alias for `linear:connect`. Same flags, same behavior.

**Recommendation:** Remove `linear:auth`, keep `linear:connect` (consistent with other integrations: `asana:connect`, `monday:connect`, `shortcut:connect`).

---

## 5. Non-Interactive / Headless Gaps

### 5.1 Commands with prompts but missing JSON mode handlers

| Command | Prompt | JSON mode handler |
|---------|--------|-------------------|
| `commit` | Multiple prompts (staging action, format, message) | **MISSING** on some prompts |
| `new` | Interactive wizard | Partially handled (has separate agent JSON path) |
| `agent:shell` | Multiple prompts (environment, display, permissions) | Partial |

### 5.2 Commands that require TTY

| Command | Reason |
|---------|--------|
| `session:attach` | Needs TTY for tmux |
| `docker:shell` | Needs TTY for interactive shell (explicitly exits in JSON mode) |
| `agent:login` | Opens interactive terminal |
| `agent:shell` | Opens interactive shell |
| `gh:login` | Spawns interactive `gh auth login` |

These are inherently interactive and correctly reject non-interactive usage.

### 5.3 `--yes/-y` flag for scripting

The `--yes` flag allows skipping confirmation in these commands, which is good for CI/scripting:
- `work:asana/jira/shortcut/linear`
- `session:prune`, `session:cleanup`
- `agent:cleanup`

But some destructive commands lack a skip-confirmation flag:
- `ticket:delete` has `--force` (OK)
- `work:drop` has no confirmation skip (always proceeds)
- `pr:close` has no confirmation skip

**Recommendation:** Ensure all destructive commands have a `--force` or `--yes` flag for headless operation.

---

## 6. Missing `--json` Support

Commands **without** JSON output support:

| Command | Impact |
|---------|--------|
| `web` | Server mode — N/A |
| `mcp-server` | Server mode — N/A |
| `repo:fix-remotes` | Should have JSON output |
| `repo:view` | Should have JSON output |
| `workspace:use` | Should have JSON output |

Most commands properly support `--json`. The gaps are minor.

**Recommendation:** Add `--json` to `repo:fix-remotes`, `repo:view`, and `workspace:use`.

---

## 7. Namespace Bloat & Consolidation Candidates

### 7.1 Command count by namespace

| Namespace | Count | Assessment |
|-----------|-------|-----------|
| `work` | 24+ | Heavy but justified — core workflow |
| `session` | 14 | Could consolidate (see below) |
| `agent` | 18 | Reasonable for agent management |
| `docker` | 12 | Could consolidate |
| `ticket` | 8 | Clean |
| `pr` | 8 | Clean |
| `sync` | 7 | Clean daemon lifecycle |
| `hook` | 5 | Clean |
| `notify` | 7 | Clean |
| `orchestrate` | 2 | Fine |
| `orchestrator` | 5 | Fine (but namespace confusing, see 4.2) |
| Standalone | 18 | Some are aliases/deprecated |

### 7.2 Candidates for removal

| Command | Reason | Action |
|---------|--------|--------|
| `init` | Deprecated, forwards to `new` | Remove |
| `self-update` | Hidden alias for `update` | Remove |
| `linear:auth` | Alias for `linear:connect` | Remove |
| `codex` (if exists) | Near-identical to `claude` with different runner | Consider merging into `run` |
| `claude-yolo` | `run <task>` in background with danger mode | Could be `run --yolo` |
| `codex-yolo` | Same as above for codex | Could be `run --yolo --runner codex` |

### 7.3 Namespace consolidation candidates

**Merge `session:cleanup` into `session:prune`:**
- `session:cleanup` = Docker containers for completed agents
- `session:prune` = stale sessions, orphan tmux, dead Docker, idle agents
- `session:prune` already covers a superset. Add `--docker-only` flag if needed.

**Merge `docker:clean` and `docker:prune`:**
- `docker:clean` = orphaned containers
- `docker:prune` = unused resources (images, volumes, networks)
- These are different scopes but could be `docker:cleanup --containers` vs `docker:cleanup --all`

**Merge `orchestrate` + `hook` namespaces:**
- `orchestrate` starts the daemon that processes hooks
- `hook` manages hook configuration
- They're two halves of the same feature. Consider `orchestrate:hooks:*` or just `hooks:*` for config + `hooks:daemon` for the runtime.

### 7.4 Namespace rename candidates

| Current | Proposed | Reason |
|---------|----------|--------|
| `orchestrate` + `orchestrator` | `pipeline` + `orchestrator` (or `daemon` + `orchestrator`) | Names are too similar |
| `work:hooks` | (merge into `hook`) | Duplicate hook management |

---

## 8. `process.exit()` Violations

CLAUDE.md states: "Never call `process.exit()` in command code."

Commands using `this.exit()` (which calls `process.exit`):

| Command | Lines | Context |
|---------|-------|---------|
| `new` | 232, 244, 254, 330 | Error handling in HQ creation |
| `update` | 69, 158 | Error handling in self-update |
| `branch:validate` | 69, 106 | Invalid branch name (exit 1) |
| `caffeinate` (all) | various | Non-macOS platform check |
| `linear:auth` | 101, 110 | `--check` mode errors |
| `linear:connect` | 205, 266 | Team not found errors |
| `asana:connect` | 83, 116, 185, 202 | Auth/connection errors |
| `shortcut:connect` | 245, 283 | Connection errors |
| `monday:connect` | 222, 264 | Connection errors |
| `trello:configure` | 289, 327 | Configuration errors |
| `docker:shell` | 52 | JSON mode rejection (needs TTY) |
| `qa` | 732 | User cancels GitHub token check |
| `execution:view` | 78 | Execution not found |
| `execution:logs` | 80 | Execution not found |
| `agent:auth` | 287 | `--check` mode, credentials missing |
| `workspace:add` | 125 | Path validation error |
| `orchestrate` | 237-303 | Overrides process.exit to keep daemon alive |

**Recommendation:** Replace `this.exit(1)` with `this.error('message')` in all cases. `this.error()` throws an error that oclif catches, which is the intended pattern. The `orchestrate` daemon's process.exit override is a special case — it's intentionally preventing oclif from killing the long-running daemon.

---

## 9. Recommendations Summary

### Priority 1 — Consistency fixes (high impact, low risk)

| # | Issue | Action |
|---|-------|--------|
| 1 | `--display` vs `--display-mode` vs `--mode` | Standardize on `--display` everywhere |
| 2 | `--skip-permissions` and `--permission-mode` coexist | Deprecate `--skip-permissions`, use `--permission-mode` only |
| 3 | `--executor` vs `--runner` | Standardize on `--executor` |
| 4 | `--json` + `--machine/-m` redundancy | Deprecate `--machine`, keep `--json` |
| 5 | `process.exit()` violations | Replace `this.exit()` with `this.error()` |

### Priority 2 — Consolidation (medium impact, medium risk)

| # | Issue | Action |
|---|-------|--------|
| 6 | `ticket:edit` + `ticket:update` overlap | Merge into single `ticket:edit` |
| 7 | `init` deprecated alias | Remove in next major |
| 8 | `linear:auth` alias | Remove, keep `linear:connect` |
| 9 | `session:cleanup` ⊂ `session:prune` | Merge into `session:prune` |
| 10 | `work:hooks` + `hook` overlap | Merge into unified `hook` namespace |

### Priority 3 — Naming clarity (medium impact, high risk — breaking changes)

| # | Issue | Action |
|---|-------|--------|
| 11 | `orchestrate` vs `orchestrator` confusion | Rename `orchestrate` → `pipeline` or `daemon` |
| 12 | 7 cleanup commands | Add `prlt cleanup` unified entry point |
| 13 | `-e` char overloaded | Assign `-e` to `--executor` only, use `-E` for `--environment` |

### Priority 4 — Completeness (low impact)

| # | Issue | Action |
|---|-------|--------|
| 14 | Missing `--json` on 3 commands | Add to `repo:fix-remotes`, `repo:view`, `workspace:use` |
| 15 | `commit` missing JSON prompt handlers | Add JSON mode to interactive prompts |
| 16 | Some destructive commands lack `--force` | Add to `work:drop`, `pr:close` |
| 17 | `--yes` vs `--force` semantics | Standardize: `--force` = override safety, `--yes` = skip prompt |
