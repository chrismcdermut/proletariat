import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { SQLiteStorage, findPMO } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectArchive extends Command {
  static description = 'Archive a project (hide from default views)';

  static examples = [
    '<%= config.bin %> <%= command.id %> old-project',
    '<%= config.bin %> <%= command.id %> old-project --force',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID',
      required: true,
    }),
  };

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProjectArchive);

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
      const project = await storage.getProject(args.id);
      if (!project) {
        await storage.close();
        this.error(`Project "${args.id}" not found.`);
      }

      if (project.isArchived) {
        await storage.close();
        this.log(styles.muted(`Project "${project.name}" is already archived.`));
        return;
      }

      if (!flags.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: `Archive project "${project.name}"? It will be hidden from default views.`,
          default: false,
        }]);

        if (!confirm) {
          this.log(styles.muted('Cancelled.'));
          await storage.close();
          return;
        }
      }

      await storage.archiveProject(args.id);

      await storage.close();

      this.log(styles.success(`\nArchived project "${project.name}"`));
      this.log(styles.muted('View archived projects: prlt project list --archived'));
      this.log(styles.muted('Unarchive: prlt project unarchive ' + args.id));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
