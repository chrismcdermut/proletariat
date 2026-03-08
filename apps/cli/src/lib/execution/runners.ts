/* eslint-disable max-lines -- runner implementations require cohesive logic */
/**
 * Execution Runners
 *
 * Implementations for each execution environment (devcontainer, host, docker, vm).
 */

import { spawn, execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
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
} from './types.js'
import { getSetTitleCommands } from '../terminal.js'
import { readDevcontainerJson, generateOrchestratorDockerfile } from './devcontainer.js'
import type { OrchestratorDockerOptions } from './devcontainer.js'
import { getCodexCommand, resolveCodexExecutionContext, validateCodexMode, CodexModeError } from './codex-adapter.js'

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
function buildWindowTitle(context: ExecutionContext): string {
  return buildSessionName(context)
}

function buildTmuxWindowName(context: ExecutionContext): string {
  return buildSessionName(context)
}

// getSetTitleCommands is now imported from '../terminal.js'

// =============================================================================
// Control Mode Helpers (iTerm -CC integration)
// =============================================================================

import type { TerminalApp } from './types.js'

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

const CLAUDE_CREDENTIALS_VOLUME = 'claude-credentials'

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
async function ensureTmuxServerHasKeychainAccess(): Promise<void> {
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
      // Brief delay to ensure server fully stops
      await new Promise(resolve => setTimeout(resolve, 500))
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
  if (environment === 'host') {
    return checkExecutorOnHost(executor)
  }

  if (environment === 'devcontainer' && options?.containerId) {
    return checkExecutorInContainer(executor, options.containerId)
  }

  return { ok: true }
}

/**
 * Build the system prompt for orchestrator sessions.
 * This is injected via Claude Code's --system-prompt flag so the orchestrator
 * knows its role immediately without relying on CLAUDE.md.
 */
export function buildOrchestratorSystemPrompt(context: ExecutionContext): string {
  const hqName = context.hqName || 'workspace'
  let prompt = `You are an orchestrator for the **${hqName}** project. `
  prompt += `Use \`prlt\` to view what's running — board, sessions, tickets, PRs. `
  prompt += `Do not implement any work yourself. `
  prompt += `Your job is to review, plan, investigate, delegate (via \`prlt work start\`), and review completed work.\n\n`

  prompt += `## Your Role\n`
  prompt += `- Plan and prioritize work across the board\n`
  prompt += `- Delegate implementation to agents via \`prlt work start\`\n`
  prompt += `- Monitor agent progress and review completed work\n`
  prompt += `- Merge completed PRs via \`gh pr merge --squash\`\n`
  prompt += `- Never write code or make changes to source files yourself\n\n`

  prompt += `## Discovering State\n`
  prompt += `Always discover current state dynamically — do NOT rely on static context files:\n`
  prompt += `- **Board**: \`prlt board view\`, \`prlt ticket list\`, \`prlt ticket show <id>\`\n`
  prompt += `- **Agents**: \`prlt session list\`, \`prlt session peek <session>\`, \`prlt work status\`\n`
  prompt += `- **PRs/CI**: \`gh pr list\`, \`gh pr view <num>\`, \`gh pr checks <num>\`\n`
  prompt += `- All prlt MCP tools are also available\n\n`

  prompt += `## Spawning Agents\n`
  prompt += `\`\`\`\n`
  prompt += `script -q /dev/null prlt work start TKT-XXXX --ephemeral --skip-permissions --create-pr --display background --action implement --run-on-host --yes\n`
  prompt += `\`\`\`\n`
  prompt += `- Review: \`--action review-comment\`\n`
  prompt += `- Fix: \`--action review-fix\`\n\n`

  prompt += `## Workflow\n`
  prompt += `- Squash merge only: \`gh pr merge --squash\`\n`
  prompt += `- After merging: subsequent PRs from parallel agents will need rebase\n`
  prompt += `- Kill stale sessions after their PRs are merged\n\n`

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

function buildOrchestratorPrompt(context: ExecutionContext): string {
  // Full prompt including role context — used for non-Claude executors that
  // don't support --system-prompt. For Claude Code, runHost() splits this into
  // a system prompt (role/tools) + a shorter user message.
  const hqName = context.hqName || 'workspace'
  let prompt = `# Orchestrator: ${hqName}\n\n`
  prompt += `You are the orchestrator for the **${hqName}** workspace using the prlt ecosystem.\n\n`

  prompt += `## Your Role\n`
  prompt += `- Plan and prioritize work across the board\n`
  prompt += `- Delegate implementation to agents via \`prlt work start\`\n`
  prompt += `- Monitor agent progress and review completed work\n`
  prompt += `- Merge completed PRs via \`gh pr merge --squash\`\n`
  prompt += `- Never write code or make changes to source files yourself\n\n`

  prompt += `## Discovering State\n`
  prompt += `Always discover current state dynamically — do NOT rely on static context files:\n`
  prompt += `- **Board**: \`prlt board view\`, \`prlt ticket list\`, \`prlt ticket show <id>\`\n`
  prompt += `- **Agents**: \`prlt session list\`, \`prlt session peek <session>\`, \`prlt work status\`\n`
  prompt += `- **PRs/CI**: \`gh pr list\`, \`gh pr view <num>\`, \`gh pr checks <num>\`\n`
  prompt += `- All prlt MCP tools are also available\n\n`

  prompt += `## Spawning Agents\n`
  prompt += `\`\`\`\n`
  prompt += `script -q /dev/null prlt work start TKT-XXXX --ephemeral --skip-permissions --create-pr --display background --action implement --run-on-host --yes\n`
  prompt += `\`\`\`\n`
  prompt += `- Review: \`--action review-comment\`\n`
  prompt += `- Fix: \`--action review-fix\`\n\n`

  prompt += `## Workflow\n`
  prompt += `- Squash merge only: \`gh pr merge --squash\`\n`
  prompt += `- After merging: subsequent PRs from parallel agents will need rebase\n`
  prompt += `- Kill stale sessions after their PRs are merged\n\n`

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

  // Include user's custom prompt or action content
  if (context.actionPrompt) {
    prompt += `## Instructions\n\n${context.actionPrompt}\n`
  }

  return prompt
}

function buildPrompt(context: ExecutionContext): string {
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
  if (context.specId) {
    prompt += `**Spec:** ${context.specId}${context.specTitle ? ` - ${context.specTitle}` : ''}\n`
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

  // Additional instructions from --message flag (appended to any action)
  if (context.customMessage) {
    prompt += `\n## Additional Instructions\n\n${context.customMessage}\n`
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
// Host Runner - Host execution with tmux session persistence
// =============================================================================

/**
 * Run command on the host machine with tmux session for persistence.
 * Supports multiple terminal emulators on macOS.
 *
 * Architecture (same as devcontainer):
 * - Always creates a host tmux session for session persistence
 * - displayMode controls whether to open a terminal tab attached to the session
 * - User can reattach with `prlt session attach` if tab is closed
 */
export async function runHost(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal'
): Promise<RunnerResult> {
  // Session name: {ticketId}-{action} (e.g., TKT-347-implement)
  const sessionName = buildTmuxWindowName(context)
  const windowTitle = buildWindowTitle(context)

  const prompt = buildPrompt(context)
  // Terminal - use permission mode setting
  const skipPermissions = config.permissionMode === 'danger'

  // Validate Codex mode combination before proceeding
  if (executor === 'codex') {
    const codexPermission: PermissionMode = config.permissionMode
    const codexContext = resolveCodexExecutionContext(displayMode, config.outputMode)
    const modeError = validateCodexMode(codexPermission, codexContext)
    if (modeError) {
      return { success: false, error: modeError.message }
    }
  }

  const { cmd, args } = getExecutorCommand(executor, prompt, skipPermissions)

  // Write command to temp script to avoid shell escaping issues
  // Use HQ .proletariat/scripts if available, otherwise fallback to home dir
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })

  const timestamp = Date.now()
  const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${timestamp}.sh`)
  const promptPath = path.join(baseDir, `prompt-${context.ticketId}-${timestamp}.txt`)

  // For orchestrator sessions with Claude Code, split the prompt:
  // - System prompt (role/tools/context) → injected via --system-prompt flag
  // - User message (action instructions or default) → passed as the initial message
  // Non-Claude executors get the full combined prompt as the user message.
  let systemPromptPath: string | null = null
  if (context.isOrchestrator && isClaudeExecutor(executor)) {
    const systemPrompt = buildOrchestratorSystemPrompt(context)
    systemPromptPath = path.join(baseDir, `system-prompt-${context.ticketId}-${timestamp}.txt`)
    fs.writeFileSync(systemPromptPath, systemPrompt, { mode: 0o644 })

    // Override user message: just action instructions or a default startup message
    const userMessage = context.actionPrompt
      || 'You are now running as the orchestrator. Check the board status and report what you see.'
    fs.writeFileSync(promptPath, userMessage, { mode: 0o644 })
  } else {
    // Write full prompt (includes role context for non-Claude executors)
    fs.writeFileSync(promptPath, prompt, { mode: 0o644 })
  }

  // Build the executor command using getExecutorCommand() output
  // For Claude Code, we also support outputMode and additional flags
  // For non-Claude executors, we use the command as-is from getExecutorCommand()
  let executorInvocation: string
  if (isClaudeExecutor(executor)) {
    // Build flags based on config - Claude-specific flags
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    // outputMode: 'print' adds -p flag (final result only), 'interactive' shows streaming UI
    const printFlag = config.outputMode === 'print' ? '-p ' : ''
    // --effort high: skips the effort level prompt for automated agents (TKT-1134)
    const effortFlag = skipPermissions ? '--effort high ' : ''
    // Orchestrator sessions inject their role via --system-prompt
    const systemPromptFlag = systemPromptPath ? '--system-prompt "$(cat "$SYSTEM_PROMPT_PATH")" ' : ''
    executorInvocation = `${cmd} ${permissionsFlag}${effortFlag}${printFlag}${systemPromptFlag}"$(cat "$PROMPT_PATH")"`
  } else {
    // Non-Claude executors: build command from getExecutorCommand() args
    // Replace the prompt in args with a file read to avoid shell escaping
    const argsWithFile = args.map(a => a === prompt ? '"$(cat "$PROMPT_PATH")"' : `"${a}"`)
    executorInvocation = `${cmd} ${argsWithFile.join(' ')}`
  }

  // Build script that runs executor and keeps shell open after completion
  const setTitleCmds = getSetTitleCommands(windowTitle)
  const systemPromptVar = systemPromptPath ? `\nSYSTEM_PROMPT_PATH="${systemPromptPath}"` : ''
  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
SCRIPT_PATH="${scriptPath}"
PROMPT_PATH="${promptPath}"${systemPromptVar}
${setTitleCmds}
echo "🚀 Starting: ${sessionName}"
echo ""
cd "${context.worktreePath}"
# Run executor in subshell with CLAUDECODE unset (prevents nested session error)
(unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; ${executorInvocation})

# Clean up script and prompt files
rm -f "$SCRIPT_PATH" "$PROMPT_PATH"${systemPromptPath ? ' "$SYSTEM_PROMPT_PATH"' : ''}

echo ""
echo "✅ Agent work complete. Press Enter to close or run more commands."
exec $SHELL
`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  try {
    // Check if tmux is available
    execSync('which tmux', { stdio: 'pipe' })

    const terminalApp = config.terminal.app

    // Check if we should use iTerm control mode (-CC)
    // When using -CC, iTerm handles scrolling/selection natively, so we DON'T set mouse on
    // Without -CC, we need mouse on for tmux to handle scrolling
    const useControlMode = shouldUseControlMode(terminalApp, config.tmux.controlMode)

    // Step 1: Create host tmux session (detached)
    // Only enable mouse mode if NOT using control mode (control mode lets iTerm handle mouse natively)
    const mouseOption = buildTmuxMouseOption(useControlMode)
    const tmuxCmd = `tmux new-session -d -s "${sessionName}" -n "${sessionName}" "${scriptPath}"${mouseOption} \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`

    try {
      execSync(tmuxCmd, { stdio: 'pipe' })
    } catch (error) {
      return {
        success: false,
        error: `Failed to create tmux session: ${error instanceof Error ? error.message : error}`,
      }
    }

    // Step 2: Open terminal tab attached to tmux session (unless background or foreground mode)
    if (displayMode === 'background') {
      return {
        success: true,
        sessionId: sessionName,
      }
    }

    // Foreground mode: attach to tmux session in current terminal (blocking)
    if (displayMode === 'foreground') {
      try {
        // Clear screen and attach - this blocks until user detaches or claude exits
        // Never use -CC in foreground mode: control mode sends raw tmux protocol
        // sequences (%begin, %output, %end) that render as garbled text unless
        // iTerm's native CC handler is active (only happens in new tabs opened via AppleScript)
        const fgTmuxAttach = buildTmuxAttachCommand(false)
        execSync(`clear && ${fgTmuxAttach} -t "${sessionName}"`, { stdio: 'inherit' })
        return {
          success: true,
          sessionId: sessionName,
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to attach to tmux session: ${error instanceof Error ? error.message : error}`,
        }
      }
    }

    // Use tmux -CC (control mode) for iTerm when enabled in config
    // -CC gives native iTerm scrolling, selection, and gesture support
    // Without -CC, use regular attach (relies on mouse mode for scrolling)
    const tmuxAttach = buildTmuxAttachCommand(useControlMode)
    const attachCmd = `clear && ${tmuxAttach} -t \\"${sessionName}\\"`

    // For iTerm with control mode, create a new tab and run -CC attach there
    // This avoids interfering with the terminal where prlt is running
    if (terminalApp === 'iTerm' && useControlMode) {
      // Configure iTerm to open tmux windows as tabs or windows based on user preference
      configureITermTmuxWindowMode(config.tmux.windowMode)

      const openInBackground = config.terminal.openInBackground ?? true

      if (openInBackground) {
        // Open tab without stealing focus - save frontmost app and restore after
        execSync(`osascript -e '
          set frontApp to path to frontmost application as text
          tell application "iTerm"
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
          tell application frontApp to activate
        '`)
      } else {
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
        '`)
      }
      return {
        success: true,
        sessionId: sessionName,
      }
    }

    // Check if we should open in background (don't steal focus)
    const openInBackground = config.terminal.openInBackground ?? true

    switch (terminalApp) {
      case 'iTerm':
        // Without control mode, create a new tab and attach normally
        // When openInBackground is true, save frontmost app and restore after
        if (openInBackground) {
          execSync(`osascript -e '
            -- Save the currently active application and window
            tell application "System Events"
              set frontApp to name of first application process whose frontmost is true
              set frontAppBundle to bundle identifier of first application process whose frontmost is true
            end tell

            tell application "iTerm"
              if (count of windows) = 0 then
                create window with default profile
                delay 0.3
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${attachCmd}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  delay 0.3
                  tell current session of newTab
                    set name to "${windowTitle}"
                    write text "${attachCmd}"
                  end tell
                end tell
              end if
            end tell

            -- Restore focus to the original application
            delay 0.2
            tell application "System Events"
              set frontmost of process frontApp to true
            end tell
            delay 0.1
            do shell script "open -b " & quoted form of frontAppBundle
          '`)
        } else {
          execSync(`osascript -e '
            tell application "iTerm"
              activate
              if (count of windows) = 0 then
                create window with default profile
                delay 0.3
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${attachCmd}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  delay 0.3
                  tell current session of newTab
                    set name to "${windowTitle}"
                    write text "${attachCmd}"
                  end tell
                end tell
              end if
            end tell
          '`)
        }
        break

      case 'Ghostty':
        // Ghostty - use osascript to open new tab and run command
        execSync(`osascript -e '
          tell application "Ghostty"
            activate
          end tell
          tell application "System Events"
            tell process "Ghostty"
              keystroke "t" using command down
              delay 0.3
              keystroke "${attachCmd}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'WezTerm':
        // WezTerm - use wezterm cli to spawn new tab
        execSync(`wezterm cli spawn --new-window -- bash -c '${attachCmd}'`)
        break

      case 'Kitty':
        // Kitty - use kitten to open new tab
        execSync(`kitty @ launch --type=tab -- bash -c '${attachCmd}'`)
        break

      case 'Alacritty':
        // Alacritty doesn't have native tab support, opens new window
        execSync(`osascript -e '
          tell application "Alacritty"
            activate
          end tell
          tell application "System Events"
            tell process "Alacritty"
              keystroke "n" using command down
              delay 0.3
              keystroke "${attachCmd}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'Terminal':
      default:
        // macOS Terminal.app - new tab
        // Note: Terminal.app with System Events keystrokes requires activation for Cmd+T
        // But we can use 'do script' which opens a new window without activation if needed
        if (openInBackground) {
          // Open in background: use 'do script' which creates a new window without activating
          execSync(`osascript -e '
            tell application "Terminal"
              do script "${attachCmd}"
              set custom title of front window to "${windowTitle}"
            end tell
          '`)
        } else {
          // Bring to front: use traditional Cmd+T for new tab
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "${attachCmd}" in front window
            end tell
          '`)
        }
        break
    }

    return {
      success: true,
      sessionId: sessionName,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to start host tmux session`,
    }
  }
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
 * Check if Docker daemon is running.
 * Returns true if Docker is available and responsive.
 * Uses retry logic to handle slow Docker Desktop startup.
 */
export function isDockerRunning(): boolean {
  const maxRetries = 3
  const timeout = 10000 // 10 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync('docker info', { stdio: 'pipe', timeout })
      return true
    } catch {
      if (attempt === maxRetries) {
        return false
      }
      // Brief pause before retry
    }
  }
  return false
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
function getHostPrltVersion(): string | null {
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
const getContainerName = getAgentContainerName

/**
 * Get the image name for an agent.
 * Format: prlt-agent-{agentName}:latest
 */
function getImageName(agentName: string): string {
  const sanitized = agentName.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `prlt-agent-${sanitized}:latest`
}

/**
 * Check if a Docker container exists (running or stopped).
 */
export function containerExists(containerName: string): boolean {
  try {
    execSync(`docker container inspect ${containerName}`, { stdio: 'pipe' })
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
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
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
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    return containerId ? containerId.substring(0, 12) : null
  } catch {
    return null
  }
}

/**
 * Build Docker image for an agent from its Dockerfile.
 */
function buildDockerImage(agentDir: string, imageName: string, buildArgs: Record<string, string> = {}): boolean {
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
function imageExists(imageName: string): boolean {
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Create and start a Docker container for an agent.
 * Uses raw Docker commands instead of devcontainer CLI.
 */
function createDockerContainer(
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
function runContainerSetup(containerId: string, permissionMode: PermissionMode = 'safe', executor: ExecutorType = 'claude-code'): boolean {
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
function ensureDockerContainer(
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
      execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' })
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
function copyClaudeCredentials(agentDir: string): void {
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
// Devcontainer Runner (now uses raw Docker)
// =============================================================================

/**
 * Clean up old prompt files from the worktree.
 * This is called before writing a new prompt file to prevent accumulation
 * of stale prompt files from failed or interrupted executions.
 */
function cleanupOldPromptFiles(worktreePath: string, ticketId?: string): void {
  try {
    const files = fs.readdirSync(worktreePath)
    const pattern = ticketId
      ? new RegExp(`^\\.prlt-prompt-${ticketId}-\\d+\\.txt$`)
      : /^\.prlt-prompt-.*\.txt$/

    for (const file of files) {
      if (pattern.test(file)) {
        try {
          fs.unlinkSync(path.join(worktreePath, file))
        } catch (err) {
          console.debug(`[runners:cleanup] Failed to delete ${file}:`, err)
        }
      }
    }
  } catch (err) {
    console.debug(`[runners:cleanup] Failed to read directory ${worktreePath}:`, err)
  }
}

/**
 * Write prompt to a file inside the worktree so the container can access it.
 * Returns the path to the prompt file (relative to worktree for container access).
 * Cleans up old prompt files for the same ticket before writing.
 */
function writePromptFile(context: ExecutionContext): { hostPath: string; containerPath: string } {
  // Clean up old prompt files for this ticket before creating a new one
  cleanupOldPromptFiles(context.worktreePath, context.ticketId)

  const prompt = buildPrompt(context)
  const filename = `.prlt-prompt-${context.ticketId}-${Date.now()}.txt`
  const hostPath = path.join(context.worktreePath, filename)

  fs.writeFileSync(hostPath, prompt, { mode: 0o644 })

  // Container mounts agentDir at /workspace
  // If worktreePath is a subdirectory of agentDir, we need the relative path
  // e.g., agentDir=/agents/altman, worktreePath=/agents/altman/textdeck
  //       -> containerPath=/workspace/textdeck/.prlt-prompt-....txt
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const containerPath = relativePath
    ? `/workspace/${relativePath}/${filename}`
    : `/workspace/${filename}`

  return { hostPath, containerPath }
}

/**
 * Build the command to run Claude inside the container.
 * Uses docker exec for direct container access.
 * Uses a prompt file to avoid shell escaping issues.
 */

export function buildDevcontainerCommand(
  context: ExecutionContext,
  executor: ExecutorType,
  promptFile: string,
  containerId?: string,
  outputMode: OutputMode = 'interactive',
  permissionMode: PermissionMode = 'safe',
  displayMode: DisplayMode = 'terminal'
): string {
  // Calculate the relative path from agentDir to worktreePath for cd
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const cdCmd = relativePath ? `cd /workspace/${relativePath} && ` : ''

  // Build executor command using the centralized getExecutorCommand()
  // This ensures all runners use consistent executor invocation
  let executorCmd: string
  const skipPermissions = permissionMode === 'danger'
  if (isClaudeExecutor(executor)) {
    // Claude-specific flags based on output mode and permission mode
    // - interactive: No -p flag, shows streaming UI (watch Claude work in real-time)
    // - print: Uses -p flag, outputs final result only (better for logs/automation)
    const printFlag = outputMode === 'print' ? '-p ' : ''
    // --permission-mode bypassPermissions: skips the "trust this folder" dialog
    const bypassTrustFlag = '--permission-mode bypassPermissions '
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    // --effort high: skips the effort level prompt for automated agents (TKT-1134)
    const effortFlag = '--effort high '
    executorCmd = `claude ${bypassTrustFlag}${permissionsFlag}${effortFlag}${printFlag}"$(cat ${promptFile})"`
  } else if (executor === 'codex') {
    // Use Codex adapter for mode validation and deterministic command building.
    // Validates that the permission/display combination is supported before building.
    const codexPermission: PermissionMode = permissionMode
    const codexContext = resolveCodexExecutionContext(displayMode, outputMode)
    const modeError = validateCodexMode(codexPermission, codexContext)
    if (modeError) {
      throw modeError
    }
    const codexResult = getCodexCommand('PLACEHOLDER', codexPermission, codexContext)
    const argsStr = codexResult.args.map(a => a === 'PLACEHOLDER' ? `"$(cat ${promptFile})"` : a).join(' ')
    executorCmd = `${codexResult.cmd} ${argsStr}`
  } else {
    // Non-Claude, non-Codex executors: use getExecutorCommand() to get correct command and args
    const { cmd, args } = getExecutorCommand(executor, `PLACEHOLDER`, skipPermissions)
    // Replace the placeholder prompt with a file read for shell safety
    const argsStr = args.map(a => a === 'PLACEHOLDER' ? `"$(cat ${promptFile})"` : a).join(' ')
    executorCmd = `${cmd} ${argsStr}`
  }

  // Build the full command with cd, executor invocation, and cleanup
  const fullCmd = `${cdCmd}${executorCmd} && rm -f ${promptFile}`

  // Use docker exec for running commands in the container
  // Use -it flags only for terminal/foreground modes where a TTY is available
  // Background mode runs without a TTY, so -it flags would cause "not a TTY" error
  const ttyFlags = displayMode === 'background' ? '' : '-it '

  // Direct mode - run executor directly (tmux setup is handled by runDevcontainerInTmux)
  return `docker exec ${ttyFlags}${containerId} bash -c '${fullCmd}'`
}



/**
 * Run command inside a Docker container.
 * Uses raw Docker commands for filesystem isolation - no devcontainer CLI required.
 * Agent can only access mounted worktrees and configured paths.
 *
 * @param displayMode - How to display output (terminal, foreground, background, tmux)
 * @param sessionManager - How to manage the session inside the container (tmux, direct)
 */
export async function runDevcontainer(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  sessionManager: SessionManager = 'tmux'  // Default to tmux for session persistence
): Promise<RunnerResult> {
  // Docker config is in the agent directory (still uses .devcontainer for Dockerfile)
  const devcontainerPath = path.join(context.agentDir, '.devcontainer')
  const dockerfile = path.join(devcontainerPath, 'Dockerfile')

  // Check if Dockerfile exists
  if (!fs.existsSync(dockerfile)) {
    return {
      success: false,
      error: `No Dockerfile found at ${devcontainerPath}. Run 'prlt agent add' to set up the agent with Docker config.`,
    }
  }

  try {
    // Check if Docker is running
    if (!isDockerRunning()) {
      return {
        success: false,
        error: 'Docker is not running. Please start Docker Desktop and try again.',
      }
    }

    // Ensure GitHub token is available for git push operations
    // Try to get token from gh CLI if not already in environment
    if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
      try {
        const token = execSync('gh auth token', { encoding: 'utf-8', stdio: 'pipe' }).trim()
        if (token) {
          process.env.GITHUB_TOKEN = token
          process.env.GH_TOKEN = token
        }
      } catch (err) {
        console.debug('[runners:docker] gh auth token failed:', err)
      }
    }

    // Copy Claude credentials into agent directory so container can access them
    // Only needed for Claude Code executor
    if (isClaudeExecutor(executor)) {
      // This was the original working approach - credentials at /workspace/.claude.json
      copyClaudeCredentials(context.agentDir)
    }

    // Start or reuse container using raw Docker commands
    // No devcontainer CLI required!
    const containerId = ensureDockerContainer(context, config, executor)
    if (!containerId) {
      return {
        success: false,
        error: 'Failed to start Docker container. Check Docker logs for details.',
      }
    }

    // Write prompt to file in worktree (accessible by container)
    const { hostPath: promptHostPath, containerPath: promptFile } = writePromptFile(context)

    // Inject fresh GitHub token into container (containers may be reused with stale/empty tokens)
    // This ensures git push works even if the container was created before token was available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    if (containerId && githubToken) {
      try {
        // Write token to file and configure git credential helper
        execSync(`docker exec ${containerId} bash -c 'echo "${githubToken}" > /home/node/.github-token && chmod 600 /home/node/.github-token && git config --global credential.helper "!f() { echo \\"username=x-access-token\\"; echo \\"password=\\$(cat /home/node/.github-token)\\"; }; f" && git config --global url."https://github.com/".insteadOf "git@github.com:"'`, {
          stdio: 'pipe',
        })
      } catch {
        // Non-fatal - token injection failed but execution can continue
      }
    }

    // Build the docker exec command (just runs claude directly)
    // tmux session setup is handled by runDevcontainerInTmux, not buildDevcontainerCommand
    const devcontainerCmd = buildDevcontainerCommand(context, executor, promptFile, containerId, config.outputMode, config.permissionMode, displayMode)

    // Execute based on display mode
    // When sessionManager is 'tmux', always use tmux inside container for session persistence
    // (allows reattach via `prlt session attach` even for background mode)
    let result: RunnerResult
    if (sessionManager === 'tmux') {
      // Use tmux inside container - pass displayMode to control whether to open terminal tab
      // Pass containerId directly to avoid regex extraction issues with devcontainer exec commands
      result = await runDevcontainerInTmux(context, devcontainerCmd, config, displayMode, containerId || undefined)
    } else {
      switch (displayMode) {
        case 'background':
          result = await runDevcontainerInBackground(context, devcontainerCmd)
          break
        case 'terminal':
        default:
          result = await runDevcontainerInTerminal(context, devcontainerCmd, config)
          break
      }
    }

    // Clean up prompt file if execution failed to start
    // (successful executions clean up the file themselves via the command)
    if (!result.success && fs.existsSync(promptHostPath)) {
      try {
        fs.unlinkSync(promptHostPath)
      } catch (err) {
        console.debug('[runners:devcontainer] Failed to cleanup prompt file:', err)
      }
    }

    // Override containerId with the real Docker container ID (not the placeholder)
    if (result.success && containerId) {
      result.containerId = containerId
    }

    // Set sessionId when using tmux inside the container
    // Use buildSessionName to match the actual tmux session name format: {ticketId}-{action}-{agentName}
    if (result.success && sessionManager === 'tmux') {
      const sessionId = buildSessionName(context)
      result.sessionId = sessionId

      // For terminal display mode, verify the tmux session was actually created
      // (terminal spawns asynchronously, so we need to wait and check)
      if (displayMode === 'terminal' && containerId) {
        // Wait for the terminal to execute the script
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Check if tmux session exists inside the container
        try {
          execSync(
            `docker exec ${containerId} tmux has-session -t "${sessionId}" 2>&1`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          )
          // Session exists - success
        } catch (err) {
          console.debug(`[runners:devcontainer] tmux session ${sessionId} not found in container:`, err)
          result.success = false
          result.error = `Failed to create tmux session "${sessionId}" inside container. Check terminal for errors.`
        }
      }
    }

    return result
  } catch (error) {
    // Clean up any orphaned prompt files on error
    cleanupOldPromptFiles(context.worktreePath, context.ticketId)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run in devcontainer',
    }
  }
}
/**
 * Run devcontainer command in a new terminal window.
 * Uses a temp script file to avoid shell escaping issues with complex prompts.
 */
async function runDevcontainerInTerminal(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig
): Promise<RunnerResult> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      error: 'Terminal mode is only supported on macOS. Use background mode instead.',
    }
  }

  const terminalApp = config.terminal.app

  // Write command to temp script to avoid shell escaping issues
  // Use HQ .proletariat/scripts if available, otherwise fallback to home dir
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })
  const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${Date.now()}.sh`)

  // Build window title for terminal tab
  const windowTitle = buildWindowTitle(context)
  const setTitleCmds = getSetTitleCommands(windowTitle)

  // Write script - run the command directly
  // No auth check needed - if auth is required, Claude will show "Invalid API key"
  // and user can run /login from there
  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
${setTitleCmds}
echo "🚀 Starting ticket execution: ${context.ticketId}"
echo ""

# Run the ticket
${devcontainerCmd}

# Clean up script file
rm -f "${scriptPath}"

# Keep shell open after completion
exec $SHELL
`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  // Check if we should open in background (don't steal focus)
  const openInBackground = config.terminal.openInBackground ?? true

  try {
    switch (terminalApp) {
      case 'iTerm':
        // Run script file directly - iTerm will execute it with proper TTY
        // When openInBackground is true, save frontmost app and restore after
        if (openInBackground) {
          execSync(`osascript -e '
            -- Save the currently active application and window
            tell application "System Events"
              set frontApp to name of first application process whose frontmost is true
              set frontAppBundle to bundle identifier of first application process whose frontmost is true
            end tell

            tell application "iTerm"
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  write text "${scriptPath}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  tell current session of newTab
                    write text "${scriptPath}"
                  end tell
                end tell
              end if
            end tell

            -- Restore focus to the original application
            delay 0.2
            tell application "System Events"
              set frontmost of process frontApp to true
            end tell
            delay 0.1
            do shell script "open -b " & quoted form of frontAppBundle
          '`)
        } else {
          execSync(`osascript -e '
            tell application "iTerm"
              activate
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  write text "${scriptPath}"
                end tell
              else
                tell current window
                  set newTab to (create tab with default profile)
                  tell current session of newTab
                    write text "${scriptPath}"
                  end tell
                end tell
              end if
            end tell
          '`)
        }
        break

      case 'Ghostty':
        // Use source to preserve TTY for docker exec
        execSync(`osascript -e '
          tell application "Ghostty"
            activate
          end tell
          tell application "System Events"
            tell process "Ghostty"
              keystroke "t" using command down
              delay 0.3
              keystroke "source ${scriptPath}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'WezTerm':
        // Use bash -c source to preserve TTY
        execSync(`wezterm cli spawn --new-window -- bash -c 'source ${scriptPath}'`)
        break

      case 'Kitty':
        // Use bash -c source to preserve TTY
        execSync(`kitty @ launch --type=tab -- bash -c 'source ${scriptPath}'`)
        break

      case 'Alacritty':
        // Use source to preserve TTY for docker exec
        execSync(`osascript -e '
          tell application "Alacritty"
            activate
          end tell
          tell application "System Events"
            tell process "Alacritty"
              keystroke "n" using command down
              delay 0.3
              keystroke "source ${scriptPath}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'Terminal':
      default:
        // Use source to preserve TTY for docker exec
        if (openInBackground) {
          // Open in background: use 'do script' which creates a new window without activating
          execSync(`osascript -e '
            tell application "Terminal"
              do script "source ${scriptPath}"
            end tell
          '`)
        } else {
          // Bring to front: use traditional Cmd+T for new tab
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "source ${scriptPath}" in front window
            end tell
          '`)
        }
        break
    }

    return {
      success: true,
      containerId: `devcontainer-${context.agentName}`,
      sessionId: `terminal-${context.ticketId}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to open ${terminalApp}`,
    }
  }
}

/**
 * Run devcontainer command in background, logging to file
 */
async function runDevcontainerInBackground(
  context: ExecutionContext,
  devcontainerCmd: string
): Promise<RunnerResult> {
  // Create logs directory
  const logsDir = path.join(os.homedir(), '.proletariat', 'logs')
  fs.mkdirSync(logsDir, { recursive: true })

  const logPath = path.join(logsDir, `work-${context.ticketId}-${Date.now()}.log`)
  const logStream = fs.openSync(logPath, 'w')

  const child = spawn('sh', ['-c', devcontainerCmd], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
  })

  child.unref()

  return {
    success: true,
    pid: child.pid?.toString(),
    containerId: `devcontainer-${context.agentName}`,
    logPath,
  }
}

/**
 * Run devcontainer command in tmux session INSIDE the container.
 *
 * Architecture: Container tmux only (simple, no nesting)
 * 1. Start tmux session INSIDE the container (detached) - runs claude
 * 2. Open iTerm tab that attaches directly to the container's tmux
 *
 * Benefits:
 * - Session persists even if you close iTerm tab
 * - No nested tmux = proper scrolling
 * - Can reattach anytime via `prlt session attach`
 * - Sessions tracked in workspace.db
 */
async function runDevcontainerInTmux(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  containerId?: string
): Promise<RunnerResult> {
  // Session name: {ticketId}-{action} (e.g., TKT-347-implement)
  const sessionName = buildTmuxWindowName(context)
  const windowTitle = buildWindowTitle(context)

  // Check if we should use iTerm control mode (-CC)
  // When using -CC, iTerm handles scrolling/selection natively, so we DON'T set mouse on
  const terminalApp = config.terminal.app
  const useControlMode = shouldUseControlMode(terminalApp, config.tmux.controlMode)

  try {
    // Get container ID - prefer passed value, fallback to extracting from command
    // The devcontainerCmd is like: docker exec [-it] <containerId> bash -c '...'
    // Note: -it flags are optional (not present in background mode)
    let actualContainerId = containerId
    if (!actualContainerId) {
      const containerIdMatch = devcontainerCmd.match(/docker exec\s+(?:-it\s+)?(\S+)/)
      if (containerIdMatch) {
        actualContainerId = containerIdMatch[1]
      }
    }
    if (!actualContainerId) {
      return {
        success: false,
        error: 'Could not determine container ID for tmux session',
      }
    }

    // Check if tmux is available inside the container
    try {
      execSync(`docker exec ${actualContainerId} which tmux`, { stdio: 'pipe' })
    } catch {
      return {
        success: false,
        error: `tmux is not installed in the devcontainer. ` +
          `Add 'tmux' to your devcontainer's Dockerfile (e.g., apt-get install -y tmux) ` +
          `or use the default prlt devcontainer template which includes tmux.`,
      }
    }

    // Step 1: Start tmux session INSIDE the container (detached)
    // Extract the claude command from the devcontainer command
    const cmdMatch = devcontainerCmd.match(/bash -c '(.+)'$/)
    const claudeCmd = cmdMatch ? cmdMatch[1] : devcontainerCmd

    // Create a script inside the container that runs claude and keeps shell open
    // TERM must be set for Claude's TUI to render properly
    // Unset CI to prevent Claude from detecting CI environment which suppresses TUI output
    // Unset CLAUDECODE to allow Claude Code to run (prevents nested session error)
    // Note: We keep DEVCONTAINER set so prlt workspace detection works correctly
    const tmuxScript = `#!/bin/bash
export TERM=xterm-256color
export COLORTERM=truecolor
unset CI
unset CLAUDECODE
echo "🚀 Starting: ${sessionName}"
echo ""
${claudeCmd}
echo ""
echo "✅ Agent work complete. Press Enter to close or run more commands."
exec bash
`
    const scriptPath = `/tmp/prlt-${sessionName}.sh`

    // Write script and start tmux session inside container
    // IMPORTANT: We create the session with bash first, then send keys to run the script.
    // This ensures bash is running interactively (required for Claude's TUI to render).
    // If we pass the script as the session command, bash runs non-interactively and Claude won't show TUI.
    // -n sets the window name (shows in iTerm tab title with -CC mode)
    // sessionName is already ticket-action-agent format
    // Only enable mouse mode if NOT using control mode (control mode lets iTerm handle mouse natively)
    // set-titles on + set-titles-string: makes tmux set terminal title to window name
    const mouseOption = buildTmuxMouseOption(useControlMode)

    // Step 1: Write the script to the container via stdin piping to avoid ARG_MAX limits
    try {
      execSync(`docker exec -i ${actualContainerId} bash -c 'cat > ${scriptPath} && chmod +x ${scriptPath}'`, {
        input: tmuxScript,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      return {
        success: false,
        error: `Failed to write script to container: ${error instanceof Error ? error.message : error}`,
      }
    }

    // TKT-1028: If a tmux session with the same name already exists (e.g., same
    // ticket+action spawned again in a reused container), kill the old session first.
    try {
      execSync(`docker exec ${actualContainerId} tmux has-session -t "${sessionName}" 2>&1`, { stdio: 'pipe' })
      // Session exists - kill it before creating a new one
      console.debug(`[runners:tmux] Killing existing tmux session "${sessionName}" in container`)
      try {
        execSync(`docker exec ${actualContainerId} tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' })
      } catch {
        // Ignore kill errors
      }
    } catch {
      // Session doesn't exist - that's the normal case
    }

    // Step 2: Create tmux session running the script directly
    // Pass the script as the session command (like host runner does) instead of using send-keys.
    // The send-keys approach had a race condition where keys could be lost if bash hadn't
    // fully initialized, causing background mode to create empty sessions without running claude.
    const createSessionCmd = `tmux new-session -d -s "${sessionName}" -n "${sessionName}" "bash ${scriptPath}"${mouseOption} \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`
    try {
      execSync(`docker exec ${actualContainerId} bash -c '${createSessionCmd}'`, { stdio: 'pipe' })
    } catch (error) {
      return {
        success: false,
        error: `Failed to create tmux session inside container: ${error instanceof Error ? error.message : error}`,
      }
    }

    // Step 3: Handle display mode
    // For background mode, return success after tmux session is created
    // User can reattach later with `prlt session attach`
    if (displayMode === 'background') {
      // Verify the tmux session was actually created (brief delay to let tmux start)
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        execSync(
          `docker exec ${actualContainerId} tmux has-session -t "${sessionName}" 2>&1`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        )
      } catch {
        return {
          success: false,
          error: `Failed to verify tmux session "${sessionName}" inside container. The session may not have started correctly.`,
        }
      }
      return {
        success: true,
        containerId: actualContainerId,
        sessionId: sessionName, // Container tmux session name for tracking
      }
    }

    // For foreground mode: attach to container's tmux session in current terminal (blocking)
    if (displayMode === 'foreground') {
      try {
        // Clear screen and attach - this blocks until user detaches or claude exits
        // Never use -CC in foreground mode: control mode sends raw tmux protocol
        // sequences (%begin, %output, %end) that render as garbled text unless
        // iTerm's native CC handler is active (only happens in new tabs opened via AppleScript)
        const fgTmuxAttach = buildTmuxAttachCommand(false, true)
        execSync(`clear && docker exec -it ${actualContainerId} ${fgTmuxAttach} -t "${sessionName}"`, { stdio: 'inherit' })
        return {
          success: true,
          containerId: actualContainerId,
          sessionId: sessionName,
        }
      } catch (error) {
        return {
          success: false,
          error: `Failed to attach to container tmux session: ${error instanceof Error ? error.message : error}`,
        }
      }
    }

    // Use tmux -CC (control mode) for iTerm when enabled in config
    // -CC gives native iTerm scrolling, selection, and gesture support
    // Without -CC, use regular attach (relies on mouse mode for scrolling)
    const tmuxAttach = buildTmuxAttachCommand(useControlMode, true)
    const attachCmd = `docker exec -it ${actualContainerId} ${tmuxAttach} -t "${sessionName}"`

    // Open terminal and run the attach command
    const terminalApp = config.terminal.app

    // For iTerm with control mode, create a new tab and run -CC attach there
    // This avoids interfering with the terminal where prlt is running
    if (terminalApp === 'iTerm' && useControlMode) {
      // Configure iTerm to open tmux windows as tabs or windows based on user preference
      configureITermTmuxWindowMode(config.tmux.windowMode)

      const openInBackground = config.terminal.openInBackground ?? true

      if (openInBackground) {
        // Open tab without stealing focus - save frontmost app and restore after
        execSync(`osascript -e '
          set frontApp to path to frontmost application as text
          tell application "iTerm"
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "docker exec -it ${actualContainerId} tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
          tell application frontApp to activate
        '`)
      } else {
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "docker exec -it ${actualContainerId} tmux -u -CC attach -d -t \\"${sessionName}\\""
              end tell
            end tell
          end tell
        '`)
      }
      return {
        success: true,
        containerId: actualContainerId,
        sessionId: sessionName,
      }
    }

    // For all other cases, create a script file and open in a new tab
    const baseDir = context.hqPath
      ? path.join(context.hqPath, '.proletariat', 'scripts')
      : path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const hostScriptPath = path.join(baseDir, `attach-${sessionName}-${Date.now()}.sh`)

    const setTitleCmds = getSetTitleCommands(windowTitle)

    const hostScript = `#!/bin/bash
${setTitleCmds}
# Attach to container tmux session
# Session: ${sessionName}
# Container: ${actualContainerId}
${attachCmd}

# Clean up
rm -f "${hostScriptPath}"
exec $SHELL
`
    fs.writeFileSync(hostScriptPath, hostScript, { mode: 0o755 })

    // Check if we should open in background (don't steal focus)
    const openInBackground = config.terminal.openInBackground ?? true

    switch (terminalApp) {
      case 'iTerm':
        // Without control mode, create a new tab and attach normally
        // When openInBackground is true, save frontmost app and restore after
        if (openInBackground) {
          execSync(`osascript -e '
            -- Save the currently active application and window
            tell application "System Events"
              set frontApp to name of first application process whose frontmost is true
              set frontAppBundle to bundle identifier of first application process whose frontmost is true
            end tell

            tell application "iTerm"
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${hostScriptPath}"
                end tell
              else
                tell current window
                  create tab with default profile
                  tell current session
                    set name to "${windowTitle}"
                    write text "${hostScriptPath}"
                  end tell
                end tell
              end if
            end tell

            -- Restore focus to the original application
            delay 0.2
            tell application "System Events"
              set frontmost of process frontApp to true
            end tell
            delay 0.1
            do shell script "open -b " & quoted form of frontAppBundle
          '`)
        } else {
          execSync(`osascript -e '
            tell application "iTerm"
              activate
              if (count of windows) = 0 then
                create window with default profile
                tell current session of current window
                  set name to "${windowTitle}"
                  write text "${hostScriptPath}"
                end tell
              else
                tell current window
                  create tab with default profile
                  tell current session
                    set name to "${windowTitle}"
                    write text "${hostScriptPath}"
                  end tell
                end tell
              end if
            end tell
          '`)
        }
        break

      case 'Ghostty':
        execSync(`osascript -e '
          tell application "Ghostty"
            activate
          end tell
          tell application "System Events"
            tell process "Ghostty"
              keystroke "t" using command down
              delay 0.3
              keystroke "${hostScriptPath}"
              keystroke return
            end tell
          end tell
        '`)
        break

      case 'Terminal':
      default:
        if (openInBackground) {
          // Open in background: use 'do script' which creates a new window without activating
          execSync(`osascript -e '
            tell application "Terminal"
              do script "${hostScriptPath}"
            end tell
          '`)
        } else {
          // Bring to front: use traditional Cmd+T for new tab
          execSync(`osascript -e '
            tell application "Terminal"
              activate
              tell application "System Events"
                tell process "Terminal"
                  keystroke "t" using command down
                end tell
              end tell
              delay 0.3
              do script "${hostScriptPath}" in front window
            end tell
          '`)
        }
        break
    }

    return {
      success: true,
      containerId: actualContainerId,
      sessionId: sessionName, // Container tmux session name for tracking
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start tmux session in container',
    }
  }
}

// =============================================================================
// Docker Runner
// =============================================================================

export async function runDocker(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  const containerName = `work-${context.ticketId}-${Date.now()}`

  try {
    // Check if docker is available
    execSync('which docker', { stdio: 'pipe' })

    // Check if Docker is running
    if (!isDockerRunning()) {
      return {
        success: false,
        error: 'Docker is not running. Please start Docker Desktop and try again.',
      }
    }

    // Build docker run command
    let dockerCmd = `docker run -d --name ${containerName}`
    dockerCmd += ` -v "${context.worktreePath}:/workspace"`
    dockerCmd += ` -w /workspace`
    dockerCmd += ` -e TICKET_ID="${context.ticketId}"`

    if (config.docker.network) {
      dockerCmd += ` --network ${config.docker.network}`
    }
    if (config.docker.memory) {
      dockerCmd += ` --memory ${config.docker.memory}`
    }
    if (config.docker.cpus) {
      dockerCmd += ` --cpus ${config.docker.cpus}`
    }

    // Validate Codex mode: Docker runner is always non-tty (detached with -d)
    if (executor === 'codex') {
      const codexPermission: PermissionMode = config.permissionMode
      const modeError = validateCodexMode(codexPermission, 'non-tty')
      if (modeError) {
        return { success: false, error: modeError.message }
      }
    }

    // Build executor command using getExecutorCommand() for correct invocation
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const { cmd, args } = getExecutorCommand(executor, escapedPrompt, config.permissionMode === 'danger')

    // For Claude Code in Docker, use --print for non-interactive output
    // Non-Claude executors use their native command format from getExecutorCommand()
    dockerCmd += ` ${config.docker.image}`
    if (isClaudeExecutor(executor)) {
      dockerCmd += ` ${cmd} --print '${escapedPrompt}'`
    } else {
      const argsStr = args.map(a => a === escapedPrompt ? `'${escapedPrompt}'` : a).join(' ')
      dockerCmd += ` ${cmd} ${argsStr}`
    }

    const containerId = execSync(dockerCmd, { encoding: 'utf-8' }).trim()

    return {
      success: true,
      containerId: containerId.substring(0, 12),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start docker container',
    }
  }
}

// =============================================================================
// Orchestrator Docker Runner (Sibling Container Pattern)
// =============================================================================

/**
 * Run orchestrator in a Docker container using the sibling container pattern.
 *
 * Architecture:
 * ```
 * Host Docker daemon
 * ├── orchestrator container (has /var/run/docker.sock mounted)
 * ├── agent-1 container (spawned by orchestrator, sibling)
 * ├── agent-2 container (spawned by orchestrator, sibling)
 * ```
 *
 * The orchestrator container needs:
 * - HQ directory mounted (proletariat-hq)
 * - Docker socket mounted (/var/run/docker.sock) — so it can spawn agent containers as siblings
 * - prlt CLI installed in the container
 * - OAuth credentials for Claude Code (via Docker volume)
 * - tmux for session persistence inside the container
 */
export async function runOrchestratorInDocker(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  options?: { displayMode?: DisplayMode; sessionName?: string }
): Promise<RunnerResult> {
  const displayMode = options?.displayMode || 'background'
  const hqPath = context.hqPath || context.worktreePath
  const hqName = context.hqName || 'default'
  const orchestratorName = context.agentName || 'main'

  // Container name matches tmux session name for consistency
  const containerName = `prlt-orchestrator-${(hqName).replace(/[^a-zA-Z0-9._-]/g, '-')}-${(orchestratorName).replace(/[^a-zA-Z0-9._-]/g, '-')}`
  const imageName = `prlt-orchestrator-${(hqName).replace(/[^a-zA-Z0-9._-]/g, '-')}:latest`

  try {
    // Check Docker is running
    if (!isDockerRunning()) {
      return {
        success: false,
        error: 'Docker is not running. Please start Docker Desktop and try again.',
      }
    }

    // Check if container already exists and is running
    if (containerExists(containerName)) {
      if (isContainerRunning(containerName)) {
        return {
          success: false,
          error: `Orchestrator container "${containerName}" is already running. Use "prlt orchestrator attach" to reattach.`,
        }
      }
      // Remove stopped container
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' })
      } catch {
        // Ignore removal errors
      }
    }

    // Generate Dockerfile
    const orchestratorDockerOptions: OrchestratorDockerOptions = {
      orchestratorName,
      hqPath,
      executor,
    }
    const dockerfileContent = generateOrchestratorDockerfile(orchestratorDockerOptions)

    // Write Dockerfile to temp directory
    const buildDir = path.join(hqPath, '.proletariat', 'orchestrator-docker')
    fs.mkdirSync(buildDir, { recursive: true })
    const dockerfilePath = path.join(buildDir, 'Dockerfile')
    fs.writeFileSync(dockerfilePath, dockerfileContent)

    // Build the image
    const hostPrltVersion = getHostPrltVersion()
    const buildArgs: Record<string, string> = {
      PRLT_VERSION: hostPrltVersion || 'latest',
    }
    const buildArgFlags = Object.entries(buildArgs)
      .map(([key, value]) => `--build-arg ${key}="${value}"`)
      .join(' ')

    console.debug(`[runners:orchestrator-docker] Building image: ${imageName}`)
    try {
      execSync(`docker build -t ${imageName} -f "${dockerfilePath}" ${buildArgFlags} "${buildDir}"`, { stdio: 'pipe' })
    } catch (buildError) {
      return {
        success: false,
        error: `Failed to build orchestrator Docker image: ${buildError instanceof Error ? buildError.message : buildError}`,
      }
    }

    // Build mount flags for docker run
    const mounts: string[] = [
      // Mount HQ directory
      `-v "${hqPath}:/hq:cached"`,
      // Docker socket for sibling container pattern
      `-v /var/run/docker.sock:/var/run/docker.sock`,
      // Claude credentials volume (shared with agent containers)
      ...(executor === 'claude-code' ? ['-v "claude-credentials:/home/node/.claude"'] : []),
      // Persistent bash history
      '-v "claude-bash-history:/commandhistory"',
    ]

    // Build environment variables
    const envVars: string[] = [
      `-e PRLT_HQ_PATH=/hq`,
      `-e PRLT_AGENT_NAME="orchestrator-${orchestratorName}"`,
      `-e PRLT_HOST_PATH="${hqPath}"`,
      // Pass through GitHub tokens for agent spawning
      ...(process.env.GITHUB_TOKEN ? [`-e GITHUB_TOKEN="${process.env.GITHUB_TOKEN}"`] : []),
      ...(process.env.GH_TOKEN ? [`-e GH_TOKEN="${process.env.GH_TOKEN}"`] : []),
      // Pass ANTHROPIC_API_KEY if available (for cases where OAuth is not set up)
      ...(process.env.ANTHROPIC_API_KEY ? [`-e ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}"`] : []),
    ]

    // Create and start container
    const createCmd = [
      'docker run -d',
      `--name ${containerName}`,
      '--user node',
      '-w /hq',
      ...mounts,
      ...envVars,
      `--memory=${config.devcontainer.memory}`,
      `--cpus=${config.devcontainer.cpus}`,
      imageName,
      'sleep infinity',  // Keep container running
    ].join(' ')

    console.debug(`[runners:orchestrator-docker] Creating container: ${createCmd}`)
    execSync(createCmd, { stdio: 'pipe' })

    const containerId = getContainerId(containerName)
    if (!containerId) {
      return {
        success: false,
        error: 'Failed to get container ID after creation',
      }
    }

    // Fix Docker socket permissions inside the container
    // The socket is owned by root on the host; we need the node user to access it
    try {
      execSync(`docker exec --user root ${containerId} chmod 666 /var/run/docker.sock`, { stdio: 'pipe' })
    } catch {
      console.debug('[runners:orchestrator-docker] Failed to fix Docker socket permissions (may already be accessible)')
    }

    // Copy Claude Code settings to container (for bypassing prompts)
    if (executor === 'claude-code') {
      try {
        const hostClaudeJson = path.join(os.homedir(), '.claude.json')
        let settings: Record<string, unknown> = {}

        if (fs.existsSync(hostClaudeJson)) {
          try {
            settings = JSON.parse(fs.readFileSync(hostClaudeJson, 'utf-8'))
          } catch {
            // Use empty settings
          }
        }

        if (config.permissionMode === 'danger') {
          settings.bypassPermissionsModeAccepted = true
        }
        settings.numStartups = settings.numStartups || 1
        settings.hasCompletedOnboarding = true
        settings.theme = settings.theme || 'dark'
        if (!settings.tipsHistory || typeof settings.tipsHistory !== 'object') {
          settings.tipsHistory = {}
        }
        const tips = settings.tipsHistory as Record<string, number>
        tips['new-user-warmup'] = tips['new-user-warmup'] || 1
        settings.effortCalloutDismissed = true

        if (!settings.projects || typeof settings.projects !== 'object') {
          settings.projects = {}
        }
        const projects = settings.projects as Record<string, Record<string, unknown>>
        for (const projectPath of ['/hq', '/']) {
          if (!projects[projectPath]) projects[projectPath] = {}
          projects[projectPath].hasTrustDialogAccepted = true
          projects[projectPath].hasCompletedProjectOnboarding = true
        }

        execSync(
          `docker exec -i ${containerId} bash -c 'cat > /home/node/.claude.json'`,
          { input: JSON.stringify(settings), stdio: ['pipe', 'pipe', 'pipe'] }
        )

        const claudeSettings = JSON.stringify({ skipDangerousModePermissionPrompt: true })
        execSync(
          `docker exec -i ${containerId} bash -c 'mkdir -p /home/node/.claude && cat > /home/node/.claude/settings.json'`,
          { input: claudeSettings, stdio: ['pipe', 'pipe', 'pipe'] }
        )
      } catch (error) {
        console.debug('[runners:orchestrator-docker] Failed to copy Claude settings:', error)
      }
    }

    // Build the prompt and write to temp file inside container
    const prompt = buildPrompt(context)
    const promptPath = `/tmp/orchestrator-prompt-${Date.now()}.txt`
    try {
      execSync(
        `docker exec -i ${containerId} bash -c 'cat > ${promptPath}'`,
        { input: prompt, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } catch {
      return {
        success: false,
        error: 'Failed to write prompt to container',
      }
    }

    // Build executor command
    const skipPermissions = config.permissionMode === 'danger'
    const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
    const effortFlag = skipPermissions ? '--effort high ' : ''
    const executorCmd = executor === 'claude-code'
      ? `claude ${permissionsFlag}${effortFlag}"$(cat ${promptPath})"`
      : `claude ${permissionsFlag}${effortFlag}"$(cat ${promptPath})"`

    // Build tmux session name (reuses the same name as host tmux for consistency)
    const tmuxSessionName = options?.sessionName || containerName

    // Create tmux session inside container with the executor command
    const tmuxCmd = `tmux new-session -d -s "${tmuxSessionName}" -n "${tmuxSessionName}" bash -c '(unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; cd /hq && ${executorCmd}); echo ""; echo "Orchestrator complete. Press Enter to close."; exec bash'`

    try {
      execSync(
        `docker exec ${containerId} bash -c '${tmuxCmd.replace(/'/g, "'\\''")}'`,
        { stdio: 'pipe' }
      )
    } catch (tmuxError) {
      // Fallback: try simpler command without subshell
      console.debug('[runners:orchestrator-docker] tmux creation failed, trying simpler approach:', tmuxError)
      try {
        // Write a script inside the container
        const scriptContent = `#!/bin/bash
cd /hq
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT
${executor === 'claude-code' ? `claude ${permissionsFlag}${effortFlag}"$(cat ${promptPath})"` : `claude "$(cat ${promptPath})"`}
echo ""
echo "Orchestrator complete. Press Enter to close."
exec bash
`
        execSync(
          `docker exec -i ${containerId} bash -c 'cat > /tmp/orchestrator-start.sh && chmod +x /tmp/orchestrator-start.sh'`,
          { input: scriptContent, stdio: ['pipe', 'pipe', 'pipe'] }
        )
        execSync(
          `docker exec ${containerId} tmux new-session -d -s "${tmuxSessionName}" /tmp/orchestrator-start.sh`,
          { stdio: 'pipe' }
        )
      } catch (fallbackError) {
        return {
          success: false,
          error: `Failed to create tmux session in container: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}`,
        }
      }
    }

    // Handle display mode
    if (displayMode === 'foreground') {
      // Attach to tmux inside the container in current terminal
      try {
        const child = spawn('docker', ['exec', '-it', containerId, 'tmux', 'attach', '-t', tmuxSessionName], {
          stdio: 'inherit',
        })
        await new Promise<void>((resolve) => {
          child.on('close', () => resolve())
        })
      } catch {
        // User detached - that's fine
      }
    } else if (displayMode === 'terminal' && process.platform === 'darwin') {
      // Open a new terminal tab that attaches to the container's tmux
      const baseDir = path.join(hqPath, '.proletariat', 'scripts')
      fs.mkdirSync(baseDir, { recursive: true })
      const scriptPath = path.join(baseDir, `orch-docker-attach-${Date.now()}.sh`)
      const scriptContent = `#!/bin/bash
echo -ne "\\033]0;Orchestrator (Docker)\\007"
echo -ne "\\033]1;Orchestrator (Docker)\\007"
docker exec -it ${containerId} tmux attach -t "${tmuxSessionName}"
rm -f "${scriptPath}"
exec $SHELL
`
      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

      const terminalApp = config.terminal.app
      try {
        switch (terminalApp) {
          case 'iTerm':
            execSync(`osascript -e '
              tell application "iTerm"
                activate
                tell current window
                  set newTab to (create tab with default profile)
                  tell current session of newTab
                    set name to "Orchestrator (Docker)"
                    write text "${scriptPath}"
                  end tell
                end tell
              end tell
            '`)
            break

          case 'Ghostty':
            execSync(`osascript -e '
              tell application "Ghostty"
                activate
              end tell
              tell application "System Events"
                tell process "Ghostty"
                  keystroke "t" using command down
                  delay 0.3
                  keystroke "${scriptPath}"
                  keystroke return
                end tell
              end tell
            '`)
            break

          default:
            execSync(`osascript -e '
              tell application "Terminal"
                activate
                tell application "System Events"
                  tell process "Terminal"
                    keystroke "t" using command down
                  end tell
                end tell
                delay 0.3
                do script "${scriptPath}" in front window
              end tell
            '`)
            break
        }
      } catch {
        console.debug('[runners:orchestrator-docker] Failed to open terminal tab, running in background')
      }
    }
    // 'background' display mode: container is already running, nothing more to do

    return {
      success: true,
      containerId,
      sessionId: tmuxSessionName,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start orchestrator in Docker',
    }
  }
}

// =============================================================================
// VM Runner
// =============================================================================

export async function runVm(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  host?: string
): Promise<RunnerResult> {
  const targetHost = host || config.vm.defaultHost
  if (!targetHost) {
    return {
      success: false,
      error: 'No VM host specified. Use --host or configure execution.vm.default_host',
    }
  }

  const prompt = buildPrompt(context)
  const user = config.vm.user
  const keyPath = config.vm.keyPath
  const remoteWorkspace = `/workspace/${context.agentName}`

  try {
    // Build SSH options
    let sshOpts = ''
    if (keyPath) {
      sshOpts = `-i "${keyPath}"`
    }

    // Sync worktree to remote
    if (config.vm.syncMethod === 'rsync') {
      let rsyncCmd = `rsync -avz`
      if (keyPath) {
        rsyncCmd += ` -e "ssh -i ${keyPath}"`
      }
      rsyncCmd += ` "${context.worktreePath}/" ${user}@${targetHost}:${remoteWorkspace}/`
      execSync(rsyncCmd, { stdio: 'pipe' })
    } else {
      // Git-based sync: push branch and pull on remote
      execSync(`git push origin ${context.branch}`, { cwd: context.worktreePath, stdio: 'pipe' })
      const gitPullCmd = `cd ${remoteWorkspace} && git fetch && git checkout ${context.branch}`
      execSync(`ssh ${sshOpts} ${user}@${targetHost} "${gitPullCmd}"`, { stdio: 'pipe' })
    }

    // Validate Codex mode: VM runner is always non-tty (SSH + nohup)
    if (executor === 'codex') {
      const codexPermission: PermissionMode = config.permissionMode
      const modeError = validateCodexMode(codexPermission, 'non-tty')
      if (modeError) {
        return { success: false, error: modeError.message }
      }
    }

    // Execute on remote using executor-appropriate command
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const { cmd: executorCmd, args: executorArgs } = getExecutorCommand(executor, escapedPrompt, config.permissionMode === 'danger')

    // Build the remote command based on executor type
    let remoteCmd: string
    if (isClaudeExecutor(executor)) {
      remoteCmd = `cd ${remoteWorkspace} && ${executorCmd} --print '${escapedPrompt}'`
    } else {
      const argsStr = executorArgs.map(a => a === escapedPrompt ? `'${escapedPrompt}'` : a).join(' ')
      remoteCmd = `cd ${remoteWorkspace} && ${executorCmd} ${argsStr}`
    }
    const sshCmd = `ssh ${sshOpts} ${user}@${targetHost} "nohup ${remoteCmd} > /tmp/work-${context.ticketId}.log 2>&1 &"`

    execSync(sshCmd, { stdio: 'pipe' })

    return {
      success: true,
      sessionId: `${targetHost}:${context.ticketId}`,
      logPath: `/tmp/work-${context.ticketId}.log`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute on VM',
    }
  }
}

// =============================================================================
// Runner Dispatcher
// =============================================================================

export async function runExecution(
  environment: ExecutionEnvironment,
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig = DEFAULT_EXECUTION_CONFIG,
  options?: { host?: string; displayMode?: DisplayMode; sessionManager?: SessionManager }
): Promise<RunnerResult> {
  // Ensure tmux server has keychain access for OAuth (host only)
  // Docker uses claude-credentials volume, devcontainer runs inside container
  if (environment === 'host') {
    await ensureTmuxServerHasKeychainAccess()
  }

  switch (environment) {
    case 'devcontainer':
      return runDevcontainer(context, executor, config, options?.displayMode, options?.sessionManager)
    case 'host':
      // Host uses tmux for session persistence (same as devcontainer)
      return runHost(context, executor, config, options?.displayMode)
    case 'docker':
      return runDocker(context, executor, config)
    case 'vm':
      return runVm(context, executor, config, options?.host)
    default:
      return { success: false, error: `Unknown execution environment: ${environment}` }
  }
}
