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
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class TicketDelete extends PMOCommand {
  static description = 'Delete ticket(s) permanently';

  static strict = false; // Allow variadic ticket ID args

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %> TICK-001 TICK-002 TICK-003  # Delete multiple tickets',
    '<%= config.bin %> <%= command.id %> TICK-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --bulk',
    '<%= config.bin %> <%= command.id %> --bulk --force --status Done  # Non-interactive bulk delete by status',
    '<%= config.bin %> <%= command.id %> --json  # Output choices as JSON',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) to delete — pass multiple IDs to delete several tickets. Prompts with dropdown if not provided.',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
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
    status: Flags.string({
      char: 's',
      description: 'Filter tickets by status name (for use with --bulk --force)',
    }),
  };

  async execute(): Promise<void> {
    const { args, argv, flags } = await this.parse(TicketDelete);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket delete', flags));
        return
      }
      this.error(message);
    };

    // Collect all ticket IDs from variadic args
    const ticketIds = argv as string[];

    // Get all tickets from provider — no local PMO fallback
    const deleteProvider = this.resolveProjectProvider(projectId || '');
    const deleteListResult = await deleteProvider.listTickets(projectId);
    if (!deleteListResult.success) {
      return handleError('LIST_FAILED', deleteListResult.error || 'Failed to list tickets.');
    }
    let allTickets = deleteListResult.tickets;

    if (allTickets.length === 0) {
      return handleError('NO_TICKETS', 'No tickets found.');
    }

    // Apply --status filter if provided
    if (flags.status) {
      const statusLower = flags.status.toLowerCase();
      allTickets = allTickets.filter((t) => (t.statusName ?? '').toLowerCase() === statusLower);
      if (allTickets.length === 0) {
        return handleError('NO_MATCHING_TICKETS', `No tickets found with status "${flags.status}".`);
      }
    }

    // Multiple ticket IDs provided — delete each one
    if (ticketIds.length > 1) {
      await this.executeMultiple(ticketIds, projectId || '', flags.force, jsonMode, flags);
      return;
    }

    // Bulk mode
    if (flags.bulk) {
      // When --force + --status (or just --force), skip interactive selection
      if (flags.force && (flags.status || ticketIds.length === 0)) {
        const ticketsToDelete = flags.status ? allTickets : allTickets;
        await this.executeDirectBulk(ticketsToDelete, jsonMode, flags);
        return;
      }
      await this.executeBulk(allTickets, flags.force, flags);
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
        getCommand: (t) => `prlt ticket delete ${t.id}${projectId ? ` -P ${projectId}` : ''} --force --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket delete' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      ticketId = selected;
    }

    // Get ticket from provider
    const ticketProvider = await this.resolveTicketProvider(ticketId!, projectId || '');
    const getResult = await ticketProvider.getTicket(ticketId!);
    const ticket = getResult.success ? getResult.ticket ?? null : null;
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
    }
    ticketId = ticket.id;

    // Get board for project name (may be null if project was deleted/orphaned)
    const board = ticket.projectId ? await this.storage.getProjectBoard(ticket.projectId) : null;

    // Confirmation prompt (unless --force)
    if (!flags.force) {
      this.log(`\nDelete ticket ${styles.emphasis(ticketId)}?`);
      this.log(`  Title: ${ticket.title}`);
      this.log(`  Project: ${board?.name || ticket.projectId || 'Unknown'}`);
      this.log(`  Status: ${ticket.statusName}`);

      const jsonModeConfig = jsonMode ? { flags, commandName: 'ticket delete' } : null;
      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message: 'Are you sure?',
        choices: [
          { name: 'No, cancel', value: false, command: '' },
          { name: 'Yes, delete', value: true, command: `prlt ticket delete ${ticketId} --force --json` },
        ],
        default: 0,
      }], jsonModeConfig);

      if (!confirmed) {
        this.log(styles.warning('Deletion cancelled.'));
        return;
      }
    }

    // Delete ticket through the provider (routes to Linear/Jira/PMO as appropriate)
    const provider = await this.resolveTicketProvider(ticketId!, ticket.projectId || '');
    const result = await provider.deleteTicket(ticketId!);

    if (!result.success) {
      return handleError('DELETE_FAILED', `Failed to delete ticket: ${result.error}`);
    }

    // Auto-export to board.md only for local PMO provider
    if (provider.name === 'pmo') {
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));
    }

    // JSON output mode - match MCP tool response shape
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        message: `Deleted ${ticketId}`,
        provider: result.provider,
      }, null, 2));
      return;
    }

    this.log(styles.success(`\nTicket ${styles.emphasis(ticketId)} deleted`));
    this.log(styles.muted(`   Removed from ${result.provider === 'pmo' ? 'database and board' : `${result.provider} and local mirror`}`));
  }

  /**
   * Delete multiple tickets by explicit IDs (non-interactive).
   */
  private async executeMultiple(
    ticketIds: string[],
    projectId: string,
    force: boolean,
    jsonMode: boolean,
    flags: Record<string, unknown>
  ): Promise<void> {
    if (!force) {
      this.log(styles.warning(`\nThis will PERMANENTLY DELETE ${ticketIds.length} ticket(s):`));
      for (const id of ticketIds) {
        this.log(styles.primary(`  ${id}`));
      }
      this.log('');

      const jsonModeConfig = jsonMode ? { flags, commandName: 'ticket delete' } : null;
      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message: 'Are you sure? This cannot be undone.',
        choices: [
          { name: 'No, cancel', value: false, command: '' },
          { name: 'Yes, DELETE tickets', value: true, command: `prlt ticket delete ${ticketIds.join(' ')} --force --json` },
        ],
        default: 0,
      }], jsonModeConfig);

      if (!confirmed) {
        this.log(styles.muted('Deletion cancelled.'));
        return;
      }
    }

    let successCount = 0;
    let failCount = 0;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const ticketId of ticketIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const provider = await this.resolveTicketProvider(ticketId, projectId);
        // eslint-disable-next-line no-await-in-loop
        const result = await provider.deleteTicket(ticketId);
        if (result.success) {
          if (!jsonMode) this.log(styles.success(`Deleted ${ticketId} (via ${result.provider})`));
          results.push({ id: ticketId, success: true });
          successCount++;
        } else {
          if (!jsonMode) this.log(styles.error(`Failed to delete ${ticketId}: ${result.error}`));
          results.push({ id: ticketId, success: false, error: result.error });
          failCount++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!jsonMode) this.log(styles.error(`Failed to delete ${ticketId}: ${msg}`));
        results.push({ id: ticketId, success: false, error: msg });
        failCount++;
      }
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    if (jsonMode) {
      this.log(JSON.stringify({
        success: failCount === 0,
        deleted: successCount,
        failed: failCount,
        results,
      }, null, 2));
      return;
    }

    this.log('');
    if (successCount > 0) this.log(styles.success(`Deleted ${successCount} ticket(s)`));
    if (failCount > 0) this.log(styles.error(`Failed to delete ${failCount} ticket(s)`));
  }

  /**
   * Bulk delete filtered tickets without interactive selection (--bulk --force).
   */
  private async executeDirectBulk(
    tickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    jsonMode: boolean,
    flags: Record<string, unknown>
  ): Promise<void> {
    const ticketIds = tickets.map((t) => t.id);
    const projectId = (flags as { project?: string }).project || '';

    let successCount = 0;
    let failCount = 0;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const ticketId of ticketIds) {
      try {
        const ticket = tickets.find((t) => t.id === ticketId);
        const ticketProjectId = ticket?.projectId || projectId;
        // eslint-disable-next-line no-await-in-loop
        const provider = await this.resolveTicketProvider(ticketId, ticketProjectId);
        // eslint-disable-next-line no-await-in-loop
        const result = await provider.deleteTicket(ticketId);
        if (result.success) {
          if (!jsonMode) this.log(styles.success(`Deleted ${ticketId} (via ${result.provider})`));
          results.push({ id: ticketId, success: true });
          successCount++;
        } else {
          if (!jsonMode) this.log(styles.error(`Failed to delete ${ticketId}: ${result.error}`));
          results.push({ id: ticketId, success: false, error: result.error });
          failCount++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!jsonMode) this.log(styles.error(`Failed to delete ${ticketId}: ${msg}`));
        results.push({ id: ticketId, success: false, error: msg });
        failCount++;
      }
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    if (jsonMode) {
      outputSuccessAsJson({
        deleted: successCount,
        failed: failCount,
        results,
      }, createMetadata('ticket delete', flags));
      return;
    }

    this.log('');
    if (successCount > 0) this.log(styles.success(`Deleted ${successCount} ticket(s)`));
    if (failCount > 0) this.log(styles.error(`Failed to delete ${failCount} ticket(s)`));
  }

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    force: boolean,
    flags?: Record<string, unknown>
  ): Promise<void> {
    const jsonMode = flags ? shouldOutputJson(flags) : false;
    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'ticket delete' } : null;
    this.log(styles.emphasis('Delete Multiple Tickets\n'));

    // Select tickets to delete
    const { selectedTickets } = await this.prompt<{ selectedTickets: string[] }>([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to DELETE:',
      choices: allTickets.map(t => ({
        name: `${t.id} - ${t.title} (${t.statusName})`,
        value: t.id,
      })),
    }], jsonModeConfig);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Confirmation
    if (!force) {
      this.log(styles.warning('\nThis will PERMANENTLY DELETE:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  ${ticketId}: ${ticket?.title}`));
      }
      this.log('');

      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'Are you sure? This cannot be undone.',
        choices: [
          { name: 'No, cancel', value: false, command: '' },
          { name: 'Yes, DELETE tickets', value: true, command: 'prlt ticket delete --bulk --force --json' }
        ],
        default: 0
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Deletion cancelled.'));
        return;
      }
    }

    this.log('');

    // Delete each ticket through the provider
    let successCount = 0;
    let failCount = 0;

    // Process sequentially for clear success/failure logging
    for (const ticketId of selectedTickets) {
      try {
        const ticket = allTickets.find(t => t.id === ticketId);
        const ticketProjectId = ticket?.projectId || '';
        // eslint-disable-next-line no-await-in-loop
        const provider = await this.resolveTicketProvider(ticketId, ticketProjectId);
        // eslint-disable-next-line no-await-in-loop
        const result = await provider.deleteTicket(ticketId);
        if (result.success) {
          this.log(styles.success(`Deleted ${ticketId} (via ${result.provider})`));
          successCount++;
        } else {
          this.log(styles.error(`Failed to delete ${ticketId}: ${result.error}`));
          failCount++;
        }
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
