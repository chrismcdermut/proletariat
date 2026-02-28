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

export default class TicketLinkDuplicates extends PMOCommand {
  static description = 'Mark a ticket as a duplicate of another';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --json',
  ];

  static args = {
    ticket: Args.string({
      description: 'Ticket that is a duplicate',
      required: true,
    }),
    original: Args.string({
      description: 'Original ticket (that this duplicates)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkDuplicates);
    const jsonMode = shouldOutputJson(flags);

    const projectId = await this.requireProject();

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket link duplicates', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Verify the source ticket exists
    const ticket = await this.storage.getTicket(args.ticket);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${args.ticket}`);
    }

    // If original ticket not provided, prompt for selection
    if (!args.original) {
      const tickets = await this.storage.listTickets(projectId);
      const otherTickets = tickets.filter(t => t.id !== args.ticket);

      if (otherTickets.length === 0) {
        return handleError('NO_TICKETS', 'No other tickets to select as original.');
      }

      const projectFlag = flags.project ? ` -P ${flags.project}` : '';
      const choices = otherTickets.map(t => ({
        name: `${t.id} - ${t.title}`,
        value: t.id,
        command: `prlt ticket link duplicates ${args.ticket} ${t.id}${projectFlag} --json`,
      }));
      const message = `Select the original ticket that ${args.ticket} duplicates:`;

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'original', message, choices),
          createMetadata('ticket link duplicates', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }], null);

      args.original = selected;
    }

    // Verify original ticket exists
    const originalTicket = await this.storage.getTicket(args.original!);
    if (!originalTicket) {
      return handleError('ORIGINAL_NOT_FOUND', `Original ticket not found: ${args.original}`);
    }

    // Create the duplicates dependency
    try {
      await this.storage.createTicketDependency(args.ticket, args.original!, 'duplicates');
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

      if (jsonMode) {
        outputSuccessAsJson({
          ticketId: args.ticket,
          originalTicketId: args.original,
          type: 'duplicates',
        }, createMetadata('ticket link duplicates', flags));
        return;
      }

      this.log(styles.success(`\n${args.ticket} marked as duplicate of ${args.original}`));
      this.log(styles.muted(`  ${ticket.title}`));
      this.log(styles.muted(`  duplicates: ${originalTicket.title}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return handleError('ALREADY_EXISTS', 'Duplicates dependency already exists.');
      }
      throw error;
    }
  }
}
