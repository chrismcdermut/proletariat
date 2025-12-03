import { Command, Args } from '@oclif/core';
import inquirer from 'inquirer';
import {
  getPMOContext,
  autoExportToBoard,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketComplete extends Command {
  static description = 'Mark a ticket as complete (move to Done column)';

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

  async run(): Promise<void> {
    const { args } = await this.parse(TicketComplete);

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
        // Get all incomplete tickets for selection
        const allTickets = await storage.listTickets();
        const incompleteTickets = allTickets.filter(t =>
          t.column && !t.column.toLowerCase().includes('done')
        );

        if (incompleteTickets.length === 0) {
          await storage.close();
          this.log(styles.info('No incomplete tickets found. All tickets are done!'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to complete:',
          choices: incompleteTickets.map(t => ({
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

      // Find the "Done" column (case-insensitive)
      const doneColumn = board.columns.find(col =>
        col.name.toLowerCase().includes('done')
      );

      if (!doneColumn) {
        await storage.close();
        this.error('No "Done" column found in board configuration.');
      }

      // Move to Done column
      await storage.moveTicket(ticketId!, doneColumn.name);

      // Auto-export to board.md if configured
      await autoExportToBoard(pmoPath, storage);

      await storage.close();

      this.log(styles.success(`✅ Completed ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   Moved to: ${doneColumn.name}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

}
