import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js'
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class WorkClaim extends PMOCommand {
  static description = 'Claim work: take ownership and assign to yourself or an agent'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --self',
    '<%= config.bin %> <%= command.id %> TKT-001 --agent altman',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --json  # Output choices as JSON',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to claim',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    self: Flags.boolean({
      description: 'Assign to yourself (skip prompt)',
      default: false,
    }),
    agent: Flags.string({
      description: 'Assign to specific agent',
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkClaim)
    const projectId = (flags as { project?: string }).project

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work claim', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Get current user
    const currentUser = this.getCurrentUser()

    // Get workspace info for agent list and database access
    let workspaceAgents: string[] = []
    let workspaceInfo: ReturnType<typeof getWorkspaceInfo> | undefined
    try {
      workspaceInfo = getWorkspaceInfo()
      workspaceAgents = workspaceInfo.agents.map((a) => a.name)
    } catch {
      // Not in workspace
    }

    // Get ticketId - prompt if not provided
    let ticketId = args.ticketId

    if (!ticketId) {
      const allTickets = await this.storage.listTickets(projectId)
      // Filter to unassigned or backlog/unstarted tickets
      const availableTickets = allTickets.filter(
        (t) => !t.assignee || t.statusCategory === 'backlog' || t.statusCategory === 'unstarted'
      )

      if (availableTickets.length === 0) {
        return handleError('NO_AVAILABLE_TICKETS', 'No available tickets to claim.')
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to claim:',
        items: availableTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName || t.statusCategory || 'no status'}${t.assignee ? `, assignee: ${t.assignee}` : ''})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt work claim ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'work claim' } : null,
      })

      if (!selected) {
        return
      }
      ticketId = selected
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!)
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`)
    }

    this.log('')
    this.log(styles.header(`Claiming ${ticketId}: ${ticket.title}`))
    this.log(styles.muted('You will be the owner (accountable for completion).'))
    this.log('')

    // Determine executor
    let executor: string
    let executeAgent = false

    if (flags.self) {
      executor = currentUser
    } else if (flags.agent) {
      executor = flags.agent
      executeAgent = true
    } else {
      // Interactive prompt
      const executorChoices: Array<{ name: string; value: string } | inquirer.Separator> = [
        { name: 'Me (I\'ll work on it myself)', value: '__self__' },
      ]

      if (workspaceAgents.length > 0) {
        executorChoices.push(new inquirer.Separator('── Agents ──'))
        for (const a of workspaceAgents) {
          executorChoices.push({ name: a, value: a })
        }
      }

      const { selectedExecutor } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedExecutor',
          message: 'Who will do the work?',
          choices: executorChoices,
        },
      ])

      if (selectedExecutor === '__self__') {
        executor = currentUser
      } else {
        executor = selectedExecutor
        executeAgent = true
      }
    }

    // Update ticket with owner and assignee
    await this.storage.updateTicket(ticketId!, {
      owner: currentUser,
      assignee: executor,
    })

    // If self, move to In Progress column (moveTicket also updates status_id)
    if (!executeAgent) {
      const db = this.storage.getDatabase()
      const targetColumnName = getWorkColumnSetting(db, 'in_progress')

      const board = await this.storage.getBoard(ticket.projectId!)
      const columnNames = board.columns.map(col => col.name)
      const inProgressColumn = findColumnByName(columnNames, targetColumnName)

      if (inProgressColumn && ticket.statusName !== inProgressColumn) {
        await this.storage.moveTicket(ticket.projectId!, ticketId!, inProgressColumn)
      } else if (!inProgressColumn) {
        this.warn(`Could not find In Progress column "${targetColumnName}", ticket column unchanged`)
      }
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

    this.log('')
    this.log(styles.success(`Claimed ${styles.emphasis(ticketId!)}`))
    this.log(styles.muted(`   Owner: ${currentUser}`))
    this.log(styles.muted(`   Assignee: ${executor}`))

    if (!executeAgent) {
      this.log(styles.muted(`   Status: In Progress`))
      this.log('')
      this.log(styles.muted('You\'re now working on this ticket.'))
    } else {
      this.log('')
      this.log(styles.muted(`To start agent: prlt work start ${ticketId}`))
    }
    this.log('')
  }

  private getCurrentUser(): string {
    try {
      const { execSync } = require('node:child_process')
      const name = execSync('git config user.name', { encoding: 'utf-8' }).trim()
      if (name) return name
    } catch {
      // Ignore
    }

    if (process.env.USER) return process.env.USER
    if (process.env.USERNAME) return process.env.USERNAME

    return 'unknown'
  }
}
