import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Complete extends PMOCommand {
  static description = 'Mark multiple tickets as complete (move to Done column)';

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
    const { flags } = await this.parse(Complete);

    this.log(colors.primary('✅ Complete Multiple Tickets\n'));

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    // Filter to only show incomplete tickets
    const incompleteTickets = allTickets.filter(t =>
      t.column && !t.column.toLowerCase().includes('done')
    );

    if (incompleteTickets.length === 0) {
      this.log(colors.success('All tickets are already complete!'));
      return;
    }

    // Get board for Done column
    const board = await this.storage.getBoard();
    const doneColumn = board.columns.find(col =>
      col.name.toLowerCase().includes('done')
    );

    if (!doneColumn) {
      this.error('No "Done" column found in board configuration.');
    }

    // Select tickets to complete
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to mark as COMPLETE:',
      choices: incompleteTickets.map(t => ({
        name: `${t.id} - ${t.title} (${t.column})`,
        value: t.id,
      })),
    }]);

    if (selectedTickets.length === 0) {
      this.log(colors.textMuted('No tickets selected.'));
      return;
    }

    // Confirmation
    if (!flags.force) {
      this.log(colors.text('\nWill mark as complete:'));
      for (const ticketId of selectedTickets) {
        const ticket = incompleteTickets.find(t => t.id === ticketId);
        this.log(colors.text(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log(colors.text(`  → Move to: ${doneColumn.name}\n`));

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '✅ Yes, complete tickets', value: true }
        ],
        default: 1
      }]);

      if (!confirm) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Complete each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        await this.storage.moveTicket(ticketId, doneColumn.name);
        this.log(format.success(`Completed ${ticketId}`));
        successCount++;
      } catch (error) {
        this.log(format.error(`Failed to complete ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(format.success(`Completed ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(format.error(`Failed to complete ${failCount} ticket(s)`));
    }
  }
}
