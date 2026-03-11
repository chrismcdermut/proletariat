import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
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
    '<%= config.bin %> session exec altman -- npm test',
    '<%= config.bin %> session exec altman --json -- git log --oneline -5',
  ]

  // Use strict: false to allow -- separator for the command
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

    // Extract command after -- separator
    // argv contains all non-flag args including those after --
    const rawArgv = argv as string[]
    const command = rawArgv.slice(1).join(' ')  // Skip the target arg

    if (!command) {
      if (jsonMode) {
        outputErrorAsJson('NO_COMMAND', 'No command specified. Use: prlt session exec <agent> -- <command>', createMetadata('session exec', flags))
        return
      }
      this.error('No command specified. Use: prlt session exec <agent> -- <command>')
    }

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
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run from a proletariat HQ directory.', createMetadata('session exec', flags))
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
          outputErrorAsJson('NO_ACTIVE_EXECUTION', `No active execution found for "${target}".`, createMetadata('session exec', flags))
          return
        }
        this.error(`No active execution found for "${target}". Use \`prlt session list\` to see running sessions.`)
      }

      const isContainer = exec.environment === 'devcontainer'
      const containerId = isContainer ? exec.containerId : undefined

      // Get worktree path
      let worktreePath: string | undefined
      try {
        const workspaceInfo = getWorkspaceInfo()
        // Try to resolve from worktree list if branch is known
        if (exec.branch && !isContainer) {
          try {
            const worktreeOutput = execSync(
              `git worktree list --porcelain`,
              { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: workspaceInfo.path },
            )
            const lines = worktreeOutput.split('\n')
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(`branch refs/heads/${exec.branch}`)) {
                // The worktree path is on the line before the branch line
                const pathLine = lines.slice(0, i).reverse().find(l => l.startsWith('worktree '))
                if (pathLine) {
                  worktreePath = pathLine.replace('worktree ', '')
                }
                break
              }
            }
          } catch {
            // Worktree list failed
          }
        }

        // Fallback: agents directory
        if (!worktreePath) {
          // Check for repo subdirectories in the agent temp dir
          const agentBase = path.join(workspaceInfo.path, 'agents', 'temp', exec.agentName)
          try {
            const entries = execSync(`ls "${agentBase}" 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n')
            // If there's a single directory that looks like a repo, use it
            if (entries.length >= 1 && entries[0]) {
              worktreePath = path.join(agentBase, entries[0])
            }
          } catch {
            worktreePath = agentBase
          }
        }
      } catch {
        // Workspace lookup failed
      }

      // Execute the command
      let stdout = ''
      let stderr = ''
      let exitCode = 0

      try {
        if (containerId) {
          // Run in container
          const escaped = command.replace(/'/g, "'\\''")
          stdout = execSync(
            `docker exec ${containerId} bash -c '${escaped}'`,
            {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: flags.timeout * 1000,
            },
          ).trim()
        } else {
          // Run on host in worktree
          stdout = execSync(command, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: flags.timeout * 1000,
            cwd: worktreePath || undefined,
          }).trim()
        }
      } catch (error: unknown) {
        const execError = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
        exitCode = execError.status || 1
        stdout = (execError.stdout ? execError.stdout.toString() : '').trim()
        stderr = (execError.stderr ? execError.stderr.toString() : '').trim()
      }

      if (jsonMode) {
        outputSuccessAsJson({
          agent: exec.agentName,
          ticketId: exec.ticketId,
          environment: isContainer ? 'container' : 'host',
          containerId,
          worktreePath,
          command,
          exitCode,
          stdout,
          stderr,
        }, createMetadata('session exec', flags))
        return
      }

      // Human-readable output
      if (stdout) {
        process.stdout.write(stdout + '\n')
      }
      if (stderr) {
        process.stderr.write(stderr + '\n')
      }
      if (exitCode !== 0) {
        this.exit(exitCode)
      }
    } finally {
      db?.close()
    }
  }
}
