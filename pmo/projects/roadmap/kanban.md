---
kanban-plugin: basic
---

# Proletariat Roadmap

## Backlog

- [ ] **tkt-055-tkt-055-update-work-commands-to-use-new-status-model** [[tkt-055-tkt-055-update-work-commands-to-use-new-status-model]] **TKT-055** [[TKT-055]] Update work commands to use new status model
      ***
      After TKT-040 (Linear-style ticket states) lands, update work/spawn/start commands to use the new status model instead of the current column/status hybrid.
      
      Changes needed:
      - Remove ticket.column field, use ticket.status_id only
      - Replace moveTicket(id, columnName) with updateStatus(id, statusId)
      - Remove fuzzy column name matching
      - Update filtering logic (currently checks both status AND column)
      - Board columns become views of statuses, not separate tracking
      
      Depends on: TKT-040
      
      Refs: TKT-041 (consolidate work/spawn commands)

- [ ] **tkt-056-tkt-056-implement-ticket-templates** [[tkt-056-tkt-056-implement-ticket-templates]] **TKT-056** [[TKT-056]] Implement ticket templates
      **Category:** feature
      ***
      Add ability to create ticket templates that can be used to quickly create common ticket types. Should include: create template from existing ticket, list available templates, create ticket from template, delete template. Templates should support: title pattern, description template, default priority, default category, suggested subtasks

- [ ] **tkt-057-tkt-057-audit-all-cli-commands-for-interactive-mode-support** [[tkt-057-tkt-057-audit-all-cli-commands-for-interactive-mode-support]] **TKT-057** [[TKT-057]] Audit all CLI commands for interactive mode support
      **Category:** backlog
      ***
      Audit all commands to ensure flags have corresponding interactive prompts when the command is run without flags. Pattern: if a command requires flags, running without flags should enter interactive mode to prompt for values. Create a programmatic test that verifies this pattern across all commands.

- [ ] **tkt-058-tkt-058-fix-skipped-e2e-tests-for-unimplemented-cli-features** [[tkt-058-tkt-058-fix-skipped-e2e-tests-for-unimplemented-cli-features]] **TKT-058** [[TKT-058]] Fix skipped E2E tests for unimplemented CLI features
      **Priority:** MEDIUM
      **Category:** chore
      ***
      Multiple E2E test files were skipped because they test commands that don't exist or have environment issues:
      
      ## Skipped Test Files
      
      1. **pmo-board-commands.test.ts** - Tests for board view, markdown, sync, export commands that don't exist
      2. **pmo-board-views.test.ts** - Tests for board view with filters/grouping that don't exist
      3. **pmo-spec-commands.test.ts** - Tests need refactoring for new workflow model
      4. **pmo-template-commands.test.ts** - Tests use wrong command paths (template list vs status template list)
      5. **work-commands.test.ts** - Tests need workspace environment setup
      6. **execution-commands.test.ts** - execution list command doesn't exist
      7. **init.test.ts** (partial) - HQ creation, workspace-only, agent creation tests have bugs
      
      ## Options
      
      1. Implement missing commands (board view, board markdown, etc.)
      2. Update tests to use correct command paths
      3. Fix test environment setup for workspace-dependent tests
      4. Fix init command bugs
      
      ## Related
      
      - TKT-040: Implement Linear-style ticket states (this ticket was blocked by these failing tests)

- [ ] **tkt-059-tkt-059-test-ticket-for-40** [[tkt-059-tkt-059-test-ticket-for-40]] **TKT-059** [[TKT-059]] test ticket for 40
      **Category:** feature
      ***
      ## What
      just need a test ticket here
      
      ## Done when
      - [ ]
      - [ ]
      - [ ] just making a stest ticket

- [ ] **tkt-060-tkt-060-review-work-command-naming-spawn-vs-start** [[tkt-060-tkt-060-review-work-command-naming-spawn-vs-start]] **TKT-060** [[TKT-060]] Review work command naming: spawn vs start
      ***
      Now that spawn just calls start in a loop, review if separate commands make sense.
      
      Current:
      - work start [ticket] - single ticket
      - work start --all - batch from backlog  
      - work spawn --column X - batch from any column
      
      Options to consider:
      - Keep as-is (spawn = batch by column)
      - Merge into start with --column flag
      - Rename spawn to 'batch' or 'bulk'
      
      Low priority - works fine, just naming clarity.

- [ ] **tkt-067-tkt-067-implement-list-view-renderer** [[tkt-067-tkt-067-implement-list-view-renderer]] **TKT-067** [[TKT-067]] Implement list view renderer
      **Priority:** MEDIUM
      **Category:** feature
      ***
      Add a compact vertical list view for the board. Shows tickets as single lines with key info (ID, title, priority, assignee). Good for quick scanning and dense information display. Part of the Linear/Notion-style views system.

- [ ] **tkt-068-tkt-068-implement-table-view-renderer** [[tkt-068-tkt-068-implement-table-view-renderer]] **TKT-068** [[TKT-068]] Implement table view renderer
      **Priority:** MEDIUM
      **Category:** feature
      ***
      Add an ASCII table view for the board. Shows tickets in a spreadsheet-like format with sortable columns (ID, title, status, priority, assignee, dates). Useful for detailed analysis and bulk review. Part of the Linear/Notion-style views system.

- [ ] **tkt-069-tkt-069-implement-calendar-view-renderer** [[tkt-069-tkt-069-implement-calendar-view-renderer]] **TKT-069** [[TKT-069]] Implement calendar view renderer
      **Priority:** LOW
      **Category:** feature
      ***
      Add a calendar view for the board. Shows tickets organized by due date in a monthly/weekly calendar format. Requires tickets to have due dates. Useful for deadline tracking and sprint planning. Part of the Linear/Notion-style views system.

- [ ] **tkt-070-tkt-070-implement-eisenhower-matrix-view-renderer** [[tkt-070-tkt-070-implement-eisenhower-matrix-view-renderer]] **TKT-070** [[TKT-070]] Implement Eisenhower matrix view renderer
      **Priority:** MEDIUM
      **Category:** feature
      ***
      Add an Eisenhower matrix (urgent/important quadrant) view for the board. Organizes tickets into four quadrants: Q1 Urgent+Important (Do First), Q2 Not Urgent+Important (Schedule), Q3 Urgent+Not Important (Delegate), Q4 Not Urgent+Not Important (Eliminate). Requires adding urgency/importance fields to tickets or deriving from priority + due date. Great for prioritization decisions.

- [ ] **tkt-071-tkt-071-implement-timeline-view-renderer** [[tkt-071-tkt-071-implement-timeline-view-renderer]] **TKT-071** [[TKT-071]] Implement timeline view renderer
      **Priority:** LOW
      **Category:** feature
      ***
      Add a timeline/Gantt chart view for the board. Shows tickets on a horizontal timeline with start/end dates, duration bars, dependency arrows (if dependencies are tracked), and milestone markers. Requires tickets to have start/end dates. ASCII-based rendering for CLI. Useful for project scheduling.

- [ ] **tkt-072-tkt-072-implement-gallery-view-renderer** [[tkt-072-tkt-072-implement-gallery-view-renderer]] **TKT-072** [[TKT-072]] Implement gallery view renderer
      **Priority:** LOW
      **Category:** feature
      ***
      Add a gallery/card grid view for the board. Shows tickets as larger cards in a grid layout with title, description preview, status badge, assignee initials, priority indicator, and progress bar (if subtasks exist). More visual than list view, good for overview of work items. ASCII-based card rendering for CLI.

- [ ] **tkt-074-tkt-074-add-commands-to-move-ticketsspecsepics-between-projects** [[tkt-074-tkt-074-add-commands-to-move-ticketsspecsepics-between-projects]] **TKT-074** [[TKT-074]] Add commands to move tickets/specs/epics between projects
      **Category:** feature
      ***
      ## What
      Add CLI commands to move PMO entities between projects.
      
      ## Done when
      
      ## Context
      Currently no way to reorganize content between projects. Had to manually update DB to consolidate Board into Proletariat Roadmap.
      
      ## Not in scope
      - Cross-HQ moves (different workspaces)
      - [ ] prlt ticket move --to-project <project-id> <ticket-ids...>
      - [ ] prlt epic move --to-project <project-id> <epic-ids...>
      - [ ] prlt spec move --to-project <project-id> <spec-ids...>
      - [ ] Bulk move support (multiple IDs or --all flag)
      - [ ] Update all foreign key references when moving

- [ ] **tkt-075-tkt-075-e2e-tests-should-use-isolated-test-pmodatabase** [[tkt-075-tkt-075-e2e-tests-should-use-isolated-test-pmodatabase]] **TKT-075** [[TKT-075]] E2E tests should use isolated test PMO/database
      **Category:** test
      ***
      ## What
      E2E tests should run against isolated test data, not pollute the real workspace.db.
      
      ## Done when
      
      ## Context
      Found 10+ test projects (My New Project, Flag Project, Custom ID, etc.) created by E2E tests in the real workspace.db. Tests were creating projects but not cleaning up, polluting the project picker.
      
      ## Not in scope
      - Unit tests (already isolated)
      - [ ] E2E tests create a temporary test database (e.g., /tmp/prlt-test-xxx/workspace.db)
      - [ ] Test PMO is isolated from real PMO
      - [ ] Tests clean up after themselves
      - [ ] No test artifacts left in production database

- [ ] **tkt-076-tkt-076-support-command-aliases-in-prlt-cli** [[tkt-076-tkt-076-support-command-aliases-in-prlt-cli]] **TKT-076** [[TKT-076]] Support command aliases in prlt CLI
      **Category:** feature
      ***
      ## What
      Add support for command aliases in prlt, similar to shell aliases in dotfiles.
      
      ## Done when
      
      ## Context
      Reference: ~/Projects/dotfiles/.aliases shows pattern of useful shortcuts:
      - gs (git status), gco (git checkout), gcm (git commit -m)
      - gnbi (interactive branch creator with conventional naming)
      - gpri (interactive PR creator)
      
      Similar shortcuts for prlt would improve DX:
      - prlt t list -> prlt ticket list
      - prlt w start -> prlt work start
      - prlt b -> prlt board
      
      ## Not in scope
      - Shell completion (separate ticket)
      - [ ] Support alias configuration in .proletariat/config.json or .prltrc
      - [ ] Common shorthand aliases (e.g., t -> ticket, b -> board, w -> work)
      - [ ] User-defined custom aliases
      - [ ] prlt alias list/add/remove commands

- [ ] **tkt-077-tkt-077-add-prlt-git-helper-commands** [[tkt-077-tkt-077-add-prlt-git-helper-commands]] **TKT-077** [[TKT-077]] Add prlt git helper commands
      **Category:** feature
      ***
      ## What
      Add git helper commands to prlt for common workflows, inspired by dotfiles aliases.
      
      ## Done when
            - Type picker (feat, fix, rfct, etc.)
            - Optional coder/agent name
            - Kebab-case validation
            - Optional empty seed commit
            - Auto-detect PR template
            - Guided prompts for summary, testing, context
            - Create as draft
      
      ## Context
      Reference: ~/Projects/dotfiles/.aliases has:
      - gnbi(): Interactive branch creator with type selection, coder name, kebab-case validation
      - gpri(): Interactive PR creator that finds templates and guides through sections
      - guma(): Fetch, switch to main, pull --ff-only
      
      These patterns work well and could be integrated into prlt for consistency with ticket/work workflows.
      
      ## Not in scope
      - Replacing git entirely
      - Complex git operations (rebase, cherry-pick)
      - [ ] prlt git branch - Interactive branch creator with conventional naming (like gnbi)
      - [ ] prlt git pr - Interactive PR creator (like gpri)
      - [ ] prlt git sync - Sync with main (fetch + switch + pull --ff-only)
      - [ ] prlt git clean - Clean merged branches

- [ ] **tkt-078-tkt-078-agent-branches-should-default-to-branching-from-main** [[tkt-078-tkt-078-agent-branches-should-default-to-branching-from-main]] **TKT-078** [[TKT-078]] Agent branches should default to branching from main
      **Category:** bug
      ***
      ## What
      When spawning agent work, new branches should be created from main by default, not from the current branch.
      
      ## Done when
      
      ## Context
      TKT-054 was spawned while on branch rfct/andreesen/TKT-041-consolidate-workspawn-commands. The agent's branch (feat/altman/TKT-054-...) was created from TKT-041 instead of main, causing it to include unrelated changes.
      
      Expected: Agent branches should start clean from main.
      Actual: Agent branches inherit whatever branch the spawner was on.
      
      ## Not in scope
      - Complex merge strategies
      - [ ] Agent work branches are created from main by default
      - [ ] Option to branch from current branch if explicitly requested
      - [ ] Prompt user if they want to branch from main or current (or just default to main)

- [ ] **tkt-079-tkt-079-make-spec-types-configurable** [[tkt-079-tkt-079-make-spec-types-configurable]] **TKT-079** [[TKT-079]] Make spec types configurable
      **Priority:** MEDIUM
      **Category:** enhancement
      ***
      Currently spec types are hardcoded in types.ts as: 'product' | 'platform' | 'infra' | 'integration'. Should be configurable per workspace/project, similar to how workflow statuses are configurable.

- [ ] **tkt-080-tkt-080-add-e2e-testing-infrastructure-for-interactive-prompts** [[tkt-080-tkt-080-add-e2e-testing-infrastructure-for-interactive-prompts]] **TKT-080** [[TKT-080]] Add e2e testing infrastructure for interactive prompts
      **Priority:** LOW
      **Category:** feature
      ***
      Currently e2e tests bypass interactive prompts by using command-line flags. To properly test interactive flows (inquirer prompts), we need testing infrastructure that can simulate user input.
      
      Options to investigate:
      1. Use node-pty to spawn CLI in pseudo-terminal and send keystrokes
      2. Mock inquirer module at test level
      3. Use expect-like library (e.g., node-expect) for terminal automation
      4. Consider testcontainers with TTY support
      
      Acceptance criteria:
      - Can test interactive dropdown selections
      - Can test confirmation prompts (y/n)
      - Can test multi-select checkbox prompts
      - Tests remain deterministic and fast
      - Document recommended pattern for future tests

- [ ] **tkt-082-tkt-082-add-ticket-retrospective-feature-to-capture-implementation-learnings** [[tkt-082-tkt-082-add-ticket-retrospective-feature-to-capture-implementation-learnings]] **TKT-082** [[TKT-082]] Add ticket retrospective feature to capture implementation learnings
      **Category:** feature
      ***
      ## What
      Add a retro feature to PMO that captures what was actually implemented, enabling better future tickets.
      
      ## Done when
      
      ## Context
      TKT-041 took ~40 back-and-forths that could have been ~5 with better upfront context. A retro feature captures learnings so similar future work can be one-shot.
      
      ## Not in scope
      - AI-generated retros (manual first)
      - [ ] prlt ticket retro <ticket-id> - Generate retrospective for completed ticket
      - [ ] Captures: files changed, decisions made, bugs discovered, follow-ups
      - [ ] Retro stored with ticket
      - [ ] prlt ticket create --from-retro <ticket-id> - Use retro as template for similar work

- [ ] **tkt-083-tkt-083-show-active-tickets-when-removing-agents** [[tkt-083-tkt-083-show-active-tickets-when-removing-agents]] **TKT-083** [[TKT-083]] Show active tickets when removing agents
      **Priority:** MEDIUM
      ***
      When running 'prlt agents remove', display any active ticket assignments for the agent before confirmation. Warn more prominently if agent has in-progress work to prevent accidentally removing an agent mid-task.

- [ ] **tkt-084-tkt-084-add-eslint-and-typescript-linting-configuration** [[tkt-084-tkt-084-add-eslint-and-typescript-linting-configuration]] **TKT-084** [[TKT-084]] Add ESLint and TypeScript linting configuration
      **Category:** chore
      ***
      ## What
      Add ESLint with TypeScript support for consistent code quality and style.
      
      ## Done when
      
      ## Context
      No linting currently configured. Would help catch issues before runtime and maintain consistency.
      
      ## Not in scope
      - Prettier (separate concern)
      - Overly strict rules that slow down development
      - [ ] ESLint configured with TypeScript parser
      - [ ] Reasonable rule set (not too strict, catches real issues)
      - [ ] npm run lint command
      - [ ] npm run lint:fix for auto-fixing
      - [ ] Pre-commit hook (optional)
      - [ ] CI check for lint errors

- [ ] **tkt-087-tkt-087-add-ticket-search-functionality** [[tkt-087-tkt-087-add-ticket-search-functionality]] **TKT-087** [[TKT-087]] Add ticket search functionality
      **Category:** feat
      ***
      Add ability to search for tickets by ID, title, or description. This would help users quickly find tickets in large projects without scrolling through lists.

## In Progress

- [ ] **tkt-044-tkt-044-refactor-board-for-one-board-views** [[tkt-044-tkt-044-refactor-board-for-one-board-views]] **TKT-044** [[TKT-044]] Refactor board for one board + views
      **Category:** refactor
      ***
      Adopt Linear/Notion model: one board with multiple views (kanban, list, etc.) instead of multiple boards. Depends on Linear-style ticket states being implemented first.

- [ ] **tkt-045-tkt-045-refactor-projects-to-use-board-views** [[tkt-045-tkt-045-refactor-projects-to-use-board-views]] **TKT-045** [[TKT-045]] Refactor projects to use board views
      **Category:** refactor
      ***
      Update project system to use board views instead of separate boards per project. Depends on board refactor being completed first.

- [ ] **tkt-050-tkt-050-andreesen-test** [[tkt-050-tkt-050-andreesen-test]] **TKT-050** [[TKT-050]] andreesen test

- [ ] **tkt-088-tkt-088-in-progress** [[tkt-088-tkt-088-in-progress]] **TKT-088** [[TKT-088]] In progress

- [ ] **tkt-036-tkt-036-add-unit-tests-for-spawner-module** [[tkt-036-tkt-036-add-unit-tests-for-spawner-module]] **TKT-036** [[TKT-036]] Add unit tests for spawner module
      **Priority:** MEDIUM
      **Category:** test
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/49
      ***
      Add comprehensive unit tests for the spawner.ts module including agent selection strategies

## Review

- [ ] **tkt-037-tkt-037-improve-error-messages-in-work-start** [[tkt-037-tkt-037-improve-error-messages-in-work-start]] **TKT-037** [[TKT-037]] Improve error messages in work start
      **Priority:** LOW
      **Category:** fix
      ***
      Add more descriptive error messages when work start fails due to missing agent or container issues

- [ ] **tkt-038-tkt-038-add-dry-run-flag-to-spawn-all** [[tkt-038-tkt-038-add-dry-run-flag-to-spawn-all]] **TKT-038** [[TKT-038]] Add --dry-run flag to spawn-all
      **Priority:** MEDIUM
      **Category:** feat
      ***
      Add a dry-run mode to spawn-all command that shows what would be spawned without actually starting agents

- [ ] **tkt-039-tkt-039-implement-event-based-hooks-for-auto-spawn** [[tkt-039-tkt-039-implement-event-based-hooks-for-auto-spawn]] **TKT-039** [[TKT-039]] Implement event-based hooks for auto-spawn
      **Priority:** MEDIUM
      **Category:** feat
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/52
      ***
      Add hooks system that triggers on events like ticket.created, ticket.moved, ticket.status_changed. Hooks would fire inline when CLI commands run (no server needed). Config via .proletariat/hooks.yaml or workspace settings. Use cases: auto-spawn when ticket enters Ready column, notify on status changes, etc.

- [ ] **tkt-041-tkt-041-consolidate-workspawn-commands** [[tkt-041-tkt-041-consolidate-workspawn-commands]] **TKT-041** [[TKT-041]] Consolidate work/spawn commands
      **Category:** refactor
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/60
      ***
      Consolidate spawn command naming: work start [ticket] for single, work start --all for batch backlog, work spawn --column X for batch by column. Remove redundant spawn-all.ts.

- [ ] **tkt-042-tkt-042-simplify-agents-for-mvp** [[tkt-042-tkt-042-simplify-agents-for-mvp]] **TKT-042** [[TKT-042]] Simplify agents for MVP
      **Category:** refactor
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/63
      ***
      Drop themes/status tracking for MVP. Simplify agent management to essential features only.

- [ ] **tkt-048-tkt-048-test-pmo-access-in-devcontainer** [[tkt-048-tkt-048-test-pmo-access-in-devcontainer]] **TKT-048** [[TKT-048]] Test PMO access in devcontainer
      **Category:** test
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/64
      ***
      Simple test to verify PMO is properly mounted in devcontainer.
      
      Task:
      1. Run: prlt ticket list
      2. Run: prlt ticket create --title 'Test from container' --column Backlog
      3. Run: prlt ticket list (verify new ticket appears)
      4. Delete the test ticket
      
      If any command fails with 'PMO not found', the mount is broken.

- [ ] **tkt-047-tkt-047-add-docker-management-cli-commands-prlt-docker-listcleanstatus** [[tkt-047-tkt-047-add-docker-management-cli-commands-prlt-docker-listcleanstatus]] **TKT-047** [[TKT-047]] Add Docker management CLI commands (prlt docker list/clean/status)
      **Category:** chore
      ***
      Add CLI commands for managing Docker containers used by agents:
      
      - prlt docker list - Show containers from agent_work table with status
      - prlt docker clean - Remove orphaned containers (containers without running agents)
      - prlt docker status - Check if Docker daemon is running
      
      Related to TKT-046 (Docker availability check).

- [ ] **tkt-046-tkt-046-add-docker-availability-check-before-container-operations** [[tkt-046-tkt-046-add-docker-availability-check-before-container-operations]] **TKT-046** [[TKT-046]] Add Docker availability check before container operations
      **Category:** fix
      ***
      Check if Docker daemon is running before executing any Docker commands (container create, remove, exec, etc.). Provide clear error message if Docker is not available instead of failing with confusing errors.

## Done

- [ ] **tkt-040-tkt-040-implement-linear-style-ticket-states** [[tkt-040-tkt-040-implement-linear-style-ticket-states]] **TKT-040** [[TKT-040]] Implement Linear-style ticket states
      **Category:** refactor
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/62
      ***
      ## Original Goal
      Update ticket states to follow Linear pattern with StateCategory (fixed semantic buckets) and customizable Status per project.
      
      ## Completed
      
      ## Testing
      1. `prlt action` - interactive menu with selectable actions
      2. `prlt action create` - interactive mode (prompts for all fields)
      3. `prlt action update groom` - interactive mode with current values
      4. `prlt action run --action groom --all` - bulk action preview
      5. `prlt status template` - workflow status templates menu
      6. `prlt phase template` - project phase templates menu
      7. `prlt template status` - alias works (redirects to status:template)
      8. `prlt template phase` - alias works (redirects to phase:template)
      9. `prlt template` - dropdown to choose status or phase templates
      10. `prlt status list` - show workflow statuses
      11. `pnpm test -- --grep "PMO Action Commands"` - run e2e tests
      - [x] StateCategory type: backlog, unstarted, started, completed, canceled
      - [x] Status table (pmo_statuses) with project scoping
      - [x] WorkflowTemplate table (pmo_templates) with built-in templates
      - [x] Template CLI: `prlt status template list|apply|save`
      - [x] Phase template CLI: `prlt phase template list|apply|save`
      - [x] Status CLI: `prlt status list|create|update|move|delete` + interactive menu
      - [x] WorkAction system for reusable agent prompts
      - [x] Action CLI: `prlt action list|show|create|update|delete` + interactive menu
      - [x] Action create/update interactive modes (no flags required)
      - [x] Bulk action command: `prlt action run`
      - [x] Branch persistence on tickets (reused across actions)
      - [x] Interactive branch detection in `work start`
      - [x] E2E tests for action commands (30 tests)
      - [x] Migrate ticket.status to ticket.status_id (foreign key)
      - [x] Template aliases: `prlt template status` -> `prlt status template`
      - [x] Template aliases: `prlt template phase` -> `prlt phase template`
      - [x] Plural aliases: prlt actions, prlt statuses

- [ ] **tkt-052-tkt-052-require-explicit-confirmation-to-run-agents-on-host-when-docker-unavailable** [[tkt-052-tkt-052-require-explicit-confirmation-to-run-agents-on-host-when-docker-unavailable]] **TKT-052** [[TKT-052]] Require explicit confirmation to run agents on host when Docker unavailable
      **Category:** fix
      ***
      Currently `work spawn` silently falls back to host execution when Docker isn't running, with just a warning message that's easy to miss.
      
      Current behavior:
      - Shows warning: 'Docker is not running. Agents will run on host instead of devcontainer.'
      - Continues with host execution without confirmation
      
      Expected behavior:
      - When Docker not running, prompt: 'Docker is not running. Run on host without sandbox? (y/N)'
      - Default to 'No' to prevent accidental unsandboxed execution
      - Or require explicit --run-on-host flag like `work start` does
      
      This is a security concern - users should explicitly opt-in to unsandboxed execution.

- [ ] **tkt-053-tkt-053-add-commit-namespaceprefix-configuration** [[tkt-053-tkt-053-add-commit-namespaceprefix-configuration]] **TKT-053** [[TKT-053]] Add commit namespace/prefix configuration
      **Category:** feature
      ***
      Allow users to configure a namespace or prefix for commits made by agents.
      
      Examples:
      - `[prlt]` prefix: `[prlt] feat: add user authentication`
      - `[agent:altman]` prefix: `[agent:altman] fix: resolve login bug`
      - Custom format: `{namespace} {type}: {message}`
      
      This helps identify agent-generated commits in git history and makes filtering/searching easier.
      
      Configuration could be in:
      - Workspace settings: `prlt config set commit.namespace '[prlt]'`
      - Per-agent override if needed
      
      Consider:
      - Should namespace include agent name? e.g., `[prlt:altman]`
      - Should it be configurable per-project?
      - Format string template for flexibility

- [ ] **tkt-054-tkt-054-update-branch-naming-to-include-human-coder-name** [[tkt-054-tkt-054-update-branch-naming-to-include-human-coder-name]] **TKT-054** [[TKT-054]] Update branch naming to include human coder name
      **Category:** feature
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/70
      ***
      Adjust branch creation to include the human coder's name (the person who owns the HQ/spawned the agent), optionally with agent name.
      
      Current format:
      `{type}/{agent}/{ticket-id}-{slug}`
      e.g., `feat/altman/TKT-040-implement-auth`
      
      Proposed options:
      1. Human only: `{type}/{human}/{ticket-id}-{slug}`
         e.g., `feat/chris/TKT-040-implement-auth`
      
      2. Human + agent: `{type}/{human}/{agent}/{ticket-id}-{slug}`
         e.g., `feat/chris/altman/TKT-040-implement-auth`
      
      3. Configurable: let user choose format
      
      Benefits:
      - Clearer ownership in shared repos
      - Easier to filter branches by human owner
      - Agent name becomes optional detail
      
      Implementation:
      - Add `coder.name` or `user.name` to workspace config
      - Update `generateBranchName()` in execution/types.ts
      - Consider git config user.name as default

- [ ] **tkt-043-tkt-043-implement-cross-entity-dependencies** [[tkt-043-tkt-043-implement-cross-entity-dependencies]] **TKT-043** [[TKT-043]] Implement cross-entity dependencies
      **Category:** feature
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/61
      ***
      Create unified dependency system that works across entity types: specs can depend on specs, tickets can depend on tickets, and potentially cross-entity dependencies.

- [ ] **tkt-085-tkt-085-retro-tkt-042-make-themes-optional-and-customizable** [[tkt-085-tkt-085-retro-tkt-042-make-themes-optional-and-customizable]] **TKT-085** [[TKT-085]] RETRO: TKT-042 - Make themes optional and customizable
      **Category:** docs
      ***
      ## Summary
      Revised MVP simplification to keep themes but make them optional. Users can create agents with simple names OR pick from themed name pools. Fixed critical database migration and path resolution bugs.
      
      ## What Was Built
      - Theme database tables (agent_themes, agent_theme_names) with CRUD operations
      - Workspace-level active theme (active_theme_id) with auto-detection from existing agents
      - Theme commands: themes list, themes create, themes add-names, themes set
      - Updated agents add to use workspace's active theme for interactive selection
      - Database migration from old schema (theme NOT NULL, status) to new schema (theme_id nullable)
      - Fixed agent path resolution to use database worktree paths as source of truth
      
      ## Files Changed
      - apps/cli/src/lib/database/index.ts - Theme tables, migration, getActiveTheme, setActiveTheme, getAgentWorktrees
      - apps/cli/src/lib/themes.ts - BUILTIN_THEMES constant, ensureBuiltinThemes(), DEFAULT_AGENTS_DIR='staff'
      - apps/cli/src/commands/agents/add.ts - Workspace theme integration, --theme flag
      - apps/cli/src/commands/agents/themes/*.ts - New list, create, add-names, set commands
      - apps/cli/src/lib/agents/commands.ts - getAgentStatus now uses database worktree paths
      - apps/cli/src/lib/init/index.ts - Sets active theme during HQ initialization
      
      ## Decisions Made
      - Themes optional: simple names work, themes add personality if wanted
      - One active theme per workspace (not mix-and-match)
      - Case-insensitive uniqueness, case-preserving display
      - Database agent_worktrees is source of truth for agent locations
      - Built-in themes seeded lazily on first use
      
      ## Bugs/Issues Discovered
      - Migration failed silently due to foreign key constraints - needed to drop indexes first and use PRAGMA foreign_keys=OFF
      - DEFAULT_AGENTS_DIR changed from 'staff' to 'agents' broke existing workspaces
      - Old database had wrong worktree paths stored (missing -agentname suffix)
      - PMO schema missing depends_on_ticket_id column (from TKT-043 merge conflict)
      
      ## Follow-up Tickets Created
      - TKT-083: Show active tickets when removing agents
      
      ## Context for One-Shot Implementation
      If someone needed to implement this again from scratch, they would need to know:
      - Migration must: disable foreign keys, drop old indexes, CREATE new table, INSERT from old, DROP old, ALTER RENAME new
      - Agent directory paths must come from agent_worktrees table, not assumed from DEFAULT_AGENTS_DIR constant
      - Worktree path format is "agents/{dir}/{agent}/{repo}-{agent}" - derive agent dir with path.dirname()
      - Test with existing workspace that has agents in different locations than code expects
      
      ## Back-and-forth Count
      ~10 exchanges - could have been ~3 with upfront context about existing workspace structure and database state

- [ ] **tkt-086-tkt-086-retro-tkt-043-cross-entity-dependency-system** [[tkt-086-tkt-086-retro-tkt-043-cross-entity-dependency-system]] **TKT-086** [[TKT-086]] RETRO: TKT-043 - Cross-entity dependency system
      **Category:** docs
      ***
      ## Summary
      Implemented a comprehensive cross-entity dependency and relationship system for the PMO, allowing tickets, epics, specs, and projects to be linked with reconciliation logic when specs conflict.
      
      ## What Was Built
      - Same-entity dependencies: ticket↔ticket, epic↔epic, spec↔spec blocking relationships
      - Spec assignments: ticket→spec (one-to-one), epic→spec (one-to-one)
      - Project↔spec many-to-many relationships (specs as global living documents)
      - Move commands: ticket/epic can move between projects
      - Bulk operations: tickets spec, tickets project
      - Spec reconciliation: warns when ticket/epic specs conflict, offers to align
      - Blocker check in work start command
      - Interactive menus updated for all entity types
      
      ## Files Changed
      - src/lib/pmo/schema.ts - Added pmo_project_specs table
      - src/lib/pmo/storage-sqlite.ts - Added linkProjectToSpec, unlinkProjectFromSpec, getSpecsForProject, getProjectsForSpec
      - src/lib/pmo/types.ts - Added interface methods for project-spec
      - src/commands/ticket/spec.ts - NEW: assign spec to ticket with epic reconciliation
      - src/commands/ticket/project.ts - NEW: move ticket to different project
      - src/commands/epic/spec.ts - NEW: assign spec to epic with ticket reconciliation
      - src/commands/epic/project.ts - NEW: move epic to project (with --with-tickets)
      - src/commands/project/spec.ts - NEW: manage project↔spec many-to-many
      - src/commands/tickets/spec.ts - NEW: bulk assign tickets to spec
      - src/commands/tickets/project.ts - NEW: bulk move tickets to project
      - src/commands/epic/ticket.ts - Added reconciliation when ticket joins epic
      - src/commands/project/*.ts - Fixed database path resolution (getPMOContext)
      - test/e2e/pmo-cross-entity-commands.test.ts - NEW: e2e tests
      
      ## Decisions Made
      - Specs are global living documents (not project-scoped) - hence many-to-many with projects
      - Ticket/Epic each have single spec (one-to-one) not array
      - Reconciliation prompts user rather than auto-fixing - user decides how to handle conflicts
      - Moving entities between projects unlinks from epics in source project
      - Used getPMOContext() consistently instead of manual path resolution
      
      ## Bugs/Issues Discovered
      - Project commands used path.dirname(pmoPath) which fails when PMO is nested (e.g., repos/proletariat/pmo)
      - Old database schema had specs.path as NOT NULL - needed migration
      - PMOError constructor args were in wrong order in some places
      - Pre-existing e2e test environment issues (CLI not executing properly in tests)
      
      ## Follow-up Tickets Created
      - TKT-079: Make spec types configurable
      - TKT-080: Add e2e testing infrastructure for interactive prompts
      - TKT-081: Create base command class or hook for getPMOContext initialization
      
      ## Context for One-Shot Implementation
      If someone needed to implement this again from scratch, they would need to know:
      - getPMOContext() is the correct way to get storage - never manually construct paths from findPMO()
      - Specs are global, not project-scoped - the many-to-many pmo_project_specs table links them
      - Reconciliation should happen bidirectionally: when assigning ticket to epic AND when assigning spec to ticket/epic
      - When moving entities between projects, handle epic associations (prompt to unlink or move together)
      - Interactive commands should work with args (prlt ticket spec TKT-001 SPEC-001) AND without (prompts for selection)
      
      ## Back-and-forth Count
      ~25 exchanges - could have been ~10 with better upfront context about entity relationship design (spec global vs project-scoped) and the existing getPMOContext pattern

- [ ] **tkt-081-tkt-081-create-base-command-class-or-hook-for-getpmocontext-initialization** [[tkt-081-tkt-081-create-base-command-class-or-hook-for-getpmocontext-initialization]] **TKT-081** [[TKT-081]] Create base command class or hook for getPMOContext initialization
      **Priority:** MEDIUM
      **Category:** refactor
      ***
      Currently every PMO command manually calls getPMOContext() with similar boilerplate:
      
      ```typescript
      const { storage, pmoPath } = await getPMOContext(
        flags.project,
        (msg) => this.log(styles.muted(msg)),
        true
      );
      ```
      
      This is repeated in 20+ commands and led to bugs when some commands used incorrect path resolution.
      
      Options:
      1. Base command class (e.g., PMOCommand) that handles initialization in init() hook
      2. oclif prerun hook that sets up context
      3. Decorator pattern
      
      Benefits:
      - DRY - remove boilerplate from every command
      - Consistency - all commands use same initialization
      - Fewer bugs - centralized path resolution logic
      - Easier testing - mock context in one place
      
      Acceptance criteria:
      - PMO commands extend base class or use hook
      - storage and pmoPath available without manual setup
      - Proper cleanup in finally/error handlers
      - Document pattern for new commands
