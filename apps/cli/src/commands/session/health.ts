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
  findContainerSessionsByPrefix,
  findSessionForExecution,
  captureTmuxPane,
  sendTmuxMessage,
} from '../../lib/execution/session-utils.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { visualPadEnd } from '../../lib/string-utils.js'
import { onShutdown } from '../../lib/signal-handler.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

// =============================================================================
// Types
// =============================================================================

export type AgentHealthState = 'HUNG' | 'WORKING' | 'DONE' | 'IDLE' | 'UNKNOWN'

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
 * Detect agent health state from tmux pane content.
 *
 * Detection patterns (checked in priority order):
 * - '0 tokens' (the down-arrow + 0 tokens pattern) = HUNG
 * - 'esc to interrupt' = WORKING
 * - 'Agent work complete' or similar completion messages = DONE
 * - Idle prompt patterns ($ or ❯ at end of line) = IDLE
 */
export function detectState(paneContent: string | null): AgentHealthState {
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
  const lastNonEmpty = [...lines].reverse().find((l: string) => l.trim().length > 0) || ''
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
  static description = 'Check health of running agent sessions, detect/recover hung agents, and auto-poke idle agents'

  static examples = [
    '<%= config.bin %> session health',
    '<%= config.bin %> session health --fix',
    '<%= config.bin %> session health --poke-idle',
    '<%= config.bin %> session health --fix --poke-idle',
    '<%= config.bin %> session health --watch',
    '<%= config.bin %> session health --watch --interval 3 --threshold 5',
    '<%= config.bin %> session health --watch --poke-idle',
  ]

  static flags = {
    ...pmoBaseFlags,
    fix: Flags.boolean({
      description: 'Send Escape to hung agents to unstick them',
      default: false,
    }),
    'poke-idle': Flags.boolean({
      description: 'Auto-poke idle agents with their ticket description to resume work',
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
      description: 'Minutes an agent must be hung/idle before auto-recovery in watch mode',
      default: 10,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SessionHealth)
    const jsonMode = shouldOutputJson(flags)
    const pokeIdle = flags['poke-idle']

    if (flags.watch) {
      await this.watchMode(flags.interval, flags.threshold, pokeIdle)
    } else {
      await this.runHealthCheck(flags.fix, jsonMode, flags, pokeIdle)
    }
  }

  /**
   * Single health check pass. Returns the list of agent health infos.
   */
  private async runHealthCheck(
    fix: boolean,
    jsonMode: boolean = false,
    flags: Record<string, unknown> = {},
    pokeIdle: boolean = false,
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
        return []
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
          if (!actualSessionId) continue
        } else {
          if (isContainer && exec.containerId) {
            const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
            exists = containerSessions.includes(exec.sessionId)
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

      // Auto-poke idle agents if --poke-idle
      const pokeResults: Array<{ agentName: string; ticketId: string; poked: boolean; message?: string }> = []
      if (pokeIdle) {
        const idleAgents = agents.filter(a => a.state === 'IDLE')
        for (const agent of idleAgents) {
          const result = await this.pokeIdleAgent(agent)
          pokeResults.push(result)
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
          ...(pokeResults.length > 0 ? { poked: pokeResults } : {}),
          commands: {
            fix: 'prlt session health --fix',
            'poke-idle': 'prlt session health --poke-idle',
            watch: 'prlt session health --watch',
          },
        }, createMetadata('session health', flags))
        return []
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

      // Display poke-idle results
      if (pokeIdle && pokeResults.length > 0) {
        this.log('')
        this.log(styles.header('Poking idle agents...'))
        this.log('')
        for (const result of pokeResults) {
          if (result.poked) {
            this.log(styles.success(`  Poked ${result.agentName} (${result.ticketId}) with ticket description`))
          } else {
            this.log(styles.warning(`  Could not poke ${result.agentName} (${result.ticketId}): ${result.message || 'unknown error'}`))
          }
        }
        this.log('')
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
        visualPadEnd('Ticket', 12) +
        visualPadEnd('Agent', 20) +
        visualPadEnd('State', 12) +
        visualPadEnd('Type', 15) +
        visualPadEnd('Elapsed', 10) +
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
        visualPadEnd(agent.ticketId, 12) +
        visualPadEnd(agent.agentName, 20) +
        stateColor(visualPadEnd(`${stateIcon} ${agent.state}`, 12)) +
        visualPadEnd(typeIcon, 15) +
        visualPadEnd(agent.elapsed, 10) +
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

    // Show poke-idle hint if there are idle agents
    if (counts.IDLE > 0) {
      this.log(styles.warning(`  ${counts.IDLE} agent(s) appear idle. Run with --poke-idle to send their ticket description and resume work.`))
      this.log(styles.muted('  prlt session health --poke-idle'))
      this.log('')
    }
  }

  /**
   * Poke an idle agent with its ticket description to resume work.
   * Looks up the ticket from PMO storage and sends the description.
   */
  private async pokeIdleAgent(
    agent: AgentHealthInfo,
  ): Promise<{ agentName: string; ticketId: string; poked: boolean; message?: string }> {
    try {
      const ticket = await this.storage.getTicket(agent.ticketId)
      if (!ticket) {
        return { agentName: agent.agentName, ticketId: agent.ticketId, poked: false, message: 'ticket not found' }
      }

      if (!ticket.description && !ticket.title) {
        return { agentName: agent.agentName, ticketId: agent.ticketId, poked: false, message: 'ticket has no description' }
      }

      // Build the poke message with ticket context
      const parts = [`Continue working on ${agent.ticketId}: ${ticket.title}`]
      if (ticket.description) {
        parts.push('')
        parts.push(ticket.description)
      }
      if (ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0) {
        parts.push('')
        parts.push('Acceptance Criteria:')
        for (const ac of ticket.acceptanceCriteria) {
          parts.push(`- ${ac.criterion}`)
        }
      }
      const pokeMessage = parts.join('\n')

      sendTmuxMessage(agent.sessionId, pokeMessage, agent.containerId)
      return { agentName: agent.agentName, ticketId: agent.ticketId, poked: true }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return { agentName: agent.agentName, ticketId: agent.ticketId, poked: false, message: errMsg }
    }
  }

  /**
   * Watchdog mode: continuously monitor and auto-recover hung agents.
   */
  private async watchMode(intervalMinutes: number, thresholdMinutes: number, pokeIdle: boolean = false): Promise<void> {
    this.log('')
    this.log(styles.header('Watchdog Mode'))
    this.log(styles.muted(`  Polling every ${intervalMinutes} minute(s)`))
    this.log(styles.muted(`  Auto-recovering agents hung for >${thresholdMinutes} minute(s)`))
    if (pokeIdle) {
      this.log(styles.muted(`  Auto-poking agents idle for >${thresholdMinutes} minute(s)`))
    }
    this.log(styles.muted('  Press Ctrl+C to stop'))
    this.log('')

    // Track how long each agent has been in HUNG or IDLE state (by sessionId)
    const hungSince = new Map<string, number>()
    const idleSince = new Map<string, number>()

    const poll = async () => {
      const timestamp = new Date().toLocaleTimeString()
      this.log(styles.muted(`[${timestamp}] Checking agent health...`))

      const agents = await this.runHealthCheck(false)

      // Track hung durations and auto-recover
      const currentHungIds = new Set<string>()
      const currentIdleIds = new Set<string>()

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

        // Track idle agents and auto-poke when threshold exceeded
        if (pokeIdle && agent.state === 'IDLE') {
          currentIdleIds.add(agent.sessionId)

          if (!idleSince.has(agent.sessionId)) {
            idleSince.set(agent.sessionId, Date.now())
            this.log(styles.warning(`  Detected idle agent: ${agent.agentName} (${agent.ticketId})`))
          }

          const idleDurationMs = Date.now() - idleSince.get(agent.sessionId)!
          const idleMinutes = Math.floor(idleDurationMs / 60000)

          if (idleMinutes >= thresholdMinutes) {
            this.log(styles.warning(`  Agent ${agent.agentName} idle for ${idleMinutes}m (threshold: ${thresholdMinutes}m) - poking...`))
            const result = await this.pokeIdleAgent(agent)
            if (result.poked) {
              this.log(styles.success(`  Poked ${agent.agentName} (${agent.ticketId}) with ticket description`))
              idleSince.delete(agent.sessionId)
            } else {
              this.log(styles.error(`  Failed to poke ${agent.agentName} (${agent.ticketId}): ${result.message}`))
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

      // Clear idle tracking for agents no longer idle
      for (const sessionId of idleSince.keys()) {
        if (!currentIdleIds.has(sessionId)) {
          idleSince.delete(sessionId)
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

      // Register cleanup via centralized signal handler
      onShutdown(() => {
        clearInterval(timer)
        resolve()
      })
    })
  }
}
