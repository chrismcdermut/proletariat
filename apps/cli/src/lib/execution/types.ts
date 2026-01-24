/**
 * Execution Types
 *
 * Types for agent execution and runtime management.
 */

// =============================================================================
// Execution Data Models
// =============================================================================
//
// Three dimensions control how agent work is executed:
//
// 1. ExecutionEnvironment - WHERE the code runs
//    (devcontainer, host, docker, vm)
//
// 2. SessionManager - HOW the process is supervised
//    (tmux, direct) - currently always tmux for session persistence
//
// 3. DisplayMode - HOW output is presented to the user
//    (terminal, background)
//
// =============================================================================

/**
 * ExecutionEnvironment - Where the agent code runs.
 */
export type ExecutionEnvironment =
  | 'devcontainer'  // In a devcontainer (sandboxed, recommended)
  | 'host'          // Directly on host machine
  | 'docker'        // In a Docker container
  | 'vm'            // On a remote VM

/**
 * SessionManager - How agent sessions are managed inside the execution environment.
 * - tmux: Run inside tmux session (can attach/detach, persistent)
 * - direct: Run process directly (simple, no session management)
 *
 * Currently always 'tmux' for consistent session persistence across all environments.
 */
export type SessionManager =
  | 'tmux'          // Run inside tmux (attach with `prlt session attach`)
  | 'direct'        // Run process directly (no session management)

/**
 * DisplayMode - How output is presented to the user.
 * - terminal: Opens a new terminal tab attached to the tmux session
 * - background: Runs detached, reattach later with `prlt session attach`
 * - foreground: Attaches tmux in current terminal (blocking)
 */
export type DisplayMode =
  | 'terminal'      // New terminal tab showing execution
  | 'background'    // Detached tmux session, reattach later
  | 'foreground'    // Attached tmux in current terminal (blocking)

/**
 * OutputMode - How Claude Code displays its output.
 * - interactive: Shows streaming UI with real-time tool calls, file reads, etc.
 * - print: Outputs final result only (uses -p flag), better for logs/automation
 */
export type OutputMode =
  | 'interactive'   // Streaming UI (no -p flag) - watch Claude work in real-time
  | 'print'         // Print mode (-p flag) - final result only, good for automation

// =============================================================================
// Executor Types
// =============================================================================

export type ExecutorType =
  | 'claude-code'
  | 'codex'
  | 'aider'
  | 'custom'

// =============================================================================
// Terminal App Types
// =============================================================================

export type TerminalApp =
  | 'Terminal'    // macOS Terminal.app
  | 'iTerm'       // iTerm
  | 'Alacritty'   // Alacritty
  | 'Ghostty'     // Ghostty
  | 'Kitty'       // Kitty
  | 'tmux'        // tmux
  | 'Warp'        // Warp
  | 'WezTerm'     // WezTerm

export type Shell =
  | 'bash'        // Bourne Again Shell
  | 'zsh'         // Z Shell (macOS default)
  | 'fish'        // Friendly Interactive Shell

// =============================================================================
// Execution Status
// =============================================================================

export type ExecutionStatus =
  | 'starting'    // Initializing
  | 'running'     // Agent is working
  | 'completed'   // Finished successfully
  | 'failed'      // Exited with error
  | 'stopped'     // Manually terminated

// =============================================================================
// Agent Work Record
// =============================================================================

export interface AgentWork {
  id: string
  ticketId: string
  agentName: string
  executor: ExecutorType
  environment: ExecutionEnvironment  // Where: devcontainer, host, docker, vm
  displayMode: DisplayMode       // How shown: terminal, background
  sessionManager?: SessionManager // How session is managed inside environment (tmux/direct)
  sandboxed: boolean             // Whether --dangerously-skip-permissions was NOT used
  status: ExecutionStatus
  branch?: string
  pid?: string
  containerId?: string
  sessionId?: string
  host?: string
  logPath?: string
  startedAt: Date
  completedAt?: Date
  exitCode?: number
}

// =============================================================================
// Execution Context
// =============================================================================

export interface ExecutionContext {
  ticketId: string
  ticketTitle: string
  ticketDescription?: string
  ticketSubtasks?: Array<{ title: string; done: boolean }>
  ticketPriority?: string
  ticketCategory?: string
  epicTitle?: string
  specId?: string
  specTitle?: string
  specProblem?: string
  specSolution?: string
  agentName: string
  agentDir: string      // Agent directory (contains .devcontainer)
  worktreePath: string  // Worktree path (may be subdirectory of agentDir)
  branch: string
  hqPath?: string // HQ root path for storing execution artifacts
  pmoPath?: string // PMO path for mounting into container
  createPR?: boolean // Whether to create a PR when work is ready (chosen at work start)
  // Action context (what the agent should do)
  actionId?: string       // Action ID (e.g., 'implement', 'groom')
  actionName?: string     // Action name for display
  actionPrompt?: string   // The action prompt (start instruction for agent)
  actionEndPrompt?: string // The action end prompt (completion instructions)
  modifiesCode?: boolean  // Whether this action modifies code (needs branch)
  // PR feedback context (for work revise)
  prFeedback?: string // Formatted PR feedback markdown
  isRevision?: boolean // Whether this is a revision (addressing PR feedback)
}

// =============================================================================
// Branch Type Mapping
// =============================================================================

/**
 * Map ticket category to branch type.
 * Used when creating branches for agent work.
 */
export const CATEGORY_TO_BRANCH_TYPE: Record<string, string> = {
  // ===========================================================================
  // Conventional Commits (standard types)
  // ===========================================================================

  // feat - New features and additions
  'feature': 'feat',
  'feat': 'feat',
  'new': 'feat',

  // fix - Bug fixes
  'bug': 'fix',
  'fix': 'fix',
  'bugfix': 'fix',

  // docs - Documentation
  'docs': 'docs',
  'documentation': 'docs',

  // test - Testing
  'test': 'test',
  'testing': 'test',

  // chore - Maintenance tasks
  'chore': 'chore',
  'maintenance': 'chore',

  // perf - Performance improvements
  'performance': 'perf',
  'perf': 'perf',

  // ci - CI/CD pipeline
  'ci': 'ci',
  'pipeline': 'ci',

  // build - Build system (mapped to 'ship' to avoid conflict with commit type)
  'build': 'build',
  'deps': 'build',
  'dependencies': 'build',

  // refactor - Code refactoring
  'refactor': 'rfct',
  'cleanup': 'rfct',
  'rfct': 'rfct',

  // ===========================================================================
  // Extended Types (proletariat extras)
  // ===========================================================================

  // sec - Security fixes
  'security': 'sec',
  'sec': 'sec',

  // db - Database changes
  'database': 'db',
  'migration': 'db',
  'schema': 'db',
  'db': 'db',

  // rel - Releases
  'release': 'rel',
  'rel': 'rel',

  // ===========================================================================
  // 5Tool Founder Types (business/ops categories)
  // ===========================================================================

  // ship - Shipping and deployment
  'ship': 'ship',
  'deploy': 'ship',
  'launch': 'ship',

  // grow - Growth and marketing
  'growth': 'grow',
  'marketing': 'grow',
  'grow': 'grow',

  // cx - Customer experience/support
  'support': 'cx',
  'customer': 'cx',
  'cx': 'cx',

  // strat - Strategy and planning
  'strategy': 'strat',
  'planning': 'strat',
  'strat': 'strat',

  // ops - Operations
  'ops': 'ops',
  'operations': 'ops',
  'bizops': 'ops',
}

/**
 * Get branch type from ticket category.
 * Defaults to 'feat' if no mapping found.
 */
export function getBranchType(category?: string): string {
  if (!category) return 'feat'
  const normalized = category.toLowerCase().trim()
  return CATEGORY_TO_BRANCH_TYPE[normalized] || 'feat'
}

/**
 * Generate branch name for agent work.
 * Format: {ticketId}/{type}/{owner}/{agent}/{slug}
 *
 * Example: TKT-054/feat/chris/altman/update-branch-naming
 *
 * - ticketId first for easy filtering: git branch | grep TKT-054
 * - owner: the human who owns the HQ/spawned the agent
 * - agent: the AI agent doing the work
 */
export function generateBranchName(
  ticketId: string,
  ticketTitle: string,
  ownerName: string,
  agentName: string,
  category?: string
): string {
  const type = getBranchType(category)
  const slug = ticketTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 20)
    .replace(/-+$/, '')

  return `${ticketId}/${type}/${ownerName}/${agentName}/${slug}`
}

// =============================================================================
// Execution Configuration
// =============================================================================

export interface ExecutionConfig {
  defaultEnvironment: ExecutionEnvironment
  defaultExecutor: ExecutorType
  autoExecute: boolean
  shell: Shell
  outputMode: OutputMode  // interactive (streaming) or print (final result only)
  sandboxed: boolean      // Whether --dangerously-skip-permissions is NOT used
  tmux: {
    session: string
    layout: 'split' | 'window'
    controlMode: boolean  // Use tmux -CC for iTerm native integration
  }
  terminal: {
    app: TerminalApp
  }
  devcontainer: {
    defaultImage: string
    memory: string
    cpus: number
    autoStart: boolean  // Auto-start container on execute
  }
  docker: {
    image: string
    network: string
    memory?: string
    cpus?: number
  }
  vm: {
    defaultHost?: string
    user: string
    keyPath?: string
    syncMethod: 'rsync' | 'git'
  }
}

/**
 * Extract ticket ID from a tmux session name.
 * Session names like: prlt-TKT-347-implement or TKT-347-implement
 * Returns the ticket ID (e.g., "TKT-347") or undefined if not found.
 */
export function extractTicketFromSession(sessionName: string | null | undefined): string | undefined {
  if (!sessionName) return undefined
  const name = sessionName.replace(/^prlt-/, '')
  const match = name.match(/^(TKT-\d+)/)
  return match ? match[1] : undefined
}

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  defaultEnvironment: 'host',
  defaultExecutor: 'claude-code',
  autoExecute: false,
  shell: 'zsh',  // macOS default
  outputMode: 'interactive',  // Show streaming UI by default
  sandboxed: true,  // Require approval for dangerous operations by default
  tmux: {
    session: 'proletariat',
    layout: 'window',
    controlMode: true,  // Enable -CC for iTerm native integration by default
  },
  terminal: {
    app: 'Terminal',
  },
  devcontainer: {
    defaultImage: 'mcr.microsoft.com/devcontainers/base:ubuntu',
    memory: '8g',
    cpus: 4,
    autoStart: true,
  },
  docker: {
    image: 'claude-code:latest',
    network: 'host',
  },
  vm: {
    user: 'agent',
    syncMethod: 'git',
  },
}
