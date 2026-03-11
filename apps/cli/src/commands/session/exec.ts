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

interface ResolvedSession {
  sessionId: string
  ticketId: string
  agentName: string
  environment: 'host' | 'container'
  containerId?: string
}

// =============================================================================
// Command
// =============================================================================

export default class SessionExec extends PMOCommand {
  static description = 'Run a command in an agent\'s worktree/container context'

  static examples = [
    '<%= config.bin %> session exec altman -- git status',
    '<%= config.bin %> session exec TKT-123 -- gh pr view --json number,state',
    '<%= config.bin %> session exec altman -- cat package.json',
    '<%= config.bin %> session exec altman --json -- git log --oneline -5',
  ]

  // Use strict: false to allow -- separator and arbitrary commands after it
  static strict = false

  static args = {
    target: Args.string({
      description: 'Agent name or ticket ID of the running agent',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    timeout: Flags.integer({
      char: 't',
      description: 'Command timeout in seconds',
      default: 30,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags, argv: rawArgv } = await this.parse(SessionExec)
    const jsonMode = shouldOutputJson(flags)

    // Extract command after -- separator
    const allArgs = rawArgv as string[]
    const dashDashIdx = allArgs.indexOf('--')
    let command: string

    if (dashDashIdx >= 0) {
      const commandParts = allArgs.slice(dashDashIdx + 1)
      if (commandParts.length === 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_COMMAND',
            'No command specified after --',
            createMetadata('session exec', flags),
          )
          return
        }
        this.error('No command specified after --. Usage: prlt session exec <agent> -- <command>')
      }
      command = commandParts.join(' ')
    } else {
      // Try everything after the target arg
      const targetIdx = allArgs.indexOf(args.target)
      if (targetIdx >= 0 && targetIdx + 1 < allArgs.length) {
        const remaining = allArgs.slice(targetIdx + 1).filter(a => !a.startsWith('-') || a === '--json' || a === '-m' || a === '--machine')
        // Filter out known flags
        const cmdParts = allArgs.slice(targetIdx + 1).filter(a => {
          if (a === '--json' || a === '-m' || a === '--machine') return false
          if (a === '-t' || a === '--timeout') return false
          return true
        })
        // Also remove the value after -t/--timeout
        const cleaned: string[] = []
        let skipNext = false
        for (const part of allArgs.slice(targetIdx + 1)) {
          if (skipNext) { skipNext = false; continue }
          if (part === '-t' || part === '--timeout') { skipNext = true; continue }
          if (part === '--json' || part === '-m' || part === '--machine') continue
          if (part.startsWith('-P') || part === '--project') { skipNext = true; continue }
          cleaned.push(part)
        }
        command = cleaned.join(' ')
      } else {
        command = ''
      }

      if (!command) {
        if (jsonMode) {
          outputErrorAsJson(
            'NO_COMMAND',
            'No command specified. Usage: prlt session exec <agent> -- <command>',
            createMetadata('session exec', flags),
          )
          return
        }
        this.error('No command specified. Usage: prlt session exec <agent> -- <command>')
      }
    }

    // Resolve the agent's session
    const resolved = this.resolveAgentSession(args.target, jsonMode, flags)
    if (!resolved) return

    // Execute the command in the agent's context
    const timeoutMs = (flags.timeout || 30) * 1000

    try {
      let stdout: string
      let stderr: string = ''
      let exitCode = 0

      if (resolved.containerId) {
        // Execute in container
        const escapedCmd = command.replace(/'/g, "'\\''")
        try {
          stdout = execSync(
            `docker exec ${resolved.containerId} bash -c '${escapedCmd}'`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs },
          )
        } catch (error: unknown) {
          const execError = error as { status?: number; stdout?: string; stderr?: string }
          exitCode = execError.status || 1
          stdout = execError.stdout || ''
          stderr = execError.stderr || ''
        }
      } else {
        // Execute on host — find the worktree path from the session
        // Use tmux to run the command in the pane's directory
        const cwdOutput = this.getSessionCwd(resolved.sessionId)
        try {
          if (cwdOutput) {
            stdout = execSync(command, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: timeoutMs,
              cwd: cwdOutput,
            })
          } else {
            stdout = execSync(command, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: timeoutMs,
            })
          }
        } catch (error: unknown) {
          const execError = error as { status?: number; stdout?: string; stderr?: string }
          exitCode = execError.status || 1
          stdout = execError.stdout || ''
          stderr = execError.stderr || ''
        }
      }

      if (jsonMode) {
        outputSuccessAsJson({
          agent: resolved.agentName,
          ticketId: resolved.ticketId,
          session: resolved.sessionId,
          command,
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        }, createMetadata('session exec', flags))
        return
      }

      // Raw output mode — just print stdout/stderr
      if (stdout.trim()) {
        process.stdout.write(stdout)
        if (!stdout.endsWith('\n')) process.stdout.write('\n')
      }
      if (stderr.trim()) {
        process.stderr.write(stderr)
        if (!stderr.endsWith('\n')) process.stderr.write('\n')
      }

      if (exitCode !== 0) {
        this.exit(exitCode)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson(
          'EXEC_FAILED',
          `Command execution failed: ${errMsg}`,
          createMetadata('session exec', flags),
        )
        return
      }
      this.error(`Command execution failed: ${errMsg}`)
    }
  }

  /**
   * Get the current working directory of a tmux session.
   */
  private getSessionCwd(sessionId: string): string | null {
    try {
      const output = execSync(
        `tmux display-message -t "${sessionId}" -p "#{pane_current_path}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      ).trim()
      return output || null
    } catch {
      return null
    }
  }

  /**
   * Resolve an agent identifier to a running session.
   */
  private resolveAgentSession(
    identifier: string,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): ResolvedSession | null {
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
          createMetadata('session exec', flags),
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
              createMetadata('session exec', flags),
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
            `Agent "${identifier}" has no active session. Use \`prlt session list\` to see running sessions.`,
            createMetadata('session exec', flags),
          )
        }
        this.log('')
        this.log(styles.error(`Agent "${identifier}" has no active session.`))
        this.log(styles.muted('Use `prlt session list` to see running sessions.'))
        this.log('')
        return null
      }

      return this.resolveSessionForExecution(match, jsonMode, flags)
    } finally {
      db?.close()
    }
  }

  private resolveSessionForExecution(
    exec: { ticketId: string; agentName: string; sessionId?: string; containerId?: string; environment: string },
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): ResolvedSession | null {
    const isContainer = !!exec.containerId
    let actualSessionId = exec.sessionId
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

    if (!actualSessionId) {
      if (jsonMode) {
        outputErrorAsJson(
          'SESSION_NOT_FOUND',
          `Could not find tmux session for agent "${exec.agentName}" (${exec.ticketId}).`,
          createMetadata('session exec', flags),
        )
      }
      this.log('')
      this.log(styles.error(`Could not find tmux session for agent "${exec.agentName}" (${exec.ticketId}).`))
      this.log(styles.muted('The session may not have started yet.'))
      this.log('')
      return null
    }

    return {
      sessionId: actualSessionId,
      ticketId: exec.ticketId,
      agentName: exec.agentName,
      environment: isContainer ? 'container' : 'host',
      containerId,
    }
  }
}
