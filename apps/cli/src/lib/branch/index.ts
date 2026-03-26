/**
 * Branch Utilities
 *
 * Utilities for creating and validating conventional branch names.
 * Format: {type}/{coder}/{description} or {type}/{description}
 */

import { execSync } from 'node:child_process'

// =============================================================================
// Branch Types
// =============================================================================

export const BRANCH_TYPES = {
  // Conventional Commits (standard types)
  feat: 'New feature',
  fix: 'Bug fix',
  rfct: 'Refactoring (no functional change)',
  docs: 'Documentation only',
  test: 'Test additions or corrections',
  chore: 'Maintenance tasks, no production code',
  perf: 'Performance improvement',
  ci: 'CI/CD configuration changes',
  build: 'Build system or external dependency changes',
  // Extended Types (proletariat extras)
  sec: 'Security fixes or improvements',
  db: 'Database migrations or schema changes',
  rel: 'Release preparation',
  // 5Tool Founder Types
  ship: 'Shipping, deployment, and launch',
  grow: 'Growth and marketing initiatives',
  cx: 'Customer experience and support',
  strat: 'Strategy and planning',
  ops: 'Business operations',
} as const

export type BranchType = keyof typeof BRANCH_TYPES

// Conventional Commits (standard types)
export const CONVENTIONAL_TYPES: BranchType[] = [
  'feat', 'fix', 'rfct', 'docs', 'test', 'chore', 'perf', 'ci', 'build'
]

// Extended Types (proletariat extras)
export const EXTENDED_TYPES: BranchType[] = [
  'sec', 'db', 'rel'
]

// 5Tool Founder Types
export const FOUNDER_TYPES: BranchType[] = [
  'ship', 'grow', 'cx', 'strat', 'ops'
]

// Combined for wizard display
export const DEVELOPMENT_TYPES: BranchType[] = [...CONVENTIONAL_TYPES, ...EXTENDED_TYPES]
export const BUSINESS_TYPES: BranchType[] = FOUNDER_TYPES

// =============================================================================
// Validation
// =============================================================================

const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isKebabCase(str: string): boolean {
  return KEBAB_CASE_REGEX.test(str)
}

export function isValidBranchType(type: string): type is BranchType {
  return type in BRANCH_TYPES
}

export interface BranchParts {
  ticketId?: string
  type: BranchType
  owner?: string
  agent?: string
  description: string
}

export interface ValidationResult {
  valid: boolean
  parts?: BranchParts
  error?: string
}

// Ticket ID pattern (e.g., TKT-001, PROJ-123)
const TICKET_ID_REGEX = /^[A-Z]+-\d+$/

/**
 * Check if a string looks like a ticket ID.
 */
export function isTicketId(str: string): boolean {
  return TICKET_ID_REGEX.test(str)
}

/**
 * Parse and validate a branch name against conventional format.
 *
 * Supported formats:
 * - {ticketId}/{type}/{description} - standard format (new)
 * - {ticketId}/{type}/{owner}/{description} - legacy format with owner
 * - {ticketId}/{type}/{owner}/{agent}/{description} - legacy format with owner+agent
 * - {type}/{owner}/{description} - legacy format without ticket
 * - {type}/{description} - minimal format
 */
export function validateBranchName(name: string): ValidationResult {
  const parts = name.split('/')

  if (parts.length < 2 || parts.length > 5) {
    return {
      valid: false,
      error: 'Branch name must have 2-5 parts separated by /',
    }
  }

  // Check if first part is a ticket ID
  const hasTicket = isTicketId(parts[0])

  if (hasTicket) {
    // Ticket-first format: {ticketId}/{type}/{owner}/{agent?}/{description}
    const ticketId = parts[0]
    const type = parts[1]

    if (!isValidBranchType(type)) {
      return {
        valid: false,
        error: `Unknown branch type: "${type}". Valid types: ${Object.keys(BRANCH_TYPES).join(', ')}`,
      }
    }

    if (parts.length === 3) {
      // {ticketId}/{type}/{description}
      return {
        valid: true,
        parts: { ticketId, type: type as BranchType, description: parts[2] },
      }
    }

    if (parts.length === 4) {
      // {ticketId}/{type}/{owner}/{description}
      return {
        valid: true,
        parts: { ticketId, type: type as BranchType, owner: parts[2], description: parts[3] },
      }
    }

    if (parts.length === 5) {
      // {ticketId}/{type}/{owner}/{agent}/{description}
      return {
        valid: true,
        parts: { ticketId, type: type as BranchType, owner: parts[2], agent: parts[3], description: parts[4] },
      }
    }

    return {
      valid: false,
      error: 'Invalid ticket branch format. Expected: {ticketId}/{type}/{description}',
    }
  }

  // Legacy format without ticket: {type}/{owner?}/{description}
  const type = parts[0]
  if (!isValidBranchType(type)) {
    return {
      valid: false,
      error: `Unknown branch type: "${type}". Valid types: ${Object.keys(BRANCH_TYPES).join(', ')}`,
    }
  }

  if (parts.length === 2) {
    // {type}/{description}
    const description = parts[1]

    // Check if description looks like a ticket ID (user put ticket in wrong position)
    if (isTicketId(description)) {
      return {
        valid: false,
        error: `Segment "${description}" looks like a ticket ID, but ticket IDs must be the first segment. ` +
               `Expected format: {ticketId}/{type}/{description}`,
      }
    }

    if (!isKebabCase(description)) {
      return {
        valid: false,
        error: `Description must be kebab-case: "${description}"`,
      }
    }
    return {
      valid: true,
      parts: { type: type as BranchType, description },
    }
  }

  // {type}/{owner}/{description}
  const owner = parts[1]
  const description = parts[2]

  // Check if owner looks like a ticket ID (user put ticket in wrong position)
  if (isTicketId(owner)) {
    return {
      valid: false,
      error: `Segment "${owner}" looks like a ticket ID, but it's in the owner position (segment 2). ` +
             `Ticket IDs must be the first segment. Expected format: {ticketId}/{type}/{owner}/{description}`,
    }
  }

  if (!isKebabCase(owner)) {
    return {
      valid: false,
      error: `Owner name must be kebab-case: "${owner}"`,
    }
  }

  // Check if description looks like a ticket ID (user put ticket in wrong position)
  if (isTicketId(description)) {
    return {
      valid: false,
      error: `Segment "${description}" looks like a ticket ID, but it's in the description position (segment 3). ` +
             `Ticket IDs must be the first segment.`,
    }
  }

  if (!isKebabCase(description)) {
    return {
      valid: false,
      error: `Description must be kebab-case: "${description}"`,
    }
  }

  return {
    valid: true,
    parts: { type: type as BranchType, owner, description },
  }
}

/**
 * Build a branch name from parts.
 *
 * Formats:
 * - With ticket: {ticketId}/{type}/{description}
 * - Without ticket: {type}/{owner}/{description}
 * - Minimal: {type}/{description}
 *
 * Owner and agent are no longer included in ticket-based branch names.
 */
export function buildBranchName(
  type: BranchType,
  description: string,
  options?: {
    ticketId?: string
    owner?: string
  }
): string {
  const { ticketId, owner } = options || {}

  if (ticketId) {
    return `${ticketId}/${type}/${description}`
  }

  // Legacy format without ticket
  if (owner) {
    return `${type}/${owner}/${description}`
  }
  return `${type}/${description}`
}

/**
 * Convert a string to kebab-case.
 */
export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// =============================================================================
// Git Operations
// =============================================================================

export interface BranchInfo {
  name: string
  current: boolean
  ticketId?: string
  type?: BranchType
  owner?: string
  agent?: string
  description?: string
  tracking?: string
  repo?: string
}

/**
 * Get current branch name.
 */
export function getCurrentBranch(cwd?: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * List all branches with parsed info.
 */
export function listBranches(cwd?: string, includeRemote = false): BranchInfo[] {
  try {
    const args = includeRemote ? '-a' : ''
    const output = execSync(`git branch ${args} --format="%(refname:short)|%(upstream:short)|%(HEAD)"`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const branches: BranchInfo[] = []

    for (const line of output.trim().split('\n')) {
      if (!line) continue

      const [name, tracking, head] = line.split('|')
      const current = head === '*'

      // Parse conventional parts
      const validation = validateBranchName(name)

      branches.push({
        name,
        current,
        ticketId: validation.parts?.ticketId,
        type: validation.parts?.type,
        owner: validation.parts?.owner,
        agent: validation.parts?.agent,
        description: validation.parts?.description,
        tracking: tracking || undefined,
      })
    }

    return branches
  } catch {
    return []
  }
}

/**
 * Check if a branch exists.
 */
export function branchExists(name: string, cwd?: string): boolean {
  try {
    execSync(`git rev-parse --verify ${name}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Create a new branch.
 * @param startPoint - Optional starting point (e.g., 'origin/main')
 */
export function createBranch(name: string, cwd?: string, checkout = true, startPoint?: string): void {
  const startArg = startPoint ? ` ${startPoint}` : ''
  if (checkout) {
    execSync(`git checkout -b ${name}${startArg}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } else {
    execSync(`git branch ${name}${startArg}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
}

/**
 * Fetch from origin.
 */
export function fetchOrigin(ref?: string, cwd?: string): boolean {
  try {
    const refArg = ref ? ` ${ref}` : ''
    execSync(`git fetch origin${refArg}`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Switch to an existing branch.
 */
export function checkoutBranch(name: string, cwd?: string): void {
  execSync(`git checkout ${name}`, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * Create an empty commit.
 */
export function createEmptyCommit(message: string, cwd?: string): void {
  execSync(`git commit --allow-empty -m "${message.replace(/"/g, '\\"')}"`, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * Check if in a git repository.
 */
export function isGitRepo(cwd?: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

// =============================================================================
// Worktree Conflict Detection & Resolution
// =============================================================================

/**
 * Prune stale worktree references.
 * This removes worktree entries that point to deleted directories,
 * which can prevent branch operations from succeeding.
 */
export function pruneWorktrees(cwd?: string): void {
  try {
    execSync('git worktree prune', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    // Ignore errors (e.g., not a git repo)
  }
}

/**
 * Check if a branch is already checked out in another worktree.
 * Returns the worktree path if so, null otherwise.
 */
export function getBranchWorktreePath(branch: string, cwd?: string): string | null {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const blocks = output.split('\n\n').filter(Boolean)

    for (const block of blocks) {
      const lines = block.split('\n')
      const worktreeLine = lines.find(l => l.startsWith('worktree '))
      const branchLine = lines.find(l => l.startsWith('branch '))

      if (!worktreeLine || !branchLine) continue

      const worktreePath = worktreeLine.replace('worktree ', '')
      const branchRef = branchLine.replace('branch refs/heads/', '')

      if (branchRef === branch) {
        return worktreePath
      }
    }
  } catch {
    // Ignore errors
  }
  return null
}

export interface WorktreeConflictResult {
  resolved: boolean
  conflictPath?: string
}

/**
 * Attempt to resolve a branch/worktree conflict.
 *
 * When a branch is checked out in another worktree, we:
 * 1. Prune stale worktree references (directory may have been deleted)
 * 2. Re-check if branch is still locked to another worktree
 *
 * Returns whether the conflict was resolved (stale ref pruned)
 * and the conflicting worktree path if still locked.
 */
export function resolveWorktreeConflict(branch: string, cwd?: string): WorktreeConflictResult {
  // Step 1: Prune stale worktree references
  pruneWorktrees(cwd)

  // Step 2: Re-check if branch is still checked out elsewhere
  const conflictPath = getBranchWorktreePath(branch, cwd)

  if (conflictPath) {
    return { resolved: false, conflictPath }
  }

  return { resolved: true }
}

/**
 * Checkout or create a branch, handling worktree conflicts.
 *
 * Attempts to checkout/create the branch. If blocked by a worktree conflict:
 * 1. Prunes stale worktrees and retries
 * 2. Returns an error with the conflicting worktree path if unresolvable
 *
 * @returns null on success, error message on failure
 */
export function checkoutBranchSafe(
  branch: string,
  baseBranch: string,
  cwd?: string
): string | null {
  const branchAlreadyExists = branchExists(branch, cwd)

  try {
    if (branchAlreadyExists) {
      execSync(`git checkout ${branch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } else {
      execSync(`git checkout -b ${branch} ${baseBranch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }
    return null
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)

    // Check if this is a worktree conflict
    if (errorMsg.includes('is already checked out at') || errorMsg.includes('is already used by worktree')) {
      // Try to resolve by pruning stale worktrees
      const resolution = resolveWorktreeConflict(branch, cwd)

      if (resolution.resolved) {
        // Stale ref was pruned — retry the checkout
        try {
          if (branchAlreadyExists) {
            execSync(`git checkout ${branch}`, {
              cwd,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
          } else {
            execSync(`git checkout -b ${branch} ${baseBranch}`, {
              cwd,
              stdio: ['pipe', 'pipe', 'pipe'],
            })
          }
          return null
        } catch (retryError) {
          return `Branch "${branch}" checkout failed after worktree cleanup: ${retryError instanceof Error ? retryError.message : retryError}`
        }
      }

      return `Branch "${branch}" is already checked out in worktree at ${resolution.conflictPath}. ` +
        'The other worktree must be removed first, or use a different agent/branch.'
    }

    // Non-worktree error
    return `Could not checkout branch "${branch}": ${errorMsg}`
  }
}
