import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Move extends PMOCommand {
  static description = 'Move multiple tickets to a different column';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(Move);

    this.log(colors.primary('📦 Move Multiple Tickets\n'));

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    if (allTickets.length === 0) {
      this.log(colors.warning('No tickets found.'));
      return;
    }

    // Get columns
    const board = await this.storage.getBoard();
    const columns = board.columns.map(col => col.name);

    // Select tickets to move
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to move:',
      choices: allTickets.map(t => ({
        name: `${t.id} - ${t.title} (${t.statusName})`,
        value: t.id,
      })),
    }]);

    if (selectedTickets.length === 0) {
      this.log(colors.textMuted('No tickets selected.'));
      return;
    }

    // Select target column
    const { targetColumn } = await inquirer.prompt([{
      type: 'list',
      name: 'targetColumn',
      message: 'Move selected tickets to:',
      choices: columns,
    }]);

    // Confirmation
    if (!flags.force) {
      this.log(colors.warning('\n⚠️  This will move:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(colors.text(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log(colors.text(`  → to column: ${targetColumn}\n`));

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Are you sure?',
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '✅ Yes, move tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(colors.textMuted('Move cancelled.'));
        return;
      }
    }

    this.log('');

    // Move each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        await this.storage.moveTicket(ticketId, targetColumn);
        this.log(format.success(`Moved ${ticketId} to ${targetColumn}`));
        successCount++;
      } catch (error) {
        this.log(format.error(`Failed to move ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(format.success(`Moved ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(format.error(`Failed to move ${failCount} ticket(s)`));
    }
  }
}
