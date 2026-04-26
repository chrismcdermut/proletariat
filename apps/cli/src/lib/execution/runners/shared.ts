/**
 * Shared Runner Utilities — Barrel Re-export
 *
 * This module re-exports all shared utilities from sub-modules.
 * Runner modules import from this file for convenience.
 *
 * Sub-modules:
 * - docker-credentials.ts — Credential volume + host creds + tmux keychain
 * - executor.ts — Executor command building + preflight checks
 * - docker-management.ts — Container lifecycle (create, setup, ensure, etc.)
 * - prompt-builder.ts — Integration commands + orchestrator/ticket prompts
 */

import { spawn, execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  ExecutionEnvironment,
  DisplayMode,
  OutputMode,
  PermissionMode,
  SessionManager,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
  normalizeEnvironment,
} from '../types.js'
import type { TerminalApp } from '../types.js'
import { getSetTitleCommands } from '../../terminal.js'
import { readDevcontainerJson, generateOrchestratorDockerfile, generateEntrypointScript } from '../devcontainer.js'
import type { OrchestratorDockerOptions } from '../devcontainer.js'
import { getCodexCommand, resolveCodexExecutionContext, validateCodexMode, CodexModeError } from '../codex-adapter.js'
import { resolveToolsForSpawn } from '../../tool-registry/index.js'

// =============================================================================
// Runner Interface
// =============================================================================

export interface RunnerResult {
  success: boolean
  pid?: string
  containerId?: string
  sessionId?: string
  logPath?: string
  error?: string
}

export type Runner = (
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
) => Promise<RunnerResult>

// =============================================================================
// Terminal Title Helpers
// =============================================================================

/**
 * Build a unified name for tmux sessions, window names, and tab titles.
 * Format: "{ticketId}-{action}-{agentName}"
 *
 * Orchestrator sessions use HQ-scoped naming:
 * Format: "prlt-orchestrator-{hqName}-{agentName}"
 * This must match buildOrchestratorSessionName() in orchestrator/start.ts
 * so that `orchestrator status` can find the running session.
 */
export function buildSessionName(context: ExecutionContext): string {
  // Orchestrator sessions use HQ-scoped naming for consistency with
  // buildOrchestratorSessionName() used by status/start commands
  if (context.isOrchestrator && context.hqName) {
    const safeHqName = (context.hqName || 'default')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'default'
    const safeName = (context.agentName || 'main')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'main'
    return `prlt-orchestrator-${safeHqName}-${safeName}`
  }

  const action = (context.actionName || 'work')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const agent = context.agentName || 'agent'
  // Prefer external provider key (e.g. PRLT-1065) over internal PMO ID (TKT-xxx) for session names
  const ticketId = context.externalTicketId || context.ticketId
  return `${ticketId}-${action}-${agent}`
}

export function buildWindowTitle(context: ExecutionContext): string {
  return buildSessionName(context)
}

export function buildTmuxWindowName(context: ExecutionContext): string {
  return buildSessionName(context)
}

// =============================================================================
// Control Mode Helpers (iTerm -CC integration)
// =============================================================================

export function shouldUseControlMode(terminalApp: TerminalApp, controlModeEnabled: boolean): boolean {
  return terminalApp === 'iTerm' && controlModeEnabled
}

export function buildTmuxMouseOption(_useControlMode: boolean): string {
  return ' \\; set-option -g mouse on'
}

/**
 * Build tmux set-titles options string.
 * Uses \\; which produces \; in the output — required so that
 * bash interprets the semicolons as literal characters (not command
 * separators) and passes them through to tmux as tmux command separators.
 *
 * PRLT-1351: Extracted to prevent escaping divergence between host.ts
 * and devcontainer-tmux.ts (where \; in a JS template literal silently
 * becomes a bare ; and bash runs set-option as a shell command).
 */
export function buildTmuxTitleOptions(): string {
  return ' \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"'
}

export function buildTmuxAttachCommand(useControlMode: boolean, includeUnicodeFlag: boolean = false): string {
  const unicodeFlag = includeUnicodeFlag ? '-u ' : ''
  if (useControlMode) {
    return `tmux -u -CC attach -d`
  }
  return `tmux ${unicodeFlag}attach -d`
}

export function configureITermTmuxPreferences(mode: 'tab' | 'window'): void {
  try {
    const windowModeValue = mode === 'tab' ? 2 : 1
    execSync(`defaults write com.googlecode.iterm2 OpenTmuxWindowsIn -int ${windowModeValue}`, { stdio: 'pipe' })
    execSync(`defaults write com.googlecode.iterm2 AutoHideTmuxClientSession -bool true`, { stdio: 'pipe' })
  } catch {
    // Non-fatal
  }
}

export function configureITermTmuxWindowMode(mode: 'tab' | 'window'): void {
  configureITermTmuxPreferences(mode)
}

// =============================================================================
// GitHub Token Check
// =============================================================================

export function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', stdio: 'pipe' }).trim()
    if (token) return token
  } catch {
    // gh auth token failed
  }
  return null
}

export function isGitHubTokenAvailable(): boolean {
  return getGitHubToken() !== null
}

// =============================================================================
// GitHub Token Scopes (PRLT-1095)
// =============================================================================

/**
 * Get the OAuth scopes of the current GitHub token.
 * Parses `gh auth status` output to extract the "Token scopes:" line.
 * Returns an array of scope strings (e.g. ['repo', 'workflow']).
 */
export function getGitHubTokenScopes(): string[] {
  try {
    // gh auth status writes to stderr
    const output = execSync('gh auth status', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 })
    return parseScopesFromAuthStatus(output)
  } catch (error: unknown) {
    // gh auth status exits non-zero when not authenticated, but still writes status to stderr
    const stderr = (error as { stderr?: string })?.stderr || ''
    if (stderr) {
      return parseScopesFromAuthStatus(stderr)
    }
    return []
  }
}

/**
 * Parse scope strings from gh auth status output.
 * Handles both active and inactive account entries — returns scopes from the active account.
 */
export function parseScopesFromAuthStatus(output: string): string[] {
  const lines = output.split('\n')
  let inActiveAccount = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Track whether we're in the active account block
    if (trimmed.startsWith('- Active account: true')) {
      inActiveAccount = true
      continue
    }
    if (trimmed.startsWith('- Active account: false')) {
      inActiveAccount = false
      continue
    }

    // Only parse scopes from the active account
    if (inActiveAccount && trimmed.startsWith('- Token scopes:')) {
      const scopePart = trimmed.replace('- Token scopes:', '').trim()
      if (!scopePart || scopePart === "''") return []
      return scopePart
        .replace(/^'|'$/g, '')
        .split(',')
        .map(s => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
    }
  }

  // Fallback: if no "Active account" markers found, parse first Token scopes line
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- Token scopes:')) {
      const scopePart = trimmed.replace('- Token scopes:', '').trim()
      if (!scopePart || scopePart === "''") return []
      return scopePart
        .replace(/^'|'$/g, '')
        .split(',')
        .map(s => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
    }
  }

  return []
}

/**
 * Check if the current GitHub token has the 'workflow' scope.
 * The workflow scope is required to push changes to .github/workflows/ files.
 */
export function hasWorkflowScope(): boolean {
  const scopes = getGitHubTokenScopes()
  return scopes.includes('workflow')
}

/**
 * Attempt to ensure the GitHub token has workflow scope.
 * If the current token lacks it, tries `gh auth refresh -s workflow` to add the scope.
 * Returns true if workflow scope is (now) available, false otherwise.
 */
export function ensureWorkflowScope(): boolean {
  if (hasWorkflowScope()) return true

  console.debug('[runners:github] Token missing workflow scope, attempting gh auth refresh...')
  try {
    execSync('gh auth refresh -h github.com -s workflow', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    })
    // Re-fetch the token after refresh so env vars pick up the new one
    try {
      const refreshedToken = execSync('gh auth token', { encoding: 'utf-8', stdio: 'pipe' }).trim()
      if (refreshedToken) {
        process.env.GITHUB_TOKEN = refreshedToken
        process.env.GH_TOKEN = refreshedToken
      }
    } catch {
      // Non-fatal — token refresh may have worked but re-fetch failed
    }
    console.debug('[runners:github] Successfully added workflow scope to token')
    return true
  } catch {
    console.debug('[runners:github] Failed to refresh token with workflow scope (may require interactive auth)')
    return false
  }
}

// =============================================================================
// Docker Status Check
// =============================================================================

export type DockerDaemonStatus = {
  available: boolean
  reason: 'ready' | 'not-installed' | 'daemon-not-ready'
  message: string
}

export function checkDockerDaemon(): DockerDaemonStatus {
  try {
    execSync('which docker', { stdio: 'pipe', timeout: 3000 })
  } catch {
    return { available: false, reason: 'not-installed', message: 'Docker is not installed.' }
  }
  const timeout = 5000
  try {
    execSync('docker ps -q --no-trunc', { stdio: 'pipe', timeout })
    return { available: true, reason: 'ready', message: 'Docker daemon is ready.' }
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer })?.stderr?.toString() || ''
    const isTimeout = (error as { killed?: boolean })?.killed === true
    let message: string
    if (isTimeout) {
      message = 'Docker daemon is not responding (timed out after 5s). Docker Desktop may be initializing or stuck — check for license/login prompts.'
    } else if (stderr.includes('500') || stderr.includes('Internal Server Error')) {
      message = 'Docker daemon is returning errors (500). Docker Desktop needs attention — check for license/login prompts.'
    } else if (stderr.includes('connect') || stderr.includes('Cannot connect') || stderr.includes('Is the docker daemon running')) {
      message = 'Docker daemon is not running. Start Docker Desktop and try again.'
    } else {
      message = `Docker daemon is not ready: ${stderr.trim() || 'unknown error'}. Check Docker Desktop status.`
    }
    return { available: false, reason: 'daemon-not-ready', message }
  }
}

export function isDockerRunning(): boolean {
  return checkDockerDaemon().available
}

/** @deprecated No longer required - we use raw Docker commands now */
export function isDevcontainerCliInstalled(): boolean {
  return true
}

// =============================================================================
// Re-exports from sub-modules
// =============================================================================

export {
  CLAUDE_CREDENTIALS_VOLUME,
  credentialsVolumeExists,
  dockerCredentialsExist,
  getDockerCredentialInfo,
  hostCredentialsExist,
  ensureTmuxServerHasKeychainAccess,
  copyClaudeCredentials,
  refreshCredentialVolume,
  CREDENTIAL_SYNC_FILES,
} from './docker-credentials.js'

export {
  getExecutorCommand,
  isClaudeExecutor,
  getExecutorDisplayName,
  getExecutorPackage,
  PreflightResult,
  checkExecutorOnHost,
  checkExecutorInContainer,
  runExecutorPreflight,
} from './executor.js'

export {
  getHostPrltVersion,
  getHostClaudeCodeVersion,
  getAgentContainerName,
  getContainerName,
  getImageName,
  containerExists,
  isContainerRunning,
  getContainerId,
  buildDockerImage,
  imageExists,
  buildContainerMounts,
  createDockerContainer,
  runContainerSetup,
  ensureDockerContainer,
  ensureDockerContainerDetailed,
  verifyWorkspaceMount,
  verifyCredentialMount,
  seedClaudeOnboarding,
  checkDockerMemoryCapacity,
} from './docker-management.js'

export type { SpawnStageError, EnsureDockerContainerResult } from './docker-management.js'

export {
  buildIntegrationCommandsSection,
  buildOrchestratorSystemPrompt,
  buildPrompt,
} from './prompt-builder.js'

// Re-export Node modules and external deps used by runner modules
export {
  spawn,
  execSync,
  fs,
  path,
  os,
  fileURLToPath,
  ExecutionEnvironment,
  DisplayMode,
  OutputMode,
  PermissionMode,
  SessionManager,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
  normalizeEnvironment,
  getSetTitleCommands,
  readDevcontainerJson,
  generateOrchestratorDockerfile,
  generateEntrypointScript,
  getCodexCommand,
  resolveCodexExecutionContext,
  validateCodexMode,
  CodexModeError,
  resolveToolsForSpawn,
}
export type { TerminalApp, OrchestratorDockerOptions }
