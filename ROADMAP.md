# PRLT Roadmap

Generated from PMO database. Source of truth: `workspace.db`

---

## MVP Launch

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-119 | Local dev testing workflow (pnpm scripts + PRLT_HOME) | backlog | P0 | feature | **Problem**: When dogfooding prlt to build prlt with multiple agent worktrees on different feature branches, testing is difficult. Global `npm link` installs overwrite each other, and all agents sh... |
| TKT-120 | Workspace discovery creates multiple isolated PMOs | backlog | P0 | bug | **Problem**: Running `prlt` from different directories creates separate `.proletariat/workspace.db` databases, each with isolated tickets, boards, agents, etc. User sees different data depending on... |
| TKT-121 | Documentation and README | backlog | P0 | docs | Getting started guide, feature overview, examples. Can't adopt what you can't understand. Critical for beta launch. |
| TKT-123 | Flexible workspace init (remove HQ folder convention) | backlog | P0 | feature | Currently requires `-hq` suffix and specific folder structure. Should support: `prlt init` in any directory, no naming conventions required. Global config (~/.proletariat/config.json) can track mul... |
| TKT-143 | Linux and Windows support | backlog | P0 | feature | Add full cross-platform support for Linux and Windows alongside current macOS support. **Current state**: prlt is developed and tested primarily on macOS. Many commands use macOS-specific paths, sh... |
| TKT-114 | Fix better-sqlite3 native module build issues | backlog | P1 | bug | ## Problem  CLI fails with `dlopen(...better_sqlite3.node...): not a mach-o file` or similar native module errors. The compiled `.node` binary is incompatible with current Node.js version or CPU ar... |
| TKT-122 | Installation comparison guide (npm vs Homebrew vs binary) | backlog | P1 | docs | Create comprehensive guide explaining different installation methods and when to use each. **Problem**: Users unfamiliar with CLI distribution will be confused by multiple install options (npm, bre... |
| TKT-124 | Landing page | backlog | P1 | docs | Simple landing page. What is prlt, why use it, quick start, link to docs/GitHub. Can be GitHub Pages or dedicated site. First touchpoint for discovery. |
| TKT-125 | Demo video | backlog | P1 | docs | Short video showing prlt in action - spawn agents, work on tickets, create PRs. Visual proof it works. |
| TKT-126 | Graceful Ctrl+C exit | backlog | P1 | bug | Smooth shutdown, no stack traces. Clean exit handling. First impressions matter. |
| TKT-127 | Feedback mechanism | backlog | P1 | feature | `prlt feedback` command to create GitHub issues directly from CLI. Opens issue creation page in browser with pre-filled template including system context (OS, version, last command). Phase 1: brows... |
| TKT-129 | Star from CLI | backlog | P1 | feature | `prlt star` command and first-run prompt to star the repo on GitHub. Growth hack: prompt after successful `prlt init` with "⭐ Star prlt on GitHub? (helps others discover it)". Phase 1: opens browse... |
| TKT-130 | View and vote on roadmap from CLI | backlog | P1 | feature | Let users see what's coming and vote on features directly from CLI. **Commands**: (1) `prlt roadmap` or `prlt roadmap list` - Display upcoming features from ROADMAP.md, grouped by project, color-co... |
| TKT-131 | Usage analytics (Statsig/PostHog) | backlog | P1 | feature | Integrate Statsig or PostHog for command usage analytics. What commands are used, success rates, feature adoption. Privacy-respecting (opt-in or anonymized). Critical for understanding what to buil... |
| TKT-132 | Error tracking (Sentry) | backlog | P1 | feature | Integrate Sentry for error tracking. Capture unhandled exceptions, failed commands, stack traces. Context: command, args, environment. Privacy-respecting. Essential for debugging issues in production. |
| TKT-136 | Standardize command structure (singular + flags) | backlog | P1 | refactor | Remove plural command directories (agents/, tickets/, works/, etc.) - keep only singular. Replace spawn-all with `spawn --all` flag. Consolidate batch operations as flags (--all, --column) not sepa... |
| TKT-137 | Define agent work completion criteria | backlog | P1 | feature | Define when agent work is considered "done" and what happens to agent/container/ticket status. **Questions to resolve during implementation**: (1) Ticket status updates: When agent creates PR, auto... |
| TKT-046 | Add Docker availability check before container operations | backlog | P2 | bug | Check if Docker daemon is running before executing any Docker commands (container create, remove, exec, etc.). Provide clear error message if Docker is not available instead of failing with confusi... |
| TKT-052 | Require explicit confirmation to run agents on host when Docker unavailable | backlog | P2 | bug | Currently `work spawn` silently falls back to host execution when Docker isn't running, with just a warning message that's easy to miss.  Current behavior: - Shows warning: 'Docker is not running. ... |
| TKT-128 | CLI-native support chat and help system | backlog | P2 | feature | In-terminal AI-powered support chat for instant help - "Intercom for CLI". **Vision**: First CLI tool with built-in real-time support. Users get instant answers without leaving terminal, you learn ... |
| TKT-133 | Auto-upgrade notification | backlog | P2 | feature | Check for new versions on startup. Suggest `prlt upgrade` if behind. Non-intrusive banner. Keeps users on latest version without forcing updates. |
| TKT-134 | Better error messages | backlog | P2 | chore | More helpful error messages throughout CLI. Polish for launch. |
| TKT-135 | Interactive "what's next?" prompts after commands | backlog | P2 | feature | After completing an action, prompt user with suggested next steps to keep momentum. **Examples**: (1) After `prlt ticket create`: "Ticket TKT-001 created. What next? [Assign to agent / Create anoth... |
| TKT-138 | PR and branch status sync via polling | backlog | P2 | feature | Auto-sync ticket and agent status based on GitHub state using polling (like `gh` CLI). Add `prlt sync` command with two responsibilities: (1) **PR status sync**: Poll GitHub API to check PR status ... |
| TKT-139 | Backtest ticket quality (training data generation) | backlog | P2 | feature | Generate training data for improving ticket quality by comparing original tickets to final merged code. **Goal**: Create self-sufficient tickets that agents can complete autonomously without human ... |
| TKT-140 | AI-assisted backlog refinement/grooming | backlog | P2 | feature | **[PLACEHOLDER - BRAINSTORMING]** AI-powered command to refine and groom backlog tickets. **Potential features**: (1) `prlt refine` or `prlt groom` command that analyzes backlog tickets. (2) Identi... |
| TKT-141 | Agent conversation trajectory logging | backlog | P2 | feature | Capture full agent conversation history for training data and ticket quality analysis. **Goal**: Build dataset of (ticket → conversation → outcome) trajectories to power RL-based ticket optimizatio... |

## Credibility & Polish

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-057 | Audit all CLI commands for interactive mode support | started | P2 | feature | Audit all commands to ensure flags have corresponding interactive prompts when the command is run without flags. Pattern: if a command requires flags, running without flags should enter interactive... |
| TKT-075 | E2E tests should use isolated test PMO/database | started | P2 | test | ## What E2E tests should run against isolated test data, not pollute the real workspace.db.  ## Done when  ## Context Found 10+ test projects (My New Project, Flag Project, Custom ID, etc.) created... |
| TKT-144 | Public issues board | backlog | P1 | docs | GitHub Issues enabled and organized. Public roadmap, bugs, feature requests. Shows transparency, active development. Let community contribute/vote on features. |
| TKT-145 | Public roadmap board | backlog | P1 | docs | GitHub Projects board showing roadmap visually. This ROADMAP.md as a living board. Public visibility into what's next. Builds trust. |
| TKT-234 | E2E tests for tickets (bulk operations) command namespace | backlog | P1 | test | Add E2E tests for the tickets/ command namespace (bulk operations).  **Test cases:** 1. Direct sub-command invocation: `prlt tickets list --project X` 2. Interactive menu delegation: `prlt tickets`... |
| TKT-238 | E2E test pattern: interactive menu → sub-command delegation | backlog | P1 | test | Create reusable test pattern/helper for testing interactive menu commands that delegate to sub-commands.  **Problem:** Multiple bugs have occurred where interactive menu index commands (tickets, st... |
| TKT-058 | Fix skipped E2E tests for unimplemented CLI features | backlog | P2 | chore | Multiple E2E test files were skipped because they test commands that don't exist or have environment issues:  ## Skipped Test Files  1. **pmo-board-commands.test.ts** - Tests for board view, markdo... |
| TKT-084 | Add ESLint and TypeScript linting configuration | backlog | P2 | chore | ## What Add ESLint with TypeScript support for consistent code quality and style.  ## Done when  ## Context No linting currently configured. Would help catch issues before runtime and maintain cons... |
| TKT-146 | Logo and branding | backlog | P2 | chore | Professional appearance for first impressions. Logo, consistent colors, consistent visual identity. |
| TKT-147 | Test coverage | backlog | P2 | test | Visible test suite builds trust. Unit tests, integration tests, e2e tests for core flows. |
| TKT-148 | Changelog | backlog | P2 | docs | Track releases, show active development. CHANGELOG.md with semver releases. |
| TKT-149 | Competitor landscape/leaderboard | backlog | P2 | docs | Public list of tools in the multi-agent orchestration space. Not competitive - educational. "Here's who's building in this space." Signals awareness, confidence. Could be page on site or curated aw... |
| TKT-150 | Content calendar for LI/Threads/Blog | backlog | P2 | docs | Plan content cadence with detailed feature explanations for each prlt capability. **Content types**: (1) **Feature explainers** - One post per feature explaining what it does, why it matters, how t... |
| TKT-235 | E2E tests for status command namespace | backlog | P2 | test | Add E2E tests for the status/ command namespace.  **Test cases:** 1. `prlt status list` - lists workflow statuses 2. `prlt status create` - creates new status 3. `prlt status update` - updates exis... |
| TKT-236 | E2E tests for gh command namespace | backlog | P2 | test | Add E2E tests for the gh/ command namespace (GitHub CLI wrapper).  **Test cases:** 1. `prlt gh status` - shows GitHub auth status 2. `prlt gh login` - initiates GitHub login flow 3. `prlt gh token`... |
| TKT-237 | E2E tests for repo/repos command namespace | backlog | P2 | test | Add E2E tests for the repo/ and repos/ command namespaces.  **Test cases:** 1. `prlt repo list` - lists configured repos 2. `prlt repo add` - adds repo to workspace 3. `prlt repo remove` - removes ... |
| TKT-037 | Improve error messages in work start | backlog | P3 | bug | Add more descriptive error messages when work start fails due to missing agent or container issues |
| TKT-080 | Add e2e testing infrastructure for interactive prompts | backlog | P3 | feature | Currently e2e tests bypass interactive prompts by using command-line flags. To properly test interactive flows (inquirer prompts), we need testing infrastructure that can simulate user input.  Opti... |
| TKT-151 | Testimonials and case studies | backlog | P3 | docs | Social proof. "I used prlt to build X" stories. Even self-testimonial of dogfooding prlt to build prlt. Collect user stories as adoption grows. |

## Open Ecosystem

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-078 | Agent branches should default to branching from main | started | P2 | bug | ## What When spawning agent work, new branches should be created from main by default, not from the current branch.  ## Done when  ## Context TKT-054 was spawned while on branch rfct/andreesen/TKT-... |
| TKT-152 | GitHub Issues integration | backlog | P1 | feature | Sync prlt with GitHub Issues. Commands: `prlt github connect`, `sync`, `import`, `export`. Map: tickets ↔ issues, statuses ↔ labels/state. Bidirectional sync - work on GH issues via prlt, auto-upda... |
| TKT-153 | Linear integration | backlog | P1 | feature | Sync tickets/projects with Linear. Commands: `prlt linear connect`, `sync`, `import`, `export`. Map: tickets ↔ issues, statuses ↔ workflow states, projects ↔ projects. Bidirectional sync. Modern te... |
| TKT-154 | GitLab Issues integration | backlog | P1 | feature | Sync prlt with GitLab Issues. Commands: `prlt gitlab connect`, `sync`, `import`, `export`. Similar to GitHub integration but with richer feature set: issue weights, time tracking, dependencies, epi... |
| TKT-155 | Multi-provider agent support (Codex, Gemini CLI) | backlog | P1 | feature | Support spawning agents with different AI backends beyond Claude Code. Codex CLI (OpenAI), Gemini CLI (Google), others. Agent config specifies provider. Devcontainer setup per provider. Key for ado... |
| TKT-156 | MCP server for prlt | backlog | P1 | feature | Expose prlt as an MCP tool. Other AI agents can create tickets, spawn work, check status. Meta: agents orchestrating agents. |
| TKT-161 | Open source strategy and auto-publish to public repo | backlog | P1 | feature | Investigate and implement open source publishing workflow for prlt CLI. **Goals**: (1) Make prlt publicly available as open source. (2) Automate syncing from private dev repo to public repo. (3) Ch... |
| TKT-039 | Implement event-based hooks for auto-spawn | backlog | P2 | feature | Add hooks system that triggers on events like ticket.created, ticket.moved, ticket.status_changed. Hooks would fire inline when CLI commands run (no server needed). Config via .proletariat/hooks.ya... |
| TKT-053 | Add commit namespace/prefix configuration | backlog | P2 | feature | Allow users to configure a namespace or prefix for commits made by agents.  Examples: - `[prlt]` prefix: `[prlt] feat: add user authentication` - `[agent:altman]` prefix: `[agent:altman] fix: resol... |
| TKT-054 | Update branch naming to include human coder name | backlog | P2 | feature | Adjust branch creation to include the human coder's name (the person who owns the HQ/spawned the agent), optionally with agent name.  Current format: `{type}/{agent}/{ticket-id}-{slug}` e.g., `feat... |
| TKT-077 | Add prlt git helper commands | backlog | P2 | feature | ## What Add git helper commands to prlt for common workflows, inspired by dotfiles aliases.  ## Done when       - Type picker (feat, fix, rfct, etc.)       - Optional coder/agent name       - Kebab... |
| TKT-107 | Configurable default branch for agent work | backlog | P2 | feature |  |
| TKT-109 | Simplify branch naming convention (remove coder/agent name) | backlog | P2 | feature |  |
| TKT-110 | Simplify commit message format (remove coder/agent name) | backlog | P2 | feature |  |
| TKT-157 | Import/export (CSV, JSON) | backlog | P2 | feature | Get data in/out easily. Export tickets/projects to CSV/JSON. Import from other tools. Reduces lock-in. |
| TKT-158 | Plugin/extension system | backlog | P2 | feature | Let others add providers, integrations, custom commands. Plugin API, discovery, loading. Key for ecosystem growth. |
| TKT-159 | Webhook support | backlog | P2 | feature | Trigger prlt from external events. Receive webhooks for ticket updates, PR merges, etc. Enables automation. |
| TKT-160 | API for programmatic access | backlog | P2 | feature | REST or gRPC API beyond CLI. Enables integrations, dashboards, custom tooling. |
| TKT-162 | Extract trajectory SDK for cross-platform RLHF | backlog | P2 | feature | Extract conversation trajectory logging into standalone SDK (`@proletariat/trajectory-sdk`) that other agent orchestration tools can integrate. **Vision**: Create cross-platform data network for RL... |

## Extensibility

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-163 | Hooks/callbacks on events | backlog | P2 | feature | Run custom scripts on events: ticket created, PR merged, agent started, etc. `prlt.hooks.js` or config-based. |
| TKT-164 | Template system | backlog | P2 | feature | Ticket templates, spec templates, agent templates. Reduce boilerplate, enforce standards. |
| TKT-165 | Config file (.prltrc) | backlog | P2 | feature | Project-level config file for customization. `.prltrc` or `prlt.config.js`. Defaults, hooks, preferences. |
| TKT-166 | Custom commands | backlog | P3 | feature | User-defined commands via `prlt x mycommand`. Scripting interface for custom workflows. |
| TKT-167 | Workflow automation (YAML scripts) | backlog | P3 | feature | Define multi-step workflows in YAML. `prlt run-workflow deploy.yaml`. Chain commands, conditionals, parallel steps. Like GitHub Actions but for prlt operations. |

## Core PMO Refinement

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-055 | Update work commands to use new status model | started | P2 | feature | After TKT-040 (Linear-style ticket states) lands, update work/spawn/start commands to use the new status model instead of the current column/status hybrid.  Changes needed: - Remove ticket.column f... |
| TKT-225 | Refactor: Projects reference workflows instead of owning statuses | backlog | P0 | refactor | Workflow becomes a first-class primitive. Current: each project has its own copy of statuses (50 rows for 10 projects with identical workflows). New model: pmo_workflows table with statuses, projec... |
| TKT-090 | Bug Report Example | backlog | P1 | bug | ## What\nFix the login page bug\n\n## Done when\n- [ ] Bug is fixed\n- [ ] Tests added |
| TKT-091 | Login page crashes on invalid input | backlog | P1 | bug | ## What\nFix the login page bug\n\n## Done when\n- [ ] Bug is fixed\n- [ ] Tests added |
| TKT-117 | Fix ticket link command - NOT NULL constraint on relates | backlog | P1 | bug | ## Problem  The `prlt ticket link relates` command fails with:  ``` SqliteError: NOT NULL constraint failed: pmo_ticket_dependencies.blocked_by_ticket_id ```  ## Root Cause  The `pmo_ticket_depende... |
| TKT-168 | Configurable workflow statuses | backlog | P1 | feature | Allow users to configure and customize workflow statuses per project instead of using hardcoded statuses. **Current state**: Fixed statuses (Backlog, Planned, In Progress, Done, Canceled) from TKT-... |
| TKT-169 | Board views (one board + multiple views) | backlog | P1 | feature | Decouple views from board concept. One ticket pool per project with project-level statuses (not team-level like Linear - projects own their workflow, people rotate across projects). Multiple view t... |
| TKT-170 | Add notes/comments to specs and tickets | backlog | P1 | feature | No place to capture discussion/decisions attached to work items. Need activity log or comment system. |
| TKT-223 | Cross-project ticket list view | backlog | P1 | feature | Add --all flag to ticket list command to show tickets across all projects. Currently ticket list only shows tickets for the current/specified project. Users need a global view to see everything at ... |
| TKT-224 | Fix excessive project prompts (double prompt + ignored promptIfMultiple flag) | backlog | P1 | bug | Two related bugs causing excessive project prompts:  **Bug 1: Double prompt in interactive menus** When interactive index commands (status, ticket, epic, etc.) call sub-commands via config.runComma... |
| TKT-226 | Repurpose prlt status as dashboard command (like git status) | backlog | P1 | feature | After TKT-225 (workflow primitive), repurpose the status namespace. prlt status shows current state: working ticket, branch, project, in-progress items, assigned items. Like git status for your wor... |
| TKT-227 | Add position field for manual ordering | backlog | P1 | feature | Add position field to tickets and projects for manual ordering. Ticket sorting (4-level hierarchy): ORDER BY status_position, position, priority, created_at. Schema changes: pmo_tickets ADD positio... |
| TKT-229 | Replace all ID text inputs with dropdown/list selection | backlog | P1 | bug | Problem: Multiple commands require typing IDs from memory instead of selecting from a list. This is poor UX - users should never have to remember IDs.  **Examples found:** - `prlt status` → "Status... |
| TKT-040 | Implement Linear-style ticket states | backlog | P2 | refactor | ## Original Goal Update ticket states to follow Linear pattern with StateCategory (fixed semantic buckets) and customizable Status per project.  ## Completed  ## Testing 1. `prlt action` - interact... |
| TKT-043 | Implement cross-entity dependencies | backlog | P2 | feature | Create unified dependency system that works across entity types: specs can depend on specs, tickets can depend on tickets, and potentially cross-entity dependencies. |
| TKT-044 | Refactor board for one board + views | backlog | P2 | refactor | Adopt Linear/Notion model: one board with multiple views (kanban, list, etc.) instead of multiple boards. Depends on Linear-style ticket states being implemented first. |
| TKT-045 | Refactor projects to use board views | backlog | P2 | refactor | Update project system to use board views instead of separate boards per project. Depends on board refactor being completed first. |
| TKT-056 | Implement ticket templates | backlog | P2 | feature | Add ability to create ticket templates that can be used to quickly create common ticket types. Should include: create template from existing ticket, list available templates, create ticket from tem... |
| TKT-067 | Implement list view renderer | backlog | P2 | feature | Add a compact vertical list view for the board. Shows tickets as single lines with key info (ID, title, priority, assignee). Good for quick scanning and dense information display. Part of the Linea... |
| TKT-068 | Implement table view renderer | backlog | P2 | feature | Add an ASCII table view for the board. Shows tickets in a spreadsheet-like format with sortable columns (ID, title, status, priority, assignee, dates). Useful for detailed analysis and bulk review.... |
| TKT-070 | Implement Eisenhower matrix view renderer | backlog | P2 | feature | Add an Eisenhower matrix (urgent/important quadrant) view for the board. Organizes tickets into four quadrants: Q1 Urgent+Important (Do First), Q2 Not Urgent+Important (Schedule), Q3 Urgent+Not Imp... |
| TKT-074 | Add commands to move tickets/specs/epics between projects | backlog | P2 | feature | ## What Add CLI commands to move PMO entities between projects.  ## Done when  ## Context Currently no way to reorganize content between projects. Had to manually update DB to consolidate Board int... |
| TKT-079 | Make spec types configurable | backlog | P2 | feature | Currently spec types are hardcoded in types.ts as: 'product' - 'platform' - 'infra' - 'integration'. Should be configurable per workspace/project, similar to how workflow statuses are configurable. |
| TKT-087 | Add ticket search functionality | backlog | P2 | feature | Add ability to search for tickets by ID, title, or description. This would help users quickly find tickets in large projects without scrolling through lists. |
| TKT-093 | Auto-detect ticket ID from workspace DB or prompt user | backlog | P2 | feature | When prlt commit cannot parse ticket ID from branch name: 1. Look up the current agent's assigned ticket from workspace.db by matching cwd against known agent directories 2. If workspace lookup fai... |
| TKT-094 | Fix e2e test infrastructure - oclif command discovery from temp directories | backlog | P2 | bug | E2E tests are failing because oclif cannot discover commands when tests run from temp directories.  **Problem:** - Tests create temp directories and change to them with process.chdir() - When CLI c... |
| TKT-096 | Retro: TKT-053 - Commit command scope expansion | backlog | P2 | chore | ## Summary TKT-053 (commit namespace config) expanded significantly during implementation from a config feature to a full CLI command with 7 formats, interactive staging, and 6 flags.  ## Root Caus... |
| TKT-103 | blah | backlog | P2 | feature | ## What blah  ## Done when - [ ] blah - [ ] - [ ] |
| TKT-111 | Extract Data Access Layer (DAL) from storage-sqlite.ts | backlog | P2 | refactor | ## Problem  Database access is currently spread across multiple locations: - `storage-sqlite.ts` (main storage class, 5000+ lines - monolithic) - Direct `better-sqlite3` usage in commands (e.g., `c... |
| TKT-171 | Add labels system for flexible categorization | backlog | P2 | feature | Separate from priority. Labels for: categorization (bug, feature, ux, security), custom workflows (blocked, needs-review, quick-win). User-defined, flexible. Priority stays fixed levels, labels pro... |
| TKT-172 | Add effort/estimate field to tickets | backlog | P2 | feature | Story points, t-shirt sizes (S/M/L/XL), or time estimates. Helps with planning and velocity tracking. |
| TKT-173 | Ticket sorting and ordering | backlog | P2 | feature | Define consistent default sort order across views. Current inconsistency: Board uses column+position, ticket list uses title alphabetically, specs use position+created_at, epic selection uses statu... |
| TKT-174 | Project-level settings | backlog | P2 | feature | Implement or defer? Settings per project vs global. |
| TKT-175 | Roadmap/timeline as first-class entity | backlog | P2 | feature | Roadmap = collection of projects/phases with timeline. Like this ROADMAP.md file but in the PMO. `prlt roadmap create`, `roadmap list`, `roadmap show`. Projects belong to roadmap phases. Timeline v... |
| TKT-220 | Roadmap data model and markdown generation | backlog | P2 | feature | Problem: ROADMAP.md manually maintained, drifts from DB. Roadmap is ordered list of projects but no schema.  Data Model: - pmo_roadmaps: id, name, description, is_default - pmo_roadmap_projects: ro... |
| TKT-221 | Normalize ticket category field with validation | backlog | P2 | refactor | Problem: ticket.category is free-form text causing duplicates (feat/feature), typos, inconsistency.  Current categories in use: - feature, chore, refactor, bug, docs, test  NOTE: "retro" should NOT... |
| TKT-228 | Add --sequential/--parallel flag to work spawn | backlog | P2 | feature | Control whether multiple tickets are spawned sequentially or in parallel. --parallel (default): spawn all at once. --sequential: one at a time, wait for completion before spawning next. Useful for ... |
| TKT-069 | Implement calendar view renderer | backlog | P3 | feature | Add a calendar view for the board. Shows tickets organized by due date in a monthly/weekly calendar format. Requires tickets to have due dates. Useful for deadline tracking and sprint planning. Par... |
| TKT-071 | Implement timeline view renderer | backlog | P3 | feature | Add a timeline/Gantt chart view for the board. Shows tickets on a horizontal timeline with start/end dates, duration bars, dependency arrows (if dependencies are tracked), and milestone markers. Re... |
| TKT-072 | Implement gallery view renderer | backlog | P3 | feature | Add a gallery/card grid view for the board. Shows tickets as larger cards in a grid layout with title, description preview, status badge, assignee initials, priority indicator, and progress bar (if... |
| TKT-RETRO-084 | Retro: TKT-084 - ESLint/TypeScript Linting | backlog | P3 | retro | ## Summary Original scope was ESLint only. Added during implementation: - typecheck command (user request) - lint:all command (user request)   - Fix agent over-removal of imports  ## Root Cause - U... |

## Agent System

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-176 | Enforce one-ticket-per-container architecture | backlog | P0 | feature | **Decision**: Enforce 1:1 mapping of tickets to Docker containers in work spawning system. One ticket per container, not multiple tickets packed into single container. **Rationale**: (1) **Simplici... |
| TKT-106 | Refactor agent model: Slots, Executions, and Work Memory | backlog | P1 | feature | ## Problem  The current agent model conflates several concerns: - Agent as identity (named, assigned work, in branch names) - Agent as infrastructure (worktree, container) - Agent as execution (run... |
| TKT-177 | Claude Code wrapper for agent automation | backlog | P1 | feature | Create wrapper commands around Claude Code CLI to enable automated agent workflows and programmatic control. **Problem**: Need to orchestrate Claude Code agents programmatically - send prompts, wai... |
| TKT-233 | Enforce PR approvals for agent-created PRs | backlog | P1 | feature | Ensure Claude/agents cannot merge their own PRs without human approval.  **Problem**: Claude can merge PRs using `gh pr merge` if the token has write access, bypassing review requirements.  **Solut... |
| TKT-036 | Add unit tests for spawner module | backlog | P2 | test | Add comprehensive unit tests for the spawner.ts module including agent selection strategies |
| TKT-038 | Add --dry-run flag to spawn-all | backlog | P2 | feature | Add a dry-run mode to spawn-all command that shows what would be spawned without actually starting agents |
| TKT-041 | Consolidate work/spawn commands | backlog | P2 | refactor | Consolidate spawn command naming: work start [ticket] for single, work start --all for batch backlog, work spawn --column X for batch by column. Remove redundant spawn-all.ts. |
| TKT-042 | Simplify agents for MVP | backlog | P2 | refactor | Drop themes/status tracking for MVP. Simplify agent management to essential features only. |
| TKT-047 | Add Docker management CLI commands (prlt docker list/clean/status) | backlog | P2 | chore | Add CLI commands for managing Docker containers used by agents:  - prlt docker list - Show containers from agent_work table with status - prlt docker clean - Remove orphaned containers (containers ... |
| TKT-048 | Test PMO access in devcontainer | backlog | P2 | test | Simple test to verify PMO is properly mounted in devcontainer.  Task: 1. Run: prlt ticket list 2. Run: prlt ticket create --title 'Test from container' --column Backlog 3. Run: prlt ticket list (ve... |
| TKT-060 | Review work command naming: spawn vs start | backlog | P2 | feature | Now that spawn just calls start in a loop, review if separate commands make sense.  Current: - work start [ticket] - single ticket - work start --all - batch from backlog   - work spawn --column X ... |
| TKT-083 | Show active tickets when removing agents | backlog | P2 | feature | When running 'prlt agents remove', display any active ticket assignments for the agent before confirmation. Warn more prominently if agent has in-progress work to prevent accidentally removing an a... |
| TKT-105 | Default to tmux for batch spawn operations | backlog | P2 | feature | When spawning multiple agents via 'work spawn', default to tmux display mode instead of terminal tabs. This provides:  1. Cross-platform support (works on Linux, not just macOS) 2. Single place to ... |
| TKT-108 | Refactor: Share execution settings between work spawn and work start | backlog | P2 | feature |  |
| TKT-178 | Set terminal tab name when opening agent workspace | backlog | P2 | feature | When opening a new terminal for an agent workspace (via `prlt work open` or similar command), automatically set the terminal tab/window title to the agent name for easy identification. **Problem**:... |
| TKT-179 | Open IDE in agent workspace with preferred editor | backlog | P2 | feature | Command to open preferred IDE/editor in agent workspace directory with AI coding assistant activated. **Goal**: One command to jump into agent's workspace with full IDE setup, ready to review agent... |
| TKT-180 | Agent theme marketplace | backlog | P2 | feature | Community marketplace for sharing and discovering custom agent themes. **Vision**: Let users create, share, and install agent themes beyond built-in options (billionaires, etc.). Build community en... |
| TKT-182 | CD into agent directory command | backlog | P2 | feature | Command to quickly navigate into an agent's workspace directory. **Command**: `prlt agent cd <agent-name>` or `prlt work cd <agent-name>`. Changes current working directory to agent's worktree path... |
| TKT-230 | Agent templates with repo access control | backlog | P2 | feature | Define what repos an agent can access via templates.  **Concept**: Agent templates that specify which repos are mounted/accessible in the agent container or worktree.  **Example config:** ```yaml #... |
| TKT-231 | Agent profiles (config-based "Claude Images") | backlog | P2 | feature | Config profiles that define agent behavior - NOT full Docker images. Simpler, more flexible.  **What a profile defines:** 1. **Start hook** - What to do when session begins (load ticket context, se... |
| TKT-232 | Agent session hooks via settings.json injection | backlog | P2 | feature | Script start/stop behavior by injecting hooks into .claude/settings.json when spawning agents.  **Concept**: When prlt spawns an agent, inject custom hooks into the Claude Code settings.json that r... |
| TKT-181 | Agent status tracking | backlog | P3 | feature | Track working/idle/offline status. Deferred for MVP - can add later if needed. |

## Developer Experience

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-189 | Input validation for prlt commands | backlog | P1 | feature | Add comprehensive input validation across all prlt commands to catch errors early and provide helpful feedback. **Problem**: Currently commands may accept invalid inputs that fail later in executio... |
| TKT-076 | Support command aliases in prlt CLI | backlog | P2 | feature | ## What Add support for command aliases in prlt, similar to shell aliases in dotfiles.  ## Done when  ## Context Reference: ~/Projects/dotfiles/.aliases shows pattern of useful shortcuts: - gs (git... |
| TKT-081 | Create base command class or hook for getPMOContext initialization | backlog | P2 | refactor | Currently every PMO command manually calls getPMOContext() with similar boilerplate:  ```typescript const { storage, pmoPath } = await getPMOContext(   flags.project,   (msg) => this.log(styles.mut... |
| TKT-082 | Add ticket retrospective feature to capture implementation learnings | backlog | P2 | feature | ## What Add a retro feature to PMO that captures what was actually implemented, enabling better future tickets.  ## Done when  ## Context TKT-041 took ~40 back-and-forths that could have been ~5 wi... |
| TKT-085 | RETRO: TKT-042 - Make themes optional and customizable | backlog | P2 | docs | ## Summary Revised MVP simplification to keep themes but make them optional. Users can create agents with simple names OR pick from themed name pools. Fixed critical database migration and path res... |
| TKT-086 | RETRO: TKT-043 - Cross-entity dependency system | backlog | P2 | docs | ## Summary Implemented a comprehensive cross-entity dependency and relationship system for the PMO, allowing tickets, epics, specs, and projects to be linked with reconciliation logic when specs co... |
| TKT-112 | Add automated retrospective generation for completed tickets | backlog | P2 | feature | ## Problem  After tickets are completed, valuable learnings are lost. Retrospectives should capture what worked, what didnt, and spec improvements for future tickets.  ## Key Design Decision  Retro... |
| TKT-115 | Retro: TKT-057 - Interactive mode audit implementation | backlog | P2 | retro | ## Retrospective Analysis: TKT-057  **Related Ticket:** TKT-057 (Audit all CLI commands for interactive mode support)  ### What the Spec Asked For 1. Audit all CLI commands for interactive mode sup... |
| TKT-116 | Retro: TKT-075 - E2E test isolation refactor | backlog | P2 | retro | ## What the Spec Asked For Original requirement: E2E tests should use isolated test database, not pollute real workspace.db  ## What Was Actually Built 1. Environment variable isolation - clearing ... |
| TKT-118 | Retro: TKT-055 - Update work commands to use new status model | backlog | P2 | retro | Related ticket: TKT-055  ## What the Spec Asked For - Remove ticket.column field, use ticket.status_id only - Replace moveTicket with updateStatus - Remove fuzzy column name matching - Update filte... |
| TKT-183 | Auto-seed initial commit with ticket info | backlog | P2 | feature | When creating branch with ticket ID in name (e.g., `fix/agent/TKT-052-...`), automatically create initial commit with message "TKT-052: [ticket title]". Add `--seed-commit <message>` flag to overri... |
| TKT-184 | Git branch aliases for agent worktrees | backlog | P2 | feature | Set up git aliases in agent worktrees for common operations. Examples: `git co` → `git checkout`, `git st` → `git status`, `git br` → `git branch`. Configure via `.gitconfig` in each worktree or gl... |
| TKT-185 | Better input UX for description fields | backlog | P2 | feature | Replace vim-based description editing with better UX. Multi-line text input, inline editing, or prompts library. Vim opens in terminal and is jarring. Make it feel like modern CLI (inquirer.js style). |
| TKT-186 | Terminal color scheme and styling | backlog | P2 | feature | Implement consistent color scheme and styling across all CLI output. **Current state**: Inconsistent or minimal use of colors in terminal output. **Proposed**: Define cohesive color palette for: (1... |
| TKT-188 | Extract copy/strings to separate files for i18n | backlog | P2 | refactor | Refactor all user-facing strings (error messages, prompts, help text, CLI output) into centralized copy files for easier internationalization and content management. **Problem**: Currently strings ... |
| TKT-190 | Terminal style marketplace | backlog | P2 | feature | Community marketplace for sharing and discovering custom terminal styles/themes for prlt CLI output. **Vision**: Let users share complete visual styles (color schemes, formatting, icons, layout tem... |
| TKT-192 | React Ink migration | backlog | P2 | refactor | Explore migrating CLI output and prompts from chalk/inquirer to React Ink for unified component-based UI. **Current state**: Mixed use of chalk for styling, console.log for output, and inquirer for... |
| TKT-092 | Retro: TKT-054 - Underspecified ticket led to 15x scope expansion | backlog | P3 | chore | TKT-054 was scoped as ~50-100 lines but delivered +1,479 lines across 12 files.  Root causes: - No format decision (3 options proposed, none picked) - Missing UX flow specs - No acceptance criteria... |
| TKT-095 | Retro: TKT-054 - Underspecified ticket led to 15x scope expansion | backlog | P3 | chore | TKT-054 was scoped as ~50-100 lines but delivered +1,479 lines across 12 files. Root causes: no format decision (3 options proposed, none picked), missing UX flow specs, no acceptance criteria, no ... |
| TKT-102 | Retro: TKT-056 - Ticket Templates Implementation | backlog | P3 | retro | ## Original Scope (Inferred) The original ticket "TKT-056 - Implement ticket templates" likely specified: - Add ability to create tickets from templates - Basic template CRUD operations  ## Actual ... |
| TKT-104 | Retro: TKT-081 - PMOCommand base class migration scope was underspecified | backlog | P3 | retro | ## Summary  - Aspect - Original Ticket - Actual Implementation - --------------------------------------------------- - **Scope** - Create base class, migrate "some" commands - Created base class + ... |
| TKT-113 | Retro: TKT-075 - E2E test isolation refactor | backlog | P3 | retro | ## What the Spec Asked For  Original requirement: "E2E tests should use isolated test database, not pollute real workspace.db"  Acceptance criteria (implied): - Tests should not affect the real wor... |
| TKT-187 | Custom color scheme configuration | backlog | P3 | feature | Allow users to customize terminal color scheme via config file. **Depends on**: Terminal color scheme ticket (must have default scheme first). **Implementation**: Add `colors` section to `.prltrc` ... |
| TKT-191 | Progress indicators for long operations | backlog | P3 | feature | Show progress for operations like container builds, batch spawns. |

## Additional Integrations

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-193 | Jira integration | backlog | P2 | feature | Enterprise integration. Commands: `prlt jira connect`, `sync`, `import`, `export`. OAuth/API key setup, bidirectional sync. Map tickets ↔ issues, statuses ↔ workflow states. Required for enterprise... |
| TKT-194 | Shortcut integration | backlog | P3 | feature | Sync with Shortcut (formerly Clubhouse). Modern PM tool popular with product teams. API similar to Linear. Commands: `prlt shortcut connect/sync/import/export`. |
| TKT-195 | ClickUp integration | backlog | P3 | feature | All-in-one tool with growing user base. Complex API (tasks, docs, goals, etc.). Start with task sync only. Commands: `prlt clickup connect/sync`. |
| TKT-196 | Asana integration | backlog | P3 | feature | Widespread adoption in non-tech teams. Task/project sync. Important for product teams and cross-functional orgs. Commands: `prlt asana connect/sync`. |
| TKT-197 | Monday.com integration | backlog | P3 | feature | Enterprise work OS platform. Popular in non-tech orgs. Board/item sync. Commands: `prlt monday connect/sync`. |
| TKT-198 | Notion integration | backlog | P3 | feature | Sync with Notion databases. Import/export. Community-requested feature. Knowledge worker favorite. |
| TKT-199 | GitHub Projects integration | backlog | P3 | feature | Sync with GitHub Projects boards (v2). Different from GitHub Issues - this is the project board layer. Lower priority since GitHub Issues covers main use case. |

## Cloud Mode & Team

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-200 | Cloud Mode architecture design | backlog | P2 | feature | Design architecture for Cloud Mode: Docker-based agents running in cloud with web dashboard. **Key decisions**: (1) Hosting model: User-hosted (Docker Compose/K8s) vs managed SaaS vs hybrid. (2) Da... |
| TKT-201 | Multi-user collaboration (local) | backlog | P2 | feature | Enable multiple developers to share a local prlt workspace via git. **Current limitation**: SQLite database (workspace.db) in .proletariat/ creates merge conflicts when multiple devs work in same r... |
| TKT-202 | Database sync/replication | backlog | P3 | feature | Sync local SQLite database with remote backup or team database. CRDTs, operational transforms, or simple last-write-wins. Enables: (1) Backup to cloud storage. (2) Multi-device usage (laptop + desk... |
| TKT-203 | Web dashboard for Cloud Mode | backlog | P3 | feature | Web UI for Cloud Mode. Features: (1) View tickets/boards (Kanban, list, calendar views). (2) Create/edit tickets. (3) Monitor agent status (live updates via WebSockets). (4) View agent logs/outputs... |
| TKT-204 | Remote agent execution API | backlog | P3 | feature | API to spawn agents on remote infrastructure instead of local Docker. Commands: `prlt work spawn --remote` or `prlt config set execution-mode remote`. Agent runs in cloud (K8s pod, ECS task, Lambda... |

## Infrastructure

| Ticket | Title | Status | Pri | Type | Description |
|--------|-------|--------|-----|------|-------------|
| TKT-205 | Database abstraction class (db.ts) | backlog | P1 | refactor | Create a centralized database abstraction class to standardize connection management, query execution, and error handling across the codebase. **Problem**: Database access is scattered - `storage-s... |
| TKT-207 | Strict TypeScript types across codebase | backlog | P1 | refactor | Add comprehensive TypeScript types to the entire codebase, eliminating `any` types and enabling strict mode. **Current state**: Mixed type coverage - some files well-typed, others use `any`, implic... |
| TKT-213 | Homebrew distribution | backlog | P1 | feature | Publish prlt to Homebrew for macOS/Linux installation via brew install proletariat.  ## Phase 1: Custom Tap (Immediate - No stars required)  Create homebrew-proletariat repo with formula. Users ins... |
| TKT-214 | Package distribution (APT, YUM, AUR, Chocolatey, Scoop) | backlog | P1 | feature | Distribute prlt through native package managers for Linux and Windows to maximize adoption and reduce install friction. **Problem**: `npm install -g` is unfamiliar to non-JS developers. Native pack... |
| TKT-215 | GitHub Releases with pre-built binaries | backlog | P1 | feature | Publish pre-built binaries for all platforms (macOS, Linux, Windows) to GitHub Releases on every version tag. **Purpose**: Provide zero-dependency download option for users who don't use package ma... |
| TKT-216 | E2E test harness and selective test execution | backlog | P1 | test | Build comprehensive e2e test harness with ability to run all tests or selective test suites. **Problem**: Currently no structured way to run e2e tests selectively - either run all or manually speci... |
| TKT-217 | Automated PR checks (e2e, static analysis, build) | backlog | P1 | chore | Set up GitHub Actions workflow to automatically run quality checks on all PRs for feature branches. **Required checks**: (1) **E2E tests** - Run full end-to-end test suite (`pnpm test` or `pnpm tes... |
| TKT-206 | ORM layer for database abstraction | backlog | P2 | refactor | Evaluate adding an ORM (Drizzle, Kysely, TypeORM, or Prisma) to replace raw SQL queries in storage-sqlite.ts. **Current state**: Direct better-sqlite3 usage with hand-written SQL, prepared statemen... |
| TKT-208 | Refactor storage-sqlite.ts into separate modules | backlog | P2 | refactor | Break up the monolithic 1891-line `apps/cli/src/lib/pmo/storage-sqlite.ts` file into focused modules for maintainability. Current file has ~50+ methods covering projects, tickets, columns, specs, e... |
| TKT-209 | Remove old-cli from repo | backlog | P3 | chore | Clean up legacy `old-cli/` directory from repository. Archive or delete deprecated code. Only remove once confirmed nothing is needed from old implementation. Low priority - doesn't affect function... |
| TKT-210 | DB schema migrations | backlog | P3 | chore | Versioned migrations (up/down). `prlt migrate` to run pending. Handle schema evolution. |
| TKT-211 | Upgrade command | backlog | P3 | chore | `prlt upgrade` - runs pending migrations, handles version bumps, any data transforms needed between versions. User-friendly wrapper around migrations. |
| TKT-212 | Auto-deploy to npm | backlog | P3 | chore | Auto-deploy on release. Versioning strategy (semver). |
| TKT-218 | GitHub Actions CI/CD | backlog | P3 | chore | Build/test/publish pipeline. |
| TKT-219 | Command deprecation with aliases | backlog | P3 | chore | Handle command renames gracefully. Old names become aliases with deprecation warnings. |
| TKT-222 | Set up prltdev package for testing dev builds | completed | P1 | feature | Set up private GitHub Packages publishing for testing dev builds separately from production prlt.  ## Goal  - prlt → production (npm public, released versions) - prltdev → dev builds (GitHub Packag... |
