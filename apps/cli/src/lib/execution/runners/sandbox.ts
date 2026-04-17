/**
 * Sandbox Runner - srt-based sandbox on host
 *
 * Runs commands in an srt sandbox for filesystem and network isolation.
 * Falls back to host runner if srt is not installed.
 */

import {
  execSync,
  path,
  os,
  DisplayMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
} from './shared.js'

import { RunnerResult } from './shared.js'
import { runHost } from './host.js'

// =============================================================================
// Sandbox Utilities
// =============================================================================

/**
 * Check if srt (sandbox-runtime) is installed on the host.
 */
export function isSrtInstalled(): boolean {
  try {
    execSync('which srt', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Build the srt command with filesystem and network restrictions.
 *
 * Filesystem policy (read-restriction philosophy from claude-code-sandbox):
 * - Read/write: agent worktree directory
 * - Read-only: repo source (if different from worktree)
 * - Read-only: additional configured read paths
 * - Deny: home directory, system paths, other repos
 *
 * Network policy:
 * - Allow: configured domains (GitHub, Anthropic API, npm registries, etc.)
 * - Deny: everything else
 */
export function buildSrtCommand(
  innerCommand: string,
  context: ExecutionContext,
  config: ExecutionConfig,
): string {
  const args: string[] = ['srt']

  // Filesystem: always allow read/write to agent worktree
  args.push(`--fs-write=${context.worktreePath}`)

  // Allow read/write to the agent directory (parent of worktree, contains .devcontainer etc.)
  if (context.agentDir && context.agentDir !== context.worktreePath) {
    args.push(`--fs-write=${context.agentDir}`)
  }

  // Allow read/write to HQ scripts directory (for temp script files)
  if (context.hqPath) {
    const scriptsDir = path.join(context.hqPath, '.proletariat', 'scripts')
    args.push(`--fs-write=${scriptsDir}`)
  }

  // Allow read access to additional configured paths
  for (const readPath of config.sandbox.allowReadPaths) {
    args.push(`--fs-read=${readPath}`)
  }

  // Allow write access to additional configured paths
  for (const writePath of config.sandbox.allowWritePaths) {
    args.push(`--fs-write=${writePath}`)
  }

  // Allow read to temp directory (needed for script execution)
  args.push(`--fs-write=${os.tmpdir()}`)

  // Network: merge sandbox domains with firewall allowlist and action-level allowlist (PRLT-1079)
  const allDomains = new Set([
    ...(context.networkAllowlist || []),
    ...config.firewall.allowlistDomains,
    ...config.sandbox.networkDomains,
  ])
  for (const domain of allDomains) {
    args.push(`--net-allow=${domain}`)
  }

  // The inner command to execute inside the sandbox
  args.push('--')
  args.push(innerCommand)

  return args.join(' ')
}

// =============================================================================
// Sandbox Runner
// =============================================================================

/**
 * Run command in an srt sandbox on the host machine.
 * Uses the same tmux session approach as the host runner, but wraps the
 * executor command with srt for filesystem and network isolation.
 *
 * Falls back to host runner with warning if srt is not installed.
 */
export async function runSandbox(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal'
): Promise<RunnerResult> {
  // Check if srt is installed
  if (!isSrtInstalled()) {
    if (config.sandbox.fallbackToHost) {
      // Log warning via stderr (will be visible in terminal)
      process.stderr.write(
        '\u001B[33m⚠️  srt (sandbox-runtime) not installed. Falling back to host execution.\n' +
        '   Install srt for filesystem + network isolation: https://github.com/anthropic-experimental/sandbox-runtime\u001B[0m\n'
      )
      // Fall back to host runner
      return runHost(context, executor, config, displayMode)
    }
    return {
      success: false,
      error: 'srt (sandbox-runtime) is not installed.\n\n' +
        'Install it from: https://github.com/anthropic-experimental/sandbox-runtime\n' +
        'Or set sandbox.fallbackToHost to true in execution config to fall back to host.',
    }
  }

  // Delegate to host runner — the sandbox wrapping happens at the script level
  // We set a flag on context so the host runner knows to wrap with srt
  const sandboxContext: ExecutionContext = {
    ...context,
    executionEnvironment: 'sandbox',
  }

  return runHost(sandboxContext, executor, config, displayMode)
}
