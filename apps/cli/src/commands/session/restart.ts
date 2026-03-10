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
import type { AgentWork } from '../../lib/execution/types.js'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Send Ctrl-C to a tmux session to interrupt the current process.
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
 * Wait for a process to exit in a tmux session by checking for shell prompt.
 */
async function waitForExit(sessionId: string, timeoutMs: number, containerId?: string): Promise<boolean> {
  const startTime = Date.now()
  const pollInterval = 1000

  while (Date.now() - startTime < timeoutMs) {
    const content = captureTmuxPane(sessionId, 5, containerId)
    if (content) {
      const lines = content.split('\n')
      const lastNonEmpty = [...lines].reverse().find((l: string) => l.trim().length > 0) || ''
      // Check for shell prompt (idle state)
      if (/[$❯#>]\s*$/.test(lastNonEmpty) || /^\s*\$\s*$/.test(lastNonEmpty)) {
        return true
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval))
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
function resetWorktree(worktreePath: string, containerId?: string): boolean {
  try {
    const cmd = `cd "${worktreePath}" && git checkout -- . && git clean -fd`
    if (containerId) {
      execSync(
        `docker exec ${containerId} bash -c '${cmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
      )
    } else {
      execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })
    }
    return true
  } catch {
    return false
  }
}

// =============================================================================
// Command
// =============================================================================

export default class SessionRestart extends PMOCommand {
  static description = 'Gracefully restart a stuck agent — send Ctrl-C, wait for exit, re-launch Claude Code'

  static examples = [
    '<%= config.bin %> session restart altman',
    '<%= config.bin %> session restart TKT-123',
    '<%= config.bin %> session restart altman --fresh',
    '<%= config.bin %> session restart altman --resume',
    '<%= config.bin %> session restart altman --timeout 30',
  ]

  static args = {
    target: Args.string({
      description: 'Agent name, ticket ID (e.g. TKT-123), or execution ID (e.g. WORK-XXXXXXXX)',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    fresh: Flags.boolean({
      description: 'Reset worktree to branch HEAD before restarting',
      default: false,
    }),
    resume: Flags.boolean({
      description: 'Continue from where the agent left off (use --resume flag with Claude)',
      default: false,
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

    // Open DB
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
        return
      }
      this.error('Not in a workspace. Run from a proletariat HQ directory.')
    }

    try {
      // Find the matching execution
      const execution = this.findExecution(target, executionStorage)

      if (!execution) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_ACTIVE_EXECUTION',
            `No active execution found for "${target}".`,
            createMetadata('session restart', flags),
          )
          return
        }
        this.error(`No active execution found for "${target}". Use \`prlt session list\` to see running sessions.`)
      }

      // Resolve tmux session
      const sessionInfo = this.resolveSession(execution)

      if (!sessionInfo.sessionId) {
        if (jsonMode) {
          outputErrorAsJson(
            'SESSION_NOT_FOUND',
            `Could not find tmux session for "${target}".`,
            createMetadata('session restart', flags),
          )
          return
        }
        this.error(`Could not find tmux session for "${target}".`)
      }

      const { sessionId, containerId } = sessionInfo

      if (!jsonMode) {
        this.log('')
        this.log(styles.header(`Restarting ${execution.agentName} (${execution.ticketId})`))
        this.log('')
      }

      // Step 1: Send Ctrl-C
      if (!jsonMode) this.log(styles.muted('  Sending Ctrl-C...'))
      const ctrlcSent = sendCtrlC(sessionId!, containerId)
      if (!ctrlcSent) {
        if (jsonMode) {
          outputErrorAsJson(
            'CTRL_C_FAILED',
            'Failed to send Ctrl-C to agent session.',
            createMetadata('session restart', flags),
          )
          return
        }
        this.error('Failed to send Ctrl-C to agent session.')
      }

      // Step 2: Wait for clean exit
      if (!jsonMode) this.log(styles.muted(`  Waiting for clean exit (${flags.timeout}s timeout)...`))
      const exited = await waitForExit(sessionId!, flags.timeout * 1000, containerId)

      if (!exited) {
        // Send another Ctrl-C and try again briefly
        if (!jsonMode) this.log(styles.warning('  First Ctrl-C may not have worked, sending another...'))
        sendCtrlC(sessionId!, containerId)
        const exitedRetry = await waitForExit(sessionId!, 5000, containerId)
        if (!exitedRetry) {
          if (!jsonMode) this.log(styles.warning('  Agent did not exit cleanly, proceeding anyway...'))
        }
      }

      // Step 3: Fresh mode - reset worktree
      if (flags.fresh) {
        if (!jsonMode) this.log(styles.muted('  Resetting worktree to branch HEAD...'))
        const worktreePath = this.guessWorktreePath(execution, containerId)
        if (worktreePath) {
          const reset = resetWorktree(worktreePath, containerId)
          if (reset) {
            if (!jsonMode) this.log(styles.success('  Worktree reset.'))
          } else {
            if (!jsonMode) this.log(styles.warning('  Failed to reset worktree, continuing...'))
          }
        }
      }

      // Step 4: Re-launch Claude Code
      if (!jsonMode) this.log(styles.muted('  Re-launching Claude Code...'))

      const resumeFlag = flags.resume ? ' --resume' : ''
      const launchCmd = `claude --permission-mode bypassPermissions --dangerously-skip-permissions --effort high${resumeFlag}`

      const launched = sendCommand(sessionId!, launchCmd, containerId)
      if (!launched) {
        if (jsonMode) {
          outputErrorAsJson(
            'LAUNCH_FAILED',
            'Failed to re-launch Claude Code.',
            createMetadata('session restart', flags),
          )
          return
        }
        this.error('Failed to re-launch Claude Code.')
      }

      // Output result
      if (jsonMode) {
        outputSuccessAsJson({
          restarted: true,
          agent: execution.agentName,
          ticketId: execution.ticketId,
          executionId: execution.id,
          sessionId,
          containerId,
          fresh: flags.fresh,
          resume: flags.resume,
          cleanExit: exited,
        }, createMetadata('session restart', flags))
        return
      }

      this.log('')
      this.log(styles.success(`  ${execution.agentName} restarted successfully.`))
      if (flags.fresh) this.log(styles.muted('  Worktree was reset to branch HEAD.'))
      if (flags.resume) this.log(styles.muted('  Agent will resume from previous context.'))
      this.log('')
    } finally {
      db?.close()
    }
  }

  /**
   * Find execution matching the target identifier.
   */
  private findExecution(target: string, storage: ExecutionStorage): AgentWork | null {
    const running = storage.listExecutions({ status: 'running' })
    const starting = storage.listExecutions({ status: 'starting' })
    const active = [...running, ...starting]

    if (target.toUpperCase().startsWith('WORK-')) {
      const exec = storage.getExecution(target.toUpperCase())
      if (exec) return exec
    }

    if (/^[A-Z]+-\d+$/i.test(target)) {
      const ticketTarget = target.toUpperCase()
      const match = active.find(e => e.ticketId === ticketTarget)
      if (match) return match
    }

    const agentMatch = active.find(e => e.agentName === target)
    if (agentMatch) return agentMatch

    if (target === 'orchestrator') {
      const orchMatch = active.find(e =>
        e.agentName === 'orchestrator' || e.agentName.startsWith('orchestrator-'),
      )
      if (orchMatch) return orchMatch
    }

    return active.find(e =>
      e.agentName.includes(target) || e.ticketId.includes(target.toUpperCase()),
    ) || null
  }

  /**
   * Resolve the tmux session for an execution.
   */
  private resolveSession(exec: AgentWork): { sessionId: string | null; containerId?: string } {
    const isContainer = exec.environment === 'devcontainer'
    let actualSessionId = exec.sessionId || null
    let containerId = isContainer ? exec.containerId : undefined

    if (!exec.sessionId) {
      if (isContainer && exec.containerId) {
        const containerTmuxSessions = getContainerTmuxSessionMap()
        const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
        const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
        if (match) {
          actualSessionId = match
          containerId = exec.containerId
        }
      } else {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
        if (match) {
          actualSessionId = match
        }
      }
    }

    return { sessionId: actualSessionId, containerId }
  }

  /**
   * Try to determine the agent's worktree path.
   */
  private guessWorktreePath(exec: AgentWork, containerId?: string): string | undefined {
    if (exec.environment === 'devcontainer' && containerId) {
      try {
        const result = execSync(
          `docker exec ${containerId} bash -c 'ls -d /workspace/* 2>/dev/null | head -1'`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
        ).trim()
        return result || '/workspace'
      } catch {
        return '/workspace'
      }
    }

    try {
      const workspaceInfo = getWorkspaceInfo()
      const agentDir = path.join(workspaceInfo.path, 'agents', 'temp', exec.agentName)
      const result = execSync(
        `ls -d "${agentDir}"/* 2>/dev/null | head -1`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      ).trim()
      return result || undefined
    } catch {
      return undefined
    }
  }
}
