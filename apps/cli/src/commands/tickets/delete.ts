import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Delete extends Command {
  static description = 'Delete multiple tickets permanently';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Delete);

    this.log(colors.primary('🗑️  Delete Multiple Tickets\n'));

    // Get PMO context (prompts for project if multiple exist)
    const { pmoPath, storage, projectName } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all tickets
      const allTickets = await storage.listTickets();

      if (allTickets.length === 0) {
        await storage.close();
        this.log(colors.warning('No tickets found.'));
        return;
      }

      // Select tickets to delete
      const { selectedTickets } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedTickets',
        message: 'Select tickets to DELETE:',
        choices: allTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.column})`,
          value: t.id,
        })),
      }]);

      if (selectedTickets.length === 0) {
        await storage.close();
        this.log(colors.textMuted('No tickets selected.'));
        return;
      }

      // Confirmation
      if (!flags.force) {
        this.log(colors.warning('\n⚠️  This will PERMANENTLY DELETE:'));
        for (const ticketId of selectedTickets) {
          const ticket = allTickets.find(t => t.id === ticketId);
          this.log(colors.text(`  • ${ticketId}: ${ticket?.title}`));
        }
        this.log('');

        const { confirm } = await inquirer.prompt([{
          type: 'list',
          name: 'confirm',
          message: 'Are you sure? This cannot be undone.',
          choices: [
            { name: '❌ No, cancel', value: false },
            { name: '⚠️  Yes, DELETE tickets', value: true }
          ],
          default: 0
        }]);

        if (!confirm) {
          await storage.close();
          this.log(colors.textMuted('Deletion cancelled.'));
          return;
        }
      }

      this.log('');

      // Delete each ticket
      let successCount = 0;
      let failCount = 0;

      for (const ticketId of selectedTickets) {
        try {
          await storage.deleteTicket(ticketId);
          this.log(format.success(`Deleted ${ticketId}`));
          successCount++;
        } catch (error) {
          this.log(format.error(`Failed to delete ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
          failCount++;
        }
      }

      // Auto-export to kanban.md
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      // Summary
      this.log('');
      if (successCount > 0) {
        this.log(format.success(`Deleted ${successCount} ticket(s)`));
      }
      if (failCount > 0) {
        this.log(format.error(`Failed to delete ${failCount} ticket(s)`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
