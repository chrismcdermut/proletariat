import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import {
  autoExportToBoard,
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketMove extends PMOCommand {
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
    ...pmoBaseFlags,
    position: Flags.integer({
      description: 'Position within the column (0 = top)',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketMove);
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
        message: 'Select ticket to move:',
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

    // Get target column - prompt if not provided
    let targetColumn = args.column;

    if (!targetColumn) {
      // Get columns from the database (not config.json) to ensure accuracy
      const project = await this.storage.getProjectBoard(this.storage.getCurrentProjectId());
      if (!project) {
        this.error('Project not found.');
      }

      const { column } = await inquirer.prompt([{
        type: 'list',
        name: 'column',
        message: `Move to column:`,
        choices: project.columns.map((col: { name: string }) => ({
          name: col.name === ticket.statusName ? `${col.name} (current)` : col.name,
          value: col.name,
        })),
        default: ticket.statusName,
      }]);
      targetColumn = column;
    }

    // Column validation happens in storage.moveTicket()

    // Check if actually moving
    if (targetColumn === ticket.statusName && flags.position === undefined) {
      this.log(styles.warning(`Ticket "${ticketId}" is already in "${targetColumn}".`));
      return;
    }

    // Move ticket (targetColumn is guaranteed to be string after validation above)
    const moved = await this.storage.moveTicket(ticketId!, targetColumn!, flags.position);

    // Auto-export to board.md after write
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(moved.id)}`));
    if (targetColumn !== ticket.statusName) {
      this.log(styles.muted(`   From: ${ticket.statusName}`));
      this.log(styles.muted(`   To: ${moved.statusName}`));
    }
    if (flags.position !== undefined) {
      this.log(styles.muted(`   Position: ${flags.position}`));
    }
  }

}
