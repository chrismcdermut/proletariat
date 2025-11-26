import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { SQLiteStorage } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectDelete extends Command {
  static description = 'Delete a project from the PMO';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> my-project --force',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID to delete',
      required: true,
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

    if (args.id === 'default') {
      this.error('Cannot delete the default project.');
    }

    const pmoPath = this.findPMO();
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
      // Check if project exists
      const project = await storage.getProject(args.id);
      if (!project) {
        await storage.close();
        this.error(`Project "${args.id}" not found.`);
      }

      // Get ticket count
      storage.setCurrentProject(args.id);
      const tickets = await storage.listTickets();
      const ticketCount = tickets.length;

      // Confirm deletion
      if (!flags.force) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: ticketCount > 0
            ? `Delete project "${project.name}" and its ${ticketCount} ticket(s)?`
            : `Delete project "${project.name}"?`,
          default: false,
        }]);

        if (!confirm) {
          this.log(styles.muted('Cancelled.'));
          await storage.close();
          return;
        }
      }

      // Delete project
      await storage.deleteProject(args.id);

      // Delete board file if it exists
      const boardPath = path.join(pmoPath, `board-${args.id}.md`);
      if (fs.existsSync(boardPath)) {
        fs.unlinkSync(boardPath);
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

  private findPMO(): string | null {
    let currentDir = process.cwd();

    while (currentDir !== '/') {
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.type === 'hq') {
            const pmoPath = path.join(currentDir, 'pmo');
            if (fs.existsSync(path.join(pmoPath, 'config.json'))) {
              return pmoPath;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }
}
