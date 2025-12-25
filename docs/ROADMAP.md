# Proletariat Roadmap

## Implementation Status

### Core Commands (✅ Complete)
| Command Area | Status | Notes |
|--------------|--------|-------|
| Schema | ✅ 100% | Database schema complete |
| Ticket CRUD | ✅ 100% | create, list, view, move, delete |
| Board Commands | ✅ 100% | view, sync, open, markdown |
| Spec Commands | ✅ 100% | create, list, view |
| Work Commands | ✅ 100% | start, ready, complete, own, claim, assign |
| Agent Commands | ✅ 100% | add, remove, list |
| PR Commands | ✅ 100% | create, link, status |

### Testing Status
- [ ] Test `prlt work start` with all display modes (terminal, foreground, background, tmux)
- [ ] Test `prlt work start` with devcontainer vs host environments
- [x] Test `prlt work start` permission mode selection (safe vs danger) - fixed tmux script generation
- [ ] Test `prlt work start` output mode selection (interactive vs print)
- [x] Test `prlt work ready` and `prlt work complete` column transitions - now configurable
- [ ] Verify agent busy checking prevents double-booking

### Known Issues
- **SIGKILL on interactive prompts**: Commands with inquirer prompts getting killed (exit 137)
  - Non-interactive commands work fine
  - Likely terminal/shell integration issue (iTerm2? zsh autocomplete?)
  - Test in fresh terminal, disable shell integrations

---

## Short Term

### Review/Complete Column Logic ✅
- [x] Tighten logic for `prlt work ready` - which column to move to
- [x] Tighten logic for `prlt work complete` - which column to move to
- [x] Handle different board templates (kanban, scrum, founder, custom)
- [x] Make column matching more robust for varied naming

**Implemented via configurable column settings:**
- `pmo_settings` stores `column_in_progress`, `column_review`, `column_done`
- `pmo init` sets template-specific defaults (kanban, scrum, founder)
- Case-insensitive matching with partial match fallback
- See `specs/domain/settings.md` for full documentation

---

## New Features

### PR Workflow ✅
- [x] Add `prlt pr` namespace with interactive menu
- [x] `prlt pr create` - create PR from current branch
- [x] `prlt pr link <ticket-id>` - link PR to ticket
- [x] `prlt pr status` - view PR status for ticket
- [x] Auto-create PR when `prlt work ready` is called (with `--pr` flag or interactive prompt)
- [x] Track PR status in ticket metadata (`pr_url`, `pr_number`, `pr_branch`)

**Implementation notes:**
- Uses `gh` CLI for GitHub operations
- Auto-detects ticket ID from branch name (pattern: `TKT-XXX`)
- Auto-generates PR title/body from ticket information
- Pushes branch automatically if not already pushed
- See `specs/domain/pull-requests.md` for full documentation

### Review Feedback Loop
- [ ] Way to move ticket back to "In Progress" with review comments
- [ ] `prlt work revise <id>` - move back with feedback
- [ ] Inject review comments into agent prompt on re-execute
- [ ] Track revision history

### Claude Agent SDK vs Manual Prompting
- [ ] Research Claude Agent SDK capabilities
- [ ] Compare with current approach (claude CLI with --print)
- [ ] Evaluate for better control, streaming, tool use
- [ ] Prototype SDK-based executor

---

## Board Views & Sync

### Multiple View Support
- [ ] CLI view (`prlt board view`) - current
- [ ] Markdown file (kanban.md) - current, Obsidian compatible
- [ ] VSCode markdown board reader
- [ ] Web UI (future)

### Sync Options
- [ ] Monorepo PMO (pmo inside repo)
- [ ] Separate PMO (standalone pmo folder)
- [ ] Hosted database option
- [ ] Linear integration
- [ ] Jira integration
- [ ] GitHub Issues integration

### Current State
- PMO paths now stored as relative (container compatible)
- Dockerfile installs prlt from GitHub Packages
- devcontainer mounts .proletariat for shared DB access

---

## AI Enhancements

### Interactive Ticket Generation
- [ ] `prlt ticket create --ai` - AI-assisted ticket creation
- [ ] Generate description from title
- [ ] Suggest acceptance criteria
- [ ] Auto-categorize and prioritize
- [ ] Link to relevant specs/epics

### Auto-Watching & Agent Spawning
- [ ] Watch specific column(s) for new tickets
- [ ] Auto-assign to available agent
- [ ] Auto-execute when ticket enters watched column
- [ ] `prlt watch --column "Ready" --auto-start`
- [ ] Agent pool management

---

## Future Enhancements

### Bulk Operations
- [ ] `prlt ticket bulk move` - Move multiple tickets
- [ ] `prlt ticket bulk delete` - Delete multiple tickets
- [ ] `prlt ticket bulk reassign` - Change assignee for multiple
- [ ] `prlt ticket bulk update` - Update priority/category

### Board Views & Filtering
- [ ] `prlt board view --assignee` - Filter by assignee
- [ ] `prlt board view --priority` - Filter by priority
- [ ] `prlt board view --column` - Show specific columns
- [ ] `prlt board view --group-by` - Group tickets
- [ ] `prlt board view --sort-by` - Sort tickets
- [ ] `prlt board export` - Export to JSON/CSV

---

## Technical Debt

### PMO Path Migration
- [x] Store paths as relative in pmo_settings
- [x] Add backward compatibility for absolute paths
- [ ] Migration script to update existing absolute paths

### Package Distribution
- [x] Publish to GitHub Packages as @chrismcdermut/prlt
- [x] Dockerfile installs from registry
- [ ] Consider npm public registry when ready
- [ ] Version management strategy

---

## Session Notes

### 2024-12-08
- Implemented `--run-on-host` flag for work start
- Added interactive prompt: devcontainer vs host
- Changed PMO path storage to relative paths
- Updated Dockerfile to install prlt from GitHub Packages
- Encountered SIGKILL issue with interactive prompts (to debug)

### 2024-12-16
- Refactored commands into `work` namespace
  - `prlt ticket execute` → `prlt work start`
  - `prlt ticket review` → `prlt work ready`
  - `prlt ticket complete` → `prlt work complete`
  - Moved `claim`, `assign`, `own` to `work` namespace
- Added output mode selection (interactive vs print) to work start flow
- Updated all specs and documentation

### 2024-12-24
- Fixed tmux `--dangerously-skip-permissions` flag not working
  - Bug: `createTmuxScript` looked for `-p` flag in args incorrectly
  - Fix: Accept `skipPermissions` as direct parameter
- Fixed devcontainer database sync for `prlt work complete`
  - Added `PRLT_HQ_PATH` check to `getWorkspaceInfo()`
- Changed agent prompt from `work ready` to `work complete`
- **Implemented configurable column mappings:**
  - Added `getWorkColumnSetting()`, `setWorkColumnSetting()`, `findColumnByName()` helpers
  - Updated `work start`, `work ready`, `work complete` to use settings
  - Added `getColumnSettingsForTemplate()` to set defaults during `pmo init`
  - Template-specific mappings: kanban, scrum, founder, custom
  - Case-insensitive column matching with partial match fallback
- Created `specs/domain/settings.md` for settings documentation
- Updated SYSTEM_CARD.md with pmo_settings table and column mappings

### 2024-12-16 (Session 2)
- Enhanced execution tracking with new fields:
  - `environment`: devcontainer, host, docker, vm
  - `display_mode`: terminal, foreground, background, tmux
  - `sandboxed`: Whether --dangerously-skip-permissions is NOT used
- Permission prompt now shows for ALL environments (including devcontainer)
  - Container environments show note about additional isolation
- Agent busy checking:
  - Dynamic agent list shows available vs busy agents
  - Busy agents disabled in selection with ticket info
  - Prevents double-booking of agents
- Execution lifecycle improvements:
  - `work ready` and `work complete` mark executions as "completed"
  - Ticket assignees cleared when agents are removed from workspace
- Enhanced Claude prompt with full ticket details:
  - Priority, category, epic, spec
  - Full description with markdown formatting
  - Subtasks with completion checkboxes

### 2024-12-24 (Session 2)
- **Implemented PR Workflow:**
  - Created `prlt pr` command namespace with interactive menu
  - `prlt pr create` - Create PR from current branch, auto-detect ticket from branch name
  - `prlt pr link` - Link existing PR to ticket
  - `prlt pr status` - View PR status for ticket
  - Integrated PR creation into `work ready` flow
    - `--pr` flag to always create PR
    - `--no-pr` flag to skip PR prompt
    - Interactive prompt when gh is available and on feature branch
  - PR metadata stored in ticket: `pr_url`, `pr_number`, `pr_branch`
- Created `src/lib/pr/index.ts` with GitHub CLI helpers
- Created `specs/domain/pull-requests.md` domain spec

---

## Quick Reference

```bash
# Start work on a ticket (interactive)
prlt work start

# Start work on host (bypass devcontainer)
prlt work start TKT-001 --run-on-host

# Agent workflow
prlt work start TKT-001   # moves to In Progress
# ... agent works ...
prlt work ready TKT-001   # moves to In Review (prompts for PR)
prlt work ready TKT-001 --pr  # moves to Review + creates PR
prlt work ready TKT-001 --pr --draft  # creates draft PR

# Human review
prlt work complete TKT-001  # moves to Done

# Ownership commands
prlt work own TKT-001       # take ownership (accountable)
prlt work claim TKT-001     # own + assign to self/agent
prlt work assign TKT-001 altman  # assign to agent

# PR commands
prlt pr                     # interactive PR menu
prlt pr create              # create PR from current branch
prlt pr create TKT-001      # create PR and link to ticket
prlt pr link TKT-001        # link existing PR to ticket
prlt pr status TKT-001      # view PR status for ticket
```
