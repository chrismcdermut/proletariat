import { Args, Flags } from '@oclif/core';
import {
  autoExportToBoard,
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { formatTicket } from '../../lib/mcp/helpers.js';

export default class TicketCancel extends PMOCommand {
  static description = 'Cancel ticket(s) (move to Canceled column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
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
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to cancel multiple tickets',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (bulk mode only)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketCancel);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket cancel', flags));
        return
      }
      this.error(message);
    };

    // Get all active tickets (not already canceled or done)
    const allTickets = await this.storage.listTickets(projectId);
    const activeTickets = allTickets.filter(t =>
      t.statusName &&
      !t.statusName.toLowerCase().includes('cancel') &&
      !t.statusName.toLowerCase().includes('done')
    );

    if (activeTickets.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_ACTIVE_TICKETS', 'No active tickets found to cancel.', createMetadata('ticket cancel', flags));
        return;
      }
      this.log(styles.info('No active tickets found to cancel.'));
      return;
    }

    // Get board for columns (use the first active ticket's project)
    const board = await this.storage.getProjectBoard(activeTickets[0].projectId!);
    if (!board) {
      return handleError('PROJECT_NOT_FOUND', `Project "${activeTickets[0].projectId}" not found. The ticket may belong to an orphaned project.`);
    }

    // Find the "Canceled" column (case-insensitive, match both "Canceled" and "Cancelled")
    const canceledColumn = board.columns.find(col =>
      col.name.toLowerCase().includes('cancel')
    );

    if (!canceledColumn) {
      return handleError('NO_CANCELED_COLUMN', 'No "Canceled" column found in board configuration.');
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(activeTickets, canceledColumn.name, flags);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      const selected = await this.selectFromList({
        message: 'Select ticket to cancel:',
        items: activeTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket cancel ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket cancel' } : null,
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
    // Use resolved internal ID for all subsequent operations (external keys like PRLT-xxx resolve to TKT-xxx)
    ticketId = ticket.id;

    // Move to Canceled column through provider (routes to Linear/Jira/PMO as appropriate)
    const provider = await this.resolveTicketProvider(ticketId!, ticket.projectId!);
    const moveResult = await provider.moveTicket(ticketId!, canceledColumn.name);

    if (!moveResult.success) {
      return handleError('CANCEL_FAILED', `Failed to cancel ticket: ${moveResult.error}`);
    }

    // Refresh ticket to get updated status
    const canceled = await this.storage.getTicket(ticketId!) || ticket;

    // Auto-export to board.md if configured
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // JSON output mode
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        ticket: formatTicket(canceled),
        provider: moveResult.provider,
      }, null, 2));
      return;
    }

    this.log(styles.success(`Canceled ${ticketId}`));
    this.log(styles.muted(`   Title: ${ticket.title}`));
    this.log(styles.muted(`   Moved to: ${canceled.statusName}`));
    if (moveResult.provider !== 'pmo') {
      this.log(styles.muted(`   Provider: ${moveResult.provider}`));
    }
  }

  private async executeBulk(
    activeTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    canceledColumnName: string,
    flags: { force: boolean; json: boolean; machine: boolean; bulk: boolean; project?: string }
  ): Promise<void> {
    // Only show header in interactive mode
    if (!shouldOutputJson(flags)) {
      this.log(styles.emphasis('Cancel Multiple Tickets\n'));
    }

    // Agent mode config for prompts
    const jsonModeConfig = shouldOutputJson(flags) ? { flags, commandName: 'ticket cancel --bulk' } : null;

    // Select tickets to cancel
    const { selectedTickets } = await this.prompt<{ selectedTickets: string[] }>([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to cancel:',
      choices: activeTickets.map(t => ({
        name: `${t.id} - ${t.title} (${t.statusName})`,
        value: t.id,
        command: `prlt ticket cancel ${t.id}${flags.project ? ` -P ${flags.project}` : ''} --json`,
      })),
    }], jsonModeConfig);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Confirmation
    if (!flags.force) {
      this.log(styles.warning('\nWill cancel:'));
      for (const ticketId of selectedTickets) {
        const ticket = activeTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log(styles.primary(`  → Move to: ${canceledColumnName}\n`));

      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, keep tickets', value: 'false', command: '' },
          { name: 'Yes, cancel tickets', value: 'true', command: `prlt ticket cancel ${selectedTickets.join(' ')}${flags.project ? ` -P ${flags.project}` : ''} --force --json` }
        ],
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Cancel each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        const ticket = activeTickets.find(t => t.id === ticketId);
        if (!ticket) {
          throw new Error('Ticket not found in active tickets list');
        }
        // eslint-disable-next-line no-await-in-loop
        const provider = await this.resolveTicketProvider(ticketId, ticket.projectId!);
        // eslint-disable-next-line no-await-in-loop
        const result = await provider.moveTicket(ticketId, canceledColumnName);
        if (result.success) {
          this.log(styles.success(`Canceled ${ticketId}`));
          successCount++;
        } else {
          this.log(styles.error(`Failed to cancel ${ticketId}: ${result.error}`));
          failCount++;
        }
      } catch (error) {
        this.log(styles.error(`Failed to cancel ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to board.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(styles.success(`Canceled ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to cancel ${failCount} ticket(s)`));
    }
  }
}
