import { Args } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
  shouldOutputJson,
} from '../../lib/prompt-json.js'

export default class ExecutionView extends PMOCommand {
  static description = 'View details of a specific execution'

  static examples = [
    '<%= config.bin %> <%= command.id %> WORK-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    id: Args.string({
      description: 'Execution ID - prompts if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ExecutionView)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('execution view', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Get execution ID - prompt if not provided
      let execId = args.id

      if (!execId) {
        const executions = executionStorage.listExecutions({ limit: 20 })

        if (executions.length === 0) {
          if (jsonMode) {
            outputErrorAsJson('NO_EXECUTIONS', 'No executions found.', createMetadata('execution view', flags))
            db.close()
            this.exit(1)
          }
          this.log(styles.muted('\nNo executions found.\n'))
          return
        }

        const jsonModeConfig = (flags.json || flags.machine) ? { flags, commandName: 'execution view' } : null

        const { selectedId } = await this.prompt<{ selectedId: string }>([
          {
            type: 'list',
            name: 'selectedId',
            message: 'Select execution to view:',
            choices: executions.map((e) => ({
              name: `${e.id} - ${e.ticketId} (${e.agentName}, ${e.status})`,
              value: e.id,
              command: `prlt execution view ${e.id} --json`,
            })),
          },
        ], jsonModeConfig)
        execId = selectedId
      }

      // Get execution
      const execution = executionStorage.getExecution(execId!)
      if (!execution) {
        return handleError('NOT_FOUND', `Execution "${execId}" not found.`)
      }

      // If JSON mode with ID provided, output the execution data as JSON
      if (jsonMode && args.id) {
        db.close()
        outputSuccessAsJson({
          id: execution.id,
          ticketId: execution.ticketId,
          agentName: execution.agentName,
          executor: execution.executor,
          environment: execution.environment,
          displayMode: execution.displayMode,
          sandboxed: execution.sandboxed,
          status: execution.status,
          branch: execution.branch || null,
          pid: execution.pid || null,
          containerId: execution.containerId || null,
          sessionId: execution.sessionId || null,
          host: execution.host || null,
          logPath: execution.logPath || null,
          startedAt: execution.startedAt.toISOString(),
          completedAt: execution.completedAt?.toISOString() || null,
          exitCode: execution.exitCode ?? null,
        }, createMetadata('execution view', flags))
      }

      // Display execution details
      this.log('')
      this.log(`${styles.header('🚀 Execution')} ${styles.emphasis(execution.id)}`)
      this.log('═'.repeat(60))
      this.log('')

      // Basic info
      this.log(`${styles.header('Ticket:')}       ${execution.ticketId}`)
      this.log(`${styles.header('Agent:')}        ${execution.agentName}`)
      this.log(`${styles.header('Executor:')}     ${execution.executor}`)
      this.log(`${styles.header('Status:')}       ${getStatusDisplay(execution.status)}`)
      this.log('')

      // Environment info
      this.log(styles.header('Environment'))
      this.log('─'.repeat(40))
      const envIcon = getEnvironmentIcon(execution.environment)
      this.log(`${styles.muted('Type:')}         ${envIcon} ${execution.environment}`)
      this.log(`${styles.muted('Display:')}      ${execution.displayMode}`)
      this.log(`${styles.muted('Permissions:')}  ${execution.sandboxed ? styles.success('sandboxed (safe)') : styles.warning('unrestricted (danger)')}`)
      if (execution.branch) {
        this.log(`${styles.muted('Branch:')}       ${execution.branch}`)
      }
      this.log('')

      // Process info
      if (execution.pid || execution.containerId || execution.sessionId || execution.host) {
        this.log(styles.header('Process Info'))
        this.log('─'.repeat(40))
        if (execution.pid) {
          this.log(`${styles.muted('PID:')}          ${execution.pid}`)
        }
        if (execution.containerId) {
          this.log(`${styles.muted('Container:')}    ${execution.containerId}`)
        }
        if (execution.sessionId) {
          this.log(`${styles.muted('Session:')}      ${execution.sessionId}`)
        }
        if (execution.host) {
          this.log(`${styles.muted('Host:')}         ${execution.host}`)
        }
        this.log('')
      }

      // Timing info
      this.log(styles.header('Timing'))
      this.log('─'.repeat(40))
      this.log(`${styles.muted('Started:')}      ${execution.startedAt.toLocaleString()} (${formatTimeAgo(execution.startedAt)})`)
      if (execution.completedAt) {
        this.log(`${styles.muted('Completed:')}    ${execution.completedAt.toLocaleString()} (${formatTimeAgo(execution.completedAt)})`)
        const duration = execution.completedAt.getTime() - execution.startedAt.getTime()
        this.log(`${styles.muted('Duration:')}     ${formatDuration(duration)}`)
      }
      if (execution.exitCode !== undefined) {
        const exitStyle = execution.exitCode === 0 ? styles.success : styles.error
        this.log(`${styles.muted('Exit Code:')}    ${exitStyle(execution.exitCode.toString())}`)
      }
      this.log('')

      // Logs summary
      if (execution.logPath) {
        this.log(styles.header('Logs'))
        this.log('─'.repeat(40))
        this.log(`${styles.muted('Path:')}         ${execution.logPath}`)

        if (fs.existsSync(execution.logPath)) {
          const stats = fs.statSync(execution.logPath)
          this.log(`${styles.muted('Size:')}         ${formatFileSize(stats.size)}`)

          // Show last few lines of the log
          const content = fs.readFileSync(execution.logPath, 'utf-8')
          const lines = content.trim().split('\n')
          if (lines.length > 0) {
            this.log(`${styles.muted('Lines:')}        ${lines.length}`)
            this.log('')
            this.log(styles.muted('Last 5 lines:'))
            const lastLines = lines.slice(-5)
            for (const line of lastLines) {
              // Truncate long lines
              const truncated = line.length > 80 ? line.substring(0, 77) + '...' : line
              this.log(styles.muted(`  ${truncated}`))
            }
          }
        } else {
          this.log(styles.warning('  Log file not found'))
        }
        this.log('')
      }

      // Commands
      this.log('═'.repeat(60))
      this.log(styles.muted('Commands:'))
      if (execution.logPath) {
        this.log(styles.muted(`  prlt execution logs ${execution.id}         View full logs`))
      }
      if (['starting', 'running'].includes(execution.status)) {
        this.log(styles.muted(`  prlt execution stop ${execution.id}         Stop execution`))
        if (execution.sessionId) {
          if (execution.environment === 'devcontainer' && execution.containerId) {
            this.log(styles.muted(`  docker exec -it ${execution.containerId} tmux attach -t ${execution.sessionId}`))
          } else {
            this.log(styles.muted(`  tmux attach -t ${execution.sessionId}     Attach to session`))
          }
        }
      }
      this.log('')
    } finally {
      db.close()
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function getStatusDisplay(status: string): string {
  switch (status) {
    case 'running':
      return styles.success('● running')
    case 'starting':
      return styles.warning('◐ starting')
    case 'completed':
      return styles.muted('✓ completed')
    case 'failed':
      return styles.error('✗ failed')
    case 'stopped':
      return styles.muted('■ stopped')
    default:
      return status
  }
}

function getEnvironmentIcon(environment: string): string {
  switch (environment) {
    case 'devcontainer':
      return '🐳'
    case 'host':
      return '💻'
    case 'docker':
      return '📦'
    case 'vm':
      return '☁️'
    default:
      return '❓'
  }
}

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
