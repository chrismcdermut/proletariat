import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
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

      const epicChoices = epics.map(e => ({
        name: `${e.id} - ${e.title} (${e.status})`,
        value: e.id,
        command: `prlt epic project ${e.id} --json`,
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic project' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to move:',
        choices: epicChoices,
      }], jsonModeConfig);
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
      if (!jsonMode) {
        this.log(styles.muted('\nNo other projects to move to.'));
      }

      const actionChoices = [
        { name: 'Create a new project', value: 'create', command: 'prlt project create --json' },
        { name: 'Cancel', value: 'cancel', command: '' },
      ];

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic project' } : null;
      const { action } = await this.prompt<{ action: string }>([{
        type: 'list',
        name: 'action',
        message: 'No other projects to move to. What would you like to do?',
        choices: actionChoices,
      }], jsonModeConfig);

      if (action === 'create') {
        await this.config.runCommand('project:create', []);
      }
      return;
    }

    // Get target project
    let targetProjectId = args.targetProject;
    if (!targetProjectId) {
      const projectChoices = otherProjects.map(p => ({
        name: `${p.id} - ${p.name} (${p.status})`,
        value: p.id,
        command: `prlt epic project ${epicId} ${p.id} --json`,
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic project' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select target project:',
        choices: projectChoices,
      }], jsonModeConfig);
      targetProjectId = selected;
    }

    // Validate target project
    const targetProject = projects.find(p => p.id === targetProjectId);
    if (!targetProject) {
      return handleError('PROJECT_NOT_FOUND', `Project not found: ${targetProjectId}`);
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
      if (!jsonMode) {
        this.log(styles.warning(`\nEpic has ${epicTickets.length} ticket(s) assigned.`));
      }

      const ticketActionChoices = [
        { name: 'Move tickets with epic', value: 'move', command: `prlt epic project ${epicId} ${targetProjectId} --with-tickets --json` },
        { name: 'Keep tickets in source project (unlink from epic)', value: 'unlink', command: `prlt epic project ${epicId} ${targetProjectId} --json` },
        { name: 'Cancel', value: 'cancel', command: '' },
      ];

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic project' } : null;
      const { action } = await this.prompt<{ action: string }>([{
        type: 'list',
        name: 'action',
        message: `Epic has ${epicTickets.length} ticket(s) assigned. How to handle tickets?`,
        choices: ticketActionChoices,
      }], jsonModeConfig);

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
      // Get target project's default status
      const targetBoard = await this.storage.getProjectBoard(targetProjectId!);
      const targetStatusId = targetBoard?.columns[0]?.id;

      for (const ticket of epicTickets) {
        if (moveTickets) {
          // Move ticket to target project with its default status
          db.prepare(`
            UPDATE pmo_tickets
            SET project_id = ?, status_id = ?, updated_at = ?
            WHERE id = ?
          `).run(targetProjectId, targetStatusId, Date.now(), ticket.id);

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
