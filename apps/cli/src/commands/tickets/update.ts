import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Update extends PMOCommand {
  static description = 'Update priority/category for multiple tickets';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --priority HIGH',
    '<%= config.bin %> <%= command.id %> --category feature',
  ];

  static flags = {
    ...pmoBaseFlags,
    priority: Flags.string({
      char: 'p',
      description: 'Set priority (URGENT, HIGH, MEDIUM, LOW)',
      options: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
    }),
    category: Flags.string({
      char: 'c',
      description: 'Set category (e.g., feature, bug, refactor)',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(Update);

    this.log(colors.primary('✏️  Update Multiple Tickets\n'));

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    if (allTickets.length === 0) {
      this.log(colors.warning('No tickets found.'));
      return;
    }

    // Select tickets to update
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to update:',
      choices: allTickets.map(t => ({
        name: `${t.id} - ${t.title}  [P:${t.priority || 'none'} C:${t.category || 'none'}]`,
        value: t.id,
      })),
    }]);

    if (selectedTickets.length === 0) {
      this.log(colors.textMuted('No tickets selected.'));
      return;
    }

    // Determine what to update
    let updatePriority = flags.priority;
    let updateCategory = flags.category;

    if (!updatePriority && !updateCategory) {
      // Ask what to update
      const { updateType } = await inquirer.prompt([{
        type: 'list',
        name: 'updateType',
        message: 'What would you like to update?',
        choices: [
          { name: 'Priority', value: 'priority' },
          { name: 'Category', value: 'category' },
          { name: 'Both', value: 'both' },
        ],
      }]);

      if (updateType === 'priority' || updateType === 'both') {
        const { priority } = await inquirer.prompt([{
          type: 'list',
          name: 'priority',
          message: 'Set priority to:',
          choices: [
            { name: '(Keep existing)', value: null },
            { name: 'URGENT', value: 'URGENT' },
            { name: 'HIGH', value: 'HIGH' },
            { name: 'MEDIUM', value: 'MEDIUM' },
            { name: 'LOW', value: 'LOW' },
            { name: 'None (clear priority)', value: '' },
          ],
        }]);
        if (priority !== null) {
          updatePriority = priority;
        }
      }

      if (updateType === 'category' || updateType === 'both') {
        const { categoryChoice } = await inquirer.prompt([{
          type: 'list',
          name: 'categoryChoice',
          message: 'Set category to:',
          choices: [
            { name: '(Keep existing)', value: null },
            { name: 'feature', value: 'feature' },
            { name: 'bug', value: 'bug' },
            { name: 'refactor', value: 'refactor' },
            { name: 'docs', value: 'docs' },
            { name: 'test', value: 'test' },
            { name: 'chore', value: 'chore' },
            { name: 'None (clear category)', value: '' },
            { name: 'Custom...', value: '__custom__' },
          ],
        }]);

        if (categoryChoice === '__custom__') {
          const { customCategory } = await inquirer.prompt([{
            type: 'input',
            name: 'customCategory',
            message: 'Enter custom category:',
            validate: (input: string) => input.length > 0 || 'Category is required',
          }]);
          updateCategory = customCategory;
        } else if (categoryChoice !== null) {
          updateCategory = categoryChoice;
        }
      }
    }

    // Check if anything to update
    if (updatePriority === undefined && updateCategory === undefined) {
      this.log(colors.textMuted('Nothing to update.'));
      return;
    }

    // Confirmation
    if (!flags.force) {
      this.log(colors.text('\nWill update:'));
      if (updatePriority !== undefined) {
        this.log(colors.text(`  Priority → ${updatePriority || '(clear)'}`));
      }
      if (updateCategory !== undefined) {
        this.log(colors.text(`  Category → ${updateCategory || '(clear)'}`));
      }
      this.log(colors.text('\nTickets:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(colors.text(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log('');

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '✅ Yes, update tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Update each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        const changes: { priority?: string; category?: string } = {};
        if (updatePriority !== undefined) {
          changes.priority = updatePriority || undefined;
        }
        if (updateCategory !== undefined) {
          changes.category = updateCategory || undefined;
        }

        await this.storage.updateTicket(ticketId, changes);

        const updates: string[] = [];
        if (updatePriority !== undefined) updates.push(`P:${updatePriority || 'none'}`);
        if (updateCategory !== undefined) updates.push(`C:${updateCategory || 'none'}`);
        this.log(format.success(`${ticketId}: ${updates.join(', ')}`));
        successCount++;
      } catch (error) {
        this.log(format.error(`Failed to update ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(format.success(`Updated ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(format.error(`Failed to update ${failCount} ticket(s)`));
    }
  }
}
