import { Command, Args } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'

export default class TicketOwn extends Command {
  static description = 'Take accountability for a ticket (you are responsible for it getting done)'

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

  async run(): Promise<void> {
    const { args } = await this.parse(TicketOwn)

    // Get current user (from git config or environment)
    const currentUser = this.getCurrentUser()

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

        if (allTickets.length === 0) {
          await storage.close()
          this.error('No tickets found. Create a ticket first with "prlt ticket create".')
        }

        const { selectedTicketId } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedTicketId',
            message: 'Select ticket to own:',
            choices: allTickets.map((t) => ({
              name: `${t.id} - ${t.title} (${t.owner ? `owner: ${t.owner}` : 'unowned'})`,
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

      // Update ticket owner
      await storage.updateTicket(ticketId!, { owner: currentUser })
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()

      this.log('')
      this.log(styles.success(`✅ You now own ${styles.emphasis(ticketId!)}`))
      this.log(styles.muted(`   Title: ${ticket.title}`))
      this.log(styles.muted(`   Owner: ${currentUser}`))
      this.log(styles.muted(`   Assignee: ${ticket.assignee || '(unassigned)'}`))
      this.log('')
      this.log(styles.muted('Next steps:'))
      this.log(styles.muted(`  prlt ticket assign ${ticketId} <agent>   # Delegate to agent`))
      this.log(styles.muted(`  prlt ticket claim ${ticketId}            # Do it yourself`))
      this.log('')
    } catch (error) {
      await storage.close()
      throw error
    }
  }

  private getCurrentUser(): string {
    // Try git config
    try {
      const { execSync } = require('child_process')
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
