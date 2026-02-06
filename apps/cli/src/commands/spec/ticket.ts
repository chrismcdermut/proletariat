import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class SpecTicket extends PMOCommand {
  static description = 'Assign a ticket to a spec document';

  static examples = [
    '<%= config.bin %> <%= command.id %> PRLT-001 user-authentication',
    '<%= config.bin %> <%= command.id %> --ticket PRLT-001 --spec api-design',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID',
      required: false,
    }),
    specId: Args.string({
      description: 'Spec ID (filename without .md)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      char: 't',
      description: 'Ticket ID',
    }),
    spec: Flags.string({
      char: 's',
      description: 'Spec ID (filename without .md)',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecTicket);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // This command requires project context (with JSON mode support)
    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'spec ticket',
        baseCommand: 'prlt spec ticket',
      } : undefined,
    });

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec ticket', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get ticket ID
    let ticketId = args.ticketId || flags.ticket;
    if (!ticketId) {
      const tickets = await this.storage.listTickets(projectId);
      if (tickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found. Create one first with: prlt ticket create');
      }

      // Use FlagResolver for ticket selection
      const ticketResolver = new FlagResolver<{ ticket?: string }>({
        commandName: 'spec ticket',
        baseCommand: 'prlt spec ticket',
        jsonMode,
        flags: { ticket: flags.ticket },
        context: { projectId },
      });

      ticketResolver.addPrompt({
        flagName: 'ticket',
        type: 'list',
        message: 'Select ticket to link:',
        choices: () => tickets.map(t => ({
          name: `${t.id}: ${t.title}`,
          value: t.id,
        })),
      });

      const resolved = await ticketResolver.resolve();
      ticketId = resolved.ticket;
    }

    if (!ticketId) {
      return handleError('NO_TICKET_SELECTED', 'No ticket selected');
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId);
    if (!ticket) {
      const projectName = await this.getProjectName(projectId);
      return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found in project "${projectName}"`);
    }

    // Get spec ID
    let specId = args.specId || flags.spec;
    if (!specId) {
      // List all specs globally (specs are not project-scoped)
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        return handleError('NO_SPECS', 'No specs found. Create one first with: prlt spec create');
      }

      // Use FlagResolver for spec selection
      const specResolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec ticket',
        baseCommand: `prlt spec ticket --ticket "${ticketId}"`,
        jsonMode,
        flags: { spec: flags.spec },
        context: { projectId, ticketId },
      });

      specResolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec to link:',
        choices: () => specs.map(s => ({
          name: `${s.title} (${s.status})`,
          value: s.id,
        })),
      });

      const resolved = await specResolver.resolve();
      specId = resolved.spec;
    }

    if (!specId) {
      this.error('No spec selected');
    }

    // Verify spec exists globally (specs are not project-scoped)
    const spec = await this.storage.getSpec(specId);
    if (!spec) {
      return handleError('SPEC_NOT_FOUND', `Spec "${specId}" not found`);
    }

    // Check if already linked
    if (ticket.specId === specId) {
      this.log(styles.warning(`Ticket "${ticketId}" is already linked to spec "${specId}"`));
      return;
    }

    // Warn if ticket already has a different spec
    if (ticket.specId && ticket.specId !== specId) {
      this.log(styles.warning(`Ticket "${ticketId}" is currently linked to spec "${ticket.specId}"`));
      this.log(styles.muted(`This will replace the existing spec link.`));
    }

    // Set spec on ticket (single spec per ticket)
    await this.storage.updateTicket(ticketId, { specId });

    // Auto-export to board.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Linked ticket "${styles.emphasis(ticketId)}" to spec "${styles.emphasis(specId)}"`));
    this.log(styles.muted(`\nView ticket:`));
    this.log(styles.muted(`  prlt ticket view ${ticketId}`));
  }
}
