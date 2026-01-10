import { Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketView extends PMOCommand {
  static description = 'View detailed ticket information';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to view - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async execute(): Promise<void> {
    const { args } = await this.parse(TicketView);

    // Get ticketId - prompt if not provided
    let ticketId = args.ticketId;

    if (!ticketId) {
      // Get all tickets for selection
      const allTickets = await this.storage.listTickets();

      if (allTickets.length === 0) {
        this.error('No tickets found. Create a ticket first with "prlt ticket create".');
      }

      const { selectedTicketId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicketId',
        message: 'Select ticket to view:',
        choices: allTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        })),
      }]);
      ticketId = selectedTicketId;
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`);
    }

    const board = await this.storage.getBoard();

    // Display ticket details
    this.log(`\n${styles.header('📄 Ticket')} ${styles.emphasis(ticket.id)}\n`);
    this.log(`${styles.header('Title:')}       ${ticket.title}`);
    this.log(`${styles.header('Project:')}     ${board.name}`);
    this.log(`${styles.header('Status:')}      ${ticket.statusName}`);
    this.log(`${styles.header('Priority:')}    ${ticket.priority || 'none'}`);
    this.log(`${styles.header('Category:')}    ${ticket.category || 'none'}`);
    this.log(`${styles.header('Created:')}     ${ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'unknown'}`);
    this.log(`${styles.header('Updated:')}     ${ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : 'unknown'}`);

    if (ticket.description) {
      this.log(`\n${styles.header('Description:')}`);
      this.log(`  ${ticket.description.split('\n').join('\n  ')}`);
    }

    this.log('');
  }

}
