import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketReassign extends PMOCommand {
  static description = 'Reassign ticket(s) to a different agent';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001 alice',
    '<%= config.bin %> <%= command.id %> --bulk --to alice',
    '<%= config.bin %> <%= command.id %> --bulk --from bob --to alice',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
    assignee: Args.string({
      description: 'Target agent name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    to: Flags.string({
      description: 'Target agent name (for bulk mode)',
    }),
    from: Flags.string({
      description: 'Filter tickets by current assignee (bulk mode)',
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to reassign multiple tickets',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketReassign);

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    if (allTickets.length === 0) {
      this.log(styles.warning('No tickets found.'));
      return;
    }

    // Get unique assignees from tickets
    const assignees = new Set<string>();
    for (const ticket of allTickets) {
      if (ticket.assignee) {
        assignees.add(ticket.assignee);
      }
    }

    // Also get agents from workspace if available
    const db = (this.storage as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } }).db;
    try {
      const agents = db.prepare(`SELECT name FROM agents`).all() as Array<{ name: string }>;
      for (const agent of agents) {
        assignees.add(agent.name);
      }
    } catch {
      // agents table might not exist, ignore
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(allTickets, Array.from(assignees), flags);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      const { selectedTicketId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicketId',
        message: 'Select ticket to reassign:',
        choices: allTickets.map(t => ({
          name: `${t.id} - ${t.title} [${t.assignee || 'unassigned'}]`,
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

    // Get target assignee
    let targetAssignee = args.assignee || flags.to;

    if (!targetAssignee) {
      const { assignee } = await inquirer.prompt([{
        type: 'list',
        name: 'assignee',
        message: `Reassign ${ticketId} to:`,
        choices: [
          { name: 'None (unassign)', value: '__none__' },
          ...Array.from(assignees).sort().map(a => ({
            name: a === ticket.assignee ? `${a} (current)` : a,
            value: a,
          })),
          { name: '── Enter custom name ──', value: '__custom__' },
        ],
      }]);

      if (assignee === '__custom__') {
        const { customAssignee } = await inquirer.prompt([{
          type: 'input',
          name: 'customAssignee',
          message: 'Enter agent/assignee name:',
          validate: (input: string) => input.length > 0 || 'Name is required',
        }]);
        targetAssignee = customAssignee;
      } else if (assignee === '__none__') {
        targetAssignee = undefined;
      } else {
        targetAssignee = assignee;
      }
    }

    // Handle special values
    if (targetAssignee === 'none' || targetAssignee === 'unassigned') {
      targetAssignee = undefined;
    }

    // Check if same
    if (targetAssignee === ticket.assignee) {
      this.log(styles.muted(`Ticket "${ticketId}" is already assigned to "${targetAssignee || 'none'}".`));
      return;
    }

    // Update ticket
    await this.storage.updateTicket(ticketId!, { assignee: targetAssignee || undefined });

    // Auto-export
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    const action = targetAssignee ? `reassigned to ${targetAssignee}` : 'unassigned';
    this.log(styles.success(`\n✅ Ticket ${styles.emphasis(ticketId!)} ${action}`));
    this.log(styles.muted(`   Title: ${ticket.title}`));
    if (ticket.assignee) {
      this.log(styles.muted(`   Previous: ${ticket.assignee}`));
    }
  }

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    assigneesList: string[],
    flags: { to?: string; from?: string; force: boolean }
  ): Promise<void> {
    this.log(styles.emphasis('👤 Reassign Tickets\n'));

    // Filter tickets if --from specified
    let filteredTickets = allTickets;
    if (flags.from) {
      if (flags.from === 'none' || flags.from === 'unassigned') {
        filteredTickets = allTickets.filter(t => !t.assignee);
      } else {
        filteredTickets = allTickets.filter(t => t.assignee === flags.from);
      }
    }

    if (filteredTickets.length === 0) {
      this.log(styles.warning('No tickets found matching filter.'));
      return;
    }

    // Select tickets to reassign
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to reassign:',
      choices: filteredTickets.map(t => ({
        name: `${t.id} - ${t.title}  [Assignee: ${t.assignee || '(none)'}]`,
        value: t.id,
      })),
    }]);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Select target assignee
    let targetAssignee: string | undefined = flags.to;
    if (targetAssignee === undefined) {
      const { assignee } = await inquirer.prompt([{
        type: 'list',
        name: 'assignee',
        message: 'Reassign to which agent?',
        choices: [
          { name: 'None (unassign)', value: '__none__' },
          ...assigneesList.sort().map(a => ({
            name: a,
            value: a,
          })),
          { name: '── Enter custom name ──', value: '__custom__' },
        ],
      }]);

      if (assignee === '__custom__') {
        const { customAssignee } = await inquirer.prompt([{
          type: 'input',
          name: 'customAssignee',
          message: 'Enter agent/assignee name:',
          validate: (input: string) => input.length > 0 || 'Name is required',
        }]);
        targetAssignee = customAssignee;
      } else if (assignee === '__none__') {
        targetAssignee = undefined;
      } else {
        targetAssignee = assignee;
      }
    }

    // Handle special values
    if (targetAssignee === 'none' || targetAssignee === 'unassigned') {
      targetAssignee = undefined;
    }

    // Confirmation
    if (!flags.force) {
      const assigneeLabel = targetAssignee || 'None (unassigning)';

      this.log(styles.primary('\nWill reassign to:'));
      this.log(styles.primary(`  → ${assigneeLabel}\n`));
      this.log(styles.primary('Tickets:'));
      for (const ticketId of selectedTickets) {
        const ticket = filteredTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log('');

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, reassign tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(styles.muted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Reassign each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        await this.storage.updateTicket(ticketId, { assignee: targetAssignee || undefined });

        const action = targetAssignee ? `Reassigned to ${targetAssignee}` : 'Unassigned';
        this.log(styles.success(`${ticketId}: ${action}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to reassign ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      const action = targetAssignee ? 'Reassigned' : 'Unassigned';
      this.log(styles.success(`${action} ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to reassign ${failCount} ticket(s)`));
    }
  }
}
