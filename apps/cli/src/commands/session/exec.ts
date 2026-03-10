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
import type { AgentWork } from '../../lib/execution/types.js'

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

  // Use strict: false to allow -- separator and capture everything after it
  static strict = false

  static args = {
    target: Args.string({
      description: 'Agent name, ticket ID (e.g. TKT-123), or execution ID (e.g. WORK-XXXXXXXX)',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    timeout: Flags.integer({
      description: 'Command timeout in seconds',
      default: 30,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags, argv } = await this.parse(SessionExec)
    const jsonMode = shouldOutputJson(flags)
    const { target } = args

    // Extract command after -- separator
    // argv contains all positional args; first is target, rest is the command
    const rawArgv = argv as string[]
    const command = rawArgv.slice(1).join(' ')

    if (!command) {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_COMMAND',
          'No command specified. Use: prlt session exec <target> -- <command>',
          createMetadata('session exec', flags),
        )
        return
      }
      this.error('No command specified. Use: prlt session exec <target> -- <command>')
    }

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
          createMetadata('session exec', flags),
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
            createMetadata('session exec', flags),
          )
          return
        }
        this.error(`No active execution found for "${target}". Use \`prlt session list\` to see running sessions.`)
      }

      // Determine execution context
      const worktreePath = this.guessWorktreePath(execution)
      const isContainer = execution.environment === 'devcontainer' && !!execution.containerId

      // Execute command
      const result = this.runCommand(command, worktreePath, isContainer ? execution.containerId : undefined, flags.timeout)

      if (jsonMode) {
        outputSuccessAsJson({
          agent: execution.agentName,
          ticketId: execution.ticketId,
          executionId: execution.id,
          command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          environment: execution.environment,
          containerId: execution.containerId,
          worktreePath,
        }, createMetadata('session exec', flags))
        return
      }

      // Output result for humans
      if (result.stdout) {
        process.stdout.write(result.stdout + '\n')
      }
      if (result.stderr) {
        process.stderr.write(result.stderr + '\n')
      }
      if (result.exitCode !== 0) {
        this.log(styles.muted(`Exit code: ${result.exitCode}`))
      }
    } finally {
      db?.close()
    }
  }

  /**
   * Run a command in the agent's context.
   */
  private runCommand(
    command: string,
    worktreePath: string | undefined,
    containerId: string | undefined,
    timeoutSecs: number,
  ): { stdout: string; stderr: string; exitCode: number } {
    const cdPrefix = worktreePath ? `cd "${worktreePath}" && ` : ''
    const fullCmd = `${cdPrefix}${command}`

    try {
      if (containerId) {
        const stdout = execSync(
          `docker exec ${containerId} bash -c '${fullCmd.replace(/'/g, "'\\''")}'`,
          {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutSecs * 1000,
          },
        )
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 }
      }

      const stdout = execSync(fullCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutSecs * 1000,
      })
      return { stdout: stdout.trim(), stderr: '', exitCode: 0 }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error) {
        const execError = error as { status: number; stdout?: string; stderr?: string }
        return {
          stdout: (execError.stdout || '').toString().trim(),
          stderr: (execError.stderr || '').toString().trim(),
          exitCode: execError.status || 1,
        }
      }
      return { stdout: '', stderr: String(error), exitCode: 1 }
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
   * Try to determine the agent's worktree path.
   */
  private guessWorktreePath(exec: AgentWork): string | undefined {
    if (exec.environment === 'devcontainer' && exec.containerId) {
      try {
        const result = execSync(
          `docker exec ${exec.containerId} bash -c 'ls -d /workspace/* 2>/dev/null | head -1'`,
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
