import { Flags } from '@oclif/core'
import type Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  parseSessionName,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
  findContainerSessionsByPrefix,
  findSessionForExecution,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { visualPadEnd } from '../../lib/string-utils.js'

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
    const jsonMode = shouldOutputJson(flags)

    // Get workspace info for execution records
    let executionStorage: ExecutionStorage | null = null
    let db: Database.Database | null = null
    let hasWorkspace = true

    try {
      const workspaceInfo = getWorkspaceInfo()
      db = openWorkspaceDatabase(workspaceInfo.path)
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

      // Refresh execution state so dead sessions aren't reported as running.
      executionStorage?.cleanupStaleExecutions()

      // Get list of actual tmux sessions for verification
      const hostTmuxSessions = getHostTmuxSessionNames()
      const containerTmuxSessions = getContainerTmuxSessionMap()

      // Flatten all container sessions for orphan detection
      const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

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
        if (!exec.sessionId) {
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
            if (match) {
              actualSessionId = match
              exists = true
              containerId = exec.containerId
            }
          } else {
            const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
            if (match) {
              actualSessionId = match
              exists = true
            }
          }

          // If still no match, skip this execution (truly has no session)
          if (!actualSessionId) {
            continue
          }
        } else {
          // sessionId is set, verify it exists
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            exists = containerSessions.includes(exec.sessionId)
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

        // Only include active sessions by default.
        // Use --all to include stale DB records (exists=false).
        if (actualSessionId && (exists || flags.all)) {
          sessions.push({
            sessionId: actualSessionId,
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

      // PRLT-1077: Self-healing recovery for background-mode spawns.
      // Check stopped executions whose tmux sessions are still alive — they were
      // incorrectly marked as stopped when the CLI exited but the agent continued.
      if (executionStorage) {
        const stoppedExecutions = executionStorage.listExecutions({ status: 'stopped' })
        for (const exec of stoppedExecutions) {
          const isContainer = exec.environment === 'devcontainer'
          if (!exec.sessionId) continue

          let sessionAlive = false
          let containerId: string | undefined

          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            sessionAlive = containerSessions.includes(exec.sessionId)
            containerId = exec.containerId
          } else {
            sessionAlive = hostTmuxSessions.includes(exec.sessionId)
          }

          if (sessionAlive) {
            // Recover: update status back to 'running'
            executionStorage.updateStatus(exec.id, 'running')

            // Track as matched so it's not reported as orphan
            if (isContainer && containerId) {
              matchedContainerSessions.add(`${containerId}:${exec.sessionId}`)
            } else {
              matchedHostSessions.add(exec.sessionId)
            }

            sessions.push({
              sessionId: exec.sessionId,
              ticketId: exec.ticketId,
              agentName: exec.agentName,
              status: 'running',
              environment: isContainer ? 'container' : 'host',
              containerId,
              exists: true,
              source: 'db',
            })
          }
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

      if (jsonMode) {
        this.log(JSON.stringify(sessions, null, 2))
        return
      }

      if (sessions.length > 0) {
        this.log('')
        this.log(styles.header('🖥️  Active Sessions'))
        this.log('═'.repeat(90))

        this.log(
          styles.muted(
            '  ' +
            visualPadEnd('Session', 34) +
            visualPadEnd('Ticket', 12) +
            visualPadEnd('Agent', 18) +
            visualPadEnd('Type', 15) +
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
            visualPadEnd(displaySession, 34) +
            visualPadEnd(session.ticketId, 12) +
            visualPadEnd(session.agentName, 18) +
            visualPadEnd(typeIcon, 15) +
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
}
