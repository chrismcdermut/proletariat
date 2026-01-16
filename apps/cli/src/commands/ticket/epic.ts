import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TicketEpic extends PMOCommand {
  static description = 'Assign ticket(s) to an epic (parent-child relationship)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 EPIC-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --unlink',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --bulk --to-epic EPIC-001',
  ];

  static args = {
    id: Args.string({
      description: 'Ticket ID',
      required: false,
    }),
    'epic-id': Args.string({
      description: 'Epic ID to link to',
      required: false,
    }),
  };

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
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove epic link instead of adding',
      default: false,
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to link multiple tickets to an epic',
      default: false,
    }),
    'to-epic': Flags.string({
      description: 'Target epic ID (for bulk mode)',
    }),
    'from-epic': Flags.string({
      description: 'Filter tickets by current epic (bulk mode)',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (bulk mode)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketEpic);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(flags);
      return;
    }

    // Get all tickets
    const allTickets = await this.storage.listTickets();
    if (allTickets.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TICKETS', 'No tickets found.', createMetadata('ticket epic', flags));
        return;
      }
      this.log(styles.muted('\nNo tickets found.'));
      return;
    }

    // Get all epics
    const epics = await this.storage.listEpics();

    // Get epic_id for each ticket via direct DB query
    const db = (this.storage as unknown as { db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => void } } }).db;
    const getTicketEpicId = (ticketId: string): string | null => {
      const row = db.prepare(`SELECT epic_id FROM pmo_tickets WHERE id = ?`).get(ticketId) as { epic_id: string | null } | undefined;
      return row?.epic_id || null;
    };

    let ticketId = args.id;
    let epicId = args['epic-id'];

    // If unlinking, we don't need an epic ID
    if (flags.unlink) {
      epicId = undefined;
    }

    // If no ticket ID provided, prompt for selection
    if (!ticketId) {
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select ticket to link:',
        choices: allTickets.map((t: Ticket) => {
          const currentEpicId = getTicketEpicId(t.id);
          const epicLabel = currentEpicId
            ? epics.find(e => e.id === currentEpicId)?.title || currentEpicId
            : 'No epic';
          return {
            name: `${t.id} - ${t.title} (${t.statusName || t.status}) [${epicLabel}]`,
            value: t.id,
          };
        }),
      }]);
      ticketId = selected;
    }

    // Validate ticket exists
    const ticket = allTickets.find((t: Ticket) => t.id === ticketId);
    if (!ticket) {
      this.error(`Ticket not found: ${ticketId}`);
    }

    const currentEpicId = getTicketEpicId(ticketId!);

    // If unlinking, just remove the link
    if (flags.unlink) {
      if (!currentEpicId) {
        this.log(styles.muted(`\nTicket ${ticketId} is not linked to any epic.`));
        return;
      }

      const currentEpic = epics.find(e => e.id === currentEpicId);

      // Update the ticket
      db.prepare(`
        UPDATE pmo_tickets
        SET epic_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), ticketId);

      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

      this.log(styles.success(`\n✅ Unlinked ${styles.emphasis(ticketId)} from ${currentEpic?.title || currentEpicId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      return;
    }

    // If no epic ID provided, prompt for selection
    if (!epicId) {
      const choices = [
        ...epics.map(e => ({
          name: `${e.id} ${e.title} (${e.status})${e.id === currentEpicId ? ' ← current' : ''}`,
          value: e.id,
        })),
      ];

      if (currentEpicId) {
        choices.push(new inquirer.Separator() as unknown as { name: string; value: string });
        choices.push({ name: 'None (remove epic link)', value: '__none__' });
      }

      if (choices.length === 0 || (choices.length === 2 && currentEpicId)) {
        this.log(styles.muted('\nNo epics found. Create one with: prlt epic create'));
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Link to which epic?',
        choices,
      }]);

      if (selected === '__none__') {
        // Unlink
        db.prepare(`
          UPDATE pmo_tickets
          SET epic_id = NULL, updated_at = ?
          WHERE id = ?
        `).run(Date.now(), ticketId);

        const currentEpic = epics.find(e => e.id === currentEpicId);
        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

        this.log(styles.success(`\n✅ Unlinked ${styles.emphasis(ticketId)} from ${currentEpic?.title || currentEpicId}`));
        this.log(styles.muted(`   Title: ${ticket.title}`));
        return;
      }

      epicId = selected;
    }

    // Validate epic exists
    const epic = epics.find(e => e.id === epicId);
    if (!epic) {
      this.error(`Epic not found: ${epicId}`);
    }

    // Check if already linked to this epic
    if (currentEpicId === epicId) {
      this.log(styles.muted(`\nTicket ${ticketId} is already linked to ${epic.title}.`));
      return;
    }

    // Update the ticket
    db.prepare(`
      UPDATE pmo_tickets
      SET epic_id = ?, updated_at = ?
      WHERE id = ?
    `).run(epicId, Date.now(), ticketId);

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Linked ${styles.emphasis(ticketId)} to ${styles.emphasis(epicId!)}`));
    this.log(styles.muted(`   Title: ${ticket.title}`));
    this.log(styles.muted(`   Epic: ${epic.title}`));
  }

  private async executeBulk(flags: {
    'to-epic'?: string;
    'from-epic'?: string;
    force: boolean;
    unlink: boolean;
  }): Promise<void> {
    this.log(styles.emphasis('🔗 Link Tickets to Epic\n'));

    // Get all tickets
    const allTickets = await this.storage.listTickets();

    if (allTickets.length === 0) {
      this.log(styles.warning('No tickets found.'));
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
      this.log(styles.warning('No tickets found matching filter.'));
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
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Select target epic
    let targetEpic: string | null | undefined = flags['to-epic'];
    if (targetEpic === undefined) {
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

      this.log(styles.primary('\nWill link to epic:'));
      this.log(styles.primary(`  → ${epicLabel}\n`));
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
          { name: 'Yes, link tickets', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(styles.muted('Operation cancelled.'));
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
        this.log(styles.success(`${ticketId}: ${action}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to link ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      const action = targetEpic ? 'Linked' : 'Unlinked';
      this.log(styles.success(`${action} ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to link ${failCount} ticket(s)`));
    }
  }
}
