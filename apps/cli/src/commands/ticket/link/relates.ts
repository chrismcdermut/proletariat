import { Args } from '@oclif/core';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class TicketLinkRelates extends PMOCommand {
  static description = 'Add a relates-to dependency between two tickets';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --json',
  ];

  static args = {
    ticket: Args.string({
      description: 'First ticket',
      required: true,
    }),
    related: Args.string({
      description: 'Second ticket (related)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkRelates);
    const jsonMode = shouldOutputJson(flags);

    const projectId = await this.requireProject();

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket link relates', flags));
        return
      }
      this.error(message);
    };

    // Verify the source ticket exists
    const ticket = await this.storage.getTicket(args.ticket);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${args.ticket}`);
    }

    // If related ticket not provided, prompt for selection
    if (!args.related) {
      const tickets = await this.storage.listTickets(projectId);
      const otherTickets = tickets.filter(t => t.id !== args.ticket);

      if (otherTickets.length === 0) {
        return handleError('NO_TICKETS', 'No other tickets to select as related.');
      }

      const projectFlag = flags.project ? ` -P ${flags.project}` : '';
      const choices = otherTickets.map(t => ({
        name: `${t.id} - ${t.title}`,
        value: t.id,
        command: `prlt ticket link relates ${args.ticket} ${t.id}${projectFlag} --json`,
      }));
      const message = `Select ticket to relate to ${args.ticket}:`;

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'related', message, choices),
          createMetadata('ticket link relates', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }], null);

      args.related = selected;
    }

    // Verify related ticket exists
    const relatedTicket = await this.storage.getTicket(args.related!);
    if (!relatedTicket) {
      return handleError('RELATED_NOT_FOUND', `Related ticket not found: ${args.related}`);
    }

    // Create the relates_to dependency
    try {
      await this.storage.createTicketDependency(args.ticket, args.related!, 'relates_to');
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

      if (jsonMode) {
        outputSuccessAsJson({
          ticketId: args.ticket,
          relatedTicketId: args.related,
          type: 'relates_to',
        }, createMetadata('ticket link relates', flags));
        return;
      }

      this.log(styles.success(`\n${args.ticket} now relates to ${args.related}`));
      this.log(styles.muted(`  ${ticket.title}`));
      this.log(styles.muted(`  relates to: ${relatedTicket.title}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return handleError('ALREADY_EXISTS', 'Relates-to dependency already exists.');
      }
      throw error;
    }
  }
}
