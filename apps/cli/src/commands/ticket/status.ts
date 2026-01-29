import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles, formatPriority, formatCategory } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { resolveDeprecatedArg } from '../../lib/deprecation.js';

export default class TicketStatus extends PMOCommand {
  static description = 'Show ticket status and details';

  static examples = [
    '<%= config.bin %> <%= command.id %> --id TKT-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  // Deprecated: Use --id flag instead. Positional args will be removed in v1.0
  static args = {
    ticketId: Args.string({
      description: '[DEPRECATED: Use --id] Ticket ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    id: Flags.string({
      description: 'Ticket ID to show status for',
      char: 'i',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketStatus);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket status', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Resolve ticket ID from --id flag or deprecated positional arg
    let ticketId = resolveDeprecatedArg(
      this.log.bind(this),
      args,
      flags,
      {
        argName: 'ticketId',
        flagName: '--id',
        getExample: (v) => `prlt ticket status --id ${v}`,
      }
    );

    if (!ticketId) {
      // Get all tickets for selection
      const allTickets = await this.storage.listTickets(projectId);

      if (allTickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".');
      }

      // Use helper for ticket selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select ticket:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket status --id ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket status' } : null,
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

    // Display ticket status
    this.log('');
    this.log(styles.emphasis(`🎫 ${ticket.id}: ${ticket.title}`));
    this.log('');
    this.log(`   ${styles.muted('Status:')}    ${ticket.statusName}`);
    this.log(`   ${styles.muted('Priority:')}  ${formatPriority(ticket.priority)}`);
    if (ticket.category) {
      this.log(`   ${styles.muted('Category:')}  ${formatCategory(ticket.category)}`);
    }
    if (ticket.description) {
      this.log(`   ${styles.muted('Description:')}`);
      this.log(`   ${ticket.description.split('\n').map((line: string) => `   ${line}`).join('\n')}`);
    }
    if (ticket.subtasks && ticket.subtasks.length > 0) {
      const completedSubtasks = ticket.subtasks.filter((s: { done: boolean }) => s.done).length;
      this.log(`   ${styles.muted('Subtasks:')}   ${completedSubtasks}/${ticket.subtasks.length} completed`);
      ticket.subtasks.forEach((subtask: { title: string; done: boolean }) => {
        const icon = subtask.done ? '☑' : '☐';
        this.log(`     ${icon} ${subtask.title}`);
      });
    }
    this.log('');
  }

}
