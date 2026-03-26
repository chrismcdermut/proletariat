import { Flags } from '@oclif/core'
import type Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  findSessionForExecution,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
  findContainerSessionsByPrefix,
  parseSessionName,
  probeExecutionLiveness,
} from '../../lib/execution/session-utils.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { visualPadEnd } from '../../lib/string-utils.js'

interface VerifiedSession {
  sessionId: string
  ticketId: string
  agentName: string
  status: string
  environment: 'host' | 'container'
  containerId?: string
  alive: boolean  // Whether the runtime is alive (container running / tmux session exists)
  source: 'db' | 'orphan'  // DB-tracked or discovered orphan (garbage)
}

export default class SessionList extends PromptCommand {
  static description = 'List active agent sessions (DB-first with runtime liveness probing)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --orphans',
  ]

  static flags = {
    ...machineOutputFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Show all sessions including stale DB records with dead runtimes',
      default: false,
    }),
    orphans: Flags.boolean({
      description: 'Also show orphan tmux sessions not tracked in the database',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async run(): Promise<void> {
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
      // Not in a workspace — no DB sessions to show
      hasWorkspace = false
    }

    try {
      const sessions: VerifiedSession[] = []

      if (executionStorage) {
        // ===================================================================
        // DB-first: Query all active executions, then probe runtime liveness.
        // The DB is the source of truth. Runtime checks confirm what IS running.
        // ===================================================================
        const runningExecutions = executionStorage.listExecutions({ status: 'running' })
        const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
        const activeExecutions = [...runningExecutions, ...startingExecutions]

        // For session ID discovery when DB has NULL session_id, we still need
        // tmux session lists (but only for matching, not as source of truth)
        const hostTmuxSessions = getHostTmuxSessionNames()
        const containerTmuxSessions = getContainerTmuxSessionMap()

        for (const exec of activeExecutions) {
          const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
          const containerId = exec.containerId
          let actualSessionId = exec.sessionId

          // If sessionId is NULL, try to find session by naming convention
          if (!actualSessionId) {
            if (isContainer && containerId) {
              const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, containerId)
              const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
              if (match) actualSessionId = match
            } else {
              const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
              if (match) actualSessionId = match
            }
          }

          // Probe runtime liveness: docker inspect for containers, tmux has-session for host
          const alive = probeExecutionLiveness(exec.environment, containerId, actualSessionId)

          // By default only show alive sessions; --all includes stale (dead runtime) too
          if (alive || flags.all) {
            sessions.push({
              sessionId: actualSessionId || `[${exec.id}]`,
              ticketId: exec.ticketId,
              agentName: exec.agentName,
              status: alive ? exec.status : 'stale',
              environment: isContainer ? 'container' : 'host',
              containerId,
              alive,
              source: 'db',
            })
          }

          // Note: we don't update DB status here — list is read-only.
          // Dead executions are cleaned up by `prlt session prune` or `prlt work stop`.
        }

        // =================================================================
        // PRLT-1077: Self-healing recovery for background-mode spawns.
        // Check stopped executions whose runtimes are still alive — they
        // were incorrectly marked as stopped when the CLI exited.
        // =================================================================
        const stoppedExecutions = executionStorage.listExecutions({ status: 'stopped' })
        for (const exec of stoppedExecutions) {
          const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
          const alive = probeExecutionLiveness(exec.environment, exec.containerId, exec.sessionId)

          if (alive) {
            // Recover: update status back to 'running'
            executionStorage.updateStatus(exec.id, 'running')

            sessions.push({
              sessionId: exec.sessionId || `[${exec.id}]`,
              ticketId: exec.ticketId,
              agentName: exec.agentName,
              status: 'running',
              environment: isContainer ? 'container' : 'host',
              containerId: exec.containerId,
              alive: true,
              source: 'db',
            })
          }
        }
      }

      // ==================================================================
      // Orphan discovery: only shown with --orphans flag.
      // These are tmux sessions matching prlt pattern but NOT in the DB.
      // They are garbage to prune, not first-class sessions.
      // ==================================================================
      let orphanCount = 0
      if (flags.orphans) {
        const hostTmuxSessions = getHostTmuxSessionNames()
        const containerTmuxSessions = getContainerTmuxSessionMap()
        const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

        // Build set of session IDs we've already matched from DB
        const dbSessionIds = new Set(sessions.filter(s => s.source === 'db').map(s => s.sessionId))
        const dbContainerSessionIds = new Set(
          sessions.filter(s => s.source === 'db' && s.containerId)
            .map(s => `${s.containerId}:${s.sessionId}`)
        )

        // Host orphans
        for (const sessionName of hostTmuxSessions) {
          if (dbSessionIds.has(sessionName)) continue
          const parsed = parseSessionName(sessionName)
          if (parsed) {
            orphanCount++
            sessions.push({
              sessionId: sessionName,
              ticketId: parsed.ticketId,
              agentName: parsed.agentName,
              status: 'orphan',
              environment: 'host',
              alive: true,
              source: 'orphan',
            })
          }
        }

        // Container orphans
        for (const { sessionName, containerId } of allContainerSessions) {
          if (dbContainerSessionIds.has(`${containerId}:${sessionName}`)) continue
          if (dbSessionIds.has(sessionName)) continue
          const parsed = parseSessionName(sessionName)
          if (parsed) {
            orphanCount++
            sessions.push({
              sessionId: sessionName,
              ticketId: parsed.ticketId,
              agentName: parsed.agentName,
              status: 'orphan',
              environment: 'container',
              containerId,
              alive: true,
              source: 'orphan',
            })
          }
        }
      }

      if (jsonMode) {
        this.log(JSON.stringify(sessions, null, 2))
        return
      }

      if (sessions.length > 0) {
        this.log('')
        this.log(styles.header('Active Sessions'))
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

          const statusText = session.source === 'orphan' ? `${session.status}*` : session.status

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

        // Show attach command example for alive DB sessions
        const firstAlive = sessions.find(s => s.alive && s.source === 'db')
        if (firstAlive) {
          this.log(styles.muted('\nCommands:'))
          this.log(styles.muted(`  prlt session attach ${firstAlive.sessionId}    Attach to session`))
          this.log('')
        }

        // Show stale sessions warning
        const staleSessions = sessions.filter(s => s.status === 'stale')
        if (staleSessions.length > 0) {
          this.log(styles.warning(`\n  ${staleSessions.length} stale session(s) in DB with dead runtime.`))
          this.log(styles.muted('   Run `prlt session prune` or `prlt work stop <work-id>` to clean up.'))
          this.log('')
        }

        // Show orphan note
        if (orphanCount > 0) {
          this.log(styles.warning(`\n  ${orphanCount} orphan session(s) found in tmux but not in DB (marked with *).`))
          this.log(styles.muted('   Run `prlt session prune` to clean them up.'))
          this.log('')
        }

      } else {
        this.log('')
        if (!hasWorkspace) {
          this.log(styles.muted('Not in a workspace. Run from a proletariat HQ directory to see tracked sessions,'))
          this.log(styles.muted('or start work with: prlt work start <ticket-id>'))
        } else {
          this.log(styles.muted('No active sessions found.'))
          this.log('')
          this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
          if (!flags.orphans) {
            this.log(styles.muted('Use --orphans to also check for untracked tmux sessions.'))
          }
        }
        this.log('')
      }

    } finally {
      db?.close()
    }
  }
}
