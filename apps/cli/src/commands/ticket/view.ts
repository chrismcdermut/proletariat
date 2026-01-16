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
      // Select project scope first
      const selection = await this.selectProjectOrAll({
        message: 'Select tickets to view from:',
      });

      // Get tickets based on selection
      const allTickets = selection.allProjects
        ? await this.storage.listTickets({ allProjects: true })
        : await this.storage.listTickets({ projectId: selection.projectId });

      if (allTickets.length === 0) {
        this.error('No tickets found. Create a ticket first with "prlt ticket create".');
      }

      // Group tickets by priority
      const priorityOrder = ['P0', 'P1', 'P2', 'P3', null];
      const priorityLabels: Record<string, string> = {
        'P0': 'P0 - Critical',
        'P1': 'P1 - High',
        'P2': 'P2 - Medium',
        'P3': 'P3 - Low',
        'none': 'No Priority',
      };

      // Sort tickets by priority
      const sortedTickets = [...allTickets].sort((a, b) => {
        const aIdx = priorityOrder.indexOf(a.priority || null);
        const bIdx = priorityOrder.indexOf(b.priority || null);
        return aIdx - bIdx;
      });

      // Build choices with priority separators
      const choices: Array<{ name: string; value: string } | inquirer.Separator> = [];
      let currentPriority: string | null | undefined = undefined;

      for (const t of sortedTickets) {
        const ticketPriority = t.priority || null;
        if (ticketPriority !== currentPriority) {
          currentPriority = ticketPriority;
          const label = priorityLabels[ticketPriority || 'none'] || '⚪ Other';
          choices.push(new inquirer.Separator(`── ${label} ──`));
        }
        choices.push({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        });
      }

      const { selectedTicketId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicketId',
        message: 'Select ticket to view:',
        choices,
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
