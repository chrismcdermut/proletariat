# Proletariat Roadmap

## Immediate Testing (Next Session)

### Execute Command Testing
- [ ] Test `prlt work start` with foreground mode (host)
- [ ] Test `prlt work start` with background mode (host)
- [ ] Test `prlt work start` with terminal mode (host)
- [ ] Test `prlt work start` with tmux mode (host)
- [ ] Test `prlt work start` with devcontainer + foreground display
- [ ] Test `prlt work start` with devcontainer + background display
- [ ] Test `prlt work start` with devcontainer + terminal display
- [ ] Test `prlt work start` with `--run-on-host` flag bypass
- [ ] Test `prlt work start` output mode selection (interactive vs print)

### Debug: Interactive Prompt SIGKILL Issue
- Commands with inquirer prompts getting killed (exit 137)
- Non-interactive commands work fine
- Likely terminal/shell integration issue (iTerm2? zsh autocomplete?)
- Test in fresh terminal, disable shell integrations

---

## Specs & Documentation

### Update Specs
- [x] Update execute-commands.md with `--run-on-host` flag
- [x] Update ticket-commands.md with review/complete column logic
- [x] Create system card / agent briefing document
- [x] Ensure all specs reflect current implementation

### Review/Complete Column Logic
- [ ] Tighten logic for `prlt work ready` - which column to move to
- [ ] Tighten logic for `prlt work complete` - which column to move to
- [ ] Handle different board templates (kanban, scrum, founder, custom)
- [ ] Make column matching more robust for varied naming

---

## New Features

### PR Workflow
- [ ] Add `prlt pr` namespace or integrate into `prlt work ready`
- [ ] `prlt pr create` - create PR from current branch
- [ ] `prlt pr link <ticket-id>` - link PR to ticket
- [ ] Auto-create PR when agent calls `prlt work ready`
- [ ] Track PR status in ticket metadata

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
prlt work ready TKT-001   # moves to In Review

# Human review
prlt work complete TKT-001  # moves to Done

# Ownership commands
prlt work own TKT-001       # take ownership (accountable)
prlt work claim TKT-001     # own + assign to self/agent
prlt work assign TKT-001 altman  # assign to agent
```
