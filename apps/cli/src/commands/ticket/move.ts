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

export default class TicketMove extends PMOCommand {
  static description = 'Move ticket(s) to a different column';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-ticket "In Progress"',
    '<%= config.bin %> <%= command.id %> implement-auth Done',
    '<%= config.bin %> <%= command.id %> fix-bug "In Review" --position 0',
    '<%= config.bin %> <%= command.id %> --bulk',
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    position: Flags.integer({
      description: 'Position within the column (0 = top)',
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to move multiple tickets',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (bulk mode only)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketMove);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket move', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // This command requires project context - get projectId (with JSON mode support)
    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'ticket move',
        baseCommand: 'prlt ticket move',
      },
    });

    // Get all tickets
    const allTickets = await this.storage.listTickets(projectId);

    if (allTickets.length === 0) {
      return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".');
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(allTickets, flags.force, projectId);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      // Use helper for ticket selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select ticket to move:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket move ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      ticketId = selected;
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
      const project = await this.storage.getProjectBoard(projectId);
      if (!project) {
        this.error('Project not found.');
      }

      // Use helper for column selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Move to column:',
        items: project.columns as { name: string }[],
        getName: (col) => col.name === ticket.statusName ? `${col.name} (current)` : col.name,
        getValue: (col) => col.name,
        getCommand: (col) => `prlt ticket move ${ticketId} "${col.name}" --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      targetColumn = selected;
    }

    // Column validation happens in storage.moveTicket()

    // Check if actually moving
    if (targetColumn === ticket.statusName && flags.position === undefined) {
      this.log(styles.warning(`Ticket "${ticketId}" is already in "${targetColumn}".`));
      return;
    }

    // Move ticket (targetColumn is guaranteed to be string after validation above)
    const moved = await this.storage.moveTicket(projectId, ticketId!, targetColumn!, flags.position);

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

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    force: boolean,
    projectId: string
  ): Promise<void> {
    this.log(styles.emphasis('📦 Move Multiple Tickets\n'));

    // Get columns
    const board = await this.storage.getBoard(projectId);
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
      this.log(styles.muted('No tickets selected.'));
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
    if (!force) {
      this.log(styles.warning('\nThis will move:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log(styles.primary(`  → to column: ${targetColumn}\n`));

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, move tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(styles.muted('Move cancelled.'));
        return;
      }
    }

    this.log('');

    // Move each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        await this.storage.moveTicket(projectId, ticketId, targetColumn);
        this.log(styles.success(`Moved ${ticketId} to ${targetColumn}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to move ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(styles.success(`Moved ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to move ${failCount} ticket(s)`));
    }
  }
}
