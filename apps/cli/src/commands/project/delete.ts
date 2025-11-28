import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { SQLiteStorage, getSpecFolderPath, findPMO } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectDelete extends Command {
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
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProjectDelete);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const hqPath = path.dirname(pmoPath);
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');

    if (!fs.existsSync(dbPath)) {
      this.error('Database not found. Run "prlt init" first.');
    }

    const storage = new SQLiteStorage(dbPath);

    try {
      // Get project ID - prompt if not provided
      let projectId = args.id;

      if (!projectId) {
        const projects = await storage.listProjects();

        if (projects.length === 0) {
          await storage.close();
          this.error('No projects found.');
        }

        const deletableProjects = projects.filter(p => p.id !== 'default');

        if (deletableProjects.length === 0) {
          await storage.close();
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
        await storage.close();
        this.error('Cannot delete the default project.');
      }

      // Check if project exists
      const project = await storage.getProject(projectId!);
      if (!project) {
        await storage.close();
        this.error(`Project "${projectId}" not found.`);
      }

      // Get ticket count
      storage.setCurrentProject(projectId!);
      const tickets = await storage.listTickets();
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
          await storage.close();
          return;
        }
      }

      // Delete project from database
      await storage.deleteProject(projectId!);

      // Delete entire project folder: pmo/projects/{projectId}/
      // This includes board.md and specs/ directory
      const projectPath = path.join(pmoPath, 'projects', projectId!);
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }

      await storage.close();

      this.log(styles.success(`Deleted project "${project.name}"`));
      if (ticketCount > 0) {
        this.log(styles.muted(`  (${ticketCount} ticket(s) removed)`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
