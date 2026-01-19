import { Args, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get project ID - prompt if not provided
    let projectId = args.id;

    if (!projectId) {
      const projects = await this.storage.listProjects();

      if (projects.length === 0) {
        return handleError('NO_PROJECTS', 'No projects found.');
      }

      const deletableProjects = projects.filter(p => p.id !== 'default');

      if (deletableProjects.length === 0) {
        return handleError('NO_DELETABLE_PROJECTS', 'No deletable projects found. Cannot delete the default project.');
      }

      // In JSON mode, output project selection prompt
      if (jsonMode) {
        const projectChoices = deletableProjects.map(p => ({ name: `${p.id} - ${p.name}`, value: p.id }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select project to delete:', projectChoices),
          createMetadata('project delete', flags)
        );
        return;
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
      return handleError('CANNOT_DELETE_DEFAULT', 'Cannot delete the default project.');
    }

    // Check if project exists
    const project = await this.storage.getProject(projectId!);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`);
    }

    // Get ticket count
    const tickets = await this.storage.listTickets(projectId!);
    const ticketCount = tickets.length;

    // Confirm deletion
    if (!flags.force) {
      const message = ticketCount > 0
        ? `Delete project "${project.name}" and its ${ticketCount} ticket(s)?`
        : `Delete project "${project.name}"?`;

      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No, cancel', value: 'false' },
          { name: 'Yes, delete', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', message, confirmChoices),
          createMetadata('project delete', flags)
        );
        return;
      }

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
