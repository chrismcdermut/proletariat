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
 * - {ticketId}/{type}/{owner}/{agent}/{description} - full format with ticket
 * - {ticketId}/{type}/{owner}/{description} - ticket format without agent (manual)
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
      error: 'Invalid ticket branch format. Expected: {ticketId}/{type}/{owner}/{description} or {ticketId}/{type}/{owner}/{agent}/{description}',
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

  if (!isKebabCase(owner)) {
    return {
      valid: false,
      error: `Owner name must be kebab-case: "${owner}"`,
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
 * - With ticket + agent: {ticketId}/{type}/{owner}/{agent}/{description}
 * - With ticket (manual): {ticketId}/{type}/{owner}/{description}
 * - Without ticket: {type}/{owner}/{description}
 * - Minimal: {type}/{description}
 */
export function buildBranchName(
  type: BranchType,
  description: string,
  options?: {
    ticketId?: string
    owner?: string
    agent?: string
  }
): string {
  const { ticketId, owner, agent } = options || {}

  if (ticketId) {
    // Ticket-first format
    if (agent && owner) {
      return `${ticketId}/${type}/${owner}/${agent}/${description}`
    }
    if (owner) {
      return `${ticketId}/${type}/${owner}/${description}`
    }
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
