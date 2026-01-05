import { Command, Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import {
  getPMOContext,
  autoExportToBoard,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketMove extends Command {
  static description = 'Move a ticket to a different column';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-ticket "In Progress"',
    '<%= config.bin %> <%= command.id %> implement-auth Done',
    '<%= config.bin %> <%= command.id %> fix-bug "In Review" --position 0',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
    column: Args.string({
      description: 'Target column - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    position: Flags.integer({
      description: 'Position within the column (0 = top)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketMove);

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
        // Get all tickets for selection
        const allTickets = await storage.listTickets();

        if (allTickets.length === 0) {
          await storage.close();
          this.error('No tickets found. Create a ticket first with "prlt ticket create".');
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to move:',
          choices: allTickets.map(t => ({
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

      // Get target column - prompt if not provided
      let targetColumn = args.column;

      if (!targetColumn) {
        // Get columns from the database (not config.json) to ensure accuracy
        const project = await storage.getProjectBoard(storage.getCurrentProjectId());
        if (!project) {
          await storage.close();
          this.error('Project not found.');
        }

        const { column } = await inquirer.prompt([{
          type: 'list',
          name: 'column',
          message: `Move to column:`,
          choices: project.columns.map((col: { name: string }) => ({
            name: col.name === ticket.column ? `${col.name} (current)` : col.name,
            value: col.name,
          })),
          default: ticket.column,
        }]);
        targetColumn = column;
      }

      // Column validation happens in storage.moveTicket()

      // Check if actually moving
      if (targetColumn === ticket.column && flags.position === undefined) {
        await storage.close();
        this.log(styles.warning(`Ticket "${ticketId}" is already in "${targetColumn}".`));
        return;
      }

      // Move ticket (targetColumn is guaranteed to be string after validation above)
      const moved = await storage.moveTicket(ticketId!, targetColumn!, flags.position);

      // Auto-export to board.md after write
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

      await storage.close();

      this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(moved.id)}`));
      if (targetColumn !== ticket.column) {
        this.log(styles.muted(`   From: ${ticket.column}`));
        this.log(styles.muted(`   To: ${moved.column}`));
      }
      if (flags.position !== undefined) {
        this.log(styles.muted(`   Position: ${flags.position}`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

}
