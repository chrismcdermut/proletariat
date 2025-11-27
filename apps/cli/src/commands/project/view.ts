import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { SQLiteStorage } from '../../lib/pmo/index.js';
import { styles, getColumnStyle, getColumnEmoji, formatPriority, formatCategory } from '../../lib/styles.js';
import { findPMO } from '../../lib/find-pmo.js';

export default class ProjectView extends Command {
  static description = 'View a project\'s board';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %>  # Views default project',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID to view - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ProjectView);

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
          this.error('No projects found. Create a project first with "prlt project create".');
        }

        const { selectedProjectId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedProjectId',
          message: 'Select project to view:',
          choices: projects.map(p => ({
            name: `${p.id} - ${p.name}`,
            value: p.id,
          })),
        }]);
        projectId = selectedProjectId;
      }

      storage.setCurrentProject(projectId!);

      const project = await storage.getProject(projectId!);
      if (!project) {
        await storage.close();
        this.error(`Project "${projectId}" not found.`);
      }

      this.log(styles.title(`\n${project.name}`));
      this.log(styles.muted(`Project: ${project.id}\n`));

      for (const column of project.columns) {
        const emoji = getColumnEmoji(column.name);
        const columnStyle = getColumnStyle(column.name);

        this.log(columnStyle(`${emoji} ${column.name} (${column.tickets.length})`));

        if (column.tickets.length === 0) {
          this.log(styles.muted('    (empty)'));
        } else {
          for (const ticket of column.tickets) {
            const priority = formatPriority(ticket.priority);
            const category = formatCategory(ticket.category);
            const badges = [priority, category].filter(Boolean).join(' ');

            this.log(`    ${styles.code(ticket.id)} ${ticket.title}${badges ? ' ' + badges : ''}`);

            // Show subtasks if any
            if (ticket.subtasks.length > 0) {
              const done = ticket.subtasks.filter(s => s.done).length;
              const total = ticket.subtasks.length;
              this.log(styles.muted(`      [${done}/${total}] subtasks`));
            }
          }
        }
        this.log('');
      }

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
