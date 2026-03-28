/**
 * Preflight Validation for `work start`
 *
 * Validates the entire environment before spawning an agent.
 * Used by both `--dry-run` mode (report all issues upfront) and
 * normal execution (fail fast with specific error messages).
 *
 * @see PRLT-1132 — Better error messages + --dry-run flag
 */

import { checkDockerDaemon, isGitHubTokenAvailable, isClaudeExecutor, dockerCredentialsExist } from './runners/index.js'
import { hasDevcontainerConfig } from './devcontainer.js'
import { getAuthMethod } from './config.js'
import { isGHInstalled, isGHAuthenticated } from '../pr/index.js'
import type { ExecutorType } from './types.js'
import type Database from 'better-sqlite3'

// =============================================================================
// Types
// =============================================================================

export type PreflightCheckName =
  | 'docker'
  | 'devcontainer'
  | 'credentials'
  | 'github-token'
  | 'gh-cli'
  | 'ticket'
  | 'agent-dir'

export type PreflightSeverity = 'error' | 'warning'

export interface PreflightCheckResult {
  name: PreflightCheckName
  label: string
  passed: boolean
  severity: PreflightSeverity
  message: string
  fix?: string
}

export interface PreflightReport {
  passed: boolean
  checks: PreflightCheckResult[]
  errors: PreflightCheckResult[]
  warnings: PreflightCheckResult[]
}

// =============================================================================
// Individual Checks
// =============================================================================

function checkDocker(environment: string): PreflightCheckResult {
  if (environment !== 'devcontainer') {
    return {
      name: 'docker',
      label: 'Docker daemon',
      passed: true,
      severity: 'error',
      message: 'Skipped (host environment)',
    }
  }

  const status = checkDockerDaemon()
  if (status.available) {
    return {
      name: 'docker',
      label: 'Docker daemon',
      passed: true,
      severity: 'error',
      message: 'Docker daemon is ready',
    }
  }

  return {
    name: 'docker',
    label: 'Docker daemon',
    passed: false,
    severity: 'error',
    message: status.message,
    fix: status.reason === 'not-installed'
      ? 'Install Docker Desktop: https://www.docker.com/products/docker-desktop/'
      : 'Start Docker Desktop, or use --run-on-host to run on host instead',
  }
}

function checkDevcontainerConfig(agentDir: string | null, environment: string): PreflightCheckResult {
  if (environment !== 'devcontainer') {
    return {
      name: 'devcontainer',
      label: 'Devcontainer config',
      passed: true,
      severity: 'warning',
      message: 'Skipped (host environment)',
    }
  }

  if (!agentDir) {
    return {
      name: 'devcontainer',
      label: 'Devcontainer config',
      passed: false,
      severity: 'error',
      message: 'Agent directory not available — cannot check for devcontainer config',
      fix: 'Ensure the agent directory exists or use --ephemeral to create one',
    }
  }

  if (hasDevcontainerConfig(agentDir)) {
    return {
      name: 'devcontainer',
      label: 'Devcontainer config',
      passed: true,
      severity: 'warning',
      message: 'Devcontainer configuration found',
    }
  }

  return {
    name: 'devcontainer',
    label: 'Devcontainer config',
    passed: false,
    severity: 'warning',
    message: `No .devcontainer/devcontainer.json found in agent directory`,
    fix: 'Use --run-on-host to run on host, or the devcontainer will be auto-generated',
  }
}

function checkCredentials(
  environment: string,
  executor: ExecutorType,
  db: Database.Database | null,
): PreflightCheckResult {
  if (environment !== 'devcontainer' || !isClaudeExecutor(executor)) {
    return {
      name: 'credentials',
      label: 'Agent credentials',
      passed: true,
      severity: 'error',
      message: 'Skipped (not applicable)',
    }
  }

  // Check saved auth method
  const savedAuthMethod = db ? getAuthMethod(db) : null

  if (savedAuthMethod === 'apikey') {
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        name: 'credentials',
        label: 'Agent credentials',
        passed: true,
        severity: 'error',
        message: 'API key is set (ANTHROPIC_API_KEY)',
      }
    }
    return {
      name: 'credentials',
      label: 'Agent credentials',
      passed: false,
      severity: 'error',
      message: 'Saved auth method is "apikey" but ANTHROPIC_API_KEY is not set',
      fix: 'Set ANTHROPIC_API_KEY in your environment, or run `prlt agent auth` to switch to OAuth',
    }
  }

  // OAuth or no saved preference — check Docker credentials
  if (dockerCredentialsExist()) {
    return {
      name: 'credentials',
      label: 'Agent credentials',
      passed: true,
      severity: 'error',
      message: 'OAuth credentials found',
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'credentials',
      label: 'Agent credentials',
      passed: true,
      severity: 'warning',
      message: 'No OAuth credentials, but ANTHROPIC_API_KEY is available (pass --use-api-key to use it)',
    }
  }

  return {
    name: 'credentials',
    label: 'Agent credentials',
    passed: false,
    severity: 'error',
    message: 'No agent credentials found — OAuth credentials not configured and ANTHROPIC_API_KEY not set',
    fix: 'Run `prlt agent auth` to set up OAuth credentials, or set ANTHROPIC_API_KEY',
  }
}

function checkGitHubToken(environment: string): PreflightCheckResult {
  if (environment !== 'devcontainer') {
    return {
      name: 'github-token',
      label: 'GitHub token',
      passed: true,
      severity: 'warning',
      message: 'Skipped (host environment — uses local git config)',
    }
  }

  if (isGitHubTokenAvailable()) {
    return {
      name: 'github-token',
      label: 'GitHub token',
      passed: true,
      severity: 'warning',
      message: 'GitHub token available for git operations',
    }
  }

  return {
    name: 'github-token',
    label: 'GitHub token',
    passed: false,
    severity: 'warning',
    message: 'GitHub token not found — git push may fail inside container',
    fix: 'Run `gh auth login` to authenticate with GitHub',
  }
}

function checkGhCli(): PreflightCheckResult {
  if (!isGHInstalled()) {
    return {
      name: 'gh-cli',
      label: 'GitHub CLI (gh)',
      passed: false,
      severity: 'warning',
      message: 'GitHub CLI (gh) not installed — PR creation will not work',
      fix: 'Install gh: https://cli.github.com/',
    }
  }

  if (!isGHAuthenticated()) {
    return {
      name: 'gh-cli',
      label: 'GitHub CLI (gh)',
      passed: false,
      severity: 'warning',
      message: 'GitHub CLI not authenticated — PR creation will not work',
      fix: 'Run `gh auth login` to authenticate',
    }
  }

  return {
    name: 'gh-cli',
    label: 'GitHub CLI (gh)',
    passed: true,
    severity: 'warning',
    message: 'GitHub CLI installed and authenticated',
  }
}

function checkTicket(ticket: { id: string; title: string } | null): PreflightCheckResult {
  if (!ticket) {
    return {
      name: 'ticket',
      label: 'Ticket',
      passed: false,
      severity: 'error',
      message: 'Ticket not found',
      fix: 'Create a ticket first with `prlt ticket create`, or check the ticket ID',
    }
  }

  return {
    name: 'ticket',
    label: 'Ticket',
    passed: true,
    severity: 'error',
    message: `Found: ${ticket.id} — ${ticket.title}`,
  }
}

function checkAgentDir(agentDir: string | null): PreflightCheckResult {
  if (!agentDir) {
    return {
      name: 'agent-dir',
      label: 'Agent directory',
      passed: true,
      severity: 'warning',
      message: 'Will be created during spawn (ephemeral agent)',
    }
  }

  // We check existence at this point only if an agentDir is specified
  // During --dry-run, the agent dir may not exist yet (it gets created during spawn)
  return {
    name: 'agent-dir',
    label: 'Agent directory',
    passed: true,
    severity: 'warning',
    message: `Agent directory: ${agentDir}`,
  }
}

// =============================================================================
// Preflight Validation Entry Point
// =============================================================================

export interface PreflightOptions {
  /** Target execution environment */
  environment: string
  /** Executor type (e.g., 'claude-code') */
  executor: ExecutorType
  /** Workspace database (for auth method lookups) */
  db: Database.Database | null
  /** Ticket being worked on (null if not yet resolved) */
  ticket: { id: string; title: string } | null
  /** Agent directory (null if not yet created) */
  agentDir: string | null
}

/**
 * Run all preflight checks and return a report.
 * Does NOT throw — caller decides how to handle failures.
 */
export function runPreflightChecks(options: PreflightOptions): PreflightReport {
  const checks: PreflightCheckResult[] = [
    checkTicket(options.ticket),
    checkDocker(options.environment),
    checkDevcontainerConfig(options.agentDir, options.environment),
    checkCredentials(options.environment, options.executor, options.db),
    checkGitHubToken(options.environment),
    checkGhCli(),
    checkAgentDir(options.agentDir),
  ]

  const errors = checks.filter(c => !c.passed && c.severity === 'error')
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning')

  return {
    passed: errors.length === 0,
    checks,
    errors,
    warnings,
  }
}

/**
 * Format a preflight report for human-readable output.
 */
export function formatPreflightReport(report: PreflightReport): string {
  const lines: string[] = []

  for (const check of report.checks) {
    const icon = check.passed ? '✓' : check.severity === 'error' ? '✗' : '⚠'
    lines.push(`  ${icon} ${check.label}: ${check.message}`)
    if (!check.passed && check.fix) {
      lines.push(`    → Fix: ${check.fix}`)
    }
  }

  return lines.join('\n')
}
