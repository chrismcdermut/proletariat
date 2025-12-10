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
        return { cmd: 'claude', args: ['--dangerously-skip-permissions', '-p', prompt] }
      }
      // Manual mode - will prompt for each action
      return { cmd: 'claude', args: ['-p', prompt] }
    case 'codex':
      return { cmd: 'codex', args: ['--prompt', prompt] }
    case 'aider':
      return { cmd: 'aider', args: ['--message', prompt] }
    case 'custom':
      // Custom executor should be configured
      return { cmd: 'echo', args: ['Custom executor not configured'] }
    default:
      if (skipPermissions) {
        return { cmd: 'claude', args: ['--dangerously-skip-permissions', '-p', prompt] }
      }
      return { cmd: 'claude', args: ['-p', prompt] }
  }
}

function buildPrompt(context: ExecutionContext): string {
  let prompt = `You are working on ticket ${context.ticketId}: ${context.ticketTitle}\n\n`

  if (context.epicTitle) {
    prompt += `Epic: ${context.epicTitle}\n`
  }

  if (context.specPath) {
    prompt += `Spec: ${context.specPath}\n`
  }

  if (context.ticketDescription) {
    prompt += `\nDescription:\n${context.ticketDescription}\n`
  }

  prompt += `\nWhen complete, run: prlt ticket review ${context.ticketId}`

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
  _config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  // Foreground - skip permissions by default for autonomous execution
  const { cmd, args } = getExecutorCommand(executor, prompt, true)

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
  // Background - skip permissions, also use --print for non-interactive output
  const { cmd, args } = getExecutorCommand(executor, prompt, true)
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

export async function runTmux(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  const prompt = buildPrompt(context)
  // Tmux - skip permissions by default for autonomous execution
  const { cmd, args } = getExecutorCommand(executor, prompt, true)

  // Escape the command for shell
  const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')
  const fullCmd = `${cmd} ${escapedArgs}`

  const sessionName = config.tmux.session
  const windowName = context.ticketId

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
        `tmux new-session -d -s ${sessionName} -n "${windowName}" -c "${context.worktreePath}" "${fullCmd}"`,
        { stdio: 'pipe' }
      )
    } else if (config.tmux.layout === 'window') {
      // Create new window in existing session
      execSync(
        `tmux new-window -t ${sessionName} -n "${windowName}" -c "${context.worktreePath}" "${fullCmd}"`,
        { stdio: 'pipe' }
      )
    } else {
      // Split existing pane
      execSync(
        `tmux split-window -t ${sessionName} -h -c "${context.worktreePath}" "${fullCmd}"`,
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
  // Terminal - skip permissions by default for autonomous execution
  const { cmd } = getExecutorCommand(executor, prompt, true)

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

  // Build script that reads prompt from file
  // This completely avoids shell escaping issues with special characters
  const scriptContent = `#!/bin/bash
# Auto-generated script for ticket ${context.ticketId}
SCRIPT_PATH="${scriptPath}"
PROMPT_PATH="${promptPath}"

cd "${context.worktreePath}"
${cmd} --dangerously-skip-permissions -p "$(cat "$PROMPT_PATH")"

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
function isDockerRunning(): boolean {
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
 * Write prompt to a file inside the worktree so the container can access it.
 * Returns the path to the prompt file (relative to worktree for container access).
 */
function writePromptFile(context: ExecutionContext): { hostPath: string; containerPath: string } {
  const prompt = buildPrompt(context)
  const filename = `.prlt-prompt-${context.ticketId}-${Date.now()}.txt`
  const hostPath = path.join(context.worktreePath, filename)

  fs.writeFileSync(hostPath, prompt, { mode: 0o644 })

  // Container sees the worktree at /workspace - use relative path
  return { hostPath, containerPath: filename }
}

/**
 * Build the command to run Claude inside the container.
 * Uses devcontainer exec which handles user context and working directory automatically.
 * Uses a prompt file to avoid shell escaping issues.
 */
function buildDevcontainerCommand(
  context: ExecutionContext,
  executor: ExecutorType,
  promptFile: string
): string {
  const { cmd } = getExecutorCommand(executor, '', true)

  // Use devcontainer exec - handles user context and working directory automatically
  // The prompt file is in the worktree which is mounted at /workspace
  return `devcontainer exec --workspace-folder "${context.worktreePath}" sh -c '${cmd} --dangerously-skip-permissions -p "$(cat ${promptFile})" && rm -f ${promptFile}'`
}

/**
 * Copy Claude Code credentials (~/.claude.json) into the agent workspace.
 * This makes the subscription credentials available inside the devcontainer
 * since the workspace is mounted at /workspace.
 */
function copyClaudeCredentials(worktreePath: string): void {
  const sourceFile = path.join(os.homedir(), '.claude.json')
  const destFile = path.join(worktreePath, '.claude.json')

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
  const devcontainerPath = path.join(context.worktreePath, '.devcontainer')
  const devcontainerJson = path.join(devcontainerPath, 'devcontainer.json')

  // Check if devcontainer config exists
  if (!fs.existsSync(devcontainerJson)) {
    return {
      success: false,
      error: `No devcontainer.json found at ${devcontainerPath}. Create one with: prlt agent container init`,
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

    // Copy Claude credentials into workspace so container can access them
    copyClaudeCredentials(context.worktreePath)

    // Set environment variables for devcontainer mounts
    // PRLT_HQ_PATH: allows agent to access the HQ database and run `prlt ticket complete`
    // PRLT_REPO_PATH: mounts the entire proletariat repo into the container (until prlt is on npm)
    const env = { ...process.env }
    if (context.hqPath) {
      env.PRLT_HQ_PATH = context.hqPath
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
    try {
      execSync(`devcontainer up --workspace-folder "${context.worktreePath}"`, {
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
    const { containerPath: promptFile } = writePromptFile(context)

    // Build the devcontainer exec command
    const devcontainerCmd = buildDevcontainerCommand(context, executor, promptFile)

    // Execute based on display mode
    switch (displayMode) {
      case 'terminal':
        return runDevcontainerInTerminal(context, devcontainerCmd, config)
      case 'background':
        return runDevcontainerInBackground(context, devcontainerCmd)
      case 'tmux':
        return runDevcontainerInTmux(context, devcontainerCmd, config)
      case 'foreground':
      default:
        return runDevcontainerForeground(context, devcontainerCmd)
    }
  } catch (error) {
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
        // Use iTerm's proper command execution instead of write text
        // This ensures the script runs with a proper TTY
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "exec ${scriptPath}"
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

      case 'WezTerm':
        execSync(`wezterm cli spawn --new-window -- ${scriptPath}`)
        break

      case 'Kitty':
        execSync(`kitty @ launch --type=tab -- ${scriptPath}`)
        break

      case 'Alacritty':
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
 * Run devcontainer command in tmux pane/window
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

    // Check if session exists
    let sessionExists = false
    try {
      execSync(`tmux has-session -t ${sessionName}`, { stdio: 'pipe' })
      sessionExists = true
    } catch {
      sessionExists = false
    }

    // Escape command for shell
    const escapedCmd = devcontainerCmd.replace(/'/g, "'\\''")

    if (!sessionExists) {
      // Create new session with window
      execSync(
        `tmux new-session -d -s ${sessionName} -n "${windowName}" "'${escapedCmd}'"`,
        { stdio: 'pipe' }
      )
    } else if (config.tmux.layout === 'window') {
      // Create new window in existing session
      execSync(
        `tmux new-window -t ${sessionName} -n "${windowName}" "'${escapedCmd}'"`,
        { stdio: 'pipe' }
      )
    } else {
      // Split existing pane
      execSync(
        `tmux split-window -t ${sessionName} -h "'${escapedCmd}'"`,
        { stdio: 'pipe' }
      )
    }

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
