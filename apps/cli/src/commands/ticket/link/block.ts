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

export default class TicketLinkBlock extends PMOCommand {
  static description = 'Add a blocking dependency to a ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 --json',
  ];

  static args = {
    ticket: Args.string({
      description: 'Ticket that will be blocked',
      required: true,
    }),
    blocker: Args.string({
      description: 'Ticket that blocks (the blocker)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkBlock);
    const jsonMode = shouldOutputJson(flags);

    const projectId = await this.requireProject();

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket link block', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Verify the target ticket exists
    const ticket = await this.storage.getTicket(args.ticket);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${args.ticket}`);
    }

    // If blocker not provided, prompt for selection
    if (!args.blocker) {
      const tickets = await this.storage.listTickets(projectId);
      const otherTickets = tickets.filter(t => t.id !== args.ticket);

      if (otherTickets.length === 0) {
        return handleError('NO_TICKETS', 'No other tickets to select as blocker.');
      }

      const projectFlag = flags.project ? ` -P ${flags.project}` : '';
      const choices = otherTickets.map(t => ({
        name: `${t.id} - ${t.title}`,
        value: t.id,
        command: `prlt ticket link block ${args.ticket} ${t.id}${projectFlag} --json`,
      }));
      const message = `Select ticket that blocks ${args.ticket}:`;

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'blocker', message, choices),
          createMetadata('ticket link block', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }], null);

      args.blocker = selected;
    }

    // Verify blocker exists
    const blockerTicket = await this.storage.getTicket(args.blocker!);
    if (!blockerTicket) {
      return handleError('BLOCKER_NOT_FOUND', `Blocker ticket not found: ${args.blocker}`);
    }

    // Create the blocking dependency
    try {
      await this.storage.createTicketDependency(args.ticket, args.blocker!, 'blocks');
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

      if (jsonMode) {
        outputSuccessAsJson({
          ticketId: args.ticket,
          blockerId: args.blocker,
          type: 'blocks',
        }, createMetadata('ticket link block', flags));
        return;
      }

      this.log(styles.success(`\n${args.ticket} is now blocked by ${args.blocker}`));
      this.log(styles.muted(`  ${ticket.title}`));
      this.log(styles.muted(`  blocked by: ${blockerTicket.title}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return handleError('ALREADY_EXISTS', 'Blocking dependency already exists.');
      }
      throw error;
    }
  }
}
