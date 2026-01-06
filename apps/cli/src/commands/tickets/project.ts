import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketsProject extends Command {
  static description = 'Bulk move tickets to a different project';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --target other-project',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Source project ID (default: current)',
    }),
    target: Flags.string({
      char: 't',
      description: 'Target project ID to move tickets to',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketsProject);

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const sourceProjectId = storage.getCurrentProjectId();

      // Get all tickets in current project
      const tickets = await storage.listTickets();
      if (tickets.length === 0) {
        this.log(styles.muted('\nNo tickets found in this project.'));
        await storage.close();
        return;
      }

      // Select tickets
      const { selectedTickets } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedTickets',
        message: 'Select tickets to move:',
        choices: tickets.map(t => {
          const epicLabel = t.epicId ? ` [epic: ${t.epicId}]` : '';
          return {
            name: `${t.id} - ${t.title} (${t.column})${epicLabel}`,
            value: t.id,
          };
        }),
      }]);

      if (selectedTickets.length === 0) {
        this.log(styles.muted('No tickets selected.'));
        await storage.close();
        return;
      }

      // Get target project
      const projects = await storage.listProjects();
      const otherProjects = projects.filter(p => p.id !== sourceProjectId);

      if (otherProjects.length === 0) {
        this.log(styles.muted('\nNo other projects to move to. Create one with: prlt project create'));
        await storage.close();
        return;
      }

      let targetProjectId = flags.target;

      if (!targetProjectId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select target project:',
          choices: otherProjects.map(p => ({
            name: `${p.id} - ${p.name}`,
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

      // Check for epic conflicts
      const ticketsWithEpics = selectedTickets.filter((id: string) => {
        const t = tickets.find(t => t.id === id);
        return t?.epicId;
      });

      if (ticketsWithEpics.length > 0) {
        this.log(styles.warning(`\n${ticketsWithEpics.length} ticket(s) are assigned to epics.`));
        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: 'How to handle epic assignments?',
          choices: [
            { name: 'Unlink from epics and move', value: 'unlink' },
            { name: 'Cancel', value: 'cancel' },
          ],
        }]);

        if (action === 'cancel') {
          await storage.close();
          return;
        }
      }

      // Get database for direct updates
      const db = (storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown } } }).db;

      // Get target project's first column
      const targetBoard = await storage.getProjectBoard(targetProjectId!);
      const targetColumn = targetBoard?.columns[0]?.name || 'Backlog';

      // Move each ticket
      for (const ticketId of selectedTickets) {
        const ticket = tickets.find(t => t.id === ticketId);

        // Unlink from epic if needed
        if (ticket?.epicId) {
          db.prepare(`
            UPDATE pmo_tickets
            SET epic_id = NULL, updated_at = ?
            WHERE id = ?
          `).run(Date.now(), ticketId);
        }

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

        const posResult = db.prepare(`
          SELECT COALESCE(MAX(position), -1) + 1 as next_pos
          FROM pmo_board_tickets
          WHERE project_id = ? AND column_id = ?
        `).get(targetProjectId, targetColumn) as { next_pos: number };

        db.prepare(`
          INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
          VALUES (?, ?, ?, ?)
        `).run(targetProjectId, ticketId, targetColumn, posResult.next_pos);

        this.log(styles.success(`  Moved ${ticketId} to ${targetProjectId}`));
      }

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      this.log(styles.success(`\n✅ Moved ${selectedTickets.length} ticket(s) to project "${targetProject.name}"`));
      this.log(styles.muted(`   Target column: ${targetColumn}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
