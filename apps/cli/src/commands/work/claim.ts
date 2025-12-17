import { Command, Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { TicketStatus } from '../../lib/pmo/types.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'

export default class WorkClaim extends Command {
  static description = 'Claim work: take ownership and assign to yourself or an agent'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --self',
    '<%= config.bin %> <%= command.id %> TKT-001 --agent altman',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to claim',
      required: false,
    }),
  }

  static flags = {
    self: Flags.boolean({
      description: 'Assign to yourself (skip prompt)',
      default: false,
    }),
    agent: Flags.string({
      description: 'Assign to specific agent',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkClaim)

    // Get current user
    const currentUser = this.getCurrentUser()

    // Get workspace info for agent list
    let workspaceAgents: string[] = []
    try {
      const workspaceInfo = getWorkspaceInfo()
      workspaceAgents = workspaceInfo.agents.map((a) => a.name)
    } catch {
      // Not in workspace
    }

    // Get PMO context
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId

      if (!ticketId) {
        const allTickets = await storage.listTickets()
        // Filter to unassigned or backlog tickets
        const availableTickets = allTickets.filter(
          (t) => !t.assignee || t.status === 'backlog'
        )

        if (availableTickets.length === 0) {
          await storage.close()
          this.error('No available tickets to claim.')
        }

        const { selectedTicketId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedTicketId',
            message: 'Select ticket to claim:',
            choices: availableTickets.map((t) => ({
              name: `${t.id} - ${t.title} (${t.status}${t.assignee ? `, assignee: ${t.assignee}` : ''})`,
              value: t.id,
            })),
          },
        ])
        ticketId = selectedTicketId
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!)
      if (!ticket) {
        await storage.close()
        this.error(`Ticket "${ticketId}" not found.`)
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

      // Update ticket
      const updates: { owner: string; assignee: string; status?: TicketStatus } = {
        owner: currentUser,
        assignee: executor,
      }

      // If self, move to in_progress
      if (!executeAgent) {
        updates.status = 'in_progress' as TicketStatus
      }

      await storage.updateTicket(ticketId!, updates)
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()

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
    } catch (error) {
      await storage.close()
      throw error
    }
  }

  private getCurrentUser(): string {
    try {
      const { execSync } = require('child_process')
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
