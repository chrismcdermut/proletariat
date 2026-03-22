import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { formatTicket } from '../../lib/mcp/helpers.js';

export default class TicketFetch extends PMOCommand {
  static description = 'Fetch ticket contents via the configured provider (Linear, Jira, or local PMO)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --json',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to fetch - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketFetch);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket fetch', flags));
        return;
      }
      this.error(message);
    };

    let ticketId = args.ticketId;

    if (!ticketId) {
      const allTickets = await this.storage.listTickets(projectId);

      if (allTickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".');
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to fetch:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket fetch ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket fetch' } : null,
      });

      if (!selected) {
        return;
      }
      ticketId = selected;
    }

    // Fetch ticket through the provider (routes to Linear/Jira/PMO as appropriate)
    const provider = await this.resolveTicketProvider(ticketId!, projectId || '');
    const result = await provider.getTicket(ticketId!);

    if (!result.success || !result.ticket) {
      return handleError('TICKET_NOT_FOUND', result.error || `Ticket "${ticketId}" not found.`);
    }

    const ticket = result.ticket;

    // JSON output mode — normalized envelope shape
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        provider: result.provider,
        ticket: formatTicket(ticket),
      }, null, 2));
      return;
    }

    // Human-readable output
    this.log(`\n${styles.header('📄 Ticket')} ${styles.emphasis(ticket.id)}\n`);
    this.log(`${styles.header('Title:')}       ${ticket.title}`);
    this.log(`${styles.header('Status:')}      ${ticket.statusName}`);
    this.log(`${styles.header('Priority:')}    ${ticket.priority || 'none'}`);
    this.log(`${styles.header('Category:')}    ${ticket.category || 'none'}`);
    this.log(`${styles.header('Assignee:')}    ${ticket.assignee || 'none'}`);
    this.log(`${styles.header('Provider:')}    ${result.provider}`);

    if (ticket.metadata?.external_url) {
      this.log(`${styles.header('External:')}    ${ticket.metadata.external_url}`);
    }

    if (ticket.description) {
      this.log(`\n${styles.header('Description:')}`);
      this.log(`  ${ticket.description.split('\n').join('\n  ')}`);
    }

    if (ticket.labels.length > 0) {
      this.log(`\n${styles.header('Labels:')}      ${ticket.labels.join(', ')}`);
    }

    this.log('');
  }
}
