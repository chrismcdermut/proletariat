import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class TicketComment extends PMOCommand {
  static description = 'Add a comment to a ticket (syncs to Linear/Jira when configured)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 "Fixed the flaky test"',
    '<%= config.bin %> <%= command.id %> TKT-001 --body "Deployed to staging"',
    '<%= config.bin %> <%= command.id %> TKT-001 --body "Ready for review" --json',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to comment on',
      required: false,
    }),
    body: Args.string({
      description: 'Comment text (alternative to --body flag)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    body: Flags.string({
      char: 'b',
      description: 'Comment body text (markdown supported)',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketComment);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket comment', flags));
        return;
      }
      this.error(message);
    };

    let ticketId = args.ticketId;

    if (!ticketId) {
      const allTickets = await this.storage.listTickets(projectId);

      if (allTickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found.');
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to comment on:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket comment ${t.id} --body "..." --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket comment' } : null,
      });

      if (!selected) {
        return;
      }
      ticketId = selected;
    }

    // Get the ticket to verify it exists
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
    }

    // Get the comment body — flag takes precedence over positional arg
    const body = flags.body || args.body;

    if (!body) {
      return handleError('MISSING_BODY', 'Comment body is required. Use --body "text" or pass as second argument.');
    }

    // Add comment through the provider (routes to Linear/Jira/PMO as appropriate)
    const provider = await this.resolveTicketProvider(ticketId!, ticket.projectId || '');
    const result = await provider.commentTicket(ticketId!, body);

    if (!result.success) {
      return handleError('COMMENT_FAILED', `Failed to add comment: ${result.error}`);
    }

    // JSON output mode
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        provider: result.provider,
        ticketId: ticketId!,
      }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Comment added to ${styles.emphasis(ticketId!)}`));
    if (result.provider !== 'pmo') {
      this.log(styles.muted(`   Provider: ${result.provider}`));
    }
  }
}
