import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class TicketView extends PMOCommand {
  static aliases = ['ticket:show'];

  static description = 'View detailed ticket information';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to view - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketView);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket view', flags));
        this.exit(1);
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
        message: 'Select ticket to view:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket view ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket view' } : null,
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

    // JSON output mode
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        ticket: {
          id: ticket.id,
          title: ticket.title,
          description: ticket.description,
          priority: ticket.priority,
          category: ticket.category,
          statusName: ticket.statusName,
          statusCategory: ticket.statusCategory,
          projectId: ticket.projectId,
          assignee: ticket.assignee,
          owner: ticket.owner,
          branch: ticket.branch,
          epicId: ticket.epicId,
          position: ticket.position,
          subtasks: ticket.subtasks,
          labels: ticket.labels,
          metadata: ticket.metadata,
          blockedBy: ticket.blockedBy,
          acceptanceCriteria: ticket.acceptanceCriteria,
          specId: ticket.specId,
          createdAt: ticket.createdAt?.toISOString(),
          updatedAt: ticket.updatedAt?.toISOString(),
        },
      }, null, 2));
      return;
    }

    // Get project board (may be null if project was deleted/orphaned)
    const board = ticket.projectId ? await this.storage.getProjectBoard(ticket.projectId) : null;
    const projectName = board?.name || ticket.projectId || 'Unknown';

    // Display ticket details
    this.log(`\n${styles.header('📄 Ticket')} ${styles.emphasis(ticket.id)}\n`);
    this.log(`${styles.header('Title:')}       ${ticket.title}`);
    this.log(`${styles.header('Project:')}     ${projectName}`);
    this.log(`${styles.header('Status:')}      ${ticket.statusName}`);
    this.log(`${styles.header('Priority:')}    ${ticket.priority || 'none'}`);
    this.log(`${styles.header('Category:')}    ${ticket.category || 'none'}`);
    this.log(`${styles.header('Created:')}     ${ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'unknown'}`);
    this.log(`${styles.header('Updated:')}     ${ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : 'unknown'}`);

    if (ticket.description) {
      this.log(`\n${styles.header('Description:')}`);
      this.log(`  ${ticket.description.split('\n').join('\n  ')}`);
    }

    this.log('');
  }

}
