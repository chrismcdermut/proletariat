import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import type { AgentWork } from '../../lib/execution/types.js'
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
// Types
// =============================================================================

interface ResolvedExecution {
  execution: AgentWork
  sessionId: string
  containerId?: string
}

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
      execSync(
        `docker exec ${containerId} bash -c '${cmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      )
    } else {
      execSync(cmd, {
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
 * Wait for a process to exit by polling pane content for idle prompt.
 */
function waitForExit(sessionId: string, timeoutMs: number, containerId?: string): boolean {
  const startTime = Date.now()
  const pollInterval = 1000

  while (Date.now() - startTime < timeoutMs) {
    const content = captureTmuxPane(sessionId, 5, containerId)
    if (content) {
      const lastLines = content.split('\n').slice(-3).join('\n')
      // Check if we're back at a shell prompt
      if (/[$❯#>]\s*$/.test(lastLines) || /^\s*\$\s*$/.test(lastLines)) {
        return true
      }
    }

    // Sleep briefly
    try {
      execSync(`sleep ${pollInterval / 1000}`, { stdio: 'pipe' })
    } catch {
      // Ignore
    }
  }

  return false
}

/**
 * Send a command to a tmux session.
 */
function sendCommand(sessionId: string, command: string, containerId?: string): boolean {
  try {
    const escapedCmd = command.replace(/'/g, "'\\''")
    const sendTextCmd = `tmux send-keys -l -t "${sessionId}" '${escapedCmd}'`
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
 * Reset worktree to branch HEAD.
 */
function resetWorktree(sessionId: string, containerId?: string): boolean {
  return sendCommand(sessionId, 'git checkout -- . && git clean -fd', containerId)
}

// =============================================================================
// Command
// =============================================================================

export default class SessionRestart extends PMOCommand {
  static description = 'Gracefully restart a stuck agent — sends Ctrl-C, waits for exit, re-launches'

  static examples = [
    '<%= config.bin %> session restart altman',
    '<%= config.bin %> session restart TKT-123',
    '<%= config.bin %> session restart altman --fresh',
    '<%= config.bin %> session restart altman --resume',
    '<%= config.bin %> session restart altman --timeout 30',
    '<%= config.bin %> session restart altman --json',
  ]

  static args = {
    target: Args.string({
      description: 'Agent name or ticket ID of the running agent',
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
      description: 'Continue from where it left off (include --resume flag to Claude)',
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

    // Resolve the agent's execution and session
    const resolved = this.resolveExecution(args.target, jsonMode, flags)
    if (!resolved) return

    const { execution, sessionId, containerId } = resolved
    const timeoutMs = (flags.timeout || 15) * 1000

    const steps: Array<{ step: string; success: boolean; detail?: string }> = []

    // Step 1: Send Ctrl-C to stop current process
    if (!jsonMode) {
      this.log('')
      this.log(styles.header(`Restarting ${execution.agentName} (${execution.ticketId})`))
      this.log('')
      this.log('  Sending Ctrl-C to stop current process...')
    }

    const ctrlCSuccess = sendCtrlC(sessionId, containerId)
    steps.push({ step: 'send-ctrl-c', success: ctrlCSuccess })

    if (!ctrlCSuccess) {
      if (jsonMode) {
        outputErrorAsJson(
          'CTRL_C_FAILED',
          `Failed to send Ctrl-C to session "${sessionId}".`,
          createMetadata('session restart', flags),
        )
        return
      }
      this.log(styles.error('  Failed to send Ctrl-C.'))
      this.log('')
      return
    }

    // Step 2: Wait for clean exit
    if (!jsonMode) {
      this.log(`  Waiting up to ${flags.timeout}s for clean exit...`)
    }

    const exitClean = waitForExit(sessionId, timeoutMs, containerId)
    steps.push({ step: 'wait-for-exit', success: exitClean, detail: exitClean ? 'clean exit' : 'timeout' })

    if (!exitClean) {
      // Send another Ctrl-C as a last resort
      sendCtrlC(sessionId, containerId)
      const secondTry = waitForExit(sessionId, 5000, containerId)
      if (!secondTry && !jsonMode) {
        this.log(styles.warning('  Process did not exit cleanly. Proceeding with restart anyway.'))
      }
    } else if (!jsonMode) {
      this.log(styles.success('  Process exited cleanly.'))
    }

    // Step 3: Optionally reset worktree
    if (flags.fresh) {
      if (!jsonMode) {
        this.log('  Resetting worktree to branch HEAD...')
      }
      const resetSuccess = resetWorktree(sessionId, containerId)
      steps.push({ step: 'reset-worktree', success: resetSuccess })
      if (!jsonMode) {
        if (resetSuccess) {
          this.log(styles.success('  Worktree reset.'))
        } else {
          this.log(styles.warning('  Worktree reset may have failed.'))
        }
      }
    }

    // Step 4: Re-launch Claude Code
    if (!jsonMode) {
      this.log('  Re-launching Claude Code...')
    }

    const claudeCmd = this.buildClaudeCommand(execution, flags.resume)
    const launchSuccess = sendCommand(sessionId, claudeCmd, containerId)
    steps.push({ step: 'relaunch', success: launchSuccess, detail: claudeCmd })

    // Track restart count
    const restartKey = `restart_count_${execution.id}`
    let restartCount = 1
    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      const db = new Database(dbPath)
      try {
        // Try to read and increment restart count from a simple metadata approach
        // We store it in the error_message field temporarily (not ideal but works)
        const currentExec = new ExecutionStorage(db).getExecution(execution.id)
        if (currentExec?.errorMessage?.startsWith('restarts:')) {
          restartCount = parseInt(currentExec.errorMessage.split(':')[1], 10) + 1
        }
        new ExecutionStorage(db).updateStatus(execution.id, 'running')
      } finally {
        db.close()
      }
    } catch {
      // Ignore tracking errors
    }

    if (jsonMode) {
      outputSuccessAsJson({
        agent: execution.agentName,
        ticketId: execution.ticketId,
        executionId: execution.id,
        session: sessionId,
        restartCount,
        fresh: flags.fresh || false,
        resume: flags.resume || false,
        steps,
      }, createMetadata('session restart', flags))
      return
    }

    if (launchSuccess) {
      this.log(styles.success(`  Claude Code re-launched for ${execution.agentName} (restart #${restartCount})`))
    } else {
      this.log(styles.error('  Failed to re-launch Claude Code.'))
    }
    this.log('')
  }

  /**
   * Build the Claude Code command to re-launch.
   */
  private buildClaudeCommand(execution: AgentWork, resume: boolean): string {
    let cmd = 'claude'

    if (execution.permissionMode === 'danger') {
      cmd += ' --dangerously-skip-permissions'
    }

    if (resume) {
      cmd += ' --resume'
    }

    return cmd
  }

  /**
   * Resolve an agent identifier to an execution and its session.
   */
  private resolveExecution(
    identifier: string,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): ResolvedExecution | null {
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
      }
      this.log('')
      this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
      this.log('')
      return null
    }

    try {
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      let match = activeExecutions.find(exec =>
        exec.agentName === identifier || exec.ticketId === identifier,
      )

      if (!match && identifier === 'orchestrator') {
        const orchestratorMatches = activeExecutions.filter(exec =>
          exec.agentName === 'orchestrator' || exec.agentName.startsWith('orchestrator-'),
        )
        if (orchestratorMatches.length === 1) {
          match = orchestratorMatches[0]
        } else if (orchestratorMatches.length > 1) {
          const names = orchestratorMatches.map(e => e.agentName).join(', ')
          if (jsonMode) {
            outputErrorAsJson(
              'MULTIPLE_ORCHESTRATORS',
              `Multiple orchestrators running: ${names}. Specify one directly.`,
              createMetadata('session restart', flags),
            )
          }
          this.log('')
          this.log(styles.error(`Multiple orchestrators running: ${names}. Specify one directly.`))
          this.log('')
          return null
        }
      }

      if (!match) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_ACTIVE_EXECUTION',
            `Agent "${identifier}" has no active session.`,
            createMetadata('session restart', flags),
          )
        }
        this.log('')
        this.log(styles.error(`Agent "${identifier}" has no active session.`))
        this.log(styles.muted('Use `prlt session list` to see running sessions.'))
        this.log('')
        return null
      }

      // Resolve tmux session
      const isContainer = !!match.containerId
      let actualSessionId = match.sessionId
      let containerId = isContainer ? match.containerId : undefined

      if (!match.sessionId) {
        if (isContainer && match.containerId) {
          const containerTmuxSessions = getContainerTmuxSessionMap()
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, match.containerId)
          const found = findSessionForExecution(match.ticketId, match.agentName, containerSessions)
          if (found) {
            actualSessionId = found
            containerId = match.containerId
          }
        } else {
          const hostTmuxSessions = getHostTmuxSessionNames()
          const found = findSessionForExecution(match.ticketId, match.agentName, hostTmuxSessions)
          if (found) {
            actualSessionId = found
          }
        }
      }

      if (!actualSessionId) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `Could not find tmux session for agent "${match.agentName}" (${match.ticketId}).`,
            createMetadata('session restart', flags),
          )
        }
        this.log('')
        this.log(styles.error(`Could not find tmux session for agent "${match.agentName}" (${match.ticketId}).`))
        this.log('')
        return null
      }

      return {
        execution: match,
        sessionId: actualSessionId,
        containerId,
      }
    } finally {
      db?.close()
    }
  }
}
