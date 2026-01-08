import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, Ticket } from '../../lib/pmo/types.js';

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

    // Get the action
    const action = await this.storage.getAction(flags.action);
    if (!action) {
      this.error(`Action not found: ${flags.action}\nRun 'prlt action list' to see available actions.`);
    }

    // Get tickets to operate on
    let tickets: Ticket[] = [];

    if (flags.all || flags.category) {
      // Get tickets by filter
      const allTickets = await this.storage.listTickets();

      if (flags.category) {
        tickets = allTickets.filter(t => t.statusCategory === flags.category);
      } else if (flags.all) {
        // Default to backlog for --all
        tickets = allTickets.filter(t => t.statusCategory === 'backlog' || !t.statusCategory);
      }
    } else if (ticketIds.length > 0) {
      // Get specific tickets
      for (const id of ticketIds) {
        const ticket = await this.storage.getTicket(id);
        if (ticket) {
          tickets.push(ticket);
        } else {
          this.warn(`Ticket not found: ${id}`);
        }
      }
    } else {
      // Interactive: show list of tickets to select
      const allTickets = await this.storage.listTickets();

      if (allTickets.length === 0) {
        this.error('No tickets found.');
      }

      const { selectedTickets } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedTickets',
        message: `Select tickets for "${action.name}" action:`,
        choices: allTickets.map(t => ({
          name: `${t.id} - ${t.title} [${t.statusName || t.statusCategory || 'unknown'}]`,
          value: t.id,
          checked: action.suggestedForCategories?.includes(t.statusCategory as StateCategory),
        })),
        validate: (input: string[]) => input.length > 0 || 'Select at least one ticket',
      }]);

      for (const id of selectedTickets) {
        const ticket = await this.storage.getTicket(id);
        if (ticket) tickets.push(ticket);
      }
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
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Run "${action.name}" on ${tickets.length} tickets?`,
        default: true,
      }]);

      if (!confirm) {
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
