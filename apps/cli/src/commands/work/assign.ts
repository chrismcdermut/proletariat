import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'

export default class WorkAssign extends PMOCommand {
  static description = 'Assign work to an agent or person'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 altman',
    '<%= config.bin %> <%= command.id %> TKT-001 --unassign',
    '<%= config.bin %> <%= command.id %> TKT-001 altman --owner chris',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
    agent: Args.string({
      description: 'Agent/user to assign - prompts with dropdown if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    owner: Flags.string({
      description: 'Also set the owner',
    }),
    unassign: Flags.boolean({
      char: 'u',
      description: 'Remove current assignee',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkAssign)

    // Get workspace info for agent list
    let workspaceAgents: string[] = []
    try {
      const workspaceInfo = getWorkspaceInfo()
      workspaceAgents = workspaceInfo.agents.map((a) => a.name)
    } catch {
      // Not in workspace, will use manual entry
    }

    // Get ticketId - prompt if not provided
    let ticketId = args.ticketId

    if (!ticketId) {
      const allTickets = await this.storage.listTickets()

      if (allTickets.length === 0) {
        this.error('No tickets found. Create a ticket first with "prlt ticket create".')
      }

      const { selectedTicketId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to assign:',
          choices: allTickets.map((t) => ({
            name: `${t.id} - ${t.title} (${t.assignee ? `assignee: ${t.assignee}` : 'unassigned'})`,
            value: t.id,
          })),
        },
      ])
      ticketId = selectedTicketId
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!)
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`)
    }

    // Handle unassign flag
    if (flags.unassign) {
      await this.storage.updateTicket(ticketId!, { assignee: undefined })
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      this.log('')
      this.log(styles.success(`Unassigned ${styles.emphasis(ticketId)}`))
      this.log(styles.muted(`   Title: ${ticket.title}`))
      this.log('')
      return
    }

    // Get agent - prompt if not provided
    let agent = args.agent

    if (!agent) {
      // Build choices from workspace agents
      const agentChoices: Array<{ name: string; value: string } | inquirer.Separator> = [
        { name: 'Unassign (remove assignee)', value: '' },
      ]

      if (workspaceAgents.length > 0) {
        agentChoices.push(new inquirer.Separator('── Agents ──'))
        for (const a of workspaceAgents) {
          agentChoices.push({ name: a, value: a })
        }
      }

      agentChoices.push(new inquirer.Separator('── Other ──'))
      agentChoices.push({ name: 'Enter custom name...', value: '__custom__' })

      const { selectedAgent } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedAgent',
          message: `Assign ${ticketId} to:`,
          choices: agentChoices,
        },
      ])

      if (selectedAgent === '__custom__') {
        const { customAgent } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customAgent',
            message: 'Enter agent/user name:',
            validate: (input: string) => {
              if (!input.trim()) {
                return 'Name cannot be empty'
              }
              return true
            },
          },
        ])
        agent = customAgent.trim()
      } else {
        agent = selectedAgent
      }
    }

    // Build update object
    const updates: { assignee?: string; owner?: string } = {}

    if (agent) {
      updates.assignee = agent
    } else {
      updates.assignee = undefined
    }

    if (flags.owner) {
      updates.owner = flags.owner
    }

    // Update ticket
    await this.storage.updateTicket(ticketId!, updates)
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

    this.log('')
    if (agent) {
      this.log(styles.success(`Assigned ${styles.emphasis(ticketId!)} to ${styles.emphasis(agent)}`))
      this.log(styles.muted(`   Title: ${ticket.title}`))
      if (flags.owner) {
        this.log(styles.muted(`   Owner: ${flags.owner}`))
      }
      this.log('')
      this.log(styles.muted(`To start work: prlt work start ${ticketId}`))
    } else {
      this.log(styles.success(`Unassigned ${styles.emphasis(ticketId!)}`))
      this.log(styles.muted(`   Title: ${ticket.title}`))
    }
    this.log('')
  }
}
