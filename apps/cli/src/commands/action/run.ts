import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ActionRun extends PMOCommand {
  static description = 'Run an action on one or more tickets (bulk action support)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 --action implement',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 TKT-003 --action groom',
    '<%= config.bin %> <%= command.id %> --all --action groom  # All backlog tickets',
    '<%= config.bin %> <%= command.id %> --category started --action review',
  ];

  static strict = false;  // Allow multiple ticket IDs

  static args = {
    ticketIds: Args.string({
      description: 'Ticket ID(s) to run action on',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    action: Flags.string({
      char: 'A',
      description: 'Action to run (e.g., groom, implement, review)',
      required: true,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Run on all tickets in backlog',
      default: false,
    }),
    category: Flags.string({
      char: 'c',
      description: 'Filter tickets by status category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be done without executing',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { argv, flags } = await this.parse(ActionRun);
    const ticketIds = argv as string[];

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('action run', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get the action
    const action = await this.storage.getAction(flags.action);
    if (!action) {
      return handleError('ACTION_NOT_FOUND', `Action not found: ${flags.action}\nRun 'prlt action list' to see available actions.`);
    }

    // Get tickets to operate on
    // Use -P flag to filter by project, or undefined to show all projects
    const projectId = (flags as { project?: string }).project;
    let tickets: Ticket[] = [];

    if (flags.all || flags.category) {
      // Get tickets by filter
      const allTickets = await this.storage.listTickets(projectId);

      if (flags.category) {
        tickets = allTickets.filter(t => t.statusCategory === flags.category);
      } else if (flags.all) {
        // Default to backlog for --all
        tickets = allTickets.filter(t => t.statusCategory === 'backlog' || !t.statusCategory);
      }
    } else if (ticketIds.length > 0) {
      // Get specific tickets in parallel
      const results = await Promise.all(
        ticketIds.map(async (id) => {
          const ticket = await this.storage.getTicket(id);
          if (!ticket) {
            this.warn(`Ticket not found: ${id}`);
          }
          return ticket;
        })
      );
      tickets = results.filter((t): t is Ticket => t !== null);
    } else {
      // Interactive: show list of tickets to select using FlagResolver
      const allTickets = await this.storage.listTickets(projectId);

      if (allTickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found.');
      }

      // Use FlagResolver for ticket selection - works in both JSON and interactive modes
      const resolver = new FlagResolver<{ ticketIds?: string[] }>({
        commandName: 'action run',
        baseCommand: `prlt action run --action ${flags.action}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'ticketIds',
        type: 'checkbox',
        message: `Select tickets for "${action.name}" action:`,
        choices: () => allTickets.map(t => ({
          name: `${t.id} - ${t.title} [${t.statusName || t.statusCategory || 'unknown'}]`,
          value: t.id,
        })),
        validate: (value) => (value as unknown as string[]).length > 0 || 'Select at least one ticket',
        getCommand: (value) => `prlt action run ${(value as unknown as string[]).join(' ')} --action ${flags.action} --json`,
      });

      const resolved = await resolver.resolve();

      if (!resolved.ticketIds || resolved.ticketIds.length === 0) {
        this.error('No tickets selected.');
      }

      const selectedResults = await Promise.all(
        resolved.ticketIds.map((id: string) => this.storage.getTicket(id))
      );
      tickets = selectedResults.filter((t): t is Ticket => t !== null);
    }

    if (tickets.length === 0) {
      this.error('No tickets matched the criteria.');
    }

    // Show what will be done
    this.log('');
    this.log(styles.header(`🎬 Action: ${action.name}`));
    if (action.description) {
      this.log(styles.muted(`   ${action.description}`));
    }
    this.log('');
    this.log(styles.emphasis(`Tickets (${tickets.length}):`));
    for (const ticket of tickets) {
      const status = ticket.statusName || ticket.statusCategory || 'unknown';
      this.log(styles.muted(`   • ${ticket.id}: ${ticket.title} [${status}]`));
    }
    this.log('');

    if (action.defaultMoveToCategory) {
      this.log(styles.muted(`After action: tickets will move to "${action.defaultMoveToCategory}"`));
      this.log('');
    }

    if (flags['dry-run']) {
      this.log(styles.warning('DRY RUN - no changes made'));
      return;
    }

    // Confirm unless --force
    if (!flags.force && tickets.length > 1) {
      // Use FlagResolver for confirmation prompt - works in both JSON and interactive modes
      const resolver = new FlagResolver<{ confirmed?: boolean }>({
        commandName: 'action run',
        baseCommand: `prlt action run ${tickets.map(t => t.id).join(' ')} --action ${flags.action}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'confirmed',
        type: 'list',
        message: `Run "${action.name}" on ${tickets.length} tickets?`,
        choices: () => [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
        getCommand: (value) => value
          ? `prlt action run ${tickets.map(t => t.id).join(' ')} --action ${flags.action} --force --json`
          : '',
      });

      const resolved = await resolver.resolve();

      if (!resolved.confirmed) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    // Queue the action for each ticket
    // For now, this just outputs what would be done
    // Full implementation would integrate with work/start
    this.log('');
    this.log(styles.muted('To execute, run for each ticket:'));
    for (const ticket of tickets) {
      this.log(styles.muted(`   prlt work start ${ticket.id} --action ${action.id}`));
    }
    this.log('');
    this.log(styles.muted('Or use spawn-all to distribute to agents:'));
    this.log(styles.muted(`   prlt work spawn-all --action ${action.id}`));
    this.log('');
  }
}
