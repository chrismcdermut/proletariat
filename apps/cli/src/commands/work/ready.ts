import { Command, Args } from '@oclif/core';
import inquirer from 'inquirer';
import {
  getPMOContext,
  autoExportToBoard,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class WorkReady extends Command {
  static description = 'Mark work as ready for review (moves ticket to In Review column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(WorkReady);

    // Get PMO context (prompts for project if multiple exist)
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId;

      if (!ticketId) {
        // Get all in-progress tickets for selection
        const allTickets = await storage.listTickets();
        const inProgressTickets = allTickets.filter(t =>
          t.column && t.column.toLowerCase().includes('progress')
        );

        if (inProgressTickets.length === 0) {
          await storage.close();
          this.log(styles.info('No in-progress work found.'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select work to mark as ready for review:',
          choices: inProgressTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.column})`,
            value: t.id,
          })),
        }]);
        ticketId = selectedTicketId;
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Get board for columns
      const board = await storage.getBoard();

      // Find the "In Review" column (case-insensitive)
      const reviewColumn = board.columns.find(col =>
        col.name.toLowerCase().includes('review')
      );

      if (!reviewColumn) {
        await storage.close();
        this.error('No "In Review" column found in board configuration.');
      }

      const previousColumn = ticket.column;

      // Move to In Review column
      await storage.moveTicket(ticketId!, reviewColumn.name);

      // Auto-export to board.md if configured
      await autoExportToBoard(pmoPath, storage);

      await storage.close();

      this.log(styles.success(`👀 Work ready for review: ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   From: ${previousColumn}`));
      this.log(styles.muted(`   To: ${reviewColumn.name}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
