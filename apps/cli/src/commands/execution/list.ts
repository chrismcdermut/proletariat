import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { ExecutionStatus } from '../../lib/execution/types.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { visualPadEnd } from '../../lib/string-utils.js'

export default class ExecutionList extends PMOCommand {
  static description = 'List running and recent executions'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --status running',
    '<%= config.bin %> <%= command.id %> --agent alice',
    '<%= config.bin %> <%= command.id %> --limit 50',
  ]

  static flags = {
    ...pmoBaseFlags,
    status: Flags.string({
      char: 's',
      description: 'Filter by status',
      options: ['starting', 'running', 'completed', 'failed', 'stopped'],
    }),
    agent: Flags.string({
      char: 'a',
      description: 'Filter by agent name',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Number of results',
      default: 20,
      min: 1,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ExecutionList)
    const jsonMode = shouldOutputJson(flags)

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.')
    }

    // Open database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      const executions = executionStorage.listExecutions({
        status: flags.status as ExecutionStatus | undefined,
        agentName: flags.agent,
        limit: flags.limit,
      })

      if (executions.length === 0) {
        if (jsonMode) {
          this.log(JSON.stringify([], null, 2))
          return
        }
        this.log(styles.muted('\nNo executions found.\n'))
        return
      }

      if (jsonMode) {
        this.log(JSON.stringify(executions, null, 2))
        return
      }

      // Display header
      this.log('')
      this.log(styles.header('🚀 Agent Work'))
      this.log('═'.repeat(100))
      this.log(
        styles.muted(
          visualPadEnd('ID', 14) +
            visualPadEnd('Ticket', 9) +
            visualPadEnd('Agent', 10) +
            visualPadEnd('Env', 13) +
            visualPadEnd('Display', 11) +
            visualPadEnd('Perms', 8) +
            visualPadEnd('Status', 10) +
            'Started'
        )
      )
      this.log('─'.repeat(100))

      // Display executions
      for (const exec of executions) {
        const statusColor = getStatusColor(exec.status)
        const timeAgo = formatTimeAgo(exec.startedAt)
        const envIcon = exec.environment === 'devcontainer' ? '🐳' : (exec.environment === 'host' ? '💻' : '📦')
        const envStr = `${envIcon} ${exec.environment}`
        const permsStr = exec.permissionMode
        const permsColor = exec.permissionMode === 'safe' ? styles.success : styles.warning

        this.log(
          visualPadEnd(exec.id, 14) +
            visualPadEnd(exec.ticketId, 9) +
            visualPadEnd(exec.agentName, 10) +
            visualPadEnd(envStr, 13) +
            visualPadEnd(exec.displayMode, 11) +
            permsColor(visualPadEnd(permsStr, 8)) +
            statusColor(visualPadEnd(exec.status, 10)) +
            styles.muted(timeAgo)
        )
      }

      this.log('═'.repeat(100))
      this.log('')

      // Show commands
      const runningExecs = executions.filter((e) =>
        ['starting', 'running'].includes(e.status)
      )
      if (runningExecs.length > 0) {
        this.log(styles.muted('Commands:'))
        this.log(
          styles.muted(`  prlt execution logs ${runningExecs[0].id}    View logs`)
        )
        this.log(
          styles.muted(`  prlt execution stop ${runningExecs[0].id}    Stop execution`)
        )
        if (runningExecs.length > 1) {
          this.log(
            styles.muted(`  prlt execution stop --all              Stop all running`)
          )
        }
        this.log('')
      }
    } finally {
      db.close()
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function getStatusColor(status: string): (s: string) => string {
  switch (status) {
    case 'running':
      return styles.success
    case 'starting':
      return styles.warning
    case 'completed':
      return styles.muted
    case 'failed':
      return styles.error
    case 'stopped':
      return styles.muted
    default:
      return (s: string) => s
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
