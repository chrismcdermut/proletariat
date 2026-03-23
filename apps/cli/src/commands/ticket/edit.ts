import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { getWorkspacePriorities } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { multiLineInput } from '../../lib/multiline-input.js';
import { trackTicketOperation } from '../../lib/telemetry/analytics.js';

export default class TicketEdit extends PMOCommand {
  static description = 'Edit an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %> TICK-001 --title "New title"',
    '<%= config.bin %> <%= command.id %> TICK-001 --priority P1 --category bug',
    '<%= config.bin %> <%= command.id %> TICK-001 --add-subtask "Implement feature" --add-subtask "Write tests"',
    '<%= config.bin %> <%= command.id %> TICK-001 --owner "john" --assignee "agent-1"',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to edit - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'New ticket title',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New ticket description',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'New ticket priority (uses workspace priority scale, "none" to clear)',
    }),
    category: Flags.string({
      description: 'New ticket category',
    }),
    owner: Flags.string({
      char: 'o',
      description: 'Ticket owner (human responsible)',
    }),
    assignee: Flags.string({
      char: 'a',
      description: 'Ticket assignee (who executes)',
    }),
    'add-subtask': Flags.string({
      description: 'Add a subtask (can be used multiple times)',
      multiple: true,
    }),
    'clear-subtasks': Flags.boolean({
      description: 'Clear all existing subtasks before adding new ones',
      default: false,
    }),
    'add-label': Flags.string({
      description: 'Add a label (can be used multiple times)',
      multiple: true,
    }),
    'remove-label': Flags.string({
      description: 'Remove a label',
      multiple: true,
    }),
    'add-ac': Flags.string({
      description: 'Add an acceptance criterion (can be used multiple times)',
      multiple: true,
    }),
    'clear-ac': Flags.boolean({
      description: 'Clear all existing acceptance criteria before adding new ones',
      default: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompts for all fields',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketEdit);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket edit', flags));
        return
      }
      this.error(message);
    };

    // Get ticketId - prompt if not provided
    let ticketId = args.ticketId;

    if (!ticketId) {
      // Get all tickets for selection
      const allTickets = await this.storage.listTickets(projectId);

      if (allTickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".');
      }

      // Use helper for ticket selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select ticket to edit:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket edit ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket edit' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      ticketId = selected;
    }

    // Get current ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
    }
    // Use resolved internal ID for all subsequent operations (external keys like PRLT-xxx resolve to TKT-xxx)
    ticketId = ticket.id;

    // Determine what to update
    let updates: {
      title?: string;
      description?: string;
      priority?: string;
      category?: string;
      owner?: string;
      assignee?: string;
    } = {};

    const hasFlags = flags.title || flags.description || flags.priority || flags.category ||
      flags.owner || flags.assignee || flags['add-subtask'] || flags['clear-subtasks'] ||
      flags['add-label'] || flags['remove-label'] || flags['add-ac'] || flags['clear-ac'];

    if (flags.interactive || !hasFlags) {
      // In JSON mode without flags, output a form prompt instead of interactive prompts
      if (jsonMode) {
        const { outputPromptAsJson, buildFormPromptConfig } = await import('../../lib/prompt-json.js');
        const db = this.storage.getDatabase();
        const workspacePriorities = getWorkspacePriorities(db);
        const formConfig = buildFormPromptConfig([
          { type: 'input', name: 'title', message: 'Title:', default: ticket.title },
          { type: 'multiline', name: 'description', message: 'Description:', default: ticket.description || '' },
          { type: 'list', name: 'priority', message: 'Priority:', choices: [
            { name: 'None', value: '' },
            ...workspacePriorities.map(p => ({ name: p, value: p })),
          ], default: ticket.priority || '' },
          { type: 'input', name: 'category', message: 'Category:', default: ticket.category || '' },
        ]);
        formConfig.context = {
          hint: `Edit ticket with: prlt ticket edit ${ticketId} --title "..." --description "..." --priority P0 --json`,
          ticketId,
          currentValues: { title: ticket.title, description: ticket.description, priority: ticket.priority, category: ticket.category },
        };
        outputPromptAsJson(formConfig, createMetadata('ticket edit', flags));
        return;
      }

      // Interactive mode - prompt for all editable fields
      const board = ticket.projectId ? await this.storage.getProjectBoard(ticket.projectId) : null;
      const columns = board ? board.columns.map(col => col.name) : [];
      updates = await this.promptForEdits(ticket, columns);
    } else {
      // Use flag values
      if (flags.title) updates.title = flags.title;
      if (flags.description) updates.description = flags.description;
      if (flags.priority) {
        // 'none' clears the priority (sets to null in database), otherwise use the flag value
        // Type assertion needed because Ticket interface uses string | undefined, but storage accepts null
        updates.priority = flags.priority === 'none' ? (null as unknown as string | undefined) : flags.priority;
      }
      if (flags.category) updates.category = flags.category;
      if (flags.owner) updates.owner = flags.owner;
      if (flags.assignee) updates.assignee = flags.assignee;
    }

    // Handle subtasks - sequential for consistent ordering
    let subtasksChanged = false;
    if (flags['clear-subtasks']) {
      // Clear all subtasks first - get from ticket object
      for (const subtask of ticket.subtasks) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.removeSubtask(ticketId!, subtask.id);
      }
      subtasksChanged = true;
    }

    if (flags['add-subtask'] && flags['add-subtask'].length > 0) {
      for (const subtaskTitle of flags['add-subtask']) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.addSubtask(ticketId!, subtaskTitle);
      }
      subtasksChanged = true;
    }

    // Handle labels
    let labelsChanged = false;
    let currentLabels = [...ticket.labels];

    if (flags['remove-label'] && flags['remove-label'].length > 0) {
      currentLabels = currentLabels.filter(l => !flags['remove-label']!.includes(l));
      labelsChanged = true;
    }

    if (flags['add-label'] && flags['add-label'].length > 0) {
      for (const label of flags['add-label']) {
        if (!currentLabels.includes(label)) {
          currentLabels.push(label);
          labelsChanged = true;
        }
      }
    }

    // Handle acceptance criteria
    let acChanged = false;
    if (flags['clear-ac']) {
      await this.storage.clearAcceptanceCriteria(ticketId!);
      acChanged = true;
    }

    if (flags['add-ac'] && flags['add-ac'].length > 0) {
      // Sequential for consistent ordering
      for (const criterion of flags['add-ac']) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.addAcceptanceCriterion(ticketId!, criterion);
      }
      acChanged = true;
    }

    // Check if anything changed
    const hasChanges = Object.keys(updates).length > 0 || subtasksChanged || labelsChanged || acChanged;
    if (!hasChanges) {
      this.log(styles.muted('\nNo changes made.'));
      return;
    }

    // Update the ticket with labels if changed
    if (labelsChanged) {
      (updates as { labels?: string[] }).labels = currentLabels;
    }

    // Update the ticket
    const updateStart = Date.now();
    const updatedTicket = await this.storage.updateTicket(ticketId!, updates);
    trackTicketOperation({ operation: 'update', provider: 'pmo', durationMs: Date.now() - updateStart, success: true });

    // Auto-export to board.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // JSON output mode - match MCP tool response shape
    if (jsonMode) {
      // Re-fetch to get latest state including subtasks/AC changes
      const finalTicket = (subtasksChanged || acChanged)
        ? await this.storage.getTicket(ticketId!) ?? updatedTicket
        : updatedTicket;
      this.log(JSON.stringify({
        success: true,
        ticket: {
          id: finalTicket.id,
          title: finalTicket.title,
          priority: finalTicket.priority,
          category: finalTicket.category,
          statusName: finalTicket.statusName,
          statusCategory: finalTicket.statusCategory,
          projectId: finalTicket.projectId,
          assignee: finalTicket.assignee,
          owner: finalTicket.owner,
          branch: finalTicket.branch,
          epicId: finalTicket.epicId,
          position: finalTicket.position,
        },
      }, null, 2));
      return;
    }

    // Display updated ticket
    this.log(styles.success(`\n✅ Updated ticket ${styles.emphasis(updatedTicket.id)}`));

    const changedFields: string[] = [];
    if (updates.title) changedFields.push(`Title: ${updatedTicket.title}`);
    if (updates.description !== undefined) changedFields.push(`Description: ${updatedTicket.description || '(cleared)'}`);
    if (updates.priority !== undefined) changedFields.push(`Priority: ${updatedTicket.priority || 'none'}`);
    if (updates.category !== undefined) changedFields.push(`Category: ${updatedTicket.category || 'none'}`);
    if (updates.owner !== undefined) changedFields.push(`Owner: ${updatedTicket.owner || 'none'}`);
    if (updates.assignee !== undefined) changedFields.push(`Assignee: ${updatedTicket.assignee || 'none'}`);
    if (subtasksChanged || acChanged) {
      // Re-fetch ticket to get updated subtasks and AC
      const refreshedTicket = await this.storage.getTicket(ticketId!);
      if (subtasksChanged) {
        changedFields.push(`Subtasks: ${refreshedTicket?.subtasks.length || 0} items`);
      }
      if (acChanged) {
        changedFields.push(`Acceptance Criteria: ${refreshedTicket?.acceptanceCriteria?.length || 0} items`);
      }
    }
    if (labelsChanged) changedFields.push(`Labels: ${currentLabels.join(', ') || 'none'}`);

    for (const field of changedFields) {
      this.log(styles.muted(`   ${field}`));
    }

    this.log('');
  }

  private async promptForEdits(
    ticket: { title: string; description?: string; priority?: string; category?: string },
    _columns: string[]
  ): Promise<{
    title?: string;
    description?: string;
    priority?: string;
    category?: string;
  }> {
    // First prompt for title
    const { title } = await this.prompt<{ title: string }>([
      {
        type: 'input',
        name: 'title',
        message: 'Title:',
        default: ticket.title,
        validate: (input: unknown) => (input as string).trim() ? true : 'Title cannot be empty',
      },
    ], null);

    // Prompt for description using inline multiline input
    const descResult = await multiLineInput({
      message: 'Description:',
      default: ticket.description || '',
      hint: 'Ctrl+D to finish, Ctrl+C to cancel',
    });

    if (descResult.cancelled) {
      throw new Error('Edit cancelled');
    }

    // Continue with remaining prompts - priority first (using workspace scale)
    const db = this.storage.getDatabase();
    const workspacePriorities = getWorkspacePriorities(db);
    const { priority } = await this.prompt<{ priority: string }>([
      {
        type: 'list',
        name: 'priority',
        message: 'Priority:',
        choices: [
          { name: 'None', value: '' },
          ...workspacePriorities.map(p => ({ name: p, value: p })),
        ],
        default: ticket.priority || '',
      },
    ], null);

    // Then category
    const { categoryChoice } = await this.prompt<{ categoryChoice: string }>([
      {
        type: 'list',
        name: 'categoryChoice',
        message: 'Category:',
        choices: [
          { name: 'None', value: '' },
          new inquirer.Separator('── Conventional Commits ──'),
          { name: 'feature     - New feature or capability', value: 'feature' },
          { name: 'bug         - Bug fix', value: 'bug' },
          { name: 'refactor    - Code refactoring', value: 'refactor' },
          { name: 'docs        - Documentation', value: 'docs' },
          { name: 'test        - Test additions/fixes', value: 'test' },
          { name: 'chore       - Maintenance tasks', value: 'chore' },
          { name: 'performance - Performance improvements', value: 'performance' },
          { name: 'ci          - CI/CD changes', value: 'ci' },
          { name: 'build       - Build system changes', value: 'build' },
          new inquirer.Separator('── Extended Types ──'),
          { name: 'security    - Security fixes', value: 'security' },
          { name: 'database    - Database migrations', value: 'database' },
          { name: 'release     - Release preparation', value: 'release' },
          new inquirer.Separator('── 5Tool Founder ──'),
          { name: 'ship        - Shipping and deployment', value: 'ship' },
          { name: 'growth      - Growth and marketing', value: 'growth' },
          { name: 'support     - Customer experience', value: 'support' },
          { name: 'strategy    - Strategy and planning', value: 'strategy' },
          { name: 'ops         - Business operations', value: 'ops' },
          new inquirer.Separator('───────────────────'),
          { name: 'Custom...', value: '__custom__' },
        ],
        default: ticket.category || '',
      },
    ], null);

    // Custom category prompt if needed
    let customCategory: string | undefined;
    if (categoryChoice === '__custom__') {
      const result = await this.prompt<{ customCategory: string }>([{
        type: 'input',
        name: 'customCategory',
        message: 'Enter custom category:',
        validate: (input: unknown) => (input as string).trim() ? true : 'Category cannot be empty',
      }], null);
      customCategory = result.customCategory;
    }

    const answers = { priority, categoryChoice, customCategory };

    // Build updates object with only changed fields
    const updates: {
      title?: string;
      description?: string;
      priority?: string;
      category?: string;
    } = {};

    if (title !== ticket.title) {
      updates.title = title;
    }
    if (descResult.value !== (ticket.description || '')) {
      // Preserve empty string to allow clearing the description
      updates.description = descResult.value;
    }
    if (answers.priority !== (ticket.priority || '')) {
      updates.priority = answers.priority || undefined;
    }

    const newCategory = answers.categoryChoice === '__custom__'
      ? answers.customCategory
      : answers.categoryChoice;
    if (newCategory !== (ticket.category || '')) {
      updates.category = newCategory || undefined;
    }

    return updates;
  }
}
