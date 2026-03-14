/**
 * Shared Runner Utilities
 *
 * Common utilities used across multiple runner implementations:
 * - Session name builders and terminal title helpers
 * - Control mode helpers (iTerm -CC integration)
 * - Docker credential helpers
 * - Tmux server keychain access
 * - Executor command helpers
 * - GitHub token checks
 * - Docker daemon status checks
 * - Docker container management
 * - Integration commands for agent prompts
 * - Orchestrator prompt building
 * - Prompt building (ticket + action)
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
import { readDevcontainerJson, generateOrchestratorDockerfile } from '../devcontainer.js'
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
 * Example: "TKT-347-implement-altman"
 */
export function buildSessionName(context: ExecutionContext): string {
  // Sanitize action name: strip non-alphanumeric chars for shell/tmux safety (& breaks paths)
  const action = (context.actionName || 'work')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const agent = context.agentName || 'agent'
  return `${context.ticketId}-${action}-${agent}`
}

// Legacy aliases for backwards compatibility
export function buildWindowTitle(context: ExecutionContext): string {
  return buildSessionName(context)
}

export function buildTmuxWindowName(context: ExecutionContext): string {
  return buildSessionName(context)
}

// getSetTitleCommands is now imported from '../../terminal.js'

// =============================================================================
// Control Mode Helpers (iTerm -CC integration)
// =============================================================================

/**
 * Check if tmux control mode (-CC) should be used.
 * Control mode is only used with iTerm when controlMode is enabled in config.
 *
 * When control mode is active:
 * - iTerm handles scrolling, selection, and gestures natively
 * - tmux mouse mode should be disabled to avoid conflicts
 */
export function shouldUseControlMode(terminalApp: TerminalApp, controlModeEnabled: boolean): boolean {
  return terminalApp === 'iTerm' && controlModeEnabled
}

/**
 * Build the tmux mouse option string for session creation.
 * Enables mouse mode for scroll support in tmux.
 * To select text or switch tabs, hold Shift or Option to bypass tmux.
 */
export function buildTmuxMouseOption(_useControlMode: boolean): string {
  return ' \\; set-option -g mouse on'
}

/**
 * Build the tmux attach command based on control mode.
 * Uses -u -CC flags for iTerm control mode (native scrolling/selection).
 * -u forces UTF-8 mode which is required for proper iTerm integration.
 * Uses regular attach otherwise.
 */
export function buildTmuxAttachCommand(useControlMode: boolean, includeUnicodeFlag: boolean = false): string {
  const unicodeFlag = includeUnicodeFlag ? '-u ' : ''
  if (useControlMode) {
    // Always use -u with -CC for proper iTerm integration
    // -d detaches other clients to prevent multi-attach lockups
    return `tmux -u -CC attach -d`
  }
  // -d detaches other clients to prevent multi-attach lockups
  return `tmux ${unicodeFlag}attach -d`
}

/**
 * Configure iTerm tmux preferences for control mode.
 * - windowMode: whether tmux -CC opens windows as tabs or new windows
 * - autoHide: automatically bury/hide the control session (the terminal where -CC was run)
 * @param mode - 'tab' for tabs in current window, 'window' for new windows
 */
export function configureITermTmuxPreferences(mode: 'tab' | 'window'): void {
  try {
    // OpenTmuxWindowsIn: 0=native windows, 1=new window, 2=tabs in existing window
    const windowModeValue = mode === 'tab' ? 2 : 1
    execSync(`defaults write com.googlecode.iterm2 OpenTmuxWindowsIn -int ${windowModeValue}`, { stdio: 'pipe' })

    // AutoHideTmuxClientSession: hide the control channel terminal so it doesn't clutter
    execSync(`defaults write com.googlecode.iterm2 AutoHideTmuxClientSession -bool true`, { stdio: 'pipe' })
  } catch {
    // Non-fatal - preference setting failed but execution can continue
  }
}

// Legacy alias for backwards compatibility
export function configureITermTmuxWindowMode(mode: 'tab' | 'window'): void {
  configureITermTmuxPreferences(mode)
}

// =============================================================================
// Docker Credential Helpers
// =============================================================================

export const CLAUDE_CREDENTIALS_VOLUME = 'claude-credentials'

/**
 * Check if the claude-credentials Docker volume exists.
 */
export function credentialsVolumeExists(): boolean {
  try {
    execSync(`docker volume inspect ${CLAUDE_CREDENTIALS_VOLUME}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if valid Claude OAuth credentials exist in the Docker volume.
 * Returns true if OAuth credentials are stored (even if access token is expired,
 * since Claude Code handles refresh internally using stored refresh tokens).
 *
 * NOTE: This intentionally does NOT check for ANTHROPIC_API_KEY. If the user
 * has an API key but no OAuth credentials, we want to prompt them to set up
 * OAuth (which uses their Max subscription) rather than silently burning API credits.
 */
export function dockerCredentialsExist(): boolean {
  try {
    const result = execSync(
      `docker run --rm -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
      { stdio: 'pipe', encoding: 'utf-8' }
    )

    const creds = JSON.parse(result)
    // Check if OAuth credentials exist. Don't check expiration because
    // access tokens are short-lived but Claude Code handles token refresh
    // internally using stored refresh tokens.
    if (creds.claudeAiOauth?.accessToken) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Get Docker credential info for display.
 * Returns expiration date and subscription type if available.
 */
export function getDockerCredentialInfo(): { expiresAt: Date; subscriptionType?: string } | null {
  try {
    const result = execSync(
      `docker run --rm -v ${CLAUDE_CREDENTIALS_VOLUME}:/data alpine cat /data/.credentials.json 2>/dev/null`,
      { stdio: 'pipe', encoding: 'utf-8' }
    )

    const creds = JSON.parse(result)
    if (creds.claudeAiOauth?.expiresAt) {
      return {
        expiresAt: new Date(creds.claudeAiOauth.expiresAt),
        subscriptionType: creds.claudeAiOauth.subscriptionType,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Check if Claude Code authentication is available on the host system.
 * Returns true if any of:
 * 1. ANTHROPIC_API_KEY environment variable is set
 * 2. OAuth credentials exist in ~/.claude/.credentials.json (Claude Code 1.x)
 * 3. OAuth credentials exist in macOS keychain (Claude Code 2.x)
 *
 * This is used to validate auth before spawning host sessions (e.g., orchestrator)
 * to avoid creating stuck sessions when the keychain is locked (SSH contexts).
 */
export function hostCredentialsExist(): boolean {
  // Check for ANTHROPIC_API_KEY first (works in all contexts, including SSH)
  if (process.env.ANTHROPIC_API_KEY) {
    return true
  }

  // Check for OAuth credentials in ~/.claude/.credentials.json (Claude Code 1.x)
  try {
    const homeDir = process.env.HOME || os.homedir()
    const credPath = path.join(homeDir, '.claude', '.credentials.json')
    if (fs.existsSync(credPath)) {
      const credData = fs.readFileSync(credPath, 'utf-8')
      const creds = JSON.parse(credData)

      // Check if OAuth credentials exist (similar to Docker check)
      // Don't check expiration - Claude Code handles token refresh internally
      if (creds.claudeAiOauth?.accessToken) {
        return true
      }
    }
  } catch {
    // Fall through to keychain check
  }

  // Check for Claude Code 2.x keychain-based auth (macOS)
  // Claude Code 2.x stores OAuth tokens in the macOS keychain under service
  // "Claude Code-credentials". If the keychain is locked (e.g., SSH sessions),
  // this check will fail, which is the desired behavior — we want to surface
  // the error early rather than create stuck sessions.
  if (process.platform === 'darwin') {
    try {
      execSync('security find-generic-password -s "Claude Code-credentials" 2>/dev/null', {
        stdio: 'pipe',
        timeout: 5000,
      })
      return true
    } catch {
      // Keychain entry not found or keychain is locked
    }
  }

  return false
}

/**
 * Ensure tmux server has keychain access for Claude Code OAuth.
 *
 * On macOS, tmux sessions can lose access to the keychain if the tmux server
 * was started in a context without keychain access (e.g., from a background
 * process, SSH session, or parent process with restricted keychain access).
 *
 * This function:
 * 1. Checks if a tmux server is running
 * 2. Tests if it can access Claude Code OAuth credentials
 * 3. If not, restarts the tmux server to restore keychain access
 *
 * This runs transparently before spawning agent sessions, ensuring OAuth
 * authentication works without manual intervention.
 */
export async function ensureTmuxServerHasKeychainAccess(): Promise<void> {
  // Skip if no tmux server is running (will be started fresh with keychain access)
  try {
    const serverRunning = execSync('tmux list-sessions 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      stdio: 'pipe'
    })
    if (!serverRunning.trim()) {
      return // No server running, will start fresh
    }
  } catch {
    return // tmux not installed or no server running
  }

  // Test if tmux server can access Claude Code credentials
  // We spawn a test session and check if Claude Code can authenticate
  const testSession = `prlt-keychain-test-${Date.now()}`

  try {
    // Create test session
    execSync(`tmux new-session -d -s "${testSession}"`, { stdio: 'pipe' })

    // Send command to check Claude Code auth
    // Use 'unset CLAUDECODE' to avoid nested session error
    execSync(
      `tmux send-keys -t "${testSession}" "unset CLAUDECODE && claude -p 'test' 2>&1 | head -1" Enter`,
      { stdio: 'pipe' }
    )

    // Wait for response (Claude Code startup + auth check)
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Capture output
    const output = execSync(`tmux capture-pane -t "${testSession}" -p`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    })

    // Clean up test session
    execSync(`tmux kill-session -t "${testSession}"`, { stdio: 'pipe' })

    // Check if auth failed
    if (output.includes('Not logged in') || output.includes('Please run /login')) {
      // Keychain access is broken - restart tmux server
      // This happens silently - the next tmux session will have keychain access
      execSync('tmux kill-server', { stdio: 'pipe' })
      // TKT-099: Wait for the tmux server to fully stop before returning.
      // The old 500ms fixed delay was insufficient under load, causing the subsequent
      // `tmux new-session` to occasionally create a session on the dying server.
      // Poll for server shutdown with a reasonable timeout instead.
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 300))
        try {
          execSync('tmux list-sessions 2>/dev/null', { stdio: 'pipe' })
          // Server still alive, keep waiting
        } catch {
          // Server is gone — ready to proceed
          break
        }
      }
    }
  } catch (_error) {
    // Test session failed - clean up if it exists
    try {
      execSync(`tmux kill-session -t "${testSession}"`, { stdio: 'pipe' })
    } catch {
      // Ignore cleanup errors
    }
    // Continue - worst case, spawn will fail with clear error message
  }
}

// =============================================================================
// Executor Commands
// =============================================================================

export function getExecutorCommand(executor: ExecutorType, prompt: string, skipPermissions: boolean = true): { cmd: string; args: string[] } {
  switch (executor) {
    case 'claude-code':
      if (skipPermissions) {
        // Skip permissions - agent runs autonomously without prompting
        // Note: NO -p flag - we want interactive mode for streaming output in terminal
        // --permission-mode bypassPermissions: skips the "trust this folder" dialog
        // --dangerously-skip-permissions: skips tool permission checks
        // --effort high: skips the effort level prompt (TKT-1134)
        return { cmd: 'claude', args: ['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--effort', 'high', prompt] }
      }
      // Manual mode - will prompt for each action (still interactive, no -p)
      return { cmd: 'claude', args: [prompt] }
    case 'codex': {
      // Delegate to Codex adapter for deterministic mode mapping.
      // getExecutorCommand is called without display/output context, so we use
      // 'interactive' as default context (safe for validation — all permission modes
      // are valid with interactive). Runners that need stricter validation should
      // call the adapter directly with the actual execution context.
      const codexPermission: PermissionMode = skipPermissions ? 'danger' : 'safe'
      const codexResult = getCodexCommand(prompt, codexPermission, 'interactive')
      return { cmd: codexResult.cmd, args: codexResult.args }
    }
    case 'custom':
      // Custom executor should be configured
      return { cmd: 'echo', args: ['Custom executor not configured'] }
    default:
      if (skipPermissions) {
        // Note: NO -p flag - we want interactive mode for streaming output
        // --effort high: skips the effort level prompt (TKT-1134)
        return { cmd: 'claude', args: ['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', '--effort', 'high', prompt] }
      }
      return { cmd: 'claude', args: [prompt] }
  }
}

/**
 * Check if an executor is Claude Code.
 * Used to gate Claude-specific flags and configuration.
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

// =============================================================================
// GitHub Token Check
// =============================================================================

/**
 * Check if GitHub token is available for git push operations.
 * Checks environment variables first, then tries gh auth token.
 * Returns the token if available, null otherwise.
 */
export function getGitHubToken(): string | null {
  // Check environment variables first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN
  }

  // Try to get token from gh CLI
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', stdio: 'pipe' }).trim()
    if (token) {
      return token
    }
  } catch {
    // gh auth token failed - user not logged in
  }

  return null
}

/**
 * Check if GitHub token is available.
 * Returns true if token is available via env vars or gh CLI.
 */
export function isGitHubTokenAvailable(): boolean {
  return getGitHubToken() !== null
}

// =============================================================================
// Docker Status Check
// =============================================================================

/**
 * Docker daemon health check result (TKT-081).
 * Provides diagnostic info about why Docker isn't available.
 */
export type DockerDaemonStatus = {
  available: boolean
  /** 'ready' | 'not-installed' | 'daemon-not-ready' */
  reason: 'ready' | 'not-installed' | 'daemon-not-ready'
  /** Human-readable message for logging/display */
  message: string
}

/**
 * Check Docker daemon health with fast detection (TKT-081).
 *
 * Uses `docker ps` with a 5-second timeout to quickly detect:
 * - Docker not installed
 * - Docker installed but daemon unresponsive (stuck on license, initializing, 500 errors)
 * - Docker ready
 *
 * Total worst-case time: ~5 seconds (single attempt with timeout).
 */
export function checkDockerDaemon(): DockerDaemonStatus {
  // First: is docker even installed?
  try {
    execSync('which docker', { stdio: 'pipe', timeout: 3000 })
  } catch {
    return {
      available: false,
      reason: 'not-installed',
      message: 'Docker is not installed.',
    }
  }

  // Second: is the daemon responsive? Use `docker ps` — it's lightweight and
  // fails fast when the daemon returns 500s or hangs on GUI prompts.
  const timeout = 5000 // 5 seconds — enough for a healthy daemon, fast fail otherwise
  try {
    execSync('docker ps -q --no-trunc', { stdio: 'pipe', timeout })
    return {
      available: true,
      reason: 'ready',
      message: 'Docker daemon is ready.',
    }
  } catch (error: unknown) {
    // Parse the error to give actionable feedback
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

    return {
      available: false,
      reason: 'daemon-not-ready',
      message,
    }
  }
}

/**
 * Check if Docker daemon is running.
 * Returns true if Docker is available and responsive.
 *
 * For detailed diagnostics, use checkDockerDaemon() instead.
 */
export function isDockerRunning(): boolean {
  return checkDockerDaemon().available
}

/**
 * Check if the devcontainer CLI is installed.
 * Returns true if the CLI is available, false otherwise.
 * @deprecated No longer required - we use raw Docker commands now
 */
export function isDevcontainerCliInstalled(): boolean {
  // Always return true since we no longer require devcontainer CLI
  // We use raw Docker commands instead
  return true
}

// =============================================================================
// Docker Container Management (Raw Docker, no devcontainer CLI)
// =============================================================================

/**
 * Get the host's installed prlt CLI version.
 * Returns the semver version string (e.g., "0.3.35") or null if not available.
 * Used to ensure containers run the same prlt version as the host (TKT-1029).
 */
export function getHostPrltVersion(): string | null {
  try {
    const output = execSync('prlt --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const match = output.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Get the container name for an agent.
 * Format: prlt-agent-{agentName}
 */
export function getAgentContainerName(agentName: string): string {
  // Sanitize agent name for Docker container naming (alphanumeric, dash, underscore only)
  const sanitized = agentName.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `prlt-agent-${sanitized}`
}

// Alias for internal use
export const getContainerName = getAgentContainerName

/**
 * Get the image name for an agent.
 * Format: prlt-agent-{agentName}:latest
 */
export function getImageName(agentName: string): string {
  const sanitized = agentName.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `prlt-agent-${sanitized}:latest`
}

/**
 * Check if a Docker container exists (running or stopped).
 */
export function containerExists(containerName: string): boolean {
  try {
    execSync(`docker container inspect ${containerName}`, { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Check if a Docker container is running.
 */
export function isContainerRunning(containerName: string): boolean {
  try {
    const status = execSync(
      `docker container inspect -f '{{.State.Running}}' ${containerName}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim()
    return status === 'true'
  } catch {
    return false
  }
}

/**
 * Get the container ID for a running container.
 */
export function getContainerId(containerName: string): string | null {
  try {
    const containerId = execSync(
      `docker container inspect -f '{{.Id}}' ${containerName}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim()
    return containerId ? containerId.substring(0, 12) : null
  } catch {
    return null
  }
}

/**
 * Build Docker image for an agent from its Dockerfile.
 */
export function buildDockerImage(agentDir: string, imageName: string, buildArgs: Record<string, string> = {}): boolean {
  const dockerfilePath = path.join(agentDir, '.devcontainer', 'Dockerfile')
  if (!fs.existsSync(dockerfilePath)) {
    console.debug(`[runners:docker] Dockerfile not found at ${dockerfilePath}`)
    return false
  }

  try {
    // Build --build-arg flags
    const buildArgFlags = Object.entries(buildArgs)
      .map(([key, value]) => `--build-arg ${key}="${value}"`)
      .join(' ')

    const buildCmd = `docker build -t ${imageName} -f "${dockerfilePath}" ${buildArgFlags} "${path.join(agentDir, '.devcontainer')}"`
    console.debug(`[runners:docker] Building image: ${buildCmd}`)
    execSync(buildCmd, { stdio: 'pipe' })
    return true
  } catch (error) {
    console.debug(`[runners:docker] Failed to build image:`, error)
    return false
  }
}

/**
 * Check if a Docker image exists.
 */
export function imageExists(imageName: string): boolean {
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Create and start a Docker container for an agent.
 * Uses raw Docker commands instead of devcontainer CLI.
 */
export function createDockerContainer(
  context: ExecutionContext,
  containerName: string,
  imageName: string,
  config: ExecutionConfig,
  executor: ExecutorType = 'claude-code',
  prltInfo?: { registry: string; version: string }
): boolean {
  // Build mount flags
  // KEY: Use a named Docker volume for Claude credentials - this is how devcontainer.json
  // was handling it. The volume persists across containers, so login once = logged in everywhere.
  // This avoids corruption from concurrent writes to host filesystem.
  //
  // TKT-801: Use :cached mount option to reduce grpcfuse contention on Docker Desktop.
  // This improves performance and helps prevent kernel panics when multiple containers
  // mount the same paths concurrently.
  const mounts: string[] = [
    // Agent workspace
    `-v "${context.agentDir}:/workspace:cached"`,
    // HQ .proletariat directory (for database access) - use :cached to reduce contention
    ...(context.hqPath ? [`-v "${context.hqPath}/.proletariat:/hq/.proletariat:cached"`] : []),
    // PMO path - use :cached to reduce contention
    ...(context.pmoPath ? [`-v "${context.pmoPath}:/hq/pmo:cached"`] : []),
    // Mount parent repos for git worktree resolution - use :cached to reduce contention
    // NOTE: Cannot use :ro because git worktrees share the object store with parent repo.
    // Commits write to parent's .git/objects/ and refs update in .git/worktrees/<name>/
    // Worktree .git files reference paths like /Users/.../repos/{repoName}/.git/worktrees/name
    // These mounts make those paths accessible inside the container at /hq/repos/{repoName}
    ...(context.repoWorktrees || []).map(
      repoName => `-v "${context.hqPath}/repos/${repoName}:/hq/repos/${repoName}:cached"`
    ),
    // Claude credentials - shared named volume (login once, all containers share)
    // Only needed for Claude Code executor
    ...(isClaudeExecutor(executor) ? [`-v "claude-credentials:/home/node/.claude"`] : []),
  ]

  // Build environment flags
  const hasWorktrees = context.repoWorktrees && context.repoWorktrees.length > 0
  const firewallAllowlistDomains = [...new Set((config.firewall?.allowlistDomains || [])
    .map(domain => domain.trim().toLowerCase())
    .filter(domain => /^[a-z0-9.-]+$/.test(domain)))]
  const envVars: string[] = [
    `-e DEVCONTAINER=true`,
    `-e PRLT_HQ_PATH=/hq`,
    `-e PRLT_AGENT_NAME="${context.agentName}"`,
    `-e PRLT_HOST_PATH="${context.agentDir}"`,
    // Only pass ANTHROPIC_API_KEY if the user explicitly chose to use it (no OAuth creds).
    // Claude Code prefers API key over OAuth, so passing it would cause agents to burn
    // API credits instead of using Max subscription.
    ...(context.useApiKey && process.env.ANTHROPIC_API_KEY ? [`-e ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`] : []),
    ...(process.env.GITHUB_TOKEN ? [`-e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}"`] : []),
    ...(process.env.GH_TOKEN ? [`-e GH_TOKEN="${process.env.GH_TOKEN}"`] : []),
    ...(firewallAllowlistDomains.length > 0 ? [`-e PRLT_EXTRA_ALLOWLIST_DOMAINS="${firewallAllowlistDomains.join(',')}"`] : []),
    // NOTE: Do NOT pass CLAUDE_CODE_OAUTH_TOKEN - it overrides credentials file
    // and setup-token generates invalid tokens. Use "prlt agent auth" instead.
    // Set mount mode to worktree if we have repo worktrees - triggers git wrapper setup
    ...(hasWorktrees ? [`-e PRLT_MOUNT_MODE=worktree`] : []),
    // Pass prlt version info for setup-prlt.sh to verify/update at container start (TKT-1029)
    ...(prltInfo ? [
      `-e PRLT_REGISTRY="${prltInfo.registry}"`,
      `-e PRLT_VERSION="${prltInfo.version}"`,
    ] : []),
  ]

  // Resource limits
  const resourceFlags = [
    `--memory=${config.devcontainer.memory}`,
    `--cpus=${config.devcontainer.cpus}`,
  ]

  // Security flags - these provide the isolation
  const securityFlags = [
    '--cap-add=NET_ADMIN',   // For firewall setup
    '--cap-add=NET_RAW',     // For firewall setup
    // Note: After firewall is set up, the container is network-restricted
  ]

  try {
    const createCmd = [
      'docker run -d',
      `--name ${containerName}`,
      '--user node',
      '-w /workspace',
      ...mounts,
      ...envVars,
      ...resourceFlags,
      ...securityFlags,
      imageName,
      'sleep infinity',  // Keep container running
    ].join(' ')

    console.debug(`[runners:docker] Creating container: ${createCmd}`)
    execSync(createCmd, { stdio: 'pipe' })
    return true
  } catch (error) {
    console.debug(`[runners:docker] Failed to create container:`, error)
    return false
  }
}

/**
 * Run the post-start setup commands in a container.
 * This includes firewall initialization, prlt setup, and Claude settings.
 * @param containerId - Docker container ID
 * @param permissionMode - Permission mode: 'safe' requires approval, 'danger' skips checks
 * @param executor - Which executor is being used (determines Claude-specific setup)
 */
export function runContainerSetup(containerId: string, permissionMode: PermissionMode = 'safe', executor: ExecutorType = 'claude-code'): boolean {
  try {
    // Run firewall init (requires sudo since we're running as node user)
    execSync(
      `docker exec ${containerId} sudo /usr/local/bin/init-firewall.sh`,
      { stdio: 'pipe' }
    )
    // Run prlt setup
    execSync(
      `docker exec ${containerId} /usr/local/bin/setup-prlt.sh`,
      { stdio: 'pipe' }
    )
  } catch (error) {
    console.debug(`[runners:docker] Container setup scripts failed:`, error)
    // Continue - setup might partially work
  }

  // Configure pnpm to use container-local store to prevent contention
  // Multiple agents sharing the same pnpm store causes hangs and ERR_PNPM errors (TKT-718)
  // Each container gets its own store at /tmp/pnpm-store for reliability
  try {
    execSync(
      `docker exec ${containerId} pnpm config set store-dir /tmp/pnpm-store`,
      { stdio: 'pipe' }
    )
    console.debug(`[runners:docker] Configured pnpm store-dir to /tmp/pnpm-store`)
  } catch (error) {
    console.debug(`[runners:docker] Failed to configure pnpm store (pnpm may not be installed):`, error)
    // Non-fatal - pnpm may not be installed in all containers
  }

  // Copy Claude settings file (.claude.json) from host to container
  // Only needed for Claude Code executor - other executors have their own config
  if (isClaudeExecutor(executor)) {
    // This is needed for Claude Code to recognize settings and bypass prompts
    // Note: Auth tokens are in the claude-credentials volume at /home/node/.claude/.credentials.json
    // But settings (.claude.json) need to be at /home/node/.claude.json (outside the .claude dir)
    try {
      const hostClaudeJson = path.join(os.homedir(), '.claude.json')
      let settings: Record<string, unknown> = {}

      if (fs.existsSync(hostClaudeJson)) {
        // Read host file content as base
        const content = fs.readFileSync(hostClaudeJson, 'utf-8')
        try {
          settings = JSON.parse(content)
        } catch {
          console.debug('[runners:docker] Failed to parse host .claude.json, using empty settings')
        }
      }

      // Only set bypassPermissionsModeAccepted when user chose danger mode
      // This doesn't modify the host file - only the container copy
      if (permissionMode === 'danger') {
        settings.bypassPermissionsModeAccepted = true
      }

      // Skip first-run onboarding (theme picker, tips, etc.) for automated agents
      // These flags indicate Claude Code has been run before
      settings.numStartups = settings.numStartups || 1
      settings.hasCompletedOnboarding = true
      settings.theme = settings.theme || 'dark'
      // Ensure tipsHistory exists to prevent tip prompts
      if (!settings.tipsHistory || typeof settings.tipsHistory !== 'object') {
        settings.tipsHistory = {}
      }
      const tips = settings.tipsHistory as Record<string, number>
      tips['new-user-warmup'] = tips['new-user-warmup'] || 1
      // Dismiss the effort level callout so agents aren't prompted (TKT-1134)
      settings.effortCalloutDismissed = true

      // Pre-accept the "trust this folder" dialog for /workspace (TKT-1134)
      // Claude Code stores trust per-project under projects[path].hasTrustDialogAccepted
      // Without this, agents get stuck on the workspace safety prompt
      if (!settings.projects || typeof settings.projects !== 'object') {
        settings.projects = {}
      }
      const projects = settings.projects as Record<string, Record<string, unknown>>
      // Accept trust for /workspace and root / to cover all container working directories
      for (const projectPath of ['/workspace', '/']) {
        if (!projects[projectPath]) {
          projects[projectPath] = {}
        }
        projects[projectPath].hasTrustDialogAccepted = true
        projects[projectPath].hasCompletedProjectOnboarding = true
      }

      // Pipe settings via stdin to avoid ARG_MAX limits with large .claude.json files
      const settingsJson = JSON.stringify(settings)
      // Write to container at /home/node/.claude.json using stdin piping
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude.json'`,
        { input: settingsJson, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Copied .claude.json settings to container (bypassPermissionsModeAccepted=${permissionMode === 'danger'})`)

      // Write ~/.claude/settings.json to skip the dangerous mode permission prompt (TKT-1134)
      // This prevents Claude Code from prompting about permission mode on first run
      const claudeSettings = JSON.stringify({ skipDangerousModePermissionPrompt: true })
      execSync(
        `docker exec -i ${containerId} bash -c 'mkdir -p /home/node/.claude && cat > /home/node/.claude/settings.json'`,
        { input: claudeSettings, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      console.debug(`[runners:docker] Wrote ~/.claude/settings.json to container`)
    } catch (error) {
      console.debug('[runners:docker] Failed to copy Claude settings to container:', error)
      // Non-fatal - Claude will just prompt for settings
    }

    // NOTE: Auth credentials come from the claude-credentials volume.
    // Run "prlt agent auth" to set up authentication (one-time).
    // Do NOT sync CLAUDE_CODE_OAUTH_TOKEN env var - it causes issues
    // (setup-token generates invalid tokens, and env var overrides valid credentials file).
  } else {
    console.debug(`[runners:docker] Skipping .claude.json settings injection for ${executor} executor`)
  }

  return true
}

/**
 * Ensure a Docker container is running for the agent.
 * Reuses running containers to preserve in-progress work (TKT-1028).
 * Only destroys and recreates stopped containers.
 * Builds image and creates container if needed.
 * Returns the container ID if successful, null otherwise.
 */
export function ensureDockerContainer(
  context: ExecutionContext,
  config: ExecutionConfig,
  executor: ExecutorType = 'claude-code'
): string | null {
  const containerName = getContainerName(context.agentName)
  const imageName = getImageName(context.agentName)

  // TKT-1028: Reuse running containers instead of destroying them.
  // This preserves in-progress tmux sessions and avoids killing running agents.
  // Only destroy stopped containers (which have stale mounts anyway).
  if (containerExists(containerName)) {
    if (isContainerRunning(containerName)) {
      // Container is running - reuse it to preserve any in-progress work.
      // Note: runContainerSetup is skipped for reused containers since they
      // were already set up when first created. GitHub token and credentials
      // are refreshed by the caller (runDevcontainer).
      const containerId = getContainerId(containerName)
      if (containerId) {
        console.debug(`[runners:docker] Reusing running container ${containerName} (${containerId}), skipping setup`)
        return containerId
      }
    }

    // Container exists but is stopped - remove and recreate for fresh mounts
    console.debug(`[runners:docker] Removing stopped container ${containerName} to create fresh one`)
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: 'pipe', timeout: 10000 })
    } catch {
      // Ignore removal errors
    }
  }

  // Build image with version-aware cache busting (TKT-1029)
  // Read build args from devcontainer.json instead of hardcoding
  const devcontainerJson = readDevcontainerJson(context.agentDir)
  const buildArgs: Record<string, string> = {
    TZ: devcontainerJson?.build?.args?.TZ || 'America/Los_Angeles',
    PRLT_REGISTRY: devcontainerJson?.build?.args?.PRLT_REGISTRY || 'npm',
  }

  // Resolve the specific prlt version to install (TKT-1029)
  // When the configured version is a tag like "latest", resolve it to the host's
  // actual prlt version. This serves two purposes:
  // 1. Ensures the container runs the same version as the host
  // 2. Enables Docker layer cache busting when the host version changes
  //    (Docker caches "latest" as a static string, so the layer never rebuilds)
  const configuredVersion = devcontainerJson?.build?.args?.PRLT_VERSION || 'latest'
  const isTagVersion = ['latest', 'dev', 'next'].includes(configuredVersion)
  const hostPrltVersion = isTagVersion ? getHostPrltVersion() : null

  if (hostPrltVersion) {
    buildArgs.PRLT_VERSION = hostPrltVersion
    console.debug(`[runners:docker] Using host prlt version ${hostPrltVersion} for image build`)
  } else {
    buildArgs.PRLT_VERSION = configuredVersion
  }

  // Always run docker build - Docker layer caching makes this efficient when
  // nothing has changed. When PRLT_VERSION changes (e.g., "0.3.29" -> "0.3.35"),
  // the changed build arg invalidates the cache from that layer forward,
  // ensuring the new version gets installed.
  console.debug(`[runners:docker] Building image ${imageName} (PRLT_VERSION=${buildArgs.PRLT_VERSION})`)
  if (!buildDockerImage(context.agentDir, imageName, buildArgs)) {
    if (!imageExists(imageName)) {
      return null  // No image at all, can't proceed
    }
    // Build failed but old image exists - continue with setup-prlt.sh as fallback
    console.debug(`[runners:docker] Build failed but existing image found, continuing with runtime update`)
  }

  // Pass resolved prlt version info to the container environment (TKT-1029)
  // This allows setup-prlt.sh to verify/update prlt without querying npm registry
  const prltInfo = {
    registry: buildArgs.PRLT_REGISTRY,
    version: buildArgs.PRLT_VERSION,
  }

  // Create and start container
  console.debug(`[runners:docker] Creating container ${containerName}`)
  if (!createDockerContainer(context, containerName, imageName, config, executor, prltInfo)) {
    return null
  }

  const containerId = getContainerId(containerName)
  if (!containerId) {
    return null
  }

  // Run post-start setup (firewall, prlt, Claude settings)
  // Pass permission mode to determine whether to set bypassPermissionsModeAccepted
  // Pass executor to skip Claude-specific setup for non-Claude executors
  console.debug(`[runners:docker] Running container setup (permissionMode=${config.permissionMode}, executor=${executor})`)
  if (!runContainerSetup(containerId, config.permissionMode, executor)) {
    console.debug(`[runners:docker] Setup failed, but continuing...`)
    // Don't fail completely - setup might partially work
  }

  // NOTE: Claude credentials are copied to workspace before container creation
  // (see copyClaudeCredentials call in runDevcontainer)

  return containerId
}

/**
 * Copy Claude Code credentials (~/.claude.json) into the agent directory.
 * This makes the subscription credentials available inside the devcontainer
 * since the agent directory is mounted at /workspace.
 *
 * This was the original working approach before the raw Docker refactor.
 */
export function copyClaudeCredentials(agentDir: string): void {
  const sourceFile = path.join(os.homedir(), '.claude.json')
  const destFile = path.join(agentDir, '.claude.json')

  if (fs.existsSync(sourceFile)) {
    try {
      fs.copyFileSync(sourceFile, destFile)
      console.debug('[runners:credentials] Copied .claude.json to workspace')
    } catch (err) {
      console.debug('[runners:credentials] Failed to copy .claude.json:', err)
    }
  }
}

// =============================================================================
// Integration Commands — Dynamic Prompt Section
// =============================================================================

/**
 * Integration command definitions: commands available for each external integration.
 * Only included in prompts when the integration is actually connected.
 */
interface IntegrationCommandSet {
  provider: string       // e.g. 'asana', 'linear'
  displayName: string    // e.g. 'Asana', 'Linear'
  commands: string[]     // Command descriptions
}

const INTEGRATION_COMMANDS: IntegrationCommandSet[] = [
  {
    provider: 'asana',
    displayName: 'Asana',
    commands: [
      'prlt asana connect — authenticate with Asana',
      'prlt asana sync --ticket TKT-XXX --create-missing --project <gid> — sync a PMO ticket to Asana',
      'prlt asana import — import Asana tasks into PMO',
    ],
  },
  {
    provider: 'linear',
    displayName: 'Linear',
    commands: [
      'prlt linear connect — authenticate with Linear',
      'prlt linear sync --ticket TKT-XXX --create-missing — sync a PMO ticket to Linear',
      'prlt linear import — import Linear issues into PMO',
    ],
  },
  {
    provider: 'jira',
    displayName: 'Jira',
    commands: [
      'prlt jira connect — authenticate with Jira',
      'prlt jira sync --ticket TKT-XXX --create-missing — sync a PMO ticket to Jira',
      'prlt jira import — import Jira issues into PMO',
    ],
  },
  {
    provider: 'shortcut',
    displayName: 'Shortcut',
    commands: [
      'prlt shortcut connect — authenticate with Shortcut',
      'prlt shortcut sync --ticket TKT-XXX --create-missing — sync a PMO ticket to Shortcut',
      'prlt shortcut import — import Shortcut stories into PMO',
    ],
  },
  {
    provider: 'monday',
    displayName: 'Monday.com',
    commands: [
      'prlt monday connect — authenticate with Monday.com',
      'prlt monday sync --ticket TKT-XXX --create-missing — sync a PMO ticket to Monday.com',
    ],
  },
]

/**
 * Build the integration commands section for agent prompts.
 * Only includes integrations that are actually connected/configured.
 * Returns empty string if no integrations are connected.
 */
export function buildIntegrationCommandsSection(connectedIntegrations?: string[]): string {
  if (!connectedIntegrations || connectedIntegrations.length === 0) return ''

  const connected = INTEGRATION_COMMANDS.filter(ic =>
    connectedIntegrations.includes(ic.provider)
  )
  if (connected.length === 0) return ''

  let section = `## Integration Commands\n\n`
  section += `The following external integrations are connected. Use these prlt commands to interact with them.\n\n`

  for (const integration of connected) {
    section += `### ${integration.displayName}\n`
    for (const cmd of integration.commands) {
      section += `- \`${cmd.split(' — ')[0]}\` — ${cmd.split(' — ')[1] || ''}\n`
    }
    section += '\n'
  }

  section += `**ANTI-PATTERN:** Never use curl, raw API calls, or shell scripts to interact with external services (Asana, Linear, Jira, Shortcut, Monday.com, etc.). Always use the corresponding \`prlt\` commands.\n\n`

  return section
}

// =============================================================================
// Orchestrator Prompt — Dynamic Command Registry
// =============================================================================

/**
 * Registry of prlt commands relevant to the orchestrator, organized by category.
 * Each command includes a checkPath used to verify the command exists at runtime.
 * External commands (like gh) omit checkPath and are always included.
 */
interface OrchestratorCommandDef {
  cmd: string        // Full CLI invocation example
  desc: string       // One-line description
  checkPath?: string // Path under commands/ dir to verify existence (omit for external cmds)
}

interface CommandCategory {
  title: string
  commands: OrchestratorCommandDef[]
}

const ORCHESTRATOR_COMMAND_REGISTRY: CommandCategory[] = [
  {
    title: 'Agent Lifecycle',
    commands: [
      { cmd: 'prlt work start <ticket> --ephemeral --skip-permissions --create-pr --display background --action implement --run-on-host --yes', desc: 'Spawn an agent for a ticket', checkPath: 'work/start' },
      { cmd: 'prlt session list', desc: 'List running sessions', checkPath: 'session/list' },
      { cmd: 'prlt session inspect <agent>', desc: 'Inspect session details', checkPath: 'session/inspect' },
      { cmd: 'prlt session poke <agent> \'message\'', desc: 'Send message to agent', checkPath: 'session/poke' },
      { cmd: 'prlt session peek <agent> --lines 200', desc: 'Read agent output', checkPath: 'session/peek' },
      { cmd: 'prlt session health', desc: 'Check health of all sessions', checkPath: 'session/health' },
      { cmd: 'prlt session restart <agent>', desc: 'Restart a stuck agent', checkPath: 'session/restart' },
      { cmd: 'prlt session exec <agent> -- git status', desc: 'Run command in agent context', checkPath: 'session/exec' },
      { cmd: 'prlt session prune', desc: 'Clean up dead sessions', checkPath: 'session/prune' },
    ],
  },
  {
    title: 'Board Management',
    commands: [
      { cmd: 'prlt board view', desc: 'View the board', checkPath: 'board/view' },
      { cmd: 'prlt ticket list', desc: 'List tickets', checkPath: 'ticket/list' },
      { cmd: 'prlt ticket show <id>', desc: 'Show ticket details', checkPath: 'ticket/show' },
      { cmd: 'prlt ticket create --title \'x\' --description \'y\'', desc: 'Create a ticket', checkPath: 'ticket/create' },
      { cmd: 'prlt ticket edit <id> --title \'...\' --add-ac \'...\'', desc: 'Edit ticket fields', checkPath: 'ticket/edit' },
    ],
  },
  {
    title: 'PR Workflow',
    commands: [
      { cmd: 'gh pr list', desc: 'List open PRs' },
      { cmd: 'gh pr view <num>', desc: 'View PR details' },
      { cmd: 'gh pr checks <num>', desc: 'Check CI status' },
      { cmd: 'gh pr merge <num> --squash', desc: 'Merge PR (squash only)' },
    ],
  },
]

/**
 * Anti-patterns: things the orchestrator should NEVER do, with the prlt alternative.
 * Only included when the replacement command is available.
 */
interface AntiPatternDef {
  bad: string        // What NOT to do
  good: string       // What to do instead
  checkPath?: string // prlt command path to verify the alternative exists
}

const ORCHESTRATOR_ANTI_PATTERNS: AntiPatternDef[] = [
  { bad: 'docker exec <container> ...', good: 'prlt session exec', checkPath: 'session/exec' },
  { bad: 'tmux send-keys ...', good: 'prlt session poke', checkPath: 'session/poke' },
  { bad: 'tmux capture-pane ...', good: 'prlt session peek', checkPath: 'session/peek' },
  { bad: 'Direct git operations on agent worktrees', good: 'prlt session exec', checkPath: 'session/exec' },
]

/**
 * Resolve the commands directory for dynamic command availability checks.
 * Looks for compiled command files under dist/commands/.
 */
let _commandsDir: string | null = null

function getCommandsDir(): string {
  if (_commandsDir === null) {
    const currentFile = fileURLToPath(import.meta.url)
    // From dist/lib/execution/runners/shared.js → dist/commands/
    _commandsDir = path.resolve(path.dirname(currentFile), '..', '..', '..', 'commands')
  }
  return _commandsDir
}

function isCommandAvailable(checkPath: string): boolean {
  const dir = getCommandsDir()
  // Check for compiled .js file or directory (which would contain index.js)
  return fs.existsSync(path.join(dir, `${checkPath}.js`)) || fs.existsSync(path.join(dir, checkPath))
}

/**
 * Build the dynamic command reference section for the orchestrator prompt.
 * Only includes commands that are actually available in this build.
 */
function buildOrchestratorCommandReference(): string {
  let ref = ''
  for (const category of ORCHESTRATOR_COMMAND_REGISTRY) {
    const available = category.commands.filter(c => !c.checkPath || isCommandAvailable(c.checkPath))
    if (available.length === 0) continue
    ref += `### ${category.title}\n`
    for (const cmd of available) {
      ref += `- \`${cmd.cmd}\` — ${cmd.desc}\n`
    }
    ref += '\n'
  }
  return ref
}

/**
 * Build the anti-patterns section for the orchestrator prompt.
 * Only includes anti-patterns where the prlt replacement is available.
 */
function buildOrchestratorAntiPatterns(): string {
  const available = ORCHESTRATOR_ANTI_PATTERNS.filter(ap => !ap.checkPath || isCommandAvailable(ap.checkPath))
  if (available.length === 0) return ''
  let section = `## Anti-Patterns — NEVER DO\n\n`
  for (const ap of available) {
    section += `- \`${ap.bad}\` → use \`${ap.good}\` instead\n`
  }
  section += `\n`
  return section
}

/**
 * Build the shared orchestrator prompt body (role, runtime, commands, anti-patterns).
 * Used by both buildOrchestratorSystemPrompt and buildOrchestratorPrompt.
 */
function buildOrchestratorBody(hqName: string, context: ExecutionContext): string {
  let prompt = ''

  // Dynamic workspace context
  const prltVersion = getHostPrltVersion()
  prompt += `## Environment\n`
  if (prltVersion) {
    prompt += `- **prlt version**: ${prltVersion}\n`
  }
  prompt += `- **Available executors**: claude-code, codex\n`
  prompt += `- **Agent worktrees**: \`agents/temp/<agent-name>/<repo>\` — each agent gets an isolated git worktree\n`
  if (context.hqPath) {
    prompt += `- **HQ path**: \`${context.hqPath}\`\n`
  }
  prompt += `\n`

  // Runtime declaration
  prompt += `## prlt Is Your Orchestration Runtime\n\n`
  prompt += `prlt is your orchestration runtime. NEVER use raw docker exec, tmux send-keys, or direct container access. `
  prompt += `All orchestration goes through prlt. Every agent interaction, session management, and board operation `
  prompt += `has a dedicated prlt command. Using raw infrastructure commands bypasses session tracking, breaks `
  prompt += `health monitoring, and creates orphaned processes.\n\n`

  // Role
  prompt += `## Your Role\n`
  prompt += `- Assess the current state of the board, running agents, and open PRs\n`
  prompt += `- Plan and prioritize work — decide what to tackle next and in what order\n`
  prompt += `- Delegate implementation to agents via \`prlt work start\`\n`
  prompt += `- Monitor agent progress via sessions and review completed work\n`
  prompt += `- Review and merge completed PRs via \`gh pr merge --squash\`\n`
  prompt += `- Coordinate parallel agents — handle rebases after merges\n`
  prompt += `- Never write code or make changes to source files yourself\n\n`

  // Command reference (dynamically generated)
  prompt += `## Command Reference\n\n`
  prompt += buildOrchestratorCommandReference()

  // Spawning agents (detailed example)
  prompt += `## Spawning Agents\n`
  prompt += `\`\`\`\n`
  prompt += `script -q /dev/null prlt work start TKT-XXXX --ephemeral --skip-permissions --create-pr --display background --action implement --run-on-host --yes\n`
  prompt += `\`\`\`\n`
  prompt += `- Review: \`--action review-comment\`\n`
  prompt += `- Fix: \`--action review-fix\`\n\n`

  // Anti-patterns (dynamically generated)
  prompt += buildOrchestratorAntiPatterns()

  // Integration commands (only for connected integrations)
  prompt += buildIntegrationCommandsSection(context.connectedIntegrations)

  // Workflow
  prompt += `## Workflow\n`
  prompt += `- Squash merge only: \`gh pr merge --squash\`\n`
  prompt += `- After merging: subsequent PRs from parallel agents will need rebase\n`
  prompt += `- Kill stale sessions after their PRs are merged\n\n`

  // Tool registry (TKT-083): inject available tools into orchestrator prompt
  if (context.hqPath) {
    const toolsResult = resolveToolsForSpawn(
      context.hqPath,
      context.toolPolicy,
      path.join(context.hqPath, '.proletariat', 'scripts')
    )
    if (toolsResult.promptSection) {
      prompt += toolsResult.promptSection
    }
  }

  // Load .orchestrator-context.md from HQ root if it exists
  if (context.hqPath) {
    const contextFilePath = path.join(context.hqPath, '.orchestrator-context.md')
    if (fs.existsSync(contextFilePath)) {
      try {
        const contextContent = fs.readFileSync(contextFilePath, 'utf-8').trim()
        if (contextContent) {
          prompt += `## Workspace Context\n\n${contextContent}\n\n`
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return prompt
}

/**
 * Build the system prompt for orchestrator sessions.
 * This is injected via Claude Code's --system-prompt flag so the orchestrator
 * knows its role immediately without relying on CLAUDE.md.
 */
export function buildOrchestratorSystemPrompt(context: ExecutionContext): string {
  const hqName = context.hqName || 'workspace'
  let prompt = `# Orchestrator: ${hqName}\n\n`
  prompt += `You are the orchestrator for the **${hqName}** headquarters — a technical project manager driving software delivery through delegated AI agents.\n\n`
  prompt += `**prlt** is an AI agent orchestration CLI. It manages software development by coordinating autonomous coding agents that work in isolated git worktrees. `
  prompt += `Your workspace (HQ) contains a PMO board for tracking tickets, agent worktrees under \`agents/temp/\`, and repo connections. `
  prompt += `Agents are spawned to implement, review, and fix code — you never write code yourself. `
  prompt += `Your job is to assess the state of the project, plan and prioritize work, delegate to agents, monitor their progress, review results, and merge completed PRs.\n\n`

  prompt += buildOrchestratorBody(hqName, context)

  return prompt
}

function buildOrchestratorPrompt(context: ExecutionContext): string {
  // Full prompt including role context — used for non-Claude executors that
  // don't support --system-prompt. For Claude Code, runHost() splits this into
  // a system prompt (role/tools) + a shorter user message.
  const hqName = context.hqName || 'workspace'
  let prompt = `# Orchestrator: ${hqName}\n\n`
  prompt += `You are the orchestrator for the **${hqName}** headquarters — a technical project manager driving software delivery through delegated AI agents.\n\n`
  prompt += `**prlt** is an AI agent orchestration CLI. It manages software development by coordinating autonomous coding agents that work in isolated git worktrees. `
  prompt += `Your workspace (HQ) contains a PMO board for tracking tickets, agent worktrees under \`agents/temp/\`, and repo connections. `
  prompt += `Agents are spawned to implement, review, and fix code — you never write code yourself.\n\n`

  prompt += buildOrchestratorBody(hqName, context)

  // Include user's custom prompt or action content
  if (context.actionPrompt) {
    prompt += `## Instructions\n\n${context.actionPrompt}\n`
  }

  return prompt
}

export function buildPrompt(context: ExecutionContext): string {
  // Orchestrator sessions get a role-specific prompt instead of the generic ticket format
  if (context.isOrchestrator) {
    return buildOrchestratorPrompt(context)
  }

  let prompt = ''

  // For revisions, lead with the PR feedback
  if (context.isRevision && context.prFeedback) {
    prompt += `# Revision: Address PR Feedback\n\n`
    prompt += context.prFeedback
    prompt += `\n\n---\n\n`
    prompt += `## Original Ticket Context\n\n`
  }

  // Action instruction (what the agent should do) - START HOOK
  if (context.actionPrompt) {
    prompt += `# Action: ${context.actionName || 'Work'}\n\n`
    prompt += context.actionPrompt
    prompt += `\n\n---\n\n`
  }

  // TICKET CONTENT
  prompt += `# Ticket: ${context.ticketId}\n\n`
  prompt += `**Title:** ${context.ticketTitle}\n\n`

  if (context.ticketPriority) {
    prompt += `**Priority:** ${context.ticketPriority}\n`
  }
  if (context.ticketCategory) {
    prompt += `**Category:** ${context.ticketCategory}\n`
  }
  if (context.epicTitle) {
    prompt += `**Epic:** ${context.epicTitle}\n`
  }
  if (context.ticketDescription) {
    prompt += `\n## Description\n\n${context.ticketDescription}\n`
  }

  if (context.ticketSubtasks && context.ticketSubtasks.length > 0) {
    prompt += `\n## Subtasks\n\n`
    for (const subtask of context.ticketSubtasks) {
      const checkbox = subtask.done ? '[x]' : '[ ]'
      prompt += `- ${checkbox} ${subtask.title}\n`
    }
  }

  // Note: Branch setup (fetch + checkout/create) is now handled programmatically
  // in work/start.ts before the agent spawns, so no prompt instructions needed

  // Integration commands (only for connected integrations)
  const integrationSection = buildIntegrationCommandsSection(context.connectedIntegrations)
  if (integrationSection) {
    prompt += `\n${integrationSection}`
  }

  // Additional instructions from --message flag (appended to any action)
  if (context.customMessage) {
    prompt += `\n## Additional Instructions\n\n${context.customMessage}\n`
  }

  // Tool registry (TKT-083): inject available tools into agent prompt
  if (context.hqPath) {
    const toolsResult = resolveToolsForSpawn(
      context.hqPath,
      context.toolPolicy,
      path.join(context.hqPath, '.proletariat', 'scripts')
    )
    if (toolsResult.promptSection) {
      prompt += `\n${toolsResult.promptSection}`
    }
  }

  // END HOOK - Action-specific completion instructions
  prompt += `\n---\n\n## When Complete\n\n`

  // For revisions, use the revision-specific end prompt
  if (context.isRevision) {
    prompt += `After addressing the feedback:\n`
    prompt += `1. Commit your changes using \`prlt commit "your message"\`\n`
    prompt += `2. Push your changes: \`git push\`\n`
    prompt += `\nThe PR will be updated automatically.`
  } else if (context.actionEndPrompt) {
    // Use action-specific end prompt, replacing {{TICKET_ID}} placeholder
    let endPrompt = context.actionEndPrompt.replace(/\{\{TICKET_ID\}\}/g, context.ticketId)
    // Also handle the PR flag placeholder if present
    if (endPrompt.includes('--pr')) {
      // Replace --pr with appropriate flag based on createPR setting
      if (!context.createPR) {
        endPrompt = endPrompt.replace(/--pr/g, '--no-pr')
      }
    }
    prompt += endPrompt
  } else {
    // Fallback to default completion instructions (for custom actions without end_prompt)
    if (context.modifiesCode) {
      prompt += `1. **Commit your work** in each repository directory you modified:\n`
      prompt += `   \`\`\`bash\n`
      prompt += `   cd /workspace/<repo-name>\n`
      prompt += `   git add -A\n`
      prompt += `   prlt commit "describe your change"\n`
      prompt += `   git push\n`
      prompt += `   \`\`\`\n`
      prompt += `   This formats your commit as a conventional commit with the ticket ID.\n`

      prompt += `\n2. **Mark work as ready** by running:\n`
      const prFlag = context.createPR ? ' --pr' : ' --no-pr'
      prompt += `   \`\`\`bash\n   prlt work ready ${context.ticketId}${prFlag}\n   \`\`\`\n`
      if (context.createPR) {
        prompt += `   This moves the ticket to review and creates a pull request.\n`
      } else {
        prompt += `   This moves the ticket to review.\n`
      }
      prompt += `\n**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`
    } else {
      // Non-code-modifying action without custom end_prompt
      prompt += `When you have completed the task, provide a summary of what you did.`
    }
  }

  // Universal stop instruction - prevents Claude Code from making additional API calls after task completion
  prompt += `\n\n---\n\n**STOP:** After providing your final summary, your task is complete. Do not take any further actions, do not verify your work again, and do not continue the conversation. Simply output your summary and stop.`

  return prompt
}

// Re-export types and functions needed by runners
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
  getCodexCommand,
  resolveCodexExecutionContext,
  validateCodexMode,
  CodexModeError,
  resolveToolsForSpawn,
}
export type { TerminalApp, OrchestratorDockerOptions }
