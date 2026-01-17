import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'

interface TmuxSession {
  name: string
  windows: number
  created: string
  attached: boolean
}

interface ContainerSession {
  containerId: string
  sessionName: string
  agentName: string
}

export default class SessionList extends PMOCommand {
  static description = 'List active tmux sessions (host and container)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --running',
  ]

  static flags = {
    ...pmoBaseFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Show all sessions (including non-proletariat)',
      default: false,
    }),
    running: Flags.boolean({
      char: 'r',
      description: 'Only show sessions with running executions',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SessionList)

    // Get workspace info for execution records
    let workspaceInfo
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null

    try {
      workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      // Not in workspace - can still show sessions, just no execution info
    }

    try {
      // Get host tmux sessions
      const hostSessions = this.getHostTmuxSessions(flags.all)

      // Get container tmux sessions (from running devcontainers)
      const containerSessions = this.getContainerTmuxSessions()

      // Get running executions from database
      const runningExecutions = executionStorage?.listExecutions({ status: 'running' }) || []
      const startingExecutions = executionStorage?.listExecutions({ status: 'starting' }) || []
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Create a map of sessionId -> execution for quick lookup
      const executionBySession = new Map(
        activeExecutions
          .filter(e => e.sessionId)
          .map(e => [e.sessionId!, e])
      )

      // Filter to only running if requested
      const filteredHostSessions = flags.running
        ? hostSessions.filter(s => executionBySession.has(s.name) || executionBySession.has(`prlt-${s.name}`))
        : hostSessions

      // Display container sessions (simplified - no host tmux)
      if (containerSessions.length > 0) {
        this.log('')
        this.log(styles.header('🖥️  Active Sessions'))
        this.log('═'.repeat(90))

        this.log(
          styles.muted(
            '  ' +
            padEnd('Session', 25) +
            padEnd('Ticket', 12) +
            padEnd('Agent', 12) +
            padEnd('Container', 15) +
            'Status'
          )
        )
        this.log('  ' + '─'.repeat(76))

        for (const session of containerSessions) {
          // Look up execution info
          const exec = executionBySession.get(session.sessionName)
          const ticketId = exec?.ticketId || extractTicketFromSession(session.sessionName) || '-'
          const status = exec?.status || 'active'
          const statusColor = status === 'running' ? styles.success :
                             status === 'starting' ? styles.warning :
                             status === 'active' ? styles.info : styles.muted

          this.log(
            '  ' +
            padEnd(session.sessionName, 25) +
            padEnd(ticketId, 12) +
            padEnd(session.agentName, 12) +
            padEnd(session.containerId.substring(0, 12), 15) +
            statusColor(status)
          )
        }

        this.log('')
        this.log('═'.repeat(90))

        // Show attach commands
        this.log(styles.muted('\nCommands:'))
        const cs = containerSessions[0]
        this.log(styles.muted(`  prlt session attach ${cs.sessionName}    Attach in new iTerm tab`))
        this.log(styles.muted(`  docker exec -it ${cs.containerId.substring(0, 12)} tmux attach -t ${cs.sessionName}    Direct attach`))
        this.log('')

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
   * Get list of host tmux sessions
   */
  private getHostTmuxSessions(includeAll: boolean): TmuxSession[] {
    try {
      // Check if tmux is available
      execSync('which tmux', { stdio: 'pipe' })

      // List tmux sessions
      const output = execSync(
        'tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!output) return []

      return output.split('\n')
        .map(line => {
          const [name, windows, created, attached] = line.split('|')
          return {
            name,
            windows: parseInt(windows, 10),
            created: new Date(parseInt(created, 10) * 1000).toISOString(),
            attached: attached === '1',
          }
        })
        .filter(session => includeAll || session.name.startsWith('prlt-'))
    } catch {
      // tmux not available or no sessions
      return []
    }
  }

  /**
   * Get tmux sessions inside running devcontainers
   */
  private getContainerTmuxSessions(): ContainerSession[] {
    const sessions: ContainerSession[] = []

    try {
      // Get running devcontainers
      const containersOutput = execSync(
        'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}|{{.Names}}|{{.Labels}}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!containersOutput) return sessions

      for (const line of containersOutput.split('\n')) {
        const [containerId, _name, labels] = line.split('|')

        // Extract agent name from local_folder label
        const localFolderMatch = labels.match(/devcontainer\.local_folder=([^,]+)/)
        const localFolder = localFolderMatch ? localFolderMatch[1] : ''
        const agentName = localFolder.split('/').pop() || 'unknown'

        // Check for tmux sessions inside this container
        try {
          const tmuxOutput = execSync(
            `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim()

          if (tmuxOutput) {
            for (const sessionName of tmuxOutput.split('\n')) {
              sessions.push({
                containerId,
                sessionName,
                agentName,
              })
            }
          }
        } catch {
          // No tmux or no sessions in this container
        }
      }
    } catch {
      // Docker not available or no containers
    }

    return sessions
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function padEnd(str: string, length: number): string {
  return str.padEnd(length)
}

/**
 * Try to extract ticket ID from session name
 * Session names like: prlt-TKT-347-implement or TKT-347-implement
 */
function extractTicketFromSession(sessionName: string): string | null {
  // Remove prlt- prefix if present
  const name = sessionName.replace(/^prlt-/, '')

  // Match TKT-XXX pattern
  const match = name.match(/^(TKT-\d+)/)
  return match ? match[1] : null
}
