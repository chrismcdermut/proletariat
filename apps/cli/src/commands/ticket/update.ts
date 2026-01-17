import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { PRIORITIES, PRIORITY_LABELS } from '../../lib/pmo/types.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TicketUpdate extends PMOCommand {
  static description = 'Update priority/category for ticket(s)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 --priority HIGH',
    '<%= config.bin %> <%= command.id %> TKT-001 --category bug',
    '<%= config.bin %> <%= command.id %> --bulk',
    '<%= config.bin %> <%= command.id %> --bulk --priority HIGH',
    '<%= config.bin %> <%= command.id %> --json  # Output choices as JSON',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Set priority (P0, P1, P2, P3)',
      options: [...PRIORITIES],
    }),
    category: Flags.string({
      char: 'c',
      description: 'Set category (e.g., feature, bug, refactor)',
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to update multiple tickets',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketUpdate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    if (allTickets.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TICKETS', 'No tickets found.', createMetadata('ticket update', flags));
        return;
      }
      this.log(styles.warning('No tickets found.'));
      return;
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(allTickets, flags);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      // In JSON mode, output ticket selection prompt
      if (jsonMode) {
        const ticketChoices = allTickets.map(t => ({
          name: `${t.id} - ${t.title}  [P:${t.priority || 'none'} C:${t.category || 'none'}]`,
          value: t.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'ticketId', 'Select ticket to update:', ticketChoices),
          createMetadata('ticket update', flags)
        );
        return;
      }

      const { selectedTicketId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicketId',
        message: 'Select ticket to update:',
        choices: allTickets.map(t => ({
          name: `${t.id} - ${t.title}  [P:${t.priority || 'none'} C:${t.category || 'none'}]`,
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
            { name: `(Keep existing: ${ticket.priority || 'none'})`, value: null },
            ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
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
            { name: `(Keep existing: ${ticket.category || 'none'})`, value: null },
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
      this.log(styles.muted('Nothing to update.'));
      return;
    }

    // Build changes
    const changes: { priority?: string; category?: string } = {};
    if (updatePriority !== undefined) {
      changes.priority = updatePriority || undefined;
    }
    if (updateCategory !== undefined) {
      changes.category = updateCategory || undefined;
    }

    // Update ticket
    await this.storage.updateTicket(ticketId!, changes);

    // Auto-export
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    const updates: string[] = [];
    if (updatePriority !== undefined) updates.push(`Priority: ${updatePriority || 'none'}`);
    if (updateCategory !== undefined) updates.push(`Category: ${updateCategory || 'none'}`);

    this.log(styles.success(`\n✅ Updated ticket ${styles.emphasis(ticketId!)}`));
    this.log(styles.muted(`   ${updates.join(', ')}`));
  }

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    flags: { priority?: string; category?: string; force: boolean }
  ): Promise<void> {
    this.log(styles.emphasis('✏️  Update Multiple Tickets\n'));

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
      this.log(styles.muted('No tickets selected.'));
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
            ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
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
      this.log(styles.muted('Nothing to update.'));
      return;
    }

    // Confirmation
    if (!flags.force) {
      this.log(styles.primary('\nWill update:'));
      if (updatePriority !== undefined) {
        this.log(styles.primary(`  Priority → ${updatePriority || '(clear)'}`));
      }
      if (updateCategory !== undefined) {
        this.log(styles.primary(`  Category → ${updateCategory || '(clear)'}`));
      }
      this.log(styles.primary('\nTickets:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log('');

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, update tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(styles.muted('Operation cancelled.'));
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
        this.log(styles.success(`${ticketId}: ${updates.join(', ')}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to update ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(styles.success(`Updated ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to update ${failCount} ticket(s)`));
    }
  }
}
