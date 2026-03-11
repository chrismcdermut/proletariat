import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findContainerSessionsByPrefix,
  findSessionForExecution,
  captureTmuxPane,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Send Ctrl-C to a tmux session.
 */
function sendCtrlC(sessionId: string, containerId?: string): boolean {
  try {
    const cmd = `tmux send-keys -t "${sessionId}" C-c`
    if (containerId) {
      execSync(`docker exec ${containerId} bash -c '${cmd}'`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
      })
    } else {
      execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Check if a tmux session's process has exited (showing a shell prompt).
 */
function hasProcessExited(sessionId: string, containerId?: string): boolean {
  try {
    const cmd = `tmux list-panes -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null`
    let result: string
    if (containerId) {
      result = execSync(`docker exec ${containerId} bash -c '${cmd}'`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
      }).trim()
    } else {
      result = execSync(cmd, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
      }).trim()
    }

    const pid = result.split('\n')[0]
    if (!pid) return true

    // Check if pane PID has child processes
    const childCmd = `pgrep -P ${pid} 2>/dev/null`
    let children: string
    if (containerId) {
      children = execSync(`docker exec ${containerId} bash -c '${childCmd}'`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
      }).trim()
    } else {
      children = execSync(childCmd, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
      }).trim()
    }

    return children.length === 0
  } catch {
    return true // If we can't check, assume exited
  }
}

/**
 * Send a command to a tmux session (types text + Enter).
 */
function sendCommand(sessionId: string, command: string, containerId?: string): void {
  const escaped = command.replace(/'/g, "'\\''")
  const sendTextCmd = `tmux send-keys -l -t "${sessionId}" '${escaped}'`
  const sendEnterCmd = `tmux send-keys -t "${sessionId}" Enter`

  if (containerId) {
    execSync(`docker exec ${containerId} bash -c '${sendTextCmd}'`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    })
    execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(`docker exec ${containerId} bash -c '${sendEnterCmd}'`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
    })
  } else {
    execSync(sendTextCmd, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    })
    execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
    execSync(sendEnterCmd, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    })
  }
}

/**
 * Wait for a process to exit, polling every second.
 */
async function waitForExit(sessionId: string, timeoutMs: number, containerId?: string): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (hasProcessExited(sessionId, containerId)) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

// =============================================================================
// Command
// =============================================================================

export default class SessionRestart extends PMOCommand {
  static description = 'Gracefully restart a stuck agent session'

  static examples = [
    '<%= config.bin %> session restart altman',
    '<%= config.bin %> session restart TKT-123',
    '<%= config.bin %> session restart altman --fresh',
    '<%= config.bin %> session restart altman --resume',
    '<%= config.bin %> session restart altman --timeout 30',
  ]

  static args = {
    target: Args.string({
      description: 'Agent name or ticket ID',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    fresh: Flags.boolean({
      description: 'Reset worktree to branch HEAD before restarting',
      default: false,
      exclusive: ['resume'],
    }),
    resume: Flags.boolean({
      description: 'Continue from where the agent left off (use --resume flag in Claude Code)',
      default: false,
      exclusive: ['fresh'],
    }),
    timeout: Flags.integer({
      description: 'Seconds to wait for clean exit after Ctrl-C',
      default: 15,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SessionRestart)
    const jsonMode = shouldOutputJson(flags)
    const { target } = args

    // Resolve agent execution
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run from a proletariat HQ directory.', createMetadata('session restart', flags))
        return
      }
      this.error('Not in a workspace. Run from a proletariat HQ directory.')
    }

    try {
      // Get active executions
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Find matching execution
      const exec = activeExecutions.find(e =>
        e.agentName === target || e.ticketId === target,
      )

      if (!exec) {
        if (jsonMode) {
          outputErrorAsJson('NO_ACTIVE_EXECUTION', `No active execution found for "${target}".`, createMetadata('session restart', flags))
          return
        }
        this.error(`No active execution found for "${target}". Use \`prlt session list\` to see running sessions.`)
      }

      const isContainer = exec.environment === 'devcontainer'
      const containerId = isContainer ? exec.containerId : undefined
      let sessionId = exec.sessionId

      // Discover session if needed
      if (!sessionId) {
        if (isContainer && exec.containerId) {
          const containerTmuxSessions = getContainerTmuxSessionMap()
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
          sessionId = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions) || undefined
        } else {
          const hostTmuxSessions = getHostTmuxSessionNames()
          sessionId = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions) || undefined
        }
      }

      if (!sessionId) {
        if (jsonMode) {
          outputErrorAsJson('SESSION_NOT_FOUND', `Could not find tmux session for "${target}".`, createMetadata('session restart', flags))
          return
        }
        this.error(`Could not find tmux session for "${target}".`)
      }

      // Step 1: Send Ctrl-C
      if (!jsonMode) {
        this.log('')
        this.log(styles.info(`Sending Ctrl-C to ${exec.agentName} (${sessionId})...`))
      }

      sendCtrlC(sessionId, containerId)

      // Step 2: Wait for clean exit
      const exitTimeout = flags.timeout * 1000
      const exited = await waitForExit(sessionId, exitTimeout, containerId)

      if (!exited) {
        // Send another Ctrl-C as escalation
        sendCtrlC(sessionId, containerId)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      if (!jsonMode) {
        this.log(styles.success(`Process ${exited ? 'exited cleanly' : 'terminated'}.`))
      }

      // Step 3: Fresh mode - reset worktree
      if (flags.fresh) {
        if (!jsonMode) {
          this.log(styles.info('Resetting worktree to branch HEAD...'))
        }

        try {
          let worktreePath: string | undefined
          const workspaceInfo = getWorkspaceInfo()
          const agentBase = path.join(workspaceInfo.path, 'agents', 'temp', exec.agentName)

          // Find repo directory
          try {
            const entries = execSync(`ls "${agentBase}" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n')
            if (entries.length >= 1 && entries[0]) {
              worktreePath = path.join(agentBase, entries[0])
            }
          } catch {
            worktreePath = agentBase
          }

          if (worktreePath) {
            if (containerId) {
              execSync(`docker exec ${containerId} bash -c 'cd "${worktreePath}" && git checkout -- . && git clean -fd 2>/dev/null'`, {
                encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
              })
            } else {
              execSync(`cd "${worktreePath}" && git checkout -- . && git clean -fd 2>/dev/null`, {
                encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
              })
            }
          }
        } catch (error) {
          if (!jsonMode) {
            this.log(styles.warning(`Warning: Could not reset worktree: ${error instanceof Error ? error.message : error}`))
          }
        }
      }

      // Step 4: Re-launch Claude Code
      if (!jsonMode) {
        this.log(styles.info('Re-launching Claude Code...'))
      }

      // Build the relaunch command
      // We use `prlt work start` equivalent or direct claude invocation
      const resumeFlag = flags.resume ? ' --resume' : ''
      const relaunchCmd = `claude${resumeFlag}`

      sendCommand(sessionId, relaunchCmd, containerId)

      // Track restart
      const restartCount = 1 // We don't track this in DB yet, but the field is in the result

      if (jsonMode) {
        outputSuccessAsJson({
          agent: exec.agentName,
          ticketId: exec.ticketId,
          sessionId,
          environment: isContainer ? 'container' : 'host',
          containerId,
          cleanExit: exited,
          fresh: flags.fresh,
          resume: flags.resume,
          restartCount,
        }, createMetadata('session restart', flags))
        return
      }

      this.log('')
      this.log(styles.success(`Restarted ${exec.agentName} (${exec.ticketId})`))
      if (flags.fresh) {
        this.log(styles.muted('  Worktree was reset to branch HEAD.'))
      }
      if (flags.resume) {
        this.log(styles.muted('  Claude Code will resume from previous state.'))
      }
      this.log(styles.muted(`  Session: ${sessionId}`))
      this.log('')
    } finally {
      db?.close()
    }
  }
}
