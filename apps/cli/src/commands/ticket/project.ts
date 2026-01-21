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

export default class TicketProject extends PMOCommand {
  static description = 'Move ticket(s) to a different project';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 new-project',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --bulk --target other-project',
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
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'keep-epic': Flags.boolean({
      description: 'Keep ticket assigned to its epic (if epic is in source project, will unlink)',
      default: false,
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to move multiple tickets',
      default: false,
    }),
    target: Flags.string({
      char: 't',
      description: 'Target project ID (for bulk mode)',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketProject);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(flags);
      return;
    }

    // Get source project ID
    const sourceProjectId = await this.requireProject();

    // Get ticket ID
    let ticketId = args.ticketId;
    if (!ticketId) {
      const tickets = await this.storage.listTickets(sourceProjectId);
      if (tickets.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_TICKETS', 'No tickets found in this project.', createMetadata('ticket project', flags));
          return;
        }
        this.log(styles.muted('\nNo tickets found in this project.'));
        return;
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to move:',
        items: tickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket project ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket project' } : null,
      });

      if (!selected) {
        return;
      }
      ticketId = selected;
    }

    // Get ticket details
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket not found: ${ticketId}`);
    }

    // Get all projects
    const projects = await this.storage.listProjects();
    const otherProjects = projects.filter(p => p.id !== sourceProjectId);

    if (otherProjects.length === 0) {
      this.log(styles.muted('\nNo other projects to move to.'));
      const actionChoices = [
        { id: 'create', name: 'Create a new project' },
        { id: 'cancel', name: 'Cancel' },
      ];

      const action = await this.selectFromList({
        message: 'What would you like to do?',
        items: actionChoices,
        getName: (a) => a.name,
        getValue: (a) => a.id,
        getCommand: (a) => a.id === 'create' ? 'prlt project create --json' : '',
        jsonMode: jsonMode ? { flags, commandName: 'ticket project' } : null,
      });

      if (action === 'create') {
        await this.config.runCommand('project:create', []);
      }
      return;
    }

    // Get target project
    let targetProjectId = args.targetProject;
    if (!targetProjectId) {
      const selected = await this.selectFromList({
        message: 'Select target project:',
        items: otherProjects,
        getName: (p) => `${p.id} - ${p.name} (${p.status})`,
        getValue: (p) => p.id,
        getCommand: (p) => `prlt ticket project ${ticketId} ${p.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket project' } : null,
      });

      if (!selected) {
        return;
      }
      targetProjectId = selected;
    }

    // Validate target project
    const targetProject = projects.find(p => p.id === targetProjectId);
    if (!targetProject) {
      this.error(`Project not found: ${targetProjectId}`);
    }

    if (targetProjectId === sourceProjectId) {
      this.log(styles.muted('\nTicket is already in this project.'));
      return;
    }

    // Check if ticket has an epic
    const epicWarning = ticket.epicId && !flags['keep-epic'];
    if (epicWarning) {
      const epic = await this.storage.getEpic(ticket.epicId!);
      if (epic && epic.projectId !== targetProjectId) {
        this.log(styles.warning(`\nTicket is assigned to epic "${ticket.epicId}" in source project.`));

        const actionChoices = [
          { id: 'unlink', name: 'Unlink from epic (move ticket only)' },
          { id: 'cancel', name: 'Cancel' },
        ];

        const action = await this.selectFromList({
          message: 'How to handle epic assignment?',
          items: actionChoices,
          getName: (a) => a.name,
          getValue: (a) => a.id,
          getCommand: (a) => a.id === 'unlink' ? `prlt ticket project ${ticketId} ${targetProjectId} --json` : '',
          jsonMode: jsonMode ? { flags, commandName: 'ticket project' } : null,
        });

        if (action === 'cancel' || !action) {
          return;
        }

        // Unlink from epic before moving
        await this.storage.updateTicket(ticketId!, { epicId: undefined });
        this.log(styles.muted(`  Unlinked from epic "${ticket.epicId}"`));
      }
    }

    // Move ticket to new project using the storage method
    const movedTicket = await this.storage.moveTicketToProject(ticketId!, targetProjectId!);

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(ticketId!)} to project ${styles.emphasis(targetProjectId!)}`));
    this.log(styles.muted(`   From: ${sourceProjectId}`));
    this.log(styles.muted(`   To: ${targetProjectId} (column: ${movedTicket.statusName || 'first column'})`));
    this.log(styles.muted(`\nView ticket: prlt ticket view ${ticketId}`));
  }

  private async executeBulk(flags: { target?: string }): Promise<void> {
    this.log(styles.emphasis('📁 Bulk Move Tickets to Project\n'));

    // Get source project ID
    const sourceProjectId = await this.requireProject();

    // Get all tickets in current project
    const tickets = await this.storage.listTickets(sourceProjectId);
    if (tickets.length === 0) {
      this.log(styles.muted('\nNo tickets found in this project.'));
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
          name: `${t.id} - ${t.title} (${t.statusName})${epicLabel}`,
          value: t.id,
        };
      }),
    }]);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Get target project
    const projects = await this.storage.listProjects();
    const otherProjects = projects.filter(p => p.id !== sourceProjectId);

    if (otherProjects.length === 0) {
      this.log(styles.muted('\nNo other projects to move to. Create one with: prlt project create'));
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
        return;
      }
    }

    // Move each ticket using the storage method
    let lastMovedTicket;
    for (const ticketId of selectedTickets) {
      const ticket = tickets.find(t => t.id === ticketId);

      // Unlink from epic if needed
      if (ticket?.epicId) {
        await this.storage.updateTicket(ticketId, { epicId: undefined });
      }

      // Move ticket to new project
      lastMovedTicket = await this.storage.moveTicketToProject(ticketId, targetProjectId!);

      this.log(styles.success(`  Moved ${ticketId} to ${targetProjectId}`));
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Moved ${selectedTickets.length} ticket(s) to project "${targetProject.name}"`));
    this.log(styles.muted(`   Target column: ${lastMovedTicket?.statusName || 'first column'}`));
  }
}
