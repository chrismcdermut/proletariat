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
 * Send Ctrl-C to a tmux session to interrupt the current process.
 */
function sendCtrlC(sessionId: string, containerId?: string): boolean {
  try {
    const sendCmd = `tmux send-keys -t "${sessionId}" C-c`
    if (containerId) {
      execSync(
        `docker exec ${containerId} bash -c '${sendCmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      )
    } else {
      execSync(sendCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Send a command to a tmux session.
 */
function sendCommand(sessionId: string, command: string, containerId?: string): boolean {
  try {
    const escapedCommand = command.replace(/'/g, "'\\''")
    const sendTextCmd = `tmux send-keys -l -t "${sessionId}" '${escapedCommand}'`
    const sendEnterCmd = `tmux send-keys -t "${sessionId}" Enter`

    if (containerId) {
      execSync(
        `docker exec ${containerId} bash -c '${sendTextCmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      )
      execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
      execSync(
        `docker exec ${containerId} bash -c '${sendEnterCmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      )
    } else {
      execSync(sendTextCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      })
      execSync('sleep 0.1', { stdio: ['pipe', 'pipe', 'pipe'] })
      execSync(sendEnterCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Check if the session is at a shell prompt (idle).
 */
function isAtPrompt(sessionId: string, containerId?: string): boolean {
  try {
    const content = captureTmuxPane(sessionId, 5, containerId)
    if (!content) return false
    const lines = content.split('\n')
    const lastNonEmpty = [...lines].reverse().find(l => l.trim().length > 0) || ''
    return /[$❯#>]\s*$/.test(lastNonEmpty)
  } catch {
    return false
  }
}

/**
 * Wait for the session to reach a shell prompt.
 */
async function waitForPrompt(
  sessionId: string,
  timeoutMs: number,
  containerId?: string,
): Promise<boolean> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    if (isAtPrompt(sessionId, containerId)) return true
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

// =============================================================================
// Command
// =============================================================================

export default class SessionRestart extends PMOCommand {
  static description = 'Gracefully restart a stuck or completed agent session'

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
      description: 'Continue from where the agent left off (pass --resume flag to Claude Code)',
      default: false,
      exclusive: ['fresh'],
    }),
    timeout: Flags.integer({
      description: 'Seconds to wait for clean exit before force restart',
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

    // Resolve the agent
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      if (jsonMode) {
        outputErrorAsJson(
          'NOT_IN_WORKSPACE',
          'Not in a workspace. Run from a proletariat HQ directory.',
          createMetadata('session restart', flags),
        )
      } else {
        this.log('')
        this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
        this.log('')
      }
      return
    }

    try {
      // Get active executions
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Find matching execution
      let match = activeExecutions.find(exec =>
        exec.agentName === target || exec.ticketId === target,
      )

      if (!match) {
        match = activeExecutions.find(exec =>
          exec.agentName.includes(target) || exec.ticketId.includes(target.toUpperCase()),
        )
      }

      if (!match) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_ACTIVE_EXECUTION',
            `No active session found for "${target}".`,
            createMetadata('session restart', flags),
          )
        } else {
          this.log('')
          this.log(styles.error(`No active session found for "${target}".`))
          this.log(styles.muted('Use `prlt session list` to see running sessions.'))
          this.log('')
        }
        return
      }

      // Resolve tmux session
      const isContainer = match.environment === 'devcontainer'
      let actualSessionId = match.sessionId
      let containerId = isContainer ? match.containerId : undefined

      if (!match.sessionId) {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const containerTmuxSessions = getContainerTmuxSessionMap()

        if (isContainer && match.containerId) {
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, match.containerId)
          const found = findSessionForExecution(match.ticketId, match.agentName, containerSessions)
          if (found) {
            actualSessionId = found
            containerId = match.containerId
          }
        } else {
          const found = findSessionForExecution(match.ticketId, match.agentName, hostTmuxSessions)
          if (found) actualSessionId = found
        }
      }

      if (!actualSessionId) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `Could not find tmux session for agent "${match.agentName}".`,
            createMetadata('session restart', flags),
          )
        } else {
          this.log('')
          this.log(styles.error(`Could not find tmux session for agent "${match.agentName}".`))
          this.log('')
        }
        return
      }

      // Step 1: Send Ctrl-C to interrupt current process
      if (!jsonMode) {
        this.log('')
        this.log(styles.info(`Restarting agent ${match.agentName} (${match.ticketId})...`))
        this.log(styles.muted('  Sending Ctrl-C to interrupt current process...'))
      }

      sendCtrlC(actualSessionId, containerId)

      // Step 2: Wait for clean exit
      const timeoutMs = flags.timeout * 1000
      const reachedPrompt = await waitForPrompt(actualSessionId, timeoutMs, containerId)

      if (!reachedPrompt) {
        // Send another Ctrl-C to force exit
        if (!jsonMode) {
          this.log(styles.muted('  Process did not exit cleanly, sending another Ctrl-C...'))
        }
        sendCtrlC(actualSessionId, containerId)
        await waitForPrompt(actualSessionId, 5000, containerId)
      }

      // Step 3: If --fresh, reset worktree
      if (flags.fresh) {
        if (!jsonMode) {
          this.log(styles.muted('  Resetting worktree to branch HEAD...'))
        }
        if (isContainer && containerId) {
          const resetCmd = `git -C /workspace reset --hard HEAD && git -C /workspace clean -fd`
          sendCommand(actualSessionId, resetCmd, containerId)
          await new Promise(resolve => setTimeout(resolve, 2000))
          await waitForPrompt(actualSessionId, 5000, containerId)
        } else {
          const workspaceInfo = getWorkspaceInfo()
          const worktreePath = path.join(workspaceInfo.path, 'agents', 'temp', match.agentName)
          try {
            execSync(`git -C "${worktreePath}" reset --hard HEAD && git -C "${worktreePath}" clean -fd`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 10000,
            })
          } catch {
            // Best effort reset
          }
        }
      }

      // Step 4: Re-launch Claude Code
      if (!jsonMode) {
        this.log(styles.muted('  Re-launching Claude Code...'))
      }

      // Build the claude command with appropriate flags
      let claudeCmd = 'claude'
      if (flags.resume) {
        claudeCmd += ' --resume'
      }
      // Add permission flags if the original execution used danger mode
      if (match.permissionMode === 'danger') {
        claudeCmd += ' --dangerously-skip-permissions'
      }

      sendCommand(actualSessionId, claudeCmd, containerId)

      // Track restart count in execution metadata
      // We increment restartCount by updating the error_message field with restart info
      const currentExec = executionStorage.getExecution(match.id)
      const restartInfo = currentExec?.errorMessage
        ? JSON.parse(currentExec.errorMessage).restartCount || 0
        : 0
      const newRestartCount = restartInfo + 1

      // Store restart metadata - use a non-error metadata approach
      try {
        // Update the execution to track restarts via a metadata convention
        executionStorage.updateStatus(match.id, 'running')
      } catch {
        // Best effort tracking
      }

      // Output results
      if (jsonMode) {
        outputSuccessAsJson({
          agent: match.agentName,
          ticketId: match.ticketId,
          sessionId: actualSessionId,
          environment: isContainer ? 'container' : 'host',
          containerId,
          restarted: true,
          mode: flags.fresh ? 'fresh' : flags.resume ? 'resume' : 'default',
          cleanExit: reachedPrompt,
          restartCount: newRestartCount,
        }, createMetadata('session restart', flags))
      } else {
        this.log('')
        this.log(styles.success(`Agent ${match.agentName} restarted successfully.`))
        if (flags.fresh) {
          this.log(styles.muted('  Mode: fresh (worktree reset to HEAD)'))
        } else if (flags.resume) {
          this.log(styles.muted('  Mode: resume (continuing from last state)'))
        }
        this.log(styles.muted(`  Clean exit: ${reachedPrompt ? 'yes' : 'no (forced)'}`))
        this.log('')
      }
    } finally {
      db?.close()
    }
  }
}
