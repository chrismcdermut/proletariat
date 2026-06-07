/**
 * Executor Command Helpers
 *
 * Functions for building executor commands, checking executor availability,
 * and running preflight checks across different execution environments.
 */

import { execSync } from 'node:child_process'
import {
  ExecutionEnvironment,
  PermissionMode,
  ExecutorType,
  normalizeEnvironment,
} from '../types.js'
import { getCodexCommand } from '../codex-adapter.js'

export function getExecutorCommand(
  executor: ExecutorType,
  prompt: string,
  skipPermissions: boolean = true,
  binOverride?: string,
): { cmd: string; args: string[] } {
  // PRLT-1369: --executor-bin overrides the default binary (e.g. wrap claude with
  // a custom script, or point at an alternate install). 'custom' executor keeps
  // its echo fallback unless the user explicitly supplies --executor-bin.
  switch (executor) {
    case 'claude-code': {
      const cmd = binOverride || 'claude'
      if (skipPermissions) {
        return { cmd, args: ['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--effort', 'high', prompt] }
      }
      return { cmd, args: [prompt] }
    }
    case 'codex': {
      const codexPermission: PermissionMode = skipPermissions ? 'danger' : 'safe'
      const codexResult = getCodexCommand(prompt, codexPermission, 'interactive')
      return { cmd: binOverride || codexResult.cmd, args: codexResult.args }
    }
    case 'custom':
      if (binOverride) {
        return { cmd: binOverride, args: [prompt] }
      }
      return { cmd: 'echo', args: ['Custom executor not configured'] }
    default: {
      const cmd = binOverride || 'claude'
      if (skipPermissions) {
        return { cmd, args: ['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--effort', 'high', prompt] }
      }
      return { cmd, args: [prompt] }
    }
  }
}

/**
 * Check if an executor is Claude Code.
 */
export function isClaudeExecutor(executor: ExecutorType): boolean {
  return executor === 'claude-code'
}

/**
 * Get the display name for an executor type.
 */
export function getExecutorDisplayName(executor: ExecutorType): string {
  switch (executor) {
    case 'claude-code': return 'Claude Code'
    case 'codex': return 'Codex'
    case 'custom': return 'Custom'
    default: return 'Claude Code'
  }
}

/**
 * Get the npm package name for an executor (for container installation).
 */
export function getExecutorPackage(executor: ExecutorType): string | null {
  switch (executor) {
    case 'claude-code': return '@anthropic-ai/claude-code'
    case 'codex': return '@openai/codex'
    case 'custom': return null
    default: return '@anthropic-ai/claude-code'
  }
}

export interface PreflightResult {
  ok: boolean
  error?: string
}

/**
 * Check executor binary availability on host.
 */
export function checkExecutorOnHost(executor: ExecutorType): PreflightResult {
  const { cmd } = getExecutorCommand(executor, 'preflight')
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' })
    return { ok: true }
  } catch {
    const pkg = getExecutorPackage(executor)
    const installHint = pkg ? `Install it with: npm install -g ${pkg}` : 'Install and configure the executor binary.'
    return {
      ok: false,
      error: `${getExecutorDisplayName(executor)} CLI not found on host (missing "${cmd}"). ${installHint}`,
    }
  }
}

/**
 * Check executor binary availability inside a container.
 */
export function checkExecutorInContainer(executor: ExecutorType, containerId: string): PreflightResult {
  const { cmd } = getExecutorCommand(executor, 'preflight')
  try {
    execSync(`docker exec ${containerId} sh -lc 'command -v ${cmd}'`, { stdio: 'pipe' })
    return { ok: true }
  } catch {
    const pkg = getExecutorPackage(executor)
    const installHint = pkg ? `Container image is missing ${pkg}.` : `Container image is missing "${cmd}".`
    return {
      ok: false,
      error: `${getExecutorDisplayName(executor)} CLI not found in container (missing "${cmd}"). ${installHint}`,
    }
  }
}

/**
 * Run executor preflight checks for the target environment.
 */
export function runExecutorPreflight(
  environment: ExecutionEnvironment,
  executor: ExecutorType,
  options?: { containerId?: string }
): PreflightResult {
  const env = normalizeEnvironment(environment)

  if (env === 'host' || env === 'sandbox') {
    return checkExecutorOnHost(executor)
  }

  if (env === 'devcontainer' && options?.containerId) {
    return checkExecutorInContainer(executor, options.containerId)
  }

  return { ok: true }
}
