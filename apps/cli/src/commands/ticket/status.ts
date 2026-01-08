import { Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles, formatPriority, formatCategory } from '../../lib/styles.js';

export default class TicketStatus extends PMOCommand {
  static description = 'Show ticket status and details';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TICK-001',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args } = await this.parse(TicketStatus);

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
          name: `${t.id} - ${t.title} (${t.column})`,
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

    // Display ticket status
    this.log('');
    this.log(styles.emphasis(`🎫 ${ticket.id}: ${ticket.title}`));
    this.log('');
    this.log(`   ${styles.muted('Column:')}    ${ticket.column}`);
    this.log(`   ${styles.muted('Priority:')}  ${formatPriority(ticket.priority)}`);
    if (ticket.category) {
      this.log(`   ${styles.muted('Category:')}  ${formatCategory(ticket.category)}`);
    }
    if (ticket.description) {
      this.log(`   ${styles.muted('Description:')}`);
      this.log(`   ${ticket.description.split('\n').map((line: string) => `   ${line}`).join('\n')}`);
    }
    if (ticket.subtasks && ticket.subtasks.length > 0) {
      const completedSubtasks = ticket.subtasks.filter((s: { done: boolean }) => s.done).length;
      this.log(`   ${styles.muted('Subtasks:')}   ${completedSubtasks}/${ticket.subtasks.length} completed`);
      ticket.subtasks.forEach((subtask: { title: string; done: boolean }) => {
        const icon = subtask.done ? '☑' : '☐';
        this.log(`     ${icon} ${subtask.title}`);
      });
    }
    this.log('');
  }

}
