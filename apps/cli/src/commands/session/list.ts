import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

interface VerifiedSession {
  sessionId: string
  ticketId: string
  agentName: string
  status: string
  environment: 'host' | 'container'
  containerId?: string
  exists: boolean  // Whether the tmux session actually exists
}

export default class SessionList extends PMOCommand {
  static description = 'List active tmux sessions (host and container)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
  ]

  static flags = {
    ...pmoBaseFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Show all sessions including stale DB records',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SessionList)

    // Get workspace info for execution records
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      this.log('')
      this.log(styles.muted('Not in a workspace. Run from a proletariat HQ directory.'))
      this.log('')
      return
    }

    try {
      // DB-driven approach: Start with executions, verify tmux sessions exist
      const runningExecutions = executionStorage.listExecutions({ status: 'running' }) || []
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' }) || []
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Get list of actual tmux sessions for verification
      const hostTmuxSessions = this.getHostTmuxSessionNames()
      const containerTmuxSessions = this.getContainerTmuxSessionMap()

      // Build verified session list from DB records
      const sessions: VerifiedSession[] = []

      for (const exec of activeExecutions) {
        if (!exec.sessionId) continue  // Skip executions without sessionId

        const isContainer = exec.environment === 'devcontainer'
        let exists = false
        let containerId: string | undefined

        if (isContainer && exec.containerId) {
          // Check if session exists in container
          const containerSessions = containerTmuxSessions.get(exec.containerId)
          exists = containerSessions?.includes(exec.sessionId) ?? false
          containerId = exec.containerId
        } else {
          // Check if session exists on host
          exists = hostTmuxSessions.includes(exec.sessionId)
        }

        // Only include if session exists, unless --all flag
        if (exists || flags.all) {
          sessions.push({
            sessionId: exec.sessionId,
            ticketId: exec.ticketId,
            agentName: exec.agentName,
            status: exists ? exec.status : 'stale',
            environment: isContainer ? 'container' : 'host',
            containerId,
            exists,
          })
        }
      }

      if (sessions.length > 0) {
        this.log('')
        this.log(styles.header('🖥️  Active Sessions'))
        this.log('═'.repeat(90))

        this.log(
          styles.muted(
            '  ' +
            padEnd('Session', 28) +
            padEnd('Ticket', 12) +
            padEnd('Agent', 14) +
            padEnd('Type', 15) +
            'Status'
          )
        )
        this.log('  ' + '─'.repeat(80))

        for (const session of sessions) {
          const typeIcon = session.environment === 'container' ? '🐳 container' : '💻 host'
          const statusColor = session.status === 'running' ? styles.success :
                             session.status === 'starting' ? styles.warning :
                             session.status === 'stale' ? styles.error : styles.muted

          this.log(
            '  ' +
            padEnd(session.sessionId, 28) +
            padEnd(session.ticketId, 12) +
            padEnd(session.agentName, 14) +
            padEnd(typeIcon, 15) +
            statusColor(session.status)
          )
        }

        this.log('')
        this.log('═'.repeat(90))

        // Show attach command example
        const firstSession = sessions.find(s => s.exists)
        if (firstSession) {
          this.log(styles.muted('\nCommands:'))
          this.log(styles.muted(`  prlt session attach ${firstSession.sessionId}    Attach to session`))
          this.log('')
        }

        // Show stale sessions warning
        const staleSessions = sessions.filter(s => !s.exists)
        if (staleSessions.length > 0) {
          this.log(styles.warning(`\n⚠️  ${staleSessions.length} stale session(s) in DB without tmux process.`))
          this.log(styles.muted('   Run `prlt work stop <work-id>` to clean up.'))
          this.log('')
        }

      } else {
        this.log('')
        this.log(styles.muted('No active sessions found.'))
        this.log('')
        this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
        this.log('')
      }

    } finally {
      db?.close()
    }
  }

  /**
   * Get list of host tmux session names
   */
  private getHostTmuxSessionNames(): string[] {
    try {
      execSync('which tmux', { stdio: 'pipe' })
      const output = execSync(
        'tmux list-sessions -F "#{session_name}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!output) return []
      return output.split('\n')
    } catch {
      return []
    }
  }

  /**
   * Get map of containerId -> tmux session names
   */
  private getContainerTmuxSessionMap(): Map<string, string[]> {
    const sessionMap = new Map<string, string[]>()

    try {
      const containersOutput = execSync(
        'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!containersOutput) return sessionMap

      for (const containerId of containersOutput.split('\n')) {
        try {
          const tmuxOutput = execSync(
            `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim()

          if (tmuxOutput) {
            sessionMap.set(containerId, tmuxOutput.split('\n'))
          }
        } catch {
          // Container has no tmux sessions
        }
      }
    } catch {
      // Docker not available
    }

    return sessionMap
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function padEnd(str: string, length: number): string {
  return str.padEnd(length)
}
