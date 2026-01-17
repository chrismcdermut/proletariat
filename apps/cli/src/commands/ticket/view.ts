import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TicketView extends PMOCommand {
  static description = 'View detailed ticket information';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

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

      // In JSON mode, output ticket selection prompt
      if (jsonMode) {
        const ticketChoices = allTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'ticketId', 'Select ticket to view:', ticketChoices),
          createMetadata('ticket view', flags)
        );
        return;
      }

      const { selectedTicketId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicketId',
        message: 'Select ticket to view:',
        choices: allTickets.map(t => ({
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

    const board = await this.storage.getBoard(ticket.projectId!);

    // Display ticket details
    this.log(`\n${styles.header('📄 Ticket')} ${styles.emphasis(ticket.id)}\n`);
    this.log(`${styles.header('Title:')}       ${ticket.title}`);
    this.log(`${styles.header('Project:')}     ${board.name}`);
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
