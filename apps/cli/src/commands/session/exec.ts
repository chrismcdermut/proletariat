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
// Command
// =============================================================================

export default class SessionExec extends PMOCommand {
  static description = 'Run a command in an agent\'s worktree/container context'

  static examples = [
    '<%= config.bin %> session exec altman -- git status',
    '<%= config.bin %> session exec TKT-123 -- gh pr view --json number,state',
    '<%= config.bin %> session exec altman -- ls -la',
    '<%= config.bin %> session exec altman --json -- git log --oneline -5',
  ]

  // Allow strict=false so everything after -- is passed through
  static strict = false

  static args = {
    target: Args.string({
      description: 'Agent name or ticket ID',
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
    const { args, flags, argv } = await this.parse(SessionExec)
    const jsonMode = shouldOutputJson(flags)
    const { target } = args

    // Everything after '--' is the command to execute
    // argv contains all remaining args after the target
    const rawArgv = argv as string[]
    const command = rawArgv.join(' ')

    if (!command) {
      if (jsonMode) {
        outputErrorAsJson(
          'NO_COMMAND',
          'No command specified. Usage: prlt session exec <agent> -- <command>',
          createMetadata('session exec', flags),
        )
        return
      } else {
        this.log('')
        this.log(styles.error('No command specified.'))
        this.log(styles.muted('Usage: prlt session exec <agent> -- <command>'))
        this.log('')
      }
      return
    }

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
          createMetadata('session exec', flags),
        )
        return
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
            createMetadata('session exec', flags),
          )
          return
        } else {
          this.log('')
          this.log(styles.error(`No active session found for "${target}".`))
          this.log(styles.muted('Use `prlt session list` to see running sessions.'))
          this.log('')
        }
        return
      }

      // Determine execution context
      const isContainer = match.environment === 'devcontainer'
      let containerId = isContainer ? match.containerId : undefined

      // Verify the tmux session exists for this agent
      if (!match.sessionId) {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const containerTmuxSessions = getContainerTmuxSessionMap()

        if (isContainer && match.containerId) {
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, match.containerId)
          const found = findSessionForExecution(match.ticketId, match.agentName, containerSessions)
          if (found) containerId = match.containerId
        } else {
          findSessionForExecution(match.ticketId, match.agentName, hostTmuxSessions)
        }
      }

      // Execute the command
      const timeoutMs = flags.timeout * 1000
      let stdout = ''
      let stderr = ''
      let exitCode = 0

      try {
        if (isContainer && containerId) {
          // Run inside container
          const escapedCommand = command.replace(/'/g, "'\\''")
          stdout = execSync(
            `docker exec ${containerId} bash -c 'cd /workspace && ${escapedCommand}'`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs },
          )
        } else {
          // Run on host in the agent's worktree
          const workspaceInfo = getWorkspaceInfo()
          const worktreePath = path.join(workspaceInfo.path, 'agents', 'temp', match.agentName)

          // Find the first repo directory inside worktree
          let execDir = worktreePath
          try {
            const entries = execSync(`ls "${worktreePath}"`, { encoding: 'utf-8' }).trim().split('\n')
            for (const entry of entries) {
              const fullPath = path.join(worktreePath, entry)
              try {
                execSync(`git -C "${fullPath}" rev-parse --git-dir 2>/dev/null`, {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                })
                execDir = fullPath
                break
              } catch {
                // Not a git repo, continue
              }
            }
          } catch {
            // Fall back to worktree path
          }

          stdout = execSync(command, {
            encoding: 'utf-8',
            cwd: execDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeoutMs,
          })
        }
      } catch (error: unknown) {
        const execError = error as { stdout?: string; stderr?: string; status?: number; message?: string }
        stdout = execError.stdout || ''
        stderr = execError.stderr || ''
        exitCode = execError.status || 1
      }

      // Output results
      if (jsonMode) {
        outputSuccessAsJson({
          agent: match.agentName,
          ticketId: match.ticketId,
          environment: isContainer ? 'container' : 'host',
          containerId,
          command,
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        }, createMetadata('session exec', flags))
        return
      } else {
        if (stdout.trim()) {
          process.stdout.write(stdout)
          if (!stdout.endsWith('\n')) process.stdout.write('\n')
        }
        if (stderr.trim()) {
          process.stderr.write(stderr)
          if (!stderr.endsWith('\n')) process.stderr.write('\n')
        }
        if (exitCode !== 0) {
          this.log(styles.muted(`Exit code: ${exitCode}`))
        }
      }
    } finally {
      db?.close()
    }
  }
}
