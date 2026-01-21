import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import {
  autoExportToBoard,
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TicketDelete extends PMOCommand {
  static description = 'Delete ticket(s) permanently';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %> TICK-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --bulk',
    '<%= config.bin %> <%= command.id %> --json  # Output choices as JSON',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to delete - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to delete multiple tickets',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketDelete);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get all tickets for selection
    const allTickets = await this.storage.listTickets(projectId);

    if (allTickets.length === 0) {
      return handleError('NO_TICKETS', 'No tickets found.');
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(allTickets, flags.force);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      // Use helper for ticket selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select ticket to delete:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket delete ${t.id} --force --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket delete' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      ticketId = selected;
    }

    // Get ticket to show details in confirmation
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`);
    }

    // Get board for project name
    const board = await this.storage.getBoard(ticket.projectId!);

    // Confirmation prompt (unless --force)
    if (!flags.force) {
      this.log(`\nDelete ticket ${styles.emphasis(ticketId)}?`);
      this.log(`  Title: ${ticket.title}`);
      this.log(`  Project: ${board.name}`);
      this.log(`  Status: ${ticket.statusName}`);

      const { confirmed } = await inquirer.prompt([{
        type: 'list',
        name: 'confirmed',
        message: 'Are you sure?',
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, delete', value: true },
        ],
        default: 0,
      }]);

      if (!confirmed) {
        this.log(styles.warning('Deletion cancelled.'));
        return;
      }
    }

    // Delete ticket
    await this.storage.deleteTicket(ticketId!);

    // Auto-export to board.md after write
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Ticket ${styles.emphasis(ticketId)} deleted`));
    this.log(styles.muted('   Removed from database and board'));
  }

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    force: boolean
  ): Promise<void> {
    this.log(styles.emphasis('🗑️  Delete Multiple Tickets\n'));

    // Select tickets to delete
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to DELETE:',
      choices: allTickets.map(t => ({
        name: `${t.id} - ${t.title} (${t.statusName})`,
        value: t.id,
      })),
    }]);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Confirmation
    if (!force) {
      this.log(styles.warning('\nThis will PERMANENTLY DELETE:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log('');

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Are you sure? This cannot be undone.',
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, DELETE tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(styles.muted('Deletion cancelled.'));
        return;
      }
    }

    this.log('');

    // Delete each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        await this.storage.deleteTicket(ticketId);
        this.log(styles.success(`Deleted ${ticketId}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to delete ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(styles.success(`Deleted ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to delete ${failCount} ticket(s)`));
    }
  }
}
