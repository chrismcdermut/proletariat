import { Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import {
  parseSessionName,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
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
// Types
// =============================================================================

type AgentHealthState = 'HUNG' | 'WORKING' | 'DONE' | 'IDLE' | 'UNKNOWN'

interface AgentHealthInfo {
  sessionId: string
  ticketId: string
  agentName: string
  state: AgentHealthState
  environment: 'host' | 'container'
  containerId?: string
  elapsed: string
  paneContent?: string
}

// =============================================================================
// Detection Logic
// =============================================================================

/**
 * Capture the last N lines from a tmux pane.
 */
function captureTmuxPane(sessionId: string, lines: number, containerId?: string): string | null {
  try {
    const captureCmd = `tmux capture-pane -t "${sessionId}" -p -S -${lines}`
    if (containerId) {
      return execSync(
        `docker exec ${containerId} bash -c '${captureCmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
      ).trim()
    }
    return execSync(captureCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * Detect agent health state from tmux pane content.
 *
 * Detection patterns (checked in priority order):
 * - '0 tokens' (the down-arrow + 0 tokens pattern) = HUNG
 * - 'esc to interrupt' = WORKING
 * - 'Agent work complete' or similar completion messages = DONE
 * - Idle prompt patterns ($ or ❯ at end of line) = IDLE
 */
function detectState(paneContent: string | null): AgentHealthState {
  if (!paneContent) return 'UNKNOWN'

  // Check last few lines for patterns
  const lines = paneContent.split('\n')
  const lastLines = lines.slice(-10).join('\n')

  // HUNG: stuck API call showing '0 tokens' (the ↓ 0 tokens pattern)
  if (/0 tokens/.test(lastLines)) {
    return 'HUNG'
  }

  // WORKING: agent is actively processing
  if (/esc to interrupt/i.test(lastLines)) {
    return 'WORKING'
  }

  // DONE: agent work is complete
  if (/agent work complete/i.test(lastLines) || /work ready/i.test(lastLines)) {
    return 'DONE'
  }

  // IDLE: shell prompt visible (agent has finished or is waiting)
  // Match common prompt patterns at end of last non-empty line
  const lastNonEmpty = lines.filter(l => l.trim().length > 0).pop() || ''
  if (/[$❯#>]\s*$/.test(lastNonEmpty) || /^\s*\$\s*$/.test(lastNonEmpty)) {
    return 'IDLE'
  }

  return 'UNKNOWN'
}

/**
 * Format elapsed time from a start date to now.
 */
function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime()
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Send Escape key to a tmux session to unstick a hung agent.
 */
function sendEscape(sessionId: string, containerId?: string): boolean {
  try {
    const sendCmd = `tmux send-keys -t "${sessionId}" Escape`
    if (containerId) {
      execSync(
        `docker exec ${containerId} bash -c '${sendCmd}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
      )
    } else {
      execSync(sendCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      })
    }
    return true
  } catch {
    return false
  }
}

// =============================================================================
// Command
// =============================================================================

export default class SessionHealth extends PMOCommand {
  static description = 'Check health of running agent sessions and detect/recover hung agents'

  static examples = [
    '<%= config.bin %> session health',
    '<%= config.bin %> session health --fix',
    '<%= config.bin %> session health --watch',
    '<%= config.bin %> session health --watch --interval 3 --threshold 5',
  ]

  static flags = {
    ...pmoBaseFlags,
    fix: Flags.boolean({
      description: 'Send Escape to hung agents to unstick them',
      default: false,
    }),
    watch: Flags.boolean({
      description: 'Continuously monitor agents and auto-recover hung ones',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Watch polling interval in minutes',
      default: 5,
    }),
    threshold: Flags.integer({
      description: 'Minutes an agent must be hung before auto-recovery in watch mode',
      default: 10,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SessionHealth)
    const jsonMode = shouldOutputJson(flags)

    if (flags.watch) {
      await this.watchMode(flags.interval, flags.threshold)
    } else {
      await this.runHealthCheck(flags.fix, jsonMode, flags)
    }
  }

  /**
   * Single health check pass. Returns the list of agent health infos.
   */
  private async runHealthCheck(
    fix: boolean,
    jsonMode: boolean = false,
    flags: Record<string, unknown> = {},
  ): Promise<AgentHealthInfo[]> {
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
          createMetadata('session health', flags),
        )
      }
      this.log('')
      this.log(styles.error('Not in a workspace. Run from a proletariat HQ directory.'))
      this.log('')
      return []
    }

    try {
      // Get active executions from DB
      const runningExecutions = executionStorage.listExecutions({ status: 'running' })
      const startingExecutions = executionStorage.listExecutions({ status: 'starting' })
      const activeExecutions = [...runningExecutions, ...startingExecutions]

      // Get actual tmux sessions
      const hostTmuxSessions = getHostTmuxSessionNames()
      const containerTmuxSessions = getContainerTmuxSessionMap()
      const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

      // Track matched sessions
      const matchedHostSessions = new Set<string>()
      const matchedContainerSessions = new Set<string>()

      const agents: AgentHealthInfo[] = []

      // Process DB-tracked executions
      for (const exec of activeExecutions) {
        const isContainer = exec.environment === 'devcontainer'
        let exists = false
        let containerId: string | undefined
        let actualSessionId = exec.sessionId

        // Try to find session if sessionId is NULL
        if (!exec.sessionId) {
          if (isContainer && exec.containerId) {
            const containerSessions = containerTmuxSessions.get(exec.containerId) || []
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
          if (!actualSessionId) continue
        } else {
          if (isContainer && exec.containerId) {
            const containerSessions = containerTmuxSessions.get(exec.containerId)
            exists = containerSessions?.includes(exec.sessionId) ?? false
            containerId = exec.containerId
          } else {
            exists = hostTmuxSessions.includes(exec.sessionId)
          }
        }

        if (exists && actualSessionId) {
          if (isContainer && containerId) {
            matchedContainerSessions.add(`${containerId}:${actualSessionId}`)
          } else {
            matchedHostSessions.add(actualSessionId)
          }

          // Capture pane and detect state
          const paneContent = captureTmuxPane(actualSessionId, 10, containerId)
          const state = detectState(paneContent)

          agents.push({
            sessionId: actualSessionId,
            ticketId: exec.ticketId,
            agentName: exec.agentName,
            state,
            environment: isContainer ? 'container' : 'host',
            containerId,
            elapsed: formatElapsed(exec.startedAt),
            paneContent: paneContent || undefined,
          })
        }
      }

      // Also discover orphan tmux sessions matching prlt pattern
      for (const sessionName of hostTmuxSessions) {
        if (matchedHostSessions.has(sessionName)) continue
        const parsed = parseSessionName(sessionName)
        if (parsed) {
          const paneContent = captureTmuxPane(sessionName, 10)
          const state = detectState(paneContent)
          agents.push({
            sessionId: sessionName,
            ticketId: parsed.ticketId,
            agentName: parsed.agentName,
            state,
            environment: 'host',
            elapsed: '?',
            paneContent: paneContent || undefined,
          })
        }
      }

      for (const { sessionName, containerId: cId } of allContainerSessions) {
        if (matchedContainerSessions.has(`${cId}:${sessionName}`)) continue
        const parsed = parseSessionName(sessionName)
        if (parsed) {
          const paneContent = captureTmuxPane(sessionName, 10, cId)
          const state = detectState(paneContent)
          agents.push({
            sessionId: sessionName,
            ticketId: parsed.ticketId,
            agentName: parsed.agentName,
            state,
            environment: 'container',
            containerId: cId,
            elapsed: '?',
            paneContent: paneContent || undefined,
          })
        }
      }

      // JSON mode: output structured data and exit
      if (jsonMode) {
        const hungAgents = agents.filter(a => a.state === 'HUNG')
        const fixResults: Array<{ agentName: string; ticketId: string; recovered: boolean }> = []

        if (fix && hungAgents.length > 0) {
          for (const agent of hungAgents) {
            const success = sendEscape(agent.sessionId, agent.containerId)
            fixResults.push({
              agentName: agent.agentName,
              ticketId: agent.ticketId,
              recovered: success,
            })
          }
        }

        outputSuccessAsJson({
          agents: agents.map(a => ({
            ticketId: a.ticketId,
            agentName: a.agentName,
            state: a.state,
            environment: a.environment,
            containerId: a.containerId,
            sessionId: a.sessionId,
            elapsed: a.elapsed,
          })),
          summary: {
            total: agents.length,
            hung: agents.filter(a => a.state === 'HUNG').length,
            working: agents.filter(a => a.state === 'WORKING').length,
            done: agents.filter(a => a.state === 'DONE').length,
            idle: agents.filter(a => a.state === 'IDLE').length,
            unknown: agents.filter(a => a.state === 'UNKNOWN').length,
          },
          ...(fix && fixResults.length > 0 ? { recovered: fixResults } : {}),
          commands: {
            fix: 'prlt session health --fix',
            watch: 'prlt session health --watch',
          },
        }, createMetadata('session health', flags))
      }

      // Display status table
      this.displayHealthTable(agents)

      // Auto-fix hung agents if --fix
      if (fix) {
        const hungAgents = agents.filter(a => a.state === 'HUNG')
        if (hungAgents.length > 0) {
          this.log('')
          this.log(styles.header('Recovering hung agents...'))
          this.log('')
          for (const agent of hungAgents) {
            const success = sendEscape(agent.sessionId, agent.containerId)
            if (success) {
              this.log(styles.success(`  Sent Escape to ${agent.agentName} (${agent.ticketId}) - recovered`))
            } else {
              this.log(styles.error(`  Failed to send Escape to ${agent.agentName} (${agent.ticketId})`))
            }
          }
          this.log('')
        } else {
          this.log('')
          this.log(styles.success('No hung agents found.'))
          this.log('')
        }
      }

      return agents
    } finally {
      db?.close()
    }
  }

  /**
   * Display the health status table.
   */
  private displayHealthTable(agents: AgentHealthInfo[]): void {
    if (agents.length === 0) {
      this.log('')
      this.log(styles.muted('No active agent sessions found.'))
      this.log('')
      this.log(styles.muted('Start work with: prlt work start <ticket-id>'))
      this.log('')
      return
    }

    this.log('')
    this.log(styles.header('Agent Health Status'))
    this.log('═'.repeat(95))

    this.log(
      styles.muted(
        '  ' +
        'Ticket'.padEnd(12) +
        'Agent'.padEnd(20) +
        'State'.padEnd(12) +
        'Type'.padEnd(15) +
        'Elapsed'.padEnd(10) +
        'Session'
      )
    )
    this.log('  ' + '─'.repeat(93))

    for (const agent of agents) {
      const typeIcon = agent.environment === 'container' ? '🐳 container' : '💻 host'
      const stateColor = agent.state === 'HUNG' ? styles.error :
                         agent.state === 'WORKING' ? styles.success :
                         agent.state === 'DONE' ? styles.info :
                         agent.state === 'IDLE' ? styles.warning :
                         styles.muted

      const stateIcon = agent.state === 'HUNG' ? '🔴' :
                        agent.state === 'WORKING' ? '🟢' :
                        agent.state === 'DONE' ? '✅' :
                        agent.state === 'IDLE' ? '🟡' :
                        '⚪'

      const displaySession = agent.sessionId.length > 24
        ? agent.sessionId.substring(0, 21) + '...'
        : agent.sessionId

      this.log(
        '  ' +
        agent.ticketId.padEnd(12) +
        agent.agentName.padEnd(20) +
        stateColor(`${stateIcon} ${agent.state}`).padEnd(22) +
        typeIcon.padEnd(15) +
        agent.elapsed.padEnd(10) +
        styles.muted(displaySession)
      )
    }

    this.log('')
    this.log('═'.repeat(95))

    // Summary counts
    const counts = {
      HUNG: agents.filter(a => a.state === 'HUNG').length,
      WORKING: agents.filter(a => a.state === 'WORKING').length,
      DONE: agents.filter(a => a.state === 'DONE').length,
      IDLE: agents.filter(a => a.state === 'IDLE').length,
      UNKNOWN: agents.filter(a => a.state === 'UNKNOWN').length,
    }

    const parts: string[] = []
    if (counts.WORKING > 0) parts.push(styles.success(`${counts.WORKING} working`))
    if (counts.HUNG > 0) parts.push(styles.error(`${counts.HUNG} hung`))
    if (counts.DONE > 0) parts.push(styles.info(`${counts.DONE} done`))
    if (counts.IDLE > 0) parts.push(styles.warning(`${counts.IDLE} idle`))
    if (counts.UNKNOWN > 0) parts.push(styles.muted(`${counts.UNKNOWN} unknown`))

    this.log(`  ${parts.join('  ')}`)
    this.log('')

    // Show fix hint if there are hung agents
    if (counts.HUNG > 0) {
      this.log(styles.warning(`  ${counts.HUNG} agent(s) appear hung. Run with --fix to send Escape and recover them.`))
      this.log(styles.muted('  prlt session health --fix'))
      this.log('')
    }
  }

  /**
   * Watchdog mode: continuously monitor and auto-recover hung agents.
   */
  private async watchMode(intervalMinutes: number, thresholdMinutes: number): Promise<void> {
    this.log('')
    this.log(styles.header('Watchdog Mode'))
    this.log(styles.muted(`  Polling every ${intervalMinutes} minute(s)`))
    this.log(styles.muted(`  Auto-recovering agents hung for >${thresholdMinutes} minute(s)`))
    this.log(styles.muted('  Press Ctrl+C to stop'))
    this.log('')

    // Track how long each agent has been in HUNG state (by sessionId)
    const hungSince = new Map<string, number>()

    const poll = async () => {
      const timestamp = new Date().toLocaleTimeString()
      this.log(styles.muted(`[${timestamp}] Checking agent health...`))

      const agents = await this.runHealthCheck(false)

      // Track hung durations and auto-recover
      const currentHungIds = new Set<string>()

      for (const agent of agents) {
        if (agent.state === 'HUNG') {
          currentHungIds.add(agent.sessionId)

          if (!hungSince.has(agent.sessionId)) {
            hungSince.set(agent.sessionId, Date.now())
            this.log(styles.warning(`  Detected hung agent: ${agent.agentName} (${agent.ticketId})`))
          }

          const hungDurationMs = Date.now() - hungSince.get(agent.sessionId)!
          const hungMinutes = Math.floor(hungDurationMs / 60000)

          if (hungMinutes >= thresholdMinutes) {
            this.log(styles.warning(`  Agent ${agent.agentName} hung for ${hungMinutes}m (threshold: ${thresholdMinutes}m) - recovering...`))
            const success = sendEscape(agent.sessionId, agent.containerId)
            if (success) {
              this.log(styles.success(`  Sent Escape to ${agent.agentName} (${agent.ticketId}) - recovered`))
              hungSince.delete(agent.sessionId)
            } else {
              this.log(styles.error(`  Failed to send Escape to ${agent.agentName} (${agent.ticketId})`))
            }
          }
        }
      }

      // Clear hung tracking for agents no longer hung
      for (const sessionId of hungSince.keys()) {
        if (!currentHungIds.has(sessionId)) {
          hungSince.delete(sessionId)
        }
      }
    }

    // Initial check
    await poll()

    // Poll loop
    const intervalMs = intervalMinutes * 60 * 1000
    await new Promise<void>((resolve) => {
      const timer = setInterval(async () => {
        try {
          await poll()
        } catch (error) {
          this.log(styles.error(`  Error during health check: ${error}`))
        }
      }, intervalMs)

      // Handle graceful shutdown
      const cleanup = () => {
        clearInterval(timer)
        this.log('')
        this.log(styles.muted('Watchdog stopped.'))
        resolve()
      }

      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    })
  }
}
