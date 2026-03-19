import { readFileSync } from 'node:fs';
import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { getWorkspacePriorities } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { formatTicket } from '../../lib/mcp/helpers.js';

export default class TicketUpdate extends PMOCommand {
  static description = 'Update ticket fields (title, description, priority, category, labels, status)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 --title "New title"',
    '<%= config.bin %> <%= command.id %> TKT-001 --description "Updated description"',
    '<%= config.bin %> <%= command.id %> TKT-001 --description-file ./spec.md',
    '<%= config.bin %> <%= command.id %> TKT-001 --priority P1',
    '<%= config.bin %> <%= command.id %> TKT-001 --category bug',
    '<%= config.bin %> <%= command.id %> TKT-001 --labels frontend,urgent',
    '<%= config.bin %> <%= command.id %> TKT-001 --status "In Progress"',
    '<%= config.bin %> <%= command.id %> TKT-001 --title "Fix auth" --priority P0 --status "In Progress" --json',
    '<%= config.bin %> <%= command.id %> --bulk --priority P1',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'Set ticket title',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Set ticket description',
    }),
    'description-file': Flags.string({
      description: 'Read ticket description from a file',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Set priority (uses workspace priority scale, "none" to clear)',
    }),
    category: Flags.string({
      char: 'c',
      description: 'Set category (e.g., feature, bug, refactor, "none" to clear)',
    }),
    labels: Flags.string({
      char: 'l',
      description: 'Set labels (comma-separated, replaces existing labels; use "" to clear)',
    }),
    status: Flags.string({
      char: 's',
      description: 'Set status/column (e.g., "In Progress", "Done")',
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
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket update', flags));
        return;
      }
      this.error(message);
    };

    // Validate --description and --description-file are not both provided
    if (flags.description !== undefined && flags['description-file'] !== undefined) {
      return handleError('INVALID_FLAGS', 'Cannot use both --description and --description-file.');
    }

    // Get all tickets
    const allTickets = await this.storage.listTickets(projectId);

    if (allTickets.length === 0) {
      return handleError('NO_TICKETS', 'No tickets found.');
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(allTickets, flags);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      const selected = await this.selectFromList({
        message: 'Select ticket to update:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket update ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket update' } : null,
      });

      if (!selected) {
        return;
      }
      ticketId = selected;
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
    }

    // Check if any flags were provided
    const hasFlags = flags.title !== undefined || flags.description !== undefined ||
      flags['description-file'] !== undefined || flags.priority !== undefined ||
      flags.category !== undefined || flags.labels !== undefined ||
      flags.status !== undefined;

    if (!hasFlags) {
      // No flags provided - fall back to interactive priority/category selection
      await this.executeInteractive(ticketId!, ticket, projectId, jsonMode, flags);
      return;
    }

    // Build changes from flags
    const changes: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (flags.title !== undefined) {
      changes.title = flags.title;
      changedFields.push(`Title: ${flags.title}`);
    }

    // Handle description (--description or --description-file)
    if (flags['description-file'] !== undefined) {
      try {
        const content = readFileSync(flags['description-file'], 'utf-8');
        changes.description = content;
        changedFields.push(`Description: (from file ${flags['description-file']})`);
      } catch (error) {
        return handleError('FILE_READ_ERROR', `Failed to read description file "${flags['description-file']}": ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (flags.description !== undefined) {
      changes.description = flags.description;
      changedFields.push(`Description: ${flags.description.length > 60 ? flags.description.slice(0, 60) + '...' : flags.description}`);
    }

    if (flags.priority !== undefined) {
      changes.priority = flags.priority === 'none' ? null : flags.priority;
      changedFields.push(`Priority: ${flags.priority === 'none' ? 'none' : flags.priority}`);
    }

    if (flags.category !== undefined) {
      changes.category = flags.category === 'none' ? undefined : flags.category;
      changedFields.push(`Category: ${flags.category === 'none' ? 'none' : flags.category}`);
    }

    if (flags.labels !== undefined) {
      const labelList = flags.labels === '' ? [] : flags.labels.split(',').map(l => l.trim()).filter(Boolean);
      changes.labels = labelList;
      changedFields.push(`Labels: ${labelList.length > 0 ? labelList.join(', ') : 'none'}`);
    }

    // Apply field changes (everything except status)
    if (Object.keys(changes).length > 0) {
      await this.storage.updateTicket(ticketId!, changes);
    }

    // Handle status change separately via provider
    if (flags.status !== undefined) {
      const provider = await this.resolveTicketProvider(ticketId!, ticket.projectId || '');
      const moveResult = await provider.moveTicket(ticketId!, flags.status);

      if (!moveResult.success) {
        return handleError('STATUS_CHANGE_FAILED', `Failed to change status to "${flags.status}": ${moveResult.error}`);
      }
      changedFields.push(`Status: ${flags.status}`);
    }

    // Auto-export
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Refresh ticket for output
    const updatedTicket = await this.storage.getTicket(ticketId!) || ticket;

    // JSON output mode
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        ticket: formatTicket(updatedTicket),
      }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Updated ticket ${styles.emphasis(ticketId!)}`));
    for (const field of changedFields) {
      this.log(styles.muted(`   ${field}`));
    }
  }

  /**
   * Interactive mode when no flags are provided - original priority/category selection flow
   */
  private async executeInteractive(
    ticketId: string,
    ticket: Awaited<ReturnType<typeof this.storage.getTicket>>,
    projectId: string | undefined,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    const jsonModeConfig = jsonMode ? { flags, commandName: 'ticket update' } : null;
    const { updateType } = await this.prompt<{ updateType: string }>([{
      type: 'list',
      name: 'updateType',
      message: 'What would you like to update?',
      choices: [
        { name: 'Priority', value: 'priority', command: `prlt ticket update ${ticketId} --priority <P0|P1|P2|P3>${projectId ? ` -P ${projectId}` : ''} --json` },
        { name: 'Category', value: 'category', command: `prlt ticket update ${ticketId} --category <category>${projectId ? ` -P ${projectId}` : ''} --json` },
        { name: 'Both', value: 'both', command: `prlt ticket update ${ticketId} --priority <P0|P1|P2|P3> --category <category>${projectId ? ` -P ${projectId}` : ''} --json` },
      ],
    }], jsonModeConfig);

    let updatePriority: string | undefined;
    let updateCategory: string | undefined;

    if (updateType === 'priority' || updateType === 'both') {
      const db = this.storage.getDatabase();
      const workspacePriorities = getWorkspacePriorities(db);
      const { priority } = await this.prompt<{ priority: string | null }>([{
        type: 'list',
        name: 'priority',
        message: 'Set priority to:',
        choices: [
          { name: `(Keep existing: ${ticket!.priority || 'none'})`, value: null, command: '' },
          ...workspacePriorities.map(p => ({ name: p, value: p, command: `prlt ticket update ${ticketId} --priority ${p}${projectId ? ` -P ${projectId}` : ''} --json` })),
          { name: 'None (clear priority)', value: '', command: `prlt ticket update ${ticketId} --priority none${projectId ? ` -P ${projectId}` : ''} --json` },
        ],
      }], jsonModeConfig);
      if (priority !== null) {
        updatePriority = priority;
      }
    }

    if (updateType === 'category' || updateType === 'both') {
      const { categoryChoice } = await this.prompt<{ categoryChoice: string | null }>([{
        type: 'list',
        name: 'categoryChoice',
        message: 'Set category to:',
        choices: [
          { name: `(Keep existing: ${ticket!.category || 'none'})`, value: null, command: '' },
          { name: 'feature', value: 'feature', command: `prlt ticket update ${ticketId} --category feature${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'bug', value: 'bug', command: `prlt ticket update ${ticketId} --category bug${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'refactor', value: 'refactor', command: `prlt ticket update ${ticketId} --category refactor${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'docs', value: 'docs', command: `prlt ticket update ${ticketId} --category docs${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'test', value: 'test', command: `prlt ticket update ${ticketId} --category test${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'chore', value: 'chore', command: `prlt ticket update ${ticketId} --category chore${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'None (clear category)', value: '', command: `prlt ticket update ${ticketId} --category none${projectId ? ` -P ${projectId}` : ''} --json` },
          { name: 'Custom...', value: '__custom__', command: `prlt ticket update ${ticketId} --category <category>${projectId ? ` -P ${projectId}` : ''} --json` },
        ],
      }], jsonModeConfig);

      if (categoryChoice === '__custom__') {
        const { customCategory } = await this.prompt<{ customCategory: string }>([{
          type: 'input',
          name: 'customCategory',
          message: 'Enter custom category:',
          validate: (input: unknown) => (input as string).length > 0 || 'Category is required',
        }], jsonModeConfig);
        updateCategory = customCategory;
      } else if (categoryChoice !== null) {
        updateCategory = categoryChoice;
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
    await this.storage.updateTicket(ticketId, changes);

    // Auto-export
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    const updates: string[] = [];
    if (updatePriority !== undefined) updates.push(`Priority: ${updatePriority || 'none'}`);
    if (updateCategory !== undefined) updates.push(`Category: ${updateCategory || 'none'}`);

    this.log(styles.success(`\n✅ Updated ticket ${styles.emphasis(ticketId)}`));
    this.log(styles.muted(`   ${updates.join(', ')}`));
  }

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    flags: { priority?: string; category?: string; force: boolean; json?: boolean }
  ): Promise<void> {
    const jsonMode = shouldOutputJson(flags);
    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'ticket update' } : null;
    this.log(styles.emphasis('✏️  Update Multiple Tickets\n'));

    // Select tickets to update
    const { selectedTickets } = await this.prompt<{ selectedTickets: string[] }>([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to update:',
      choices: allTickets.map(t => ({
        name: `${t.id} - ${t.title}  [P:${t.priority || 'none'} C:${t.category || 'none'}]`,
        value: t.id,
      })),
    }], jsonModeConfig);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Determine what to update
    let updatePriority = flags.priority;
    let updateCategory = flags.category;

    if (!updatePriority && !updateCategory) {
      // Ask what to update
      const { updateType } = await this.prompt<{ updateType: string }>([{
        type: 'list',
        name: 'updateType',
        message: 'What would you like to update?',
        choices: [
          { name: 'Priority', value: 'priority', command: 'prlt ticket update --bulk --priority <P0|P1|P2|P3> --json' },
          { name: 'Category', value: 'category', command: 'prlt ticket update --bulk --category <category> --json' },
          { name: 'Both', value: 'both', command: 'prlt ticket update --bulk --priority <P0|P1|P2|P3> --category <category> --json' },
        ],
      }], jsonModeConfig);

      if (updateType === 'priority' || updateType === 'both') {
        const db = this.storage.getDatabase();
        const bulkWorkspacePriorities = getWorkspacePriorities(db);
        const { priority } = await this.prompt<{ priority: string | null }>([{
          type: 'list',
          name: 'priority',
          message: 'Set priority to:',
          choices: [
            { name: '(Keep existing)', value: null, command: '' },
            ...bulkWorkspacePriorities.map(p => ({ name: p, value: p, command: `prlt ticket update --bulk --priority ${p} --json` })),
            { name: 'None (clear priority)', value: '', command: 'prlt ticket update --bulk --priority none --json' },
          ],
        }], jsonModeConfig);
        if (priority !== null) {
          updatePriority = priority;
        }
      }

      if (updateType === 'category' || updateType === 'both') {
        const { categoryChoice } = await this.prompt<{ categoryChoice: string | null }>([{
          type: 'list',
          name: 'categoryChoice',
          message: 'Set category to:',
          choices: [
            { name: '(Keep existing)', value: null, command: '' },
            { name: 'feature', value: 'feature', command: 'prlt ticket update --bulk --category feature --json' },
            { name: 'bug', value: 'bug', command: 'prlt ticket update --bulk --category bug --json' },
            { name: 'refactor', value: 'refactor', command: 'prlt ticket update --bulk --category refactor --json' },
            { name: 'docs', value: 'docs', command: 'prlt ticket update --bulk --category docs --json' },
            { name: 'test', value: 'test', command: 'prlt ticket update --bulk --category test --json' },
            { name: 'chore', value: 'chore', command: 'prlt ticket update --bulk --category chore --json' },
            { name: 'None (clear category)', value: '', command: 'prlt ticket update --bulk --category none --json' },
            { name: 'Custom...', value: '__custom__', command: 'prlt ticket update --bulk --category <category> --json' },
          ],
        }], jsonModeConfig);

        if (categoryChoice === '__custom__') {
          const { customCategory } = await this.prompt<{ customCategory: string }>([{
            type: 'input',
            name: 'customCategory',
            message: 'Enter custom category:',
            validate: (input: unknown) => (input as string).length > 0 || 'Category is required',
          }], jsonModeConfig);
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

      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, cancel', value: false, command: '' },
          { name: 'Yes, update tickets', value: true, command: 'prlt ticket update --bulk --force --json' }
        ],
        default: 0
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Update each ticket
    let successCount = 0;
    let failCount = 0;

    // Process sequentially for clear success/failure logging
    for (const ticketId of selectedTickets) {
      try {
        const changes: { priority?: string; category?: string } = {};
        if (updatePriority !== undefined) {
          changes.priority = updatePriority || undefined;
        }
        if (updateCategory !== undefined) {
          changes.category = updateCategory || undefined;
        }

        // eslint-disable-next-line no-await-in-loop
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
