import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class EpicProject extends Command {
  static description = 'Move an epic to a different project (optionally with its tickets)';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 new-project',
    '<%= config.bin %> <%= command.id %> EPIC-001 new-project --with-tickets',
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    epicId: Args.string({
      description: 'Epic ID',
      required: false,
    }),
    targetProject: Args.string({
      description: 'Target project ID',
      required: false,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Source project ID (default: current)',
    }),
    'with-tickets': Flags.boolean({
      char: 't',
      description: 'Also move all tickets assigned to this epic',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicProject);

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const sourceProjectId = storage.getCurrentProjectId();

      // Get epic ID
      let epicId = args.epicId;
      if (!epicId) {
        const epics = await storage.listEpics();
        if (epics.length === 0) {
          this.log(styles.muted('\nNo epics found in this project.'));
          await storage.close();
          return;
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic to move:',
          choices: epics.map(e => ({
            name: `${e.id} - ${e.title} (${e.status})`,
            value: e.id,
          })),
        }]);
        epicId = selected;
      }

      // Get epic details
      const epic = await storage.getEpic(epicId!);
      if (!epic) {
        await storage.close();
        this.error(`Epic not found: ${epicId}`);
      }

      // Get all projects
      const projects = await storage.listProjects();
      const otherProjects = projects.filter(p => p.id !== sourceProjectId);

      if (otherProjects.length === 0) {
        this.log(styles.muted('\nNo other projects to move to.'));
        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Create a new project', value: 'create' },
            { name: 'Cancel', value: 'cancel' },
          ],
        }]);

        await storage.close();

        if (action === 'create') {
          await this.config.runCommand('project:create', []);
        }
        return;
      }

      // Get target project
      let targetProjectId = args.targetProject;
      if (!targetProjectId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select target project:',
          choices: otherProjects.map(p => ({
            name: `${p.id} - ${p.name} (${p.status})`,
            value: p.id,
          })),
        }]);
        targetProjectId = selected;
      }

      // Validate target project
      const targetProject = projects.find(p => p.id === targetProjectId);
      if (!targetProject) {
        await storage.close();
        this.error(`Project not found: ${targetProjectId}`);
      }

      if (targetProjectId === sourceProjectId) {
        this.log(styles.muted('\nEpic is already in this project.'));
        await storage.close();
        return;
      }

      // Get database for direct updates
      const db = (storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } } }).db;

      // Get tickets associated with this epic
      const epicTickets = await storage.getTicketsForEpic(epicId!);

      // Handle tickets
      let moveTickets = flags['with-tickets'];
      if (epicTickets.length > 0 && !flags['with-tickets']) {
        this.log(styles.warning(`\nEpic has ${epicTickets.length} ticket(s) assigned.`));
        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: 'How to handle tickets?',
          choices: [
            { name: 'Move tickets with epic', value: 'move' },
            { name: 'Keep tickets in source project (unlink from epic)', value: 'unlink' },
            { name: 'Cancel', value: 'cancel' },
          ],
        }]);

        if (action === 'cancel') {
          await storage.close();
          return;
        }

        moveTickets = action === 'move';
      }

      // Move epic to new project
      db.prepare(`
        UPDATE pmo_epics
        SET project_id = ?, updated_at = ?
        WHERE id = ?
      `).run(targetProjectId, Date.now(), epicId);

      // Handle tickets
      const movedTicketIds: string[] = [];
      if (epicTickets.length > 0) {
        // Get target project's first column
        const targetBoard = await storage.getProjectBoard(targetProjectId!);
        const targetColumn = targetBoard?.columns[0]?.name || 'Backlog';

        for (const ticket of epicTickets) {
          if (moveTickets) {
            // Move ticket to target project
            db.prepare(`
              UPDATE pmo_tickets
              SET project_id = ?, updated_at = ?
              WHERE id = ?
            `).run(targetProjectId, Date.now(), ticket.id);

            // Update board position
            db.prepare(`
              DELETE FROM pmo_board_tickets
              WHERE ticket_id = ?
            `).run(ticket.id);

            const posResult = db.prepare(`
              SELECT COALESCE(MAX(position), -1) + 1 as next_pos
              FROM pmo_board_tickets
              WHERE project_id = ? AND column_id = ?
            `).get(targetProjectId, targetColumn) as { next_pos: number };

            db.prepare(`
              INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
              VALUES (?, ?, ?, ?)
            `).run(targetProjectId, ticket.id, targetColumn, posResult.next_pos);

            movedTicketIds.push(ticket.id);
          } else {
            // Unlink ticket from epic (keep in source project)
            db.prepare(`
              UPDATE pmo_tickets
              SET epic_id = NULL, updated_at = ?
              WHERE id = ?
            `).run(Date.now(), ticket.id);
          }
        }
      }

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      this.log(styles.success(`\n✅ Moved epic ${styles.emphasis(epicId!)} to project ${styles.emphasis(targetProjectId!)}`));
      this.log(styles.muted(`   From: ${sourceProjectId}`));
      this.log(styles.muted(`   To: ${targetProjectId}`));

      if (movedTicketIds.length > 0) {
        this.log(styles.muted(`\n   Moved ${movedTicketIds.length} ticket(s) with epic:`));
        for (const ticketId of movedTicketIds) {
          this.log(styles.muted(`     - ${ticketId}`));
        }
      } else if (epicTickets.length > 0) {
        this.log(styles.muted(`\n   ${epicTickets.length} ticket(s) unlinked and kept in source project.`));
      }

      this.log(styles.muted(`\nView epic: prlt epic view ${epicId}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
