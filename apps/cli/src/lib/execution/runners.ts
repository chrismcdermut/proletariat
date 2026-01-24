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
  SessionManager,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js'
import { getSetTitleCommands } from '../terminal.js'

// =============================================================================
// Terminal Title Helpers
// =============================================================================

/**
 * Build a unified name for tmux sessions, window names, and tab titles.
 * Format: "{ticketId}-{action}-{agentName}"
 * Example: "TKT-347-implement-altman"
 */
export function buildSessionName(context: ExecutionContext): string {
  // Sanitize action name: replace spaces and special chars with hyphens for shell safety
  const action = (context.actionName || 'work').replace(/\s+/g, '-')
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
// Executor Commands
// =============================================================================

function getExecutorCommand(executor: ExecutorType, prompt: string, skipPermissions: boolean = true): { cmd: string; args: string[] } {
  switch (executor) {
    case 'claude-code':
      if (skipPermissions) {
        // Skip permissions - agent runs autonomously without prompting
        // Note: NO -p flag - we want interactive mode for streaming output in terminal
        return { cmd: 'claude', args: ['--dangerously-skip-permissions', prompt] }
      }
      // Manual mode - will prompt for each action (still interactive, no -p)
      return { cmd: 'claude', args: [prompt] }
    case 'codex':
      return { cmd: 'codex', args: ['--prompt', prompt] }
    case 'aider':
      return { cmd: 'aider', args: ['--message', prompt] }
    case 'custom':
      // Custom executor should be configured
      return { cmd: 'echo', args: ['Custom executor not configured'] }
    default:
      if (skipPermissions) {
        // Note: NO -p flag - we want interactive mode for streaming output
        return { cmd: 'claude', args: ['--dangerously-skip-permissions', prompt] }
      }
      return { cmd: 'claude', args: [prompt] }
  }
}

function buildPrompt(context: ExecutionContext): string {
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
  // Terminal - use sandboxed setting
  const skipPermissions = !config.sandboxed
  const { cmd } = getExecutorCommand(executor, prompt, skipPermissions)

  // Write command to temp script to avoid shell escaping issues
  // Use HQ .proletariat/scripts if available, otherwise fallback to home dir
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })

  const timestamp = Date.now()
  const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${timestamp}.sh`)
  const promptPath = path.join(baseDir, `prompt-${context.ticketId}-${timestamp}.txt`)

  // Write prompt to separate file to avoid any shell escaping issues
  fs.writeFileSync(promptPath, prompt, { mode: 0o644 })

  // Build flags based on config
  const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''
  // outputMode: 'print' adds -p flag (final result only), 'interactive' shows streaming UI
  const printFlag = config.outputMode === 'print' ? '-p ' : ''

  // Build script that runs claude and keeps shell open after completion
  const setTitleCmds = getSetTitleCommands(windowTitle)
  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
SCRIPT_PATH="${scriptPath}"
PROMPT_PATH="${promptPath}"
${setTitleCmds}
echo "🚀 Starting: ${sessionName}"
echo ""
cd "${context.worktreePath}"
${cmd} ${permissionsFlag}${printFlag}"$(cat "$PROMPT_PATH")"

# Clean up script and prompt files
rm -f "$SCRIPT_PATH" "$PROMPT_PATH"

echo ""
echo "✅ Agent work complete. Press Enter to close or run more commands."
exec $SHELL
`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  try {
    // Check if tmux is available
    execSync('which tmux', { stdio: 'pipe' })

    const terminalApp = config.terminal.app

    // Step 1: Create host tmux session (detached)
    // Enable mouse mode for native scrolling
    const tmuxCmd = `tmux new-session -d -s "${sessionName}" -n "${sessionName}" "${scriptPath}" \\; set-option -g mouse on \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`

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
        execSync(`clear && tmux attach -t "${sessionName}"`, { stdio: 'inherit' })
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

    // NOTE: Don't use tmux -CC here. While -CC gives native iTerm scrolling,
    // it also causes iTerm to create new windows for tmux sessions.
    // Regular tmux attach inside an iTerm tab works well with mouse mode enabled.
    // User can reattach with `prlt session attach` which offers -CC option.
    // Use clear before attach to ensure clean display
    const attachCmd = `clear && tmux attach -t \\"${sessionName}\\"`

    switch (terminalApp) {
      case 'iTerm':
        // iTerm2 - new tab in current window
        // Write the tmux attach command directly (no script file needed)
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
    } catch (err) {
      console.debug(`[runners:docker] Docker check attempt ${attempt}/${maxRetries} failed:`, err)
      if (attempt === maxRetries) {
        return false
      }
      // Brief pause before retry
    }
  }
  return false
}

// =============================================================================
// Devcontainer Runner
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
 * Uses devcontainer exec which handles user context and working directory automatically.
 * Uses a prompt file to avoid shell escaping issues.
 */
/**
 * Get the container ID for a devcontainer workspace.
 */
function getDevcontainerContainerId(agentDir: string): string | null {
  try {
    // devcontainer up outputs JSON with container ID
    const result = execSync(
      `devcontainer up --workspace-folder "${agentDir}" 2>/dev/null | tail -1`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const json = JSON.parse(result.trim())
    return json.containerId || null
  } catch (err) {
    console.debug('[runners:devcontainer] devcontainer up failed, trying docker ps fallback:', err)
    try {
      const containerId = execSync(
        `docker ps -q --filter "label=devcontainer.local_folder=${agentDir}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()
      return containerId || null
    } catch (fallbackErr) {
      console.debug('[runners:devcontainer] docker ps fallback also failed:', fallbackErr)
      return null
    }
  }
}

function buildDevcontainerCommand(
  context: ExecutionContext,
  executor: ExecutorType,
  promptFile: string,
  containerId?: string,
  outputMode: OutputMode = 'interactive',
  sandboxed: boolean = true,
  displayMode: DisplayMode = 'terminal'
): string {
  // Get base command (just 'claude' for claude-code)
  let baseCmd: string
  switch (executor) {
    case 'claude-code':
      baseCmd = 'claude'
      break
    case 'codex':
      baseCmd = 'codex'
      break
    case 'aider':
      baseCmd = 'aider'
      break
    default:
      baseCmd = 'claude'
  }

  // Calculate the relative path from agentDir to worktreePath for cd
  const relativePath = path.relative(context.agentDir, context.worktreePath)
  const cdCmd = relativePath ? `cd /workspace/${relativePath} && ` : ''

  // Build Claude flags based on output mode and sandboxed setting
  // - interactive: No -p flag, shows streaming UI (watch Claude work in real-time)
  // - print: Uses -p flag, outputs final result only (better for logs/automation)
  const printFlag = outputMode === 'print' ? '-p ' : ''
  // sandboxed=true means safe mode (no --dangerously-skip-permissions)
  // sandboxed=false means danger mode (use --dangerously-skip-permissions)
  const permissionsFlag = !sandboxed ? '--dangerously-skip-permissions ' : ''

  // Build the claude command
  const claudeCmd = `${cdCmd}${baseCmd} ${permissionsFlag}${printFlag}"$(cat ${promptFile})" && rm -f ${promptFile}`

  // If we have a container ID, use docker exec for streaming
  if (containerId) {
    // Use -it flags only for terminal/foreground modes where a TTY is available
    // Background mode runs without a TTY, so -it flags would cause "not a TTY" error
    const ttyFlags = displayMode === 'background' ? '' : '-it '

    // Direct mode - run claude directly (tmux setup is handled by runDevcontainerInTmux)
    return `docker exec ${ttyFlags}${containerId} bash -c '${claudeCmd}'`
  }

  // Fallback to devcontainer exec (no streaming, but works)
  return `devcontainer exec --workspace-folder "${context.agentDir}" bash -c '${claudeCmd}'`
}

/**
 * Copy Claude Code credentials (~/.claude.json) into the agent directory.
 * This makes the subscription credentials available inside the devcontainer
 * since the agent directory is mounted at /workspace.
 */
function copyClaudeCredentials(agentDir: string): void {
  const sourceFile = path.join(os.homedir(), '.claude.json')
  const destFile = path.join(agentDir, '.claude.json')

  if (fs.existsSync(sourceFile)) {
    try {
      fs.copyFileSync(sourceFile, destFile)
    } catch (err) {
      console.debug('[runners:credentials] Failed to copy .claude.json:', err)
    }
  }
}


/**
 * Run command inside a devcontainer.
 * Uses the devcontainer CLI to start/exec in a VS Code devcontainer.
 * Provides filesystem isolation - agent can only access mounted worktrees.
 *
 * @param displayMode - How to display output (terminal, foreground, background, tmux)
 * @param sessionManager - How to manage the session inside the container (tmux, direct)
 */
export async function runDevcontainer(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'terminal',
  sessionManager: SessionManager = 'direct'
): Promise<RunnerResult> {
  // Devcontainer config is in the agent directory, not the worktree
  // (worktree may be a subdirectory like agents/altman/textdeck)
  const devcontainerPath = path.join(context.agentDir, '.devcontainer')
  const devcontainerJson = path.join(devcontainerPath, 'devcontainer.json')

  // Check if devcontainer config exists
  if (!fs.existsSync(devcontainerJson)) {
    return {
      success: false,
      error: `No devcontainer.json found at ${devcontainerPath}. Run 'prlt agent add' to set up the agent with devcontainer config.`,
    }
  }

  try {
    // Check devcontainer CLI is installed
    try {
      execSync('which devcontainer', { stdio: 'pipe' })
    } catch (err) {
      console.debug('[runners:devcontainer] devcontainer CLI not found:', err)
      return {
        success: false,
        error: 'devcontainer CLI not found. Install with: npm install -g @devcontainers/cli',
      }
    }

    // Check if Docker is running
    if (!isDockerRunning()) {
      return {
        success: false,
        error: 'Docker is not running. Please start Docker Desktop and try again.',
      }
    }

    // Copy Claude credentials into agent directory so container can access them
    copyClaudeCredentials(context.agentDir)

    // Set environment variables for devcontainer mounts
    // PRLT_HQ_PATH: allows agent to access the HQ database and run `prlt ticket complete`
    // PRLT_PMO_PATH: allows agent to access the PMO (can be anywhere, e.g., /hq/repos/myrepo/pmo)
    // PRLT_REPO_PATH: mounts the entire proletariat repo into the container (until prlt is on npm)
    const env = { ...process.env }
    if (context.hqPath) {
      env.PRLT_HQ_PATH = context.hqPath
    }
    if (context.pmoPath) {
      env.PRLT_PMO_PATH = context.pmoPath
    }

    // Ensure GitHub token is available for git push operations
    // Try to get token from gh CLI if not already in environment
    if (!env.GITHUB_TOKEN && !env.GH_TOKEN) {
      try {
        const token = execSync('gh auth token', { encoding: 'utf-8', stdio: 'pipe' }).trim()
        if (token) {
          env.GITHUB_TOKEN = token
          env.GH_TOKEN = token
        }
      } catch (err) {
        console.debug('[runners:devcontainer] gh auth token failed:', err)
      }
    }
    // Set repo path to the proletariat monorepo (auto-detect from current CLI location)
    // We mount the entire repo so node_modules resolution works correctly
    if (!env.PRLT_REPO_PATH) {
      // Get the directory where this CLI is running from (apps/cli)
      const cliDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')
      // Go up to the monorepo root (repos/proletariat)
      const repoDir = path.resolve(cliDir, '..', '..')
      if (fs.existsSync(path.join(repoDir, 'apps', 'cli', 'bin', 'run.js'))) {
        env.PRLT_REPO_PATH = repoDir
      }
    }

    // Start or reuse container (devcontainer up is idempotent)
    // Use agentDir as the workspace folder since that's where .devcontainer is
    try {
      execSync(`devcontainer up --workspace-folder "${context.agentDir}"`, {
        stdio: 'pipe',
        env,
      })
    } catch (error) {
      return {
        success: false,
        error: `Failed to start devcontainer: ${error instanceof Error ? error.message : error}`,
      }
    }

    // Write prompt to file in worktree (accessible by container)
    const { hostPath: promptHostPath, containerPath: promptFile } = writePromptFile(context)

    // Get container ID for docker exec (enables streaming output with TTY)
    const containerId = getDevcontainerContainerId(context.agentDir)

    // Inject fresh GitHub token into container (containers may be reused with stale/empty tokens)
    // This ensures git push works even if the container was created before token was available
    if (containerId && (env.GITHUB_TOKEN || env.GH_TOKEN)) {
      const token = env.GITHUB_TOKEN || env.GH_TOKEN
      try {
        // Write token to file and configure git credential helper
        execSync(`docker exec ${containerId} bash -c 'echo "${token}" > /home/node/.github-token && chmod 600 /home/node/.github-token && git config --global credential.helper "!f() { echo \\"username=x-access-token\\"; echo \\"password=\\$(cat /home/node/.github-token)\\"; }; f" && git config --global url."https://github.com/".insteadOf "git@github.com:"'`, {
          stdio: 'pipe',
        })
      } catch {
        // Non-fatal - token injection failed but execution can continue
      }
    }

    // Build the devcontainer exec command (just runs claude directly)
    // tmux session setup is handled by runDevcontainerInTmux, not buildDevcontainerCommand
    const devcontainerCmd = buildDevcontainerCommand(context, executor, promptFile, containerId || undefined, config.outputMode, config.sandboxed, displayMode)

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

  try {
    switch (terminalApp) {
      case 'iTerm':
        // Run script file directly - iTerm will execute it with proper TTY
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "${scriptPath}"
              end tell
            end tell
          end tell
        '`)
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
    const tmuxScript = `#!/bin/bash
echo "🚀 Starting: ${sessionName}"
echo ""
${claudeCmd}
echo ""
echo "✅ Agent work complete. Press Enter to close or run more commands."
exec bash
`
    const base64Script = Buffer.from(tmuxScript).toString('base64')
    const scriptPath = `/tmp/prlt-${sessionName}.sh`

    // Write script and start tmux session inside container
    // -n sets the window name (shows in iTerm tab title with -CC mode)
    // sessionName is already ticket-action-agent format
    // Enable mouse mode for native scrolling (trackpad/mouse wheel works without -CC mode)
    // set-titles on + set-titles-string: makes tmux set terminal title to window name
    const setupCmd = `echo ${base64Script} | base64 -d > ${scriptPath} && chmod +x ${scriptPath} && tmux new-session -d -s "${sessionName}" -n "${sessionName}" "${scriptPath}" \\; set-option -g mouse on \\; set-option -g set-titles on \\; set-option -g set-titles-string "#{window_name}"`

    try {
      execSync(`docker exec ${actualContainerId} bash -c '${setupCmd}'`, { stdio: 'pipe' })
    } catch (error) {
      return {
        success: false,
        error: `Failed to start tmux inside container: ${error instanceof Error ? error.message : error}`,
      }
    }

    // Step 2: Open iTerm tab that attaches directly to container's tmux
    // Skip this step for background mode - just return success after tmux session is created
    // User can reattach later with `prlt session attach`
    if (displayMode === 'background') {
      return {
        success: true,
        containerId: actualContainerId,
        sessionId: sessionName, // Container tmux session name for tracking
      }
    }

    // Foreground mode: attach to container's tmux session in current terminal (blocking)
    if (displayMode === 'foreground') {
      try {
        // Clear screen and attach - this blocks until user detaches or claude exits
        execSync(`clear && docker exec -it ${actualContainerId} tmux -u attach -t "${sessionName}"`, { stdio: 'inherit' })
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

    // NOTE: We don't use tmux -CC (control mode) here because we're already
    // creating a tab via AppleScript. Using -CC would cause iTerm to create
    // another window for the tmux session (double windows).
    // Users can reattach with `prlt session attach` which uses -CC for native scrolling.
    const attachCmd = `docker exec -it ${actualContainerId} tmux -u attach -t "${sessionName}"`

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

    // Open iTerm tab and run the attach script
    const terminalApp = config.terminal.app

    switch (terminalApp) {
      case 'iTerm':
        // Create new tab in existing window, or create new window if none exists
        // Set tab name via AppleScript for reliable naming
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

/**
 * Legacy: Run devcontainer in host-side tmux (kept for non-container modes)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runDevcontainerInHostTmux(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const sessionName = config.tmux.session
  const windowName = buildTmuxWindowName(context)

  try {
    // Check if tmux is available on host
    execSync('which tmux', { stdio: 'pipe' })

    // Write command to temp script
    const baseDir = context.hqPath
      ? path.join(context.hqPath, '.proletariat', 'scripts')
      : path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${Date.now()}.sh`)

    const windowTitle = buildWindowTitle(context)
    const setTitleCmds = getSetTitleCommands(windowTitle)

    const scriptContent = `#!/bin/bash
${setTitleCmds}
echo "🚀 Starting ticket execution: ${context.ticketId}"
${devcontainerCmd}
rm -f "${scriptPath}"
exec $SHELL
`
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

    // Check if session exists
    let sessionExists = false
    try {
      execSync(`tmux has-session -t ${sessionName}`, { stdio: 'pipe' })
      sessionExists = true
    } catch (err) {
      console.debug(`[runners:hostTmux] Session ${sessionName} does not exist:`, err)
      sessionExists = false
    }

    const targetPane = `${sessionName}:${windowName}`

    if (!sessionExists) {
      execSync(
        `tmux new-session -d -s ${sessionName} -n "${windowName}"`,
        { stdio: 'pipe' }
      )
    } else if (config.tmux.layout === 'window') {
      // Create new window in existing session (starts with shell)
      execSync(
        `tmux new-window -t ${sessionName} -n "${windowName}"`,
        { stdio: 'pipe' }
      )
    } else {
      // Split existing pane (starts with shell)
      execSync(
        `tmux split-window -t ${sessionName} -h`,
        { stdio: 'pipe' }
      )
    }

    // Send the script command to the shell - execute directly (not source)
    // Using exec replaces the shell, ensuring proper TTY passthrough
    execSync(
      `tmux send-keys -t "${targetPane}" 'exec ${scriptPath}' Enter`,
      { stdio: 'pipe' }
    )

    return {
      success: true,
      containerId: `devcontainer-${context.agentName}`,
      sessionId: `${sessionName}:${windowName}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start tmux session',
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

    // Escape prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    dockerCmd += ` ${config.docker.image}`
    dockerCmd += ` claude --print '${escapedPrompt}'`

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

    // Execute on remote
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    const remoteCmd = `cd ${remoteWorkspace} && claude --print '${escapedPrompt}'`
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
