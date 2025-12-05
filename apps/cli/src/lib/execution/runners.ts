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
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js'

// =============================================================================
// Executor Commands
// =============================================================================

function getExecutorCommand(executor: ExecutorType, prompt: string): { cmd: string; args: string[] } {
  switch (executor) {
    case 'claude-code':
      return { cmd: 'claude', args: ['--print', prompt] }
    case 'codex':
      return { cmd: 'codex', args: ['--prompt', prompt] }
    case 'aider':
      return { cmd: 'aider', args: ['--message', prompt] }
    case 'custom':
      // Custom executor should be configured
      return { cmd: 'echo', args: ['Custom executor not configured'] }
    default:
      return { cmd: 'claude', args: ['--print', prompt] }
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

  prompt += `\nWhen complete, run: prlt ticket complete ${context.ticketId}`

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
  const { cmd, args } = getExecutorCommand(executor, prompt)

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
  const { cmd, args } = getExecutorCommand(executor, prompt)

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
  const { cmd, args } = getExecutorCommand(executor, prompt)

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

export async function runTerminal(
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig
): Promise<RunnerResult> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      error: 'Terminal mode is only supported on macOS',
    }
  }

  const prompt = buildPrompt(context)
  const { cmd, args } = getExecutorCommand(executor, prompt)

  // Escape the command for AppleScript
  const escapedArgs = args.map((a) => a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')).join('" "')
  const fullCmd = `cd "${context.worktreePath}" && ${cmd} "${escapedArgs}"`
  const escapedCmd = fullCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

  try {
    if (config.terminal.app === 'iTerm') {
      execSync(`osascript -e '
        tell application "iTerm"
          create window with default profile
          tell current session of current window
            write text "${escapedCmd}"
          end tell
        end tell
      '`)
    } else {
      // Default to Terminal.app
      execSync(`osascript -e '
        tell application "Terminal"
          do script "${escapedCmd}"
          activate
        end tell
      '`)
    }

    return {
      success: true,
      sessionId: `terminal-${context.ticketId}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to open terminal',
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
  options?: { host?: string }
): Promise<RunnerResult> {
  switch (mode) {
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
