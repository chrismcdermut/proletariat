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
  source: 'db' | 'discovered'  // Whether session was found in DB or discovered from tmux
}

/**
 * Parse a tmux session name following prlt naming convention.
 * Format: {ticketId}-{action}-{agentName}
 * Example: "TKT-878-Implement-stout-page" -> { ticketId: "TKT-878", action: "Implement", agentName: "stout-page" }
 */
function parseSessionName(sessionName: string): { ticketId: string; action: string; agentName: string } | null {
  // Pattern: TKT-### or similar ticket ID, followed by action, followed by agent name
  // The ticket ID contains a hyphen, so we need to be careful about parsing
  const match = sessionName.match(/^(TKT-\d+|[A-Z]+-\d+)-([^-]+)-(.+)$/)
  if (match) {
    return {
      ticketId: match[1],
      action: match[2],
      agentName: match[3],
    }
  }
  return null
}

/**
 * Build expected session name from execution data.
 * Format: {ticketId}-{action}-{agentName}
 * This is the same format used by runners.ts buildSessionName()
 */
function buildExpectedSessionName(ticketId: string, agentName: string, action: string = 'work'): string {
  return `${ticketId}-${action}-${agentName}`
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
    let hasWorkspace = true

    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      db = new Database(dbPath)
      executionStorage = new ExecutionStorage(db)
    } catch {
      // Not in a workspace, but we can still discover tmux sessions
      hasWorkspace = false
    }

    try {
      // DB-driven approach: Start with executions, verify tmux sessions exist
      const runningExecutions = executionStorage?.listExecutions({ status: 'running' }) || []
      const startingExecutions = executionStorage?.listExecutions({ status: 'starting' }) || []
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Get list of actual tmux sessions for verification
      const hostTmuxSessions = this.getHostTmuxSessionNames()
      const containerTmuxSessions = this.getContainerTmuxSessionMap()

      // Flatten all container sessions for orphan detection
      const allContainerSessions: Array<{ sessionName: string; containerId: string }> = []
      containerTmuxSessions.forEach((sessions, containerId) => {
        for (const sessionName of sessions) {
          allContainerSessions.push({ sessionName, containerId })
        }
      })

      // Track which tmux sessions we've matched to DB records
      const matchedHostSessions = new Set<string>()
      const matchedContainerSessions = new Set<string>()

      // Build verified session list from DB records
      const sessions: VerifiedSession[] = []

      for (const exec of activeExecutions) {
        const isContainer = exec.environment === 'devcontainer'
        let exists = false
        let containerId: string | undefined
        let actualSessionId = exec.sessionId

        // If sessionId is NULL, try to find session by naming convention
        // Format: {ticketId}-{action}-{agentName}
        if (!exec.sessionId) {
          // Try common action names to find the session
          const possibleActions = ['Implement', 'implement', 'work', 'Review', 'review', 'Fix', 'fix']

          if (isContainer && exec.containerId) {
            const containerSessions = containerTmuxSessions.get(exec.containerId) || []
            for (const action of possibleActions) {
              const expectedName = buildExpectedSessionName(exec.ticketId, exec.agentName, action)
              if (containerSessions.includes(expectedName)) {
                actualSessionId = expectedName
                exists = true
                containerId = exec.containerId
                break
              }
            }
            // Also try partial match by ticket ID prefix
            if (!actualSessionId) {
              const match = containerSessions.find(s => s.startsWith(`${exec.ticketId}-`))
              if (match) {
                actualSessionId = match
                exists = true
                containerId = exec.containerId
              }
            }
          } else {
            for (const action of possibleActions) {
              const expectedName = buildExpectedSessionName(exec.ticketId, exec.agentName, action)
              if (hostTmuxSessions.includes(expectedName)) {
                actualSessionId = expectedName
                exists = true
                break
              }
            }
            // Also try partial match by ticket ID prefix
            if (!actualSessionId) {
              const match = hostTmuxSessions.find(s => s.startsWith(`${exec.ticketId}-`))
              if (match) {
                actualSessionId = match
                exists = true
              }
            }
          }

          // If still no match, skip this execution (truly has no session)
          if (!actualSessionId) {
            continue
          }
        } else {
          // sessionId is set, verify it exists
          if (isContainer && exec.containerId) {
            const containerSessions = containerTmuxSessions.get(exec.containerId)
            exists = containerSessions?.includes(exec.sessionId) ?? false
            containerId = exec.containerId
          } else {
            exists = hostTmuxSessions.includes(exec.sessionId)
          }
        }

        // Track matched sessions to detect orphans later
        if (exists && actualSessionId) {
          if (isContainer && containerId) {
            matchedContainerSessions.add(`${containerId}:${actualSessionId}`)
          } else {
            matchedHostSessions.add(actualSessionId)
          }
        }

        // Only include if session exists, unless --all flag
        if (exists || flags.all) {
          sessions.push({
            sessionId: actualSessionId!,
            ticketId: exec.ticketId,
            agentName: exec.agentName,
            status: exists ? exec.status : 'stale',
            environment: isContainer ? 'container' : 'host',
            containerId,
            exists,
            source: 'db',
          })
        }
      }

      // Discover orphan sessions: tmux sessions matching prlt pattern but not in DB
      // Host sessions
      for (const sessionName of hostTmuxSessions) {
        if (matchedHostSessions.has(sessionName)) continue

        const parsed = parseSessionName(sessionName)
        if (parsed) {
          sessions.push({
            sessionId: sessionName,
            ticketId: parsed.ticketId,
            agentName: parsed.agentName,
            status: 'orphan',
            environment: 'host',
            exists: true,
            source: 'discovered',
          })
        }
      }

      // Container sessions
      for (const { sessionName, containerId } of allContainerSessions) {
        if (matchedContainerSessions.has(`${containerId}:${sessionName}`)) continue

        const parsed = parseSessionName(sessionName)
        if (parsed) {
          sessions.push({
            sessionId: sessionName,
            ticketId: parsed.ticketId,
            agentName: parsed.agentName,
            status: 'orphan',
            environment: 'container',
            containerId,
            exists: true,
            source: 'discovered',
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
            padEnd('Session', 34) +
            padEnd('Ticket', 12) +
            padEnd('Agent', 18) +
            padEnd('Type', 15) +
            'Status'
          )
        )
        this.log('  ' + '─'.repeat(88))

        for (const session of sessions) {
          const typeIcon = session.environment === 'container' ? '🐳 container' : '💻 host'
          const statusColor = session.status === 'running' ? styles.success :
                             session.status === 'starting' ? styles.warning :
                             session.status === 'stale' ? styles.error :
                             session.status === 'orphan' ? styles.warning : styles.muted

          // For orphan sessions, append source indicator
          const statusText = session.source === 'discovered' ? `${session.status}*` : session.status

          // Truncate long session names to fit column
          const displaySession = session.sessionId.length > 32
            ? session.sessionId.substring(0, 29) + '...'
            : session.sessionId

          this.log(
            '  ' +
            padEnd(displaySession, 34) +
            padEnd(session.ticketId, 12) +
            padEnd(session.agentName, 18) +
            padEnd(typeIcon, 15) +
            statusColor(statusText)
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

        // Show orphan sessions note
        const orphanSessions = sessions.filter(s => s.source === 'discovered')
        if (orphanSessions.length > 0) {
          this.log(styles.muted(`\n📋 ${orphanSessions.length} session(s) discovered from tmux (marked with *).`))
          this.log(styles.muted('   These sessions match the prlt naming pattern but are not tracked in the database.'))
          this.log('')
        }

      } else {
        this.log('')
        if (!hasWorkspace) {
          this.log(styles.muted('Not in a workspace and no prlt-pattern tmux sessions found.'))
          this.log('')
          this.log(styles.muted('Run from a proletariat HQ directory to see tracked sessions,'))
          this.log(styles.muted('or start work with: prlt work start <ticket-id>'))
        } else {
          this.log(styles.muted('No active sessions found.'))
          this.log('')
          this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
        }
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
