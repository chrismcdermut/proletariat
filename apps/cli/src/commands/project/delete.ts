import { Args, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectDelete extends PMOCommand {
  static description = 'Delete a project from the PMO';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> my-project --force',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID to delete - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectDelete);

    // Get project ID - prompt if not provided
    let projectId = args.id;

    if (!projectId) {
      const projects = await this.storage.listProjects();

      if (projects.length === 0) {
        this.error('No projects found.');
      }

      const deletableProjects = projects.filter(p => p.id !== 'default');

      if (deletableProjects.length === 0) {
        this.error('No deletable projects found. Cannot delete the default project.');
      }

      const { selectedProjectId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedProjectId',
        message: 'Select project to delete:',
        choices: deletableProjects.map(p => ({
          name: `${p.id} - ${p.name}`,
          value: p.id,
        })),
      }]);
      projectId = selectedProjectId;
    }

    if (projectId === 'default') {
      this.error('Cannot delete the default project.');
    }

    // Check if project exists
    const project = await this.storage.getProject(projectId!);
    if (!project) {
      this.error(`Project "${projectId}" not found.`);
    }

    // Get ticket count
    this.storage.setCurrentProject(projectId!);
    const tickets = await this.storage.listTickets();
    const ticketCount = tickets.length;

    // Confirm deletion
    if (!flags.force) {
      const message = ticketCount > 0
        ? `Delete project "${project.name}" and its ${ticketCount} ticket(s)?`
        : `Delete project "${project.name}"?`;

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message,
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, delete', value: true },
        ],
        default: 0,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    // Delete project from database
    await this.storage.deleteProject(projectId!);

    // Delete entire project folder: pmo/projects/{projectId}/
    // This includes board.md and specs/ directory
    const projectPath = path.join(this.pmoPath, 'projects', projectId!);
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }

    this.log(styles.success(`Deleted project "${project.name}"`));
    if (ticketCount > 0) {
      this.log(styles.muted(`  (${ticketCount} ticket(s) removed)`));
    }
  }
}
