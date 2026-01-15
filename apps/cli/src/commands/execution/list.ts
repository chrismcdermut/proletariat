import { Flags } from '@oclif/core'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { ExecutionStatus } from '../../lib/execution/types.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

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
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ExecutionList)

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
        this.log(styles.muted('\nNo executions found.\n'))
        return
      }

      // Display header
      this.log('')
      this.log(styles.header('🚀 Agent Work'))
      this.log('═'.repeat(100))
      this.log(
        styles.muted(
          padEnd('ID', 11) +
            padEnd('Ticket', 9) +
            padEnd('Agent', 10) +
            padEnd('Env', 12) +
            padEnd('Display', 11) +
            padEnd('Perms', 8) +
            padEnd('Status', 10) +
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
        const permsStr = exec.sandboxed ? 'safe' : 'danger'
        const permsColor = exec.sandboxed ? styles.success : styles.warning

        this.log(
          padEnd(exec.id, 11) +
            padEnd(exec.ticketId, 9) +
            padEnd(exec.agentName, 10) +
            padEnd(envStr, 12) +
            padEnd(exec.displayMode, 11) +
            permsColor(padEnd(permsStr, 8)) +
            statusColor(padEnd(exec.status, 10)) +
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

function padEnd(str: string, length: number): string {
  return str.padEnd(length)
}

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
