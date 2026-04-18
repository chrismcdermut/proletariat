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
//    (host, sandbox, devcontainer, docker, cloud)
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
 *
 * Hierarchy (least to most isolation):
 *   host      -> Full access, no sandbox (quick, trusted, power users)
 *   sandbox   -> srt restrictions on host (filesystem + network isolation, lightweight)
 *   container -> Docker/devcontainer (full isolation, can run browsers/headless chrome)
 *   cloud     -> Remote machines (scale, GPUs, offload to powerful hardware)
 */
export type ExecutionEnvironment =
  | 'host'          // Directly on host machine (no isolation)
  | 'sandbox'       // srt sandbox on host (filesystem + network restrictions)
  | 'devcontainer'  // In a devcontainer (isolated, recommended)
  | 'docker'        // In a Docker container
  | 'cloud'         // On a remote machine (was 'vm')
  | 'vm'            // @deprecated - alias for 'cloud', use 'cloud' instead

/**
 * Normalize execution environment, mapping deprecated values to current ones.
 * 'vm' is mapped to 'cloud'.
 */
export function normalizeEnvironment(env: ExecutionEnvironment): ExecutionEnvironment {
  if (env === 'vm') return 'cloud'
  return env
}

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

/**
 * PermissionMode - How Claude Code handles permission checks.
 * - danger: Skip permission checks (faster, relies on container/environment isolation)
 * - safe: Requires approval for dangerous operations
 */
export type PermissionMode =
  | 'danger'        // Skip permission checks (--dangerously-skip-permissions)
  | 'safe'          // Require approval for dangerous operations

/**
 * CleanupPolicy - What happens to the container when the agent session ends.
 * - on-exit: Remove container when agent exits (default)
 * - persistent: Leave container running (for long-lived orchestrators)
 * - on-error-keep: Remove on success, keep on error (for debugging)
 */
export type CleanupPolicy =
  | 'on-exit'       // Remove container when agent exits
  | 'persistent'    // Leave container running
  | 'on-error-keep' // Keep container only on error

// =============================================================================
// Executor Types
// =============================================================================

export type ExecutorType =
  | 'claude-code'
  | 'codex'
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
  environment: ExecutionEnvironment  // Where: host, sandbox, devcontainer, docker, cloud
  displayMode: DisplayMode       // How shown: terminal, background
  sessionManager?: SessionManager // How session is managed inside environment (tmux/direct)
  permissionMode: PermissionMode  // Permission mode used for this execution
  cleanupPolicy: CleanupPolicy   // Container cleanup policy for this execution
  status: ExecutionStatus
  branch?: string
  pid?: string
  containerId?: string
  sessionId?: string
  host?: string
  logPath?: string
  externalSource?: string
  externalKey?: string
  externalId?: string
  externalUrl?: string
  startedAt: Date
  completedAt?: Date
  exitCode?: number
  errorMessage?: string
  lastHeartbeat?: Date
  lifecycleState?: LifecycleState
  retries?: number
}

/**
 * Lifecycle state for agent work execution.
 * Tracked in the lifecycle_state column of agent_work.
 */
export type LifecycleState = 'healthy' | 'idle' | 'died' | 'completed'

// =============================================================================
// Workspace Repo Info (PRLT-1088)
// =============================================================================

/**
 * Structured information about a repository in the agent workspace.
 * Used for workspace manifest and prompt injection so agents know
 * exactly which repos are available.
 */
export interface WorkspaceRepo {
  name: string       // Directory name (e.g., 'proletariat')
  path: string       // Absolute path inside container (e.g., '/workspace/proletariat')
  remote?: string    // GitHub remote (e.g., 'chrismcdermut/proletariat')
  branch?: string    // Current branch name
  primary: boolean   // Whether this is the primary repo to work in
}

/**
 * Workspace manifest written to /workspace/.prlt-workspace.json
 * so agents know exactly what repos are available and what to work on.
 */
export interface WorkspaceManifest {
  repos: WorkspaceRepo[]
  ticket: string
  agent: string
  action?: string
}

// =============================================================================
// Execution Context
// =============================================================================

export interface ExecutionContext {
  ticketId: string
  /** @deprecated PRLT-1166: ticketId now stores the external provider key (e.g. PRLT-1065) directly. This field is kept for backwards compatibility but should not be used for new code. */
  externalTicketId?: string
  ticketTitle: string
  ticketDescription?: string
  ticketSubtasks?: Array<{ title: string; done: boolean }>
  ticketPriority?: string
  ticketCategory?: string
  epicTitle?: string
  agentName: string
  agentDir: string      // Agent directory (contains .devcontainer)
  worktreePath: string  // Worktree path (may be subdirectory of agentDir)
  branch: string
  hqPath?: string // HQ root path for storing execution artifacts
  pmoPath?: string // PMO path for mounting into container
  repoWorktrees?: string[] // Names of repo worktrees to mount for git worktree resolution
  workspaceRepos?: WorkspaceRepo[] // Structured workspace repo info (PRLT-1088)
  createPR?: boolean // Whether to create a PR when work is ready (chosen at work start)
  verifyCi?: boolean // Whether agent should poll CI and fix failures before exiting (PRLT-1126)
  reviewGate?: 'required' | 'auto' | 'post' // Review gate mode (resolved at work start)
  // Action context (what the agent should do)
  actionId?: string       // Action ID (e.g., 'implement', 'groom')
  actionName?: string     // Action name for display
  actionPrompt?: string   // The action prompt (start instruction for agent)
  actionEndPrompt?: string // The action end prompt (completion instructions)
  modifiesCode?: boolean  // Whether this action modifies code (needs branch)
  networkAllowlist?: string[] // Extra domains to allow in container firewall for this action
  // Custom message (appended as additional instructions to any action)
  customMessage?: string
  // Docker credential mode
  useApiKey?: boolean // If true, pass ANTHROPIC_API_KEY to container (user explicitly chose this)
  // PR feedback context (for review actions)
  prFeedback?: string // Formatted PR feedback markdown
  isRevision?: boolean // Whether this is a revision (addressing PR feedback)
  // Orchestrator context
  isOrchestrator?: boolean // Whether this is an orchestrator session (long-running manager, not a ticket worker)
  isEphemeral?: boolean // Whether this is an ephemeral agent (auto-closes session on completion)
  hqName?: string // HQ workspace name (used in orchestrator prompt)
  // Execution environment (where the agent is running)
  executionEnvironment?: ExecutionEnvironment // 'host', 'sandbox', 'devcontainer', 'docker', 'cloud'
  // Connected integrations (for prompt injection)
  connectedIntegrations?: string[] // e.g. ['asana', 'linear'] — only integrations that are configured
  // Tool registry (TKT-083): per-agent tool access
  toolPolicy?: string // Policy profile name (e.g., 'code-agent') for tool access control
  // PRLT-1337: Execution lifecycle tracking
  executionId?: string // agent_work row ID — passed to runner scripts for exit code reporting
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
 * Format: {ticketId}/{type}/{slug}
 *
 * Example: PRLT-1137/feat/fix-main-branch-ci
 *
 * - ticketId first for easy filtering: git branch | grep PRLT-1137
 * - type: derived from ticket category (feat, fix, rfct, etc.)
 * - slug: kebab-case from ticket title, truncated to 20 chars
 *
 * Agent name and owner are dropped from the branch name entirely.
 * They remain in the DB work record and session metadata for debugging.
 */
export function generateBranchName(
  ticketId: string,
  ticketTitle: string,
  category?: string
): string {
  const type = getBranchType(category)
  const slug = ticketTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 20)
    .replace(/-+$/, '')

  return `${ticketId}/${type}/${slug}`
}

// =============================================================================
// Auth Method
// =============================================================================

export type AuthMethod = 'oauth' | 'apikey'

// =============================================================================
// Execution Configuration
// =============================================================================

export interface ExecutionConfig {
  defaultEnvironment: ExecutionEnvironment
  defaultExecutor: ExecutorType
  autoExecute: boolean
  shell: Shell
  outputMode: OutputMode  // interactive (streaming) or print (final result only)
  permissionMode: PermissionMode  // Permission mode for agent execution
  authMethod?: AuthMethod // Saved auth method preference (oauth or apikey). null/undefined = ask each time
  createPrDefault?: boolean // Workspace default for PR creation (true=create PRs, false=no PRs, undefined=prompt)
  verifyCiDefault?: boolean // Workspace default for CI verification (true=verify CI before exiting, undefined=prompt)
  tmux: {
    session: string
    layout: 'split' | 'window'
    controlMode: boolean  // Use tmux -CC for iTerm native integration
    windowMode: 'tab' | 'window'  // How iTerm opens tmux windows: tab in current window, or new window
  }
  terminal: {
    app: TerminalApp
    openInBackground: boolean  // Open terminal tabs without stealing focus (default: true)
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
  firewall: {
    allowlistDomains: string[]  // Additional domains to allow in container firewall
  }
  sandbox: {
    allowReadPaths: string[]   // Additional paths the sandbox can read (repo source is always allowed)
    allowWritePaths: string[]  // Additional paths the sandbox can write (agent worktree is always allowed)
    networkDomains: string[]   // Domains allowed for network access (merged with firewall.allowlistDomains)
    fallbackToHost: boolean    // If srt not installed, fall back to host with warning (default: true)
  }
  cloud: {
    defaultHost?: string
    user: string
    keyPath?: string
    syncMethod: 'rsync' | 'git'
  }
  /** @deprecated Use 'cloud' instead. Kept for backwards compatibility. */
  vm: {
    defaultHost?: string
    user: string
    keyPath?: string
    syncMethod: 'rsync' | 'git'
  }
}

/**
 * Extract ticket ID from a tmux session name.
 * Session names like: prlt-TKT-347-implement, TKT-347-implement, or PRLT-1065-implement
 * Returns the ticket ID (e.g., "TKT-347" or "PRLT-1065") or undefined if not found.
 *
 * Supports both internal PMO IDs (TKT-xxx) and external provider IDs (PRLT-xxx, PROJ-xxx, etc.).
 */
export function extractTicketFromSession(sessionName: string | null | undefined): string | undefined {
  if (!sessionName) return undefined
  const name = sessionName.replace(/^prlt-/, '')
  const match = name.match(/^([A-Z]+-\d+)/)
  return match ? match[1] : undefined
}

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  defaultEnvironment: 'host',
  defaultExecutor: 'claude-code',
  autoExecute: false,
  shell: 'zsh',  // macOS default
  outputMode: 'interactive',  // Show streaming UI by default
  permissionMode: 'safe',  // Require approval for dangerous operations by default
  tmux: {
    session: 'proletariat',
    layout: 'window',
    controlMode: true,  // Use -u -CC for native iTerm scrolling/selection
    windowMode: 'tab',  // Open tmux windows as tabs in current window by default
  },
  terminal: {
    app: 'Terminal',
    openInBackground: true,  // Don't steal focus when opening new tabs
  },
  devcontainer: {
    defaultImage: 'mcr.microsoft.com/devcontainers/base:ubuntu',
    memory: '8g',
    cpus: 2,
    autoStart: true,
  },
  docker: {
    image: 'claude-code:latest',
    network: 'host',
  },
  firewall: {
    allowlistDomains: [],
  },
  sandbox: {
    allowReadPaths: [],
    allowWritePaths: [],
    networkDomains: [
      'github.com',
      'api.anthropic.com',
      'registry.npmjs.org',
      'registry.yarnpkg.com',
    ],
    fallbackToHost: true,
  },
  cloud: {
    user: 'agent',
    syncMethod: 'git',
  },
  vm: {
    user: 'agent',
    syncMethod: 'git',
  },
}
