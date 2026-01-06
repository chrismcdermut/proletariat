import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketProject extends Command {
  static description = 'Move a ticket to a different project';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 new-project',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID',
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
    'keep-epic': Flags.boolean({
      description: 'Keep ticket assigned to its epic (if epic is in source project, will unlink)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketProject);

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const sourceProjectId = storage.getCurrentProjectId();

      // Get ticket ID
      let ticketId = args.ticketId;
      if (!ticketId) {
        const tickets = await storage.listTickets();
        if (tickets.length === 0) {
          this.log(styles.muted('\nNo tickets found in this project.'));
          await storage.close();
          return;
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select ticket to move:',
          choices: tickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.column})`,
            value: t.id,
          })),
        }]);
        ticketId = selected;
      }

      // Get ticket details
      const ticket = await storage.getTicket(ticketId!);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket not found: ${ticketId}`);
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
        this.log(styles.muted('\nTicket is already in this project.'));
        await storage.close();
        return;
      }

      // Get database for direct updates
      const db = (storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown } } }).db;

      // Check if ticket has an epic
      const epicWarning = ticket.epicId && !flags['keep-epic'];
      if (epicWarning) {
        const epic = await storage.getEpic(ticket.epicId!);
        if (epic && epic.projectId !== targetProjectId) {
          this.log(styles.warning(`\nTicket is assigned to epic "${ticket.epicId}" in source project.`));
          const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'How to handle epic assignment?',
            choices: [
              { name: 'Unlink from epic (move ticket only)', value: 'unlink' },
              { name: 'Cancel', value: 'cancel' },
            ],
          }]);

          if (action === 'cancel') {
            await storage.close();
            return;
          }

          // Unlink from epic
          db.prepare(`
            UPDATE pmo_tickets
            SET epic_id = NULL, updated_at = ?
            WHERE id = ?
          `).run(Date.now(), ticketId);
          this.log(styles.muted(`  Unlinked from epic "${ticket.epicId}"`));
        }
      }

      // Get target project's first column (Backlog typically)
      const targetBoard = await storage.getProjectBoard(targetProjectId!);
      const targetColumn = targetBoard?.columns[0]?.name || 'Backlog';

      // Move ticket to new project
      db.prepare(`
        UPDATE pmo_tickets
        SET project_id = ?, updated_at = ?
        WHERE id = ?
      `).run(targetProjectId, Date.now(), ticketId);

      // Update board position
      db.prepare(`
        DELETE FROM pmo_board_tickets
        WHERE ticket_id = ?
      `).run(ticketId);

      // Get position in target column
      const posResult = db.prepare(`
        SELECT COALESCE(MAX(position), -1) + 1 as next_pos
        FROM pmo_board_tickets
        WHERE project_id = ? AND column_id = ?
      `).get(targetProjectId, targetColumn) as { next_pos: number };

      db.prepare(`
        INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
        VALUES (?, ?, ?, ?)
      `).run(targetProjectId, ticketId, targetColumn, posResult.next_pos);

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(ticketId!)} to project ${styles.emphasis(targetProjectId!)}`));
      this.log(styles.muted(`   From: ${sourceProjectId}`));
      this.log(styles.muted(`   To: ${targetProjectId} (column: ${targetColumn})`));
      this.log(styles.muted(`\nView ticket: prlt ticket view ${ticketId}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
