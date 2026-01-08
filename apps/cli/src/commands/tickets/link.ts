import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class Link extends PMOCommand {
  static description = 'Link multiple tickets to an epic';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --to-epic auth-system',
  ];

  static flags = {
    ...pmoBaseFlags,
    'to-epic': Flags.string({
      description: 'Target epic ID (skip interactive prompt)',
    }),
    'from-epic': Flags.string({
      description: 'Filter tickets by current epic',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(Link);

    this.log(colors.primary('🔗 Link Tickets to Epic\n'));

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    if (allTickets.length === 0) {
      this.log(colors.warning('No tickets found.'));
      return;
    }

    // Get epics from database
    const db = (this.storage as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown } } }).db;
    const epics = db.prepare(`
      SELECT id, title, status FROM pmo_epics
      WHERE project_id = ?
      ORDER BY status, title
    `).all(this.storage.getCurrentProjectId()) as Array<{ id: string; title: string; status: string }>;

    // Filter tickets if --from-epic specified
    let filteredTickets = allTickets;
    if (flags['from-epic']) {
      // Get tickets with matching epic_id via metadata or direct query
      const epicTickets = db.prepare(`
        SELECT id FROM pmo_tickets
        WHERE project_id = ? AND epic_id = ?
      `).all(this.storage.getCurrentProjectId(), flags['from-epic']) as Array<{ id: string }>;
      const epicTicketIds = new Set(epicTickets.map(t => t.id));
      filteredTickets = allTickets.filter(t => epicTicketIds.has(t.id));
    }

    if (filteredTickets.length === 0) {
      this.log(colors.warning('No tickets found matching filter.'));
      return;
    }

    // Get current epic for each ticket
    const ticketEpics = new Map<string, string | null>();
    for (const ticket of filteredTickets) {
      const row = db.prepare(`
        SELECT epic_id FROM pmo_tickets WHERE id = ?
      `).get(ticket.id) as { epic_id: string | null } | undefined;
      ticketEpics.set(ticket.id, row?.epic_id || null);
    }

    // Select tickets to link
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to link:',
      choices: filteredTickets.map(t => {
        const epicId = ticketEpics.get(t.id);
        const epicTitle = epicId ? epics.find(e => e.id === epicId)?.title || epicId : '(none)';
        return {
          name: `${t.id} - ${t.title}  [Epic: ${epicTitle}]`,
          value: t.id,
        };
      }),
    }]);

    if (selectedTickets.length === 0) {
      this.log(colors.textMuted('No tickets selected.'));
      return;
    }

    // Select target epic
    let targetEpic = flags['to-epic'];
    if (!targetEpic) {
      const { epic } = await inquirer.prompt([{
        type: 'list',
        name: 'epic',
        message: 'Link to which epic?',
        choices: [
          { name: 'None (remove epic link)', value: null },
          ...epics.map(e => ({
            name: `${e.title} (${e.status})`,
            value: e.id,
          })),
        ],
      }]);
      targetEpic = epic;
    }

    // Confirmation
    if (!flags.force) {
      const epicLabel = targetEpic
        ? epics.find(e => e.id === targetEpic)?.title || targetEpic
        : 'None (removing link)';

      this.log(colors.text('\nWill link to epic:'));
      this.log(colors.text(`  → ${epicLabel}\n`));
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
          { name: '✅ Yes, link tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    this.log('');

    // Link each ticket
    let successCount = 0;
    let failCount = 0;

    for (const ticketId of selectedTickets) {
      try {
        db.prepare(`
          UPDATE pmo_tickets
          SET epic_id = ?, updated_at = ?
          WHERE id = ?
        `).run(targetEpic, Date.now(), ticketId);

        const action = targetEpic ? `Linked to ${targetEpic}` : 'Removed epic link';
        this.log(format.success(`${ticketId}: ${action}`));
        successCount++;
      } catch (error) {
        this.log(format.error(`Failed to link ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      const action = targetEpic ? 'Linked' : 'Unlinked';
      this.log(format.success(`${action} ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(format.error(`Failed to link ${failCount} ticket(s)`));
    }
  }
}
