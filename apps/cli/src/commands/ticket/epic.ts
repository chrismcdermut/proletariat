import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';

export default class TicketEpic extends PMOCommand {
  static description = 'Assign a ticket to an epic (parent-child relationship)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 EPIC-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --unlink',
    '<%= config.bin %> <%= command.id %>',
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
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove epic link instead of adding',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketEpic);

    // Get all tickets
    const allTickets = await this.storage.listTickets();
    if (allTickets.length === 0) {
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
}
