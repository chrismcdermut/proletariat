import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketEdit extends PMOCommand {
  static description = 'Edit an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %> TICK-001 --title "New title"',
    '<%= config.bin %> <%= command.id %> TICK-001 --priority HIGH --category bug',
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
      description: 'New ticket priority',
      options: ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'none'],
    }),
    category: Flags.string({
      description: 'New ticket category',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompts for all fields',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketEdit);

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
        message: 'Select ticket to edit:',
        choices: allTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.column})`,
          value: t.id,
        })),
      }]);
      ticketId = selectedTicketId;
    }

    // Get current ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`);
    }

    // Determine what to update
    let updates: {
      title?: string;
      description?: string;
      priority?: string;
      category?: string;
    } = {};

    const hasFlags = flags.title || flags.description || flags.priority || flags.category;

    if (flags.interactive || !hasFlags) {
      // Interactive mode - prompt for all editable fields
      updates = await this.promptForEdits(ticket, this.columns);
    } else {
      // Use flag values
      if (flags.title) updates.title = flags.title;
      if (flags.description) updates.description = flags.description;
      if (flags.priority) {
        updates.priority = flags.priority === 'none' ? undefined : flags.priority;
      }
      if (flags.category) updates.category = flags.category;
    }

    // Check if anything changed
    const hasChanges = Object.keys(updates).length > 0;
    if (!hasChanges) {
      this.log(styles.muted('\nNo changes made.'));
      return;
    }

    // Update the ticket
    const updatedTicket = await this.storage.updateTicket(ticketId!, updates);

    // Auto-export to board.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Display updated ticket
    this.log(styles.success(`\n✅ Updated ticket ${styles.emphasis(updatedTicket.id)}`));

    const changedFields: string[] = [];
    if (updates.title) changedFields.push(`Title: ${updatedTicket.title}`);
    if (updates.description !== undefined) changedFields.push(`Description: ${updatedTicket.description || '(cleared)'}`);
    if (updates.priority !== undefined) changedFields.push(`Priority: ${updatedTicket.priority || 'none'}`);
    if (updates.category !== undefined) changedFields.push(`Category: ${updatedTicket.category || 'none'}`);

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
    const answers = await inquirer.prompt<{
      title: string;
      description: string;
      priority: string;
      categoryChoice: string;
      customCategory?: string;
    }>([
      {
        type: 'input',
        name: 'title',
        message: 'Title:',
        default: ticket.title,
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
      {
        type: 'editor',
        name: 'description',
        message: 'Description (opens $EDITOR for multiline input):',
        default: ticket.description || '',
        waitForUseInput: false,
      },
      {
        type: 'list',
        name: 'priority',
        message: 'Priority:',
        choices: [
          { name: 'None', value: '' },
          { name: 'URGENT', value: 'URGENT' },
          { name: 'HIGH', value: 'HIGH' },
          { name: 'MEDIUM', value: 'MEDIUM' },
          { name: 'LOW', value: 'LOW' },
        ],
        default: ticket.priority || '',
      },
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
      {
        type: 'input',
        name: 'customCategory',
        message: 'Enter custom category:',
        when: (answers: { categoryChoice: string }) => answers.categoryChoice === '__custom__',
        validate: (input: string) => input.length > 0 || 'Category is required when choosing custom',
      },
    ]);

    // Build updates object with only changed fields
    const updates: {
      title?: string;
      description?: string;
      priority?: string;
      category?: string;
    } = {};

    if (answers.title !== ticket.title) {
      updates.title = answers.title;
    }
    if (answers.description !== (ticket.description || '')) {
      updates.description = answers.description || undefined;
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
