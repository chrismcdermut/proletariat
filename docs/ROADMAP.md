# Proletariat Roadmap

## Implementation Status

### Core Commands (✅ Complete)
| Command Area | Status | Notes |
|--------------|--------|-------|
| Schema | ✅ 100% | Database schema complete |
| Ticket CRUD | ✅ 100% | create, list, view, move, delete |
| Board Commands | ✅ 100% | view, sync, open, markdown |
| Spec Commands | ✅ 100% | create, list, view |
| Work Commands | ✅ 100% | start, ready, complete, revise, own, claim, assign |
| Agent Commands | ✅ 100% | add, remove, list |
| PR Commands | ✅ 100% | create, link, status |
| GH Commands | ✅ 100% | status, login, token |

### Known Issues
- **SIGKILL on interactive prompts**: Commands with inquirer prompts getting killed (exit 137)
  - Non-interactive commands work fine
  - Likely terminal/shell integration issue (iTerm2? zsh autocomplete?)

---

## What's Next

### 1. Auto-Watching & Agent Spawning (High Priority)
Automate the workflow by watching columns and spawning agents automatically.

- [ ] `prlt watch` - Watch specific column(s) for new tickets
- [ ] Auto-assign to available agent when ticket enters watched column
- [ ] Auto-execute `work start` when ticket assigned
- [ ] `prlt watch --column "Ready" --auto-start`
- [ ] Agent pool management - track available/busy agents
- [ ] Configurable polling interval or webhook-based triggers
- [ ] `prlt watch stop` - Stop watching

### 2. Sync Options (Medium Priority)
Enable different PMO storage and sync backends.

- [ ] Monorepo PMO (pmo inside repo) - current default
- [ ] Separate PMO (standalone pmo folder)
- [ ] Hosted database option (PostgreSQL/Turso)
- [ ] Linear integration - bidirectional sync
- [ ] GitHub Issues integration - sync tickets ↔ issues
- [ ] Jira integration - import/export

### 3. Board Views (Medium Priority)
Multiple ways to view and interact with the board.

- [x] CLI view (`prlt board view`)
- [x] Markdown file (kanban.md) - Obsidian compatible
- [ ] VSCode extension - view board in sidebar
- [ ] Web UI - browser-based board view
- [ ] Real-time updates across views

### 4. AI Ticket Generation (Lower Priority)
AI-assisted ticket creation and management.

- [ ] `prlt ticket create --ai` - AI-assisted ticket creation
- [ ] Generate description from title
- [ ] Suggest acceptance criteria
- [ ] Auto-categorize and prioritize
- [ ] Link to relevant specs/epics
- [ ] Break down large tickets into subtasks

### 5. Database Safety & Versioning (Important)
Protect user data with backups, migrations, and rollback capabilities.

- [ ] Schema versioning - track DB schema version in metadata table
- [ ] Auto-backup before migrations - snapshot before any schema change
- [ ] `prlt db backup` - manual backup to timestamped file
- [ ] `prlt db restore <backup>` - restore from backup file
- [ ] `prlt db export` - export all data to JSON/YAML
- [ ] `prlt db import` - import from JSON/YAML
- [ ] Migration rollback support - undo failed migrations
- [ ] Periodic auto-backup (configurable interval)
- [ ] Backup rotation - keep last N backups, delete old ones

### 6. Testing & Polish
- [ ] Test suite expansion for PR workflow
- [ ] Revision history tracking (count, time spent)
- [ ] PR merge detection - auto-complete tickets
- [ ] Multi-repo support testing
- [ ] Execution analytics (success rate, time tracking)
- [ ] Bulk operations (move, delete, reassign multiple tickets)
- [ ] Board filtering (--assignee, --priority, --column)

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

# Address PR feedback
prlt work revise TKT-001    # spawns agent with PR feedback
prlt work revise TKT-001 --force  # proceed even if no pending feedback

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

# GitHub CLI setup
prlt gh                     # interactive GH setup menu
prlt gh status              # check gh authentication status
prlt gh login               # login to GitHub CLI
prlt gh token               # show GH_TOKEN setup instructions
```

---

## Session Notes

### 2024-12-24 (Session 3)
- **PR Revision Workflow:** `prlt work revise` spawns agent to address PR feedback
- **PR Creation at Work Start:** Interactive prompt for PR preference, passed to agent
- **`prlt gh` commands:** status, login, token for GitHub CLI setup
- **UX:** Converted all y/n prompts to interactive dropdowns
- **Docs:** Updated specs for pull-requests and work domains

### 2024-12-24 (Session 2)
- **PR Workflow:** `prlt pr create/link/status` commands
- Integrated PR creation into `work ready` flow with `--pr`/`--no-pr` flags
- PR metadata stored in ticket: `pr_url`, `pr_number`, `pr_branch`

### 2024-12-24 (Session 1)
- Fixed tmux `--dangerously-skip-permissions` flag
- Fixed devcontainer database sync for `prlt work complete`
- **Configurable column mappings** via `pmo_settings`
- Template-specific defaults (kanban, scrum, founder)

### 2024-12-16
- Refactored commands into `work` namespace
- Enhanced execution tracking (environment, display_mode, sandboxed)
- Agent busy checking prevents double-booking
- Enhanced Claude prompt with full ticket details

### 2024-12-08
- Implemented `--run-on-host` flag for work start
- Changed PMO path storage to relative paths
- Dockerfile installs prlt from GitHub Packages
