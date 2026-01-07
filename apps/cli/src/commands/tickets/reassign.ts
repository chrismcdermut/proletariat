import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Reassign extends Command {
  static description = 'Reassign multiple tickets to a different agent';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --to alice',
  ];

  static flags = {
    to: Flags.string({
      description: 'Target agent name (skip interactive prompt)',
    }),
    from: Flags.string({
      description: 'Filter tickets by current assignee',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Reassign);

    this.log(colors.primary('👤 Reassign Tickets\n'));

    // Get PMO context (prompts for project if multiple exist)
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all tickets
      const allTickets = await storage.listTickets();

      if (allTickets.length === 0) {
        await storage.close();
        this.log(colors.warning('No tickets found.'));
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
      const db = (storage as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } }).db;
      try {
        const agents = db.prepare(`SELECT name FROM agents`).all() as Array<{ name: string }>;
        for (const agent of agents) {
          assignees.add(agent.name);
        }
      } catch {
        // agents table might not exist, ignore
      }

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
        await storage.close();
        this.log(colors.warning('No tickets found matching filter.'));
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
        await storage.close();
        this.log(colors.textMuted('No tickets selected.'));
        return;
      }

      // Select target assignee
      let targetAssignee: string | null | undefined = flags.to;
      if (targetAssignee === undefined) {
        const { assignee } = await inquirer.prompt([{
          type: 'list',
          name: 'assignee',
          message: 'Reassign to which agent?',
          choices: [
            { name: 'None (unassign)', value: null },
            ...Array.from(assignees).sort().map(a => ({
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
        } else {
          targetAssignee = assignee;
        }
      }

      // Handle 'none' as undefined (unassign)
      if (targetAssignee === 'none' || targetAssignee === 'unassigned' || targetAssignee === null) {
        targetAssignee = undefined;
      }

      // Confirmation
      if (!flags.force) {
        const assigneeLabel = targetAssignee || 'None (unassigning)';

        this.log(colors.text('\nWill reassign to:'));
        this.log(colors.text(`  → ${assigneeLabel}\n`));
        this.log(colors.text('Tickets:'));
        for (const ticketId of selectedTickets) {
          const ticket = filteredTickets.find(t => t.id === ticketId);
          this.log(colors.text(`  • ${ticketId}: ${ticket?.title}`));
        }
        this.log('');

        const { confirm } = await inquirer.prompt([{
          type: 'list',
          name: 'confirm',
          message: 'Continue?',
          choices: [
            { name: '❌ No, cancel', value: false },
            { name: '✅ Yes, reassign tickets', value: true }
          ],
          default: 0
        }]);

        if (!confirm) {
          await storage.close();
          this.log(colors.textMuted('Operation cancelled.'));
          return;
        }
      }

      this.log('');

      // Reassign each ticket
      let successCount = 0;
      let failCount = 0;

      for (const ticketId of selectedTickets) {
        try {
          await storage.updateTicket(ticketId, { assignee: targetAssignee || undefined });

          const action = targetAssignee ? `Reassigned to ${targetAssignee}` : 'Unassigned';
          this.log(format.success(`${ticketId}: ${action}`));
          successCount++;
        } catch (error) {
          this.log(format.error(`Failed to reassign ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
          failCount++;
        }
      }

      // Auto-export to kanban.md
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      // Summary
      this.log('');
      if (successCount > 0) {
        const action = targetAssignee ? 'Reassigned' : 'Unassigned';
        this.log(format.success(`${action} ${successCount} ticket(s)`));
      }
      if (failCount > 0) {
        this.log(format.error(`Failed to reassign ${failCount} ticket(s)`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
