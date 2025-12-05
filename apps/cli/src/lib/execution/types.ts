/**
 * Execution Types
 *
 * Types for agent execution and runtime management.
 */

// =============================================================================
// Runtime Modes
// =============================================================================

export type RuntimeMode =
  | 'foreground'  // Subprocess in current terminal
  | 'background'  // Detached process, logs to file
  | 'tmux'        // New tmux pane/window
  | 'terminal'    // New Terminal.app window (macOS)
  | 'docker'      // Container with worktree mounted
  | 'vm'          // Remote VM via SSH

// =============================================================================
// Executor Types
// =============================================================================

export type ExecutorType =
  | 'claude-code'
  | 'codex'
  | 'aider'
  | 'custom'

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
  mode: RuntimeMode
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
  epicTitle?: string
  specPath?: string
  agentName: string
  worktreePath: string
  branch: string
}

// =============================================================================
// Branch Type Mapping
// =============================================================================

/**
 * Map ticket category to branch type.
 * Used when creating branches for agent work.
 */
export const CATEGORY_TO_BRANCH_TYPE: Record<string, string> = {
  // Development types
  'feature': 'feat',
  'feat': 'feat',
  'new': 'feat',
  'bug': 'fix',
  'fix': 'fix',
  'bugfix': 'fix',
  'refactor': 'rfct',
  'cleanup': 'rfct',
  'docs': 'docs',
  'documentation': 'docs',
  'test': 'test',
  'testing': 'test',
  'chore': 'chore',
  'maintenance': 'chore',
  'performance': 'perf',
  'security': 'sec',
  'ci': 'ci',
  'pipeline': 'ci',
  'build': 'build',
  'deps': 'build',
  'dependencies': 'build',
  'database': 'db',
  'migration': 'db',
  'schema': 'db',
  'release': 'rel',
  // Founder/business types
  'growth': 'grow',
  'marketing': 'grow',
  'ops': 'ops',
  'operations': 'ops',
  'bizops': 'ops',
  'strategy': 'strat',
  'planning': 'strat',
  'support': 'cx',
  'customer': 'cx',
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
 * Format: {type}/{agent}/{ticket-id}-{slug}
 */
export function generateBranchName(
  ticketId: string,
  ticketTitle: string,
  agentName: string,
  category?: string
): string {
  const type = getBranchType(category)
  const slug = ticketTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30)
    .replace(/-+$/, '')

  return `${type}/${agentName}/${ticketId}-${slug}`
}

// =============================================================================
// Execution Configuration
// =============================================================================

export interface ExecutionConfig {
  defaultMode: RuntimeMode
  defaultExecutor: ExecutorType
  autoExecute: boolean
  tmux: {
    session: string
    layout: 'split' | 'window'
  }
  terminal: {
    app: 'Terminal' | 'iTerm'
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

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  defaultMode: 'foreground',
  defaultExecutor: 'claude-code',
  autoExecute: false,
  tmux: {
    session: 'proletariat',
    layout: 'window',
  },
  terminal: {
    app: 'Terminal',
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
