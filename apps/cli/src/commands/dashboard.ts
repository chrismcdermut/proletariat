/**
 * prlt dashboard — unified TUI dashboard
 *
 * Combines kanban board, agent list, and session status
 * into a single auto-refreshing terminal view.
 */

import { Flags } from '@oclif/core'
import {
  PMOCommand,
  pmoBaseFlags,
  Ticket,
  Subtask,
} from '../lib/pmo/index.js'
import {
  styles,
  formatPriority,
  formatCategory,
  getColumnStyle,
  getColumnEmoji,
} from '../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import { SessionStore, SessionRecord } from '../lib/session-store.js'
import {
  getWorkspaceInfo,
  getAllAgentsStatus,
  getAgentTmuxSessions,
  AgentStatus,
} from '../lib/agents/commands.js'

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.substring(0, maxLen - 3) + '...'
}

interface DashboardData {
  board: {
    name: string
    columns: Array<{ name: string; tickets: Ticket[] }>
  } | null
  agents: AgentStatus[]
  sessions: SessionRecord[]
  timestamp: Date
}

export default class Dashboard extends PMOCommand {
  static description = 'Unified TUI dashboard with board, agents, and sessions'

  static examples = [
    '<%= config.bin %> dashboard',
    '<%= config.bin %> dashboard --refresh 10',
    '<%= config.bin %> dashboard --compact',
    '<%= config.bin %> dashboard --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    refresh: Flags.integer({
      char: 'r',
      description: 'Auto-refresh interval in seconds (0 to disable)',
      default: 0,
    }),
    compact: Flags.boolean({
      char: 'c',
      description: 'Compact ticket view (ID and title only)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Dashboard)
    const jsonMode = shouldOutputJson(flags)
    const projectId = await this.requireProject()

    if (flags.refresh > 0 && !jsonMode) {
      await this.runWithRefresh(projectId, flags.refresh, flags.compact)
    } else {
      const data = await this.gatherData(projectId)

      if (jsonMode) {
        this.outputJson(data, flags)
        return
      }

      this.renderDashboard(data, flags.compact)
    }
  }

  /**
   * Gather all dashboard data from board, agents, and sessions.
   */
  private async gatherData(projectId: string): Promise<DashboardData> {
    const board = await this.storage.getBoard(projectId)

    // Get agent status from workspace
    let agents: AgentStatus[] = []
    try {
      const workspaceInfo = getWorkspaceInfo()
      const activeAgents = workspaceInfo.agents.filter(a => a.status === 'active')
      if (activeAgents.length > 0) {
        agents = getAllAgentsStatus(workspaceInfo)
      }
    } catch {
      // Workspace info might not be available — ignore
    }

    // Get sessions from global session store
    let sessions: SessionRecord[] = []
    let sessionStore: SessionStore | null = null
    try {
      sessionStore = new SessionStore()
      sessionStore.reconcile()
      sessions = sessionStore.list('running')
    } catch {
      // Session store might not exist yet — ignore
    } finally {
      sessionStore?.close()
    }

    return {
      board: board ? { name: board.name, columns: board.columns } : null,
      agents,
      sessions,
      timestamp: new Date(),
    }
  }

  /**
   * Auto-refresh loop: clear screen and redraw on interval.
   */
  private async runWithRefresh(
    projectId: string,
    intervalSec: number,
    compact: boolean
  ): Promise<void> {
    const render = async () => {
      const data = await this.gatherData(projectId)
      // Clear screen
      process.stdout.write('\x1B[2J\x1B[H')
      this.renderDashboard(data, compact)
      this.log(
        styles.muted(`\nAuto-refreshing every ${intervalSec}s. Press Ctrl+C to exit.`)
      )
    }

    // Initial render
    await render()

    // Set up interval
    const timer = setInterval(render, intervalSec * 1000)

    // Wait for SIGINT
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        clearInterval(timer)
        resolve()
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    })
  }

  /**
   * Output all dashboard data as JSON for AI agents.
   */
  private outputJson(data: DashboardData, flags: Record<string, unknown>): void {
    outputSuccessAsJson(
      {
        board: data.board
          ? {
              name: data.board.name,
              columns: data.board.columns.map(col => ({
                name: col.name,
                ticketCount: col.tickets.length,
                tickets: col.tickets.map(t => ({
                  id: t.id,
                  title: t.title,
                  priority: t.priority,
                  category: t.category,
                  assignee: t.assignee,
                  subtasksDone: t.subtasks.filter((s: Subtask) => s.done).length,
                  subtasksTotal: t.subtasks.length,
                })),
              })),
              totalTickets: data.board.columns.reduce(
                (sum, col) => sum + col.tickets.length,
                0
              ),
            }
          : null,
        agents: data.agents.map(a => ({
          name: a.name,
          exists: a.exists,
          branch: a.branch,
          assignedTickets: a.assignedTickets,
          completedTickets: a.completedTickets,
          running: getAgentTmuxSessions(a.name).length > 0,
        })),
        sessions: data.sessions.map(s => ({
          id: s.id,
          agentName: s.agentName,
          runner: s.runner,
          task: s.task,
          environment: s.environment,
          status: s.status,
          duration: Date.now() - s.startedAt.getTime(),
          startedAt: s.startedAt.toISOString(),
        })),
        timestamp: data.timestamp.toISOString(),
      },
      createMetadata('dashboard', flags)
    )
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  private renderDashboard(data: DashboardData, compact: boolean): void {
    const termWidth = process.stdout.columns || 80

    // Header
    this.log(styles.title('\n  PROLETARIAT DASHBOARD'))
    this.log(
      styles.muted(
        `  ${data.timestamp.toLocaleTimeString()} — ` +
          `${data.agents.length} agent(s), ` +
          `${data.sessions.length} session(s)`
      )
    )
    this.log(styles.muted('  ' + '═'.repeat(Math.min(termWidth - 4, 76))))

    // Section 1: Kanban Board
    this.renderBoardSection(data, compact)

    // Section 2: Agents
    this.renderAgentsSection(data)

    // Section 3: Sessions
    this.renderSessionsSection(data)

    // Footer
    this.log(styles.muted('  ' + '═'.repeat(Math.min(termWidth - 4, 76))))
    this.log(
      styles.muted('  Commands: ') +
        styles.primary('prlt dashboard -r 5') +
        styles.muted(' (auto-refresh)  ') +
        styles.primary('prlt ps') +
        styles.muted(' (sessions)  ') +
        styles.primary('prlt agent list') +
        styles.muted(' (agents)')
    )
    this.log('')
  }

  // -- Board ------------------------------------------------------------------

  private renderBoardSection(data: DashboardData, compact: boolean): void {
    this.log('')
    this.log(styles.header('  BOARD'))

    if (!data.board) {
      this.log(styles.muted('  No board found.'))
      return
    }

    // Summary bar: show counts per column inline
    const summaryParts = data.board.columns
      .map(col => {
        const colStyle = getColumnStyle(col.name)
        return colStyle(`${col.name}: ${col.tickets.length}`)
      })

    this.log('  ' + summaryParts.join(styles.muted(' | ')))
    this.log(styles.muted('  ' + '─'.repeat(60)))

    // Show tickets grouped by column (skip empty columns in compact mode)
    for (const column of data.board.columns) {
      if (compact && column.tickets.length === 0) continue

      const headerColor = getColumnStyle(column.name)
      const emoji = getColumnEmoji(column.name)

      this.log(headerColor(`  ${emoji} ${column.name} (${column.tickets.length})`))

      if (column.tickets.length === 0) {
        this.log(styles.muted('    (empty)'))
        continue
      }

      const sortedTickets = [...column.tickets].sort(
        (a, b) => (a.position || 0) - (b.position || 0)
      )

      for (const ticket of sortedTickets) {
        if (compact) {
          this.renderTicketCompact(ticket)
        } else {
          this.renderTicketFull(ticket)
        }
      }
    }
  }

  private renderTicketCompact(ticket: Ticket): void {
    const priority = formatPriority(ticket.priority)
    const assignee = ticket.assignee ? styles.muted(` @${ticket.assignee}`) : ''
    this.log(`    ${styles.code(ticket.id)}: ${ticket.title} ${priority}${assignee}`)
  }

  private renderTicketFull(ticket: Ticket): void {
    const priority = formatPriority(ticket.priority)
    const category = formatCategory(ticket.category)
    const assignee = ticket.assignee ? styles.muted(` @${ticket.assignee}`) : ''

    this.log(
      `    ${styles.code(ticket.id)} ${ticket.title} ${priority} ${category}${assignee}`
    )

    if (ticket.description) {
      const shortDesc = ticket.description.split('\n')[0].substring(0, 50)
      this.log(
        styles.muted(
          `       ${shortDesc}${ticket.description.length > 50 ? '...' : ''}`
        )
      )
    }

    if (ticket.subtasks.length > 0) {
      const done = ticket.subtasks.filter(s => s.done).length
      const total = ticket.subtasks.length
      const pct = Math.round((done / total) * 100)
      const bar = this.progressBar(done, total, 10)
      this.log(styles.muted(`       ${bar} ${done}/${total} (${pct}%)`))
    }
  }

  private progressBar(done: number, total: number, width: number): string {
    const filled = Math.round((done / total) * width)
    const empty = width - filled
    return styles.success('█'.repeat(filled)) + styles.muted('░'.repeat(empty))
  }

  // -- Agents -----------------------------------------------------------------

  private renderAgentsSection(data: DashboardData): void {
    this.log('')
    this.log(styles.header('  AGENTS'))

    if (data.agents.length === 0) {
      this.log(styles.muted('  No agents found.'))
      return
    }

    // Header row
    this.log(
      styles.muted(
        '  ' +
          padEnd('Name', 18) +
          padEnd('Status', 12) +
          padEnd('Tickets', 24) +
          'Branch'
      )
    )
    this.log(styles.muted('  ' + '─'.repeat(70)))

    for (const agent of data.agents) {
      const sessions = getAgentTmuxSessions(agent.name)
      const isRunning = sessions.length > 0

      // Determine status
      let statusLabel: string
      let statusStyled: string
      if (!agent.exists) {
        statusLabel = 'missing'
        statusStyled = styles.error(statusLabel)
      } else if (isRunning) {
        statusLabel = 'running'
        statusStyled = styles.success(statusLabel)
      } else {
        statusLabel = 'idle'
        statusStyled = styles.muted(statusLabel)
      }

      const ticketsLabel =
        agent.assignedTickets.length > 0
          ? truncate(agent.assignedTickets.join(', '), 22)
          : 'none'
      const ticketsStyled =
        agent.assignedTickets.length > 0
          ? styles.info(ticketsLabel)
          : styles.muted(ticketsLabel)

      const branchLabel = agent.branch ? truncate(agent.branch, 30) : '-'
      const branchStyled = agent.branch ? styles.code(branchLabel) : styles.muted(branchLabel)

      this.log(
        '  ' +
          padEnd(agent.name, 18) +
          padEnd(statusLabel, 12).replace(statusLabel, statusStyled) +
          padEnd(ticketsLabel, 24).replace(ticketsLabel, ticketsStyled) +
          branchStyled
      )
    }

    // Agent summary
    const activeCount = data.agents.filter(a => a.exists).length
    const runningCount = data.agents.filter(a => getAgentTmuxSessions(a.name).length > 0).length
    this.log(
      styles.muted(
        `  Total: ${data.agents.length} | Active: ${activeCount} | Running: ${runningCount}`
      )
    )
  }

  // -- Sessions ---------------------------------------------------------------

  private renderSessionsSection(data: DashboardData): void {
    this.log('')
    this.log(styles.header('  SESSIONS'))

    if (data.sessions.length === 0) {
      this.log(styles.muted('  No running sessions.'))
      return
    }

    // Header row
    this.log(
      styles.muted(
        '  ' +
          padEnd('Agent', 16) +
          padEnd('Runner', 12) +
          padEnd('Task', 28) +
          padEnd('Env', 8) +
          padEnd('Duration', 10) +
          'Status'
      )
    )
    this.log(styles.muted('  ' + '─'.repeat(78)))

    for (const session of data.sessions) {
      const duration = formatDuration(Date.now() - session.startedAt.getTime())
      const taskDisplay = truncate(session.task, 26)
      const statusColor = session.status === 'running' ? styles.success : styles.muted

      this.log(
        '  ' +
          padEnd(session.agentName, 16) +
          padEnd(session.runner, 12) +
          padEnd(taskDisplay, 28) +
          padEnd(session.environment, 8) +
          padEnd(duration, 10) +
          statusColor(session.status)
      )
    }
  }
}
