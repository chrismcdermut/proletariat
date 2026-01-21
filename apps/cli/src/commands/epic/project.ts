import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class EpicProject extends PMOCommand {
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
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'with-tickets': Flags.boolean({
      char: 't',
      description: 'Also move all tickets assigned to this epic',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicProject);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic project', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const sourceProjectId = await this.requireProject();

    // Get epic ID
    let epicId = args.epicId;
    if (!epicId) {
      const epics = await this.storage.listEpics(sourceProjectId);
      if (epics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EPICS', 'No epics found in this project.', createMetadata('epic project', flags));
          return;
        }
        this.log(styles.muted('\nNo epics found in this project.'));
        return;
      }

      // In JSON mode, output epic selection prompt
      if (jsonMode) {
        const epicChoices = epics.map(e => ({ name: `${e.id} - ${e.title} (${e.status})`, value: e.id }));
        outputPromptAsJson(
          buildPromptConfig('list', 'epicId', 'Select epic to move:', epicChoices),
          createMetadata('epic project', flags)
        );
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
    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    // Get all projects
    const projects = await this.storage.listProjects();
    const otherProjects = projects.filter(p => p.id !== sourceProjectId);

    if (otherProjects.length === 0) {
      if (jsonMode) {
        const actionChoices = [
          { name: 'Create a new project', value: 'create' },
          { name: 'Cancel', value: 'cancel' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'action', 'No other projects to move to. What would you like to do?', actionChoices),
          createMetadata('epic project', flags)
        );
        return;
      }

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

      if (action === 'create') {
        await this.config.runCommand('project:create', []);
      }
      return;
    }

    // Get target project
    let targetProjectId = args.targetProject;
    if (!targetProjectId) {
      // In JSON mode, output project selection prompt
      if (jsonMode) {
        const projectChoices = otherProjects.map(p => ({ name: `${p.id} - ${p.name} (${p.status})`, value: p.id }));
        outputPromptAsJson(
          buildPromptConfig('list', 'targetProject', 'Select target project:', projectChoices),
          createMetadata('epic project', flags)
        );
        return;
      }

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
      this.error(`Project not found: ${targetProjectId}`);
    }

    if (targetProjectId === sourceProjectId) {
      this.log(styles.muted('\nEpic is already in this project.'));
      return;
    }

    // Get database for direct updates
    const db = (this.storage as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } } }).db;

    // Get tickets associated with this epic
    const epicTickets = await this.storage.getTicketsForEpic(sourceProjectId, epicId!);

    // Handle tickets
    let moveTickets = flags['with-tickets'];
    if (epicTickets.length > 0 && !flags['with-tickets']) {
      // In JSON mode, output ticket handling prompt
      if (jsonMode) {
        const ticketActionChoices = [
          { name: 'Move tickets with epic', value: 'move' },
          { name: 'Keep tickets in source project (unlink from epic)', value: 'unlink' },
          { name: 'Cancel', value: 'cancel' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'ticketAction', `Epic has ${epicTickets.length} ticket(s) assigned. How to handle tickets?`, ticketActionChoices),
          createMetadata('epic project', flags)
        );
        return;
      }

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
      const targetBoard = await this.storage.getProjectBoard(targetProjectId!);
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

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

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
  }
}
