/**
 * Execution Runners
 *
 * Implementations for each runtime mode (foreground, background, tmux, terminal, docker, vm).
 */

import { spawn, execSync, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  RuntimeMode,
  DisplayMode,
  OutputMode,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js'

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

  // Add branch instructions
  if (context.branch && !context.isRevision) {
    prompt += `\n---\n\n## Before You Start\n\n`
    prompt += `**IMPORTANT:** You must be on the correct branch before making changes.\n\n`
    prompt += `\`\`\`bash\n`
    prompt += `# Create/checkout the target branch from origin/main with initial commit (seeds PR title)\n`
    prompt += `prlt branch create ${context.branch} --from-origin --force --empty-commit\n`
    prompt += `\`\`\`\n\n`
    prompt += `**Target branch:** \`${context.branch}\`\n`
  }

  // Add completion instructions
  prompt += `\n---\n\n## When Complete\n\n`

  // For revisions, just tell agent to push changes
  if (context.isRevision) {
    prompt += `After addressing the feedback:\n`
    prompt += `1. Commit your changes in each repository you modified\n`
    prompt += `2. Push your changes: \`git push\`\n`
    prompt += `\nThe PR will be updated automatically.`
  } else {
    prompt += `1. **Commit your work** in each repository directory you modified:\n`
    prompt += `   \`\`\`bash\n`
    prompt += `   cd /workspace/<repo-name>\n`
    prompt += `   git add -A\n`
    prompt += `   git commit -m "Your descriptive commit message"\n`
    prompt += `   git push\n`
    prompt += `   \`\`\`\n`
    prompt += `2. **Mark work as ready** by running:\n`
    // Build the work ready command with the appropriate PR flag
    const prFlag = context.createPR ? ' --pr' : ' --no-pr'
    prompt += `   \`\`\`bash\n   prlt work ready ${context.ticketId}${prFlag}\n   \`\`\`\n`
    if (context.createPR) {
      prompt += `   This moves the ticket to review and creates a pull request.\n`
    } else {
      prompt += `   This moves the ticket to review.\n`
    }
    prompt += `\n**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`
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
// Foreground Runner
// =============================================================================

export async function runForeground(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  // skipPermissions is the inverse of sandboxed
  // sandboxed=true means safe mode (no --dangerously-skip-permissions)
  // sandboxed=false means danger mode (use --dangerously-skip-permissions)
  const skipPermissions = !config.sandboxed
  const { cmd, args } = getExecutorCommand(executor, prompt, skipPermissions)

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: context.worktreePath,
      stdio: 'inherit',
    })

    child.on('error', (error) => {
      resolve({ success: false, error: error.message })
    })

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        pid: child.pid?.toString(),
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
      })
    })
  })
}

// =============================================================================
// Background Runner
// =============================================================================

export async function runBackground(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  // Background - use sandboxed setting, also use --print for non-interactive output
  const skipPermissions = !config.sandboxed
  const { cmd, args } = getExecutorCommand(executor, prompt, skipPermissions)
  // Add --print for background mode to avoid interactive prompts
  if (executor === 'claude-code') {
    args.unshift('--print')
  }

  // Create logs directory
  const logsDir = path.join(os.homedir(), '.proletariat', 'logs')
  fs.mkdirSync(logsDir, { recursive: true })

  const logPath = path.join(logsDir, `work-${context.ticketId}-${Date.now()}.log`)
  const logStream = fs.openSync(logPath, 'w')

  const child = spawn(cmd, args, {
    cwd: context.worktreePath,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  })

  child.unref()

  return {
    success: true,
    pid: child.pid?.toString(),
    logPath,
  }
}

// =============================================================================
// Tmux Runner
// =============================================================================

/**
 * Create a wrapper script that initializes the shell properly before running commands.
 * This ensures nvm/node environment is correctly set up in tmux sessions.
 */
function createTmuxScript(
  context: ExecutionContext,
  cmd: string,
  args: string[],
  skipPermissions: boolean
): { scriptPath: string; promptPath: string } {
  // Write prompt to separate file to avoid shell escaping issues
  const baseDir = context.hqPath
    ? path.join(context.hqPath, '.proletariat', 'scripts')
    : path.join(os.homedir(), '.proletariat', 'scripts')
  fs.mkdirSync(baseDir, { recursive: true })

  const timestamp = Date.now()
  const scriptPath = path.join(baseDir, `tmux-${context.ticketId}-${timestamp}.sh`)
  const promptPath = path.join(baseDir, `prompt-${context.ticketId}-${timestamp}.txt`)

  // The prompt is the last argument in args (getExecutorCommand puts it there directly)
  // Args structure: ['--dangerously-skip-permissions', 'prompt'] or just ['prompt']
  const prompt = args[args.length - 1] || ''

  // Write prompt to file
  fs.writeFileSync(promptPath, prompt, { mode: 0o644 })

  // Build the permissions flag for the script
  const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''

  // Create script that initializes shell environment properly
  // We use --rcfile/ZDOTDIR to inject nvm init into the shell that stays open
  const scriptContent = `#!/bin/bash
# Auto-generated tmux script for ticket ${context.ticketId}
SCRIPT_PATH="${scriptPath}"
PROMPT_PATH="${promptPath}"

# Initialize nvm if available (ensures correct Node version)
export NVM_DIR="\${HOME}/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && source "\$NVM_DIR/nvm.sh"

cd "${context.worktreePath}"
${cmd} ${permissionsFlag}"$(cat "$PROMPT_PATH")"

# Clean up prompt file
rm -f "$PROMPT_PATH"

# Create a temp rc file that sources nvm then the user's normal rc
TEMP_RC="\$(mktemp)"
if [ -n "\$ZSH_VERSION" ] || [ "\$SHELL" = */zsh ]; then
  # For zsh: create temp .zshrc that sources nvm and user's rc
  cat > "\$TEMP_RC" << 'RCEOF'
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && source "\$NVM_DIR/nvm.sh"
[ -f "\$HOME/.zshrc" ] && source "\$HOME/.zshrc"
RCEOF
  rm -f "$SCRIPT_PATH"
  ZDOTDIR="\$(dirname \$TEMP_RC)" exec zsh
else
  # For bash: use --rcfile
  cat > "\$TEMP_RC" << 'RCEOF'
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && source "\$NVM_DIR/nvm.sh"
[ -f "\$HOME/.bashrc" ] && source "\$HOME/.bashrc"
RCEOF
  rm -f "$SCRIPT_PATH"
  exec bash --rcfile "\$TEMP_RC"
fi
`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  return { scriptPath, promptPath }
}

export async function runTmux(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  // Tmux - use sandboxed setting
  const skipPermissions = !config.sandboxed
  const { cmd, args } = getExecutorCommand(executor, prompt, skipPermissions)

  const sessionName = config.tmux.session
  const windowName = context.ticketId

  // Create wrapper script that initializes shell environment
  const { scriptPath } = createTmuxScript(context, cmd, args, skipPermissions)

  try {
    // Check if tmux is available
    execSync('which tmux', { stdio: 'pipe' })

    // Check if session exists
    let sessionExists = false
    try {
      execSync(`tmux has-session -t ${sessionName}`, { stdio: 'pipe' })
      sessionExists = true
    } catch {
      sessionExists = false
    }

    if (!sessionExists) {
      // Create new session with window
      execSync(
        `tmux new-session -d -s ${sessionName} -n "${windowName}" -c "${context.worktreePath}" "${scriptPath}"`,
        { stdio: 'pipe' }
      )
    } else if (config.tmux.layout === 'window') {
      // Create new window in existing session
      execSync(
        `tmux new-window -t ${sessionName} -n "${windowName}" -c "${context.worktreePath}" "${scriptPath}"`,
        { stdio: 'pipe' }
      )
    } else {
      // Split existing pane
      execSync(
        `tmux split-window -t ${sessionName} -h -c "${context.worktreePath}" "${scriptPath}"`,
        { stdio: 'pipe' }
      )
    }

    return {
      success: true,
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
// Terminal Runner (macOS)
// =============================================================================

/**
 * Run command in a new terminal tab/window.
 * Supports multiple terminal emulators on macOS.
 * Opens a new tab (not window) and keeps the tab open after command completes.
 * Uses a temp script file to avoid shell escaping issues with complex prompts.
 */
export async function runTerminal(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      error: 'Terminal mode is only supported on macOS. Use tmux mode instead.',
    }
  }

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

  // Build permissions flag based on sandboxed setting
  const permissionsFlag = skipPermissions ? '--dangerously-skip-permissions ' : ''

  // Build script that reads prompt from file
  // This completely avoids shell escaping issues with special characters
  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
SCRIPT_PATH="${scriptPath}"
PROMPT_PATH="${promptPath}"

cd "${context.worktreePath}"
${cmd} ${permissionsFlag}-p "$(cat "$PROMPT_PATH")"

# Clean up script and prompt files
rm -f "$SCRIPT_PATH" "$PROMPT_PATH"

# Keep shell open after completion
exec $SHELL
`
  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

  const terminalApp = config.terminal.app

  try {
    switch (terminalApp) {
      case 'iTerm':
        // iTerm2 - new tab in current window
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              create tab with default profile
              tell current session
                write text "${scriptPath}"
              end tell
            end tell
          end tell
        '`)
        break

      case 'Ghostty':
        // Ghostty - use osascript to open new tab and run script
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

      case 'WezTerm':
        // WezTerm - use wezterm cli to spawn new tab
        execSync(`wezterm cli spawn --new-window -- ${scriptPath}`)
        break

      case 'Kitty':
        // Kitty - use kitten to open new tab
        execSync(`kitty @ launch --type=tab -- ${scriptPath}`)
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
              keystroke "${scriptPath}"
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
            do script "${scriptPath}" in front window
          end tell
        '`)
        break
    }

    return {
      success: true,
      sessionId: `terminal-${context.ticketId}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to open ${terminalApp}`,
    }
  }
}

// =============================================================================
// Docker Status Check
// =============================================================================

/**
 * Check if Docker daemon is running.
 * Returns true if Docker is available and responsive.
 */
export function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
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
        } catch {
          // Ignore individual file deletion errors
        }
      }
    }
  } catch {
    // Ignore errors reading directory - may not exist yet
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
  } catch {
    // Fallback: find container by label
    try {
      const containerId = execSync(
        `docker ps -q --filter "label=devcontainer.local_folder=${agentDir}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()
      return containerId || null
    } catch {
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
  displayMode: DisplayMode = 'foreground'
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

  // If we have a container ID, use docker exec for streaming
  if (containerId) {
    // Use -it flags only for terminal/foreground modes where a TTY is available
    // Background mode runs without a TTY, so -it flags would cause "not a TTY" error
    const ttyFlags = displayMode === 'background' ? '' : '-it '
    return `docker exec ${ttyFlags}${containerId} bash -c '${cdCmd}${baseCmd} ${permissionsFlag}${printFlag}"$(cat ${promptFile})" && rm -f ${promptFile}'`
  }

  // Fallback to devcontainer exec (no streaming, but works)
  return `devcontainer exec --workspace-folder "${context.agentDir}" bash -c '${cdCmd}${baseCmd} ${permissionsFlag}${printFlag}"$(cat ${promptFile})" && rm -f ${promptFile}'`
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
    } catch {
      // Silently fail - user may be using API key instead
    }
  }
}


/**
 * Run command inside a devcontainer.
 * Uses the devcontainer CLI to start/exec in a VS Code devcontainer.
 * Provides filesystem isolation - agent can only access mounted worktrees.
 *
 * @param displayMode - How to display output (terminal, foreground, background, tmux)
 */
export async function runDevcontainer(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig,
  displayMode: DisplayMode = 'foreground'
): Promise<RunnerResult> {
  // Devcontainer config is in the agent directory, not the worktree
  // (worktree may be a subdirectory like agents/altman/textdeck)
  const devcontainerPath = path.join(context.agentDir, '.devcontainer')
  const devcontainerJson = path.join(devcontainerPath, 'devcontainer.json')

  // Check if devcontainer config exists
  if (!fs.existsSync(devcontainerJson)) {
    return {
      success: false,
      error: `No devcontainer.json found at ${devcontainerPath}. Run 'prlt agents add' to set up the agent with devcontainer config.`,
    }
  }

  try {
    // Check devcontainer CLI is installed
    try {
      execSync('which devcontainer', { stdio: 'pipe' })
    } catch {
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
      } catch {
        // gh CLI not authenticated or not installed, container will warn about no token
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

    // Build the devcontainer exec command
    const devcontainerCmd = buildDevcontainerCommand(context, executor, promptFile, containerId || undefined, config.outputMode, config.sandboxed, displayMode)

    // Execute based on display mode
    let result: RunnerResult
    switch (displayMode) {
      case 'terminal':
        result = await runDevcontainerInTerminal(context, devcontainerCmd, config)
        break
      case 'background':
        result = await runDevcontainerInBackground(context, devcontainerCmd)
        break
      case 'tmux':
        result = await runDevcontainerInTmux(context, devcontainerCmd, config)
        break
      case 'foreground':
      default:
        result = await runDevcontainerForeground(context, devcontainerCmd)
        break
    }

    // Clean up prompt file if execution failed to start
    // (successful executions clean up the file themselves via the command)
    if (!result.success && fs.existsSync(promptHostPath)) {
      try {
        fs.unlinkSync(promptHostPath)
      } catch {
        // Ignore cleanup errors
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
 * Run devcontainer command in foreground (current terminal)
 */
async function runDevcontainerForeground(
  context: ExecutionContext,
  devcontainerCmd: string
): Promise<RunnerResult> {
  const child = spawn('sh', ['-c', devcontainerCmd], {
    stdio: 'inherit',
  })

  return new Promise((resolve) => {
    child.on('error', (error) => {
      resolve({ success: false, error: error.message })
    })

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        containerId: `devcontainer-${context.agentName}`,
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
      })
    })
  })
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
      error: 'Terminal mode is only supported on macOS. Use foreground or tmux mode instead.',
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

  // Write script - run the command directly
  // No auth check needed - if auth is required, Claude will show "Invalid API key"
  // and user can run /login from there
  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}

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
 * Run devcontainer command in tmux pane/window.
 * Uses a temp script file to avoid shell escaping issues with complex prompts.
 */
async function runDevcontainerInTmux(
  context: ExecutionContext,
  devcontainerCmd: string,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const sessionName = config.tmux.session
  const windowName = context.ticketId

  try {
    // Check if tmux is available
    execSync('which tmux', { stdio: 'pipe' })

    // Write command to temp script to avoid shell escaping issues
    const baseDir = context.hqPath
      ? path.join(context.hqPath, '.proletariat', 'scripts')
      : path.join(os.homedir(), '.proletariat', 'scripts')
    fs.mkdirSync(baseDir, { recursive: true })
    const scriptPath = path.join(baseDir, `exec-${context.ticketId}-${Date.now()}.sh`)

    // Write script that runs the devcontainer command
    const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}

echo "🚀 Starting ticket execution: ${context.ticketId}"
echo ""

# Run the ticket - tmux provides a PTY so docker exec -it should work
${devcontainerCmd}

# Clean up script file
rm -f "${scriptPath}"

# Keep shell open after completion
exec $SHELL
`
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 })

    // Check if session exists
    let sessionExists = false
    try {
      execSync(`tmux has-session -t ${sessionName}`, { stdio: 'pipe' })
      sessionExists = true
    } catch {
      sessionExists = false
    }

    // Create window with interactive shell, then send the script command
    // This ensures proper TTY allocation for docker exec -it
    const targetPane = `${sessionName}:${windowName}`

    if (!sessionExists) {
      // Create new session with window (starts with shell)
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
  mode: RuntimeMode,
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig = DEFAULT_EXECUTION_CONFIG,
  options?: { host?: string; displayMode?: DisplayMode }
): Promise<RunnerResult> {
  switch (mode) {
    case 'devcontainer':
      return runDevcontainer(context, executor, config, options?.displayMode)
    case 'foreground':
      return runForeground(context, executor, config)
    case 'background':
      return runBackground(context, executor, config)
    case 'tmux':
      return runTmux(context, executor, config)
    case 'terminal':
      return runTerminal(context, executor, config)
    case 'docker':
      return runDocker(context, executor, config)
    case 'vm':
      return runVm(context, executor, config, options?.host)
    default:
      return { success: false, error: `Unknown runtime mode: ${mode}` }
  }
}
