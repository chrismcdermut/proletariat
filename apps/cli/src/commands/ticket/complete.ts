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

export default class TicketComplete extends PMOCommand {
  static description = 'Mark ticket(s) as complete (move to Done column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %> --bulk',
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
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to complete multiple tickets',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (bulk mode only)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketComplete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket complete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get all incomplete tickets
    const allTickets = await this.storage.listTickets();
    const incompleteTickets = allTickets.filter(t =>
      t.statusName && !t.statusName.toLowerCase().includes('done')
    );

    if (incompleteTickets.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_INCOMPLETE_TICKETS', 'No incomplete tickets found. All tickets are done!', createMetadata('ticket complete', flags));
        return;
      }
      this.log(styles.info('No incomplete tickets found. All tickets are done!'));
      return;
    }

    // Get board for columns
    const board = await this.storage.getBoard();

    // Find the "Done" column (case-insensitive)
    const doneColumn = board.columns.find(col =>
      col.name.toLowerCase().includes('done')
    );

    if (!doneColumn) {
      return handleError('NO_DONE_COLUMN', 'No "Done" column found in board configuration.');
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(incompleteTickets, doneColumn.name, flags.force);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      // In JSON mode, output ticket selection prompt
      if (jsonMode) {
        const ticketChoices = incompleteTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'ticketId', 'Select ticket to complete:', ticketChoices),
          createMetadata('ticket complete', flags)
        );
        return;
      }

      const { selectedTicketId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicketId',
        message: 'Select ticket to complete:',
        choices: incompleteTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
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

    // Move to Done column
    await this.storage.moveTicket(ticketId!, doneColumn.name);

    // Auto-export to board.md if configured
    await autoExportToBoard(this.pmoPath, this.storage);

    this.log(styles.success(`✅ Completed ${ticketId}`));
    this.log(styles.muted(`   Title: ${ticket.title}`));
    this.log(styles.muted(`   Moved to: ${doneColumn.name}`));
  }

  private async executeBulk(
    incompleteTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    doneColumnName: string,
    force: boolean
  ): Promise<void> {
    this.log(styles.emphasis('✅ Complete Multiple Tickets\n'));

    // Select tickets to complete
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to mark as COMPLETE:',
      choices: incompleteTickets.map(t => ({
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
      this.log(styles.primary('\nWill mark as complete:'));
      for (const ticketId of selectedTickets) {
        const ticket = incompleteTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log(styles.primary(`  → Move to: ${doneColumnName}\n`));

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, complete tickets', value: true }
        ],
        default: 1
      }]);

      if (!confirm) {
        this.log(styles.muted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Complete each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        await this.storage.moveTicket(ticketId, doneColumnName);
        this.log(styles.success(`Completed ${ticketId}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to complete ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(styles.success(`Completed ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to complete ${failCount} ticket(s)`));
    }
  }
}
