import { Args } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'

export default class WorkOwn extends PMOCommand {
  static description = 'Take ownership of work (you are accountable for it getting done)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(WorkOwn)

    // Get current user (from git config or environment)
    const currentUser = this.getCurrentUser()

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
          message: 'Select work to own:',
          choices: allTickets.map((t) => ({
            name: `${t.id} - ${t.title} (${t.owner ? `owner: ${t.owner}` : 'unowned'})`,
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

    // Update ticket owner
    await this.storage.updateTicket(ticketId!, { owner: currentUser })
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

    this.log('')
    this.log(styles.success(`You now own ${styles.emphasis(ticketId!)}`))
    this.log(styles.muted(`   Title: ${ticket.title}`))
    this.log(styles.muted(`   Owner: ${currentUser}`))
    this.log(styles.muted(`   Assignee: ${ticket.assignee || '(unassigned)'}`))
    this.log('')
    this.log(styles.muted('Next steps:'))
    this.log(styles.muted(`  prlt work assign ${ticketId} <agent>   # Delegate to agent`))
    this.log(styles.muted(`  prlt work claim ${ticketId}            # Do it yourself`))
    this.log('')
  }

  private getCurrentUser(): string {
    // Try git config
    try {
      const { execSync } = require('node:child_process')
      const name = execSync('git config user.name', { encoding: 'utf-8' }).trim()
      if (name) return name
    } catch {
      // Ignore
    }

    // Try environment
    if (process.env.USER) return process.env.USER
    if (process.env.USERNAME) return process.env.USERNAME

    return 'unknown'
  }
}
