import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { SQLiteStorage, findPMO } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectUnarchive extends Command {
  static description = 'Unarchive a project (restore to default views)';

  static examples = [
    '<%= config.bin %> <%= command.id %> old-project',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ProjectUnarchive);

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

      if (!project.isArchived) {
        await storage.close();
        this.log(styles.muted(`Project "${project.name}" is not archived.`));
        return;
      }

      await storage.unarchiveProject(args.id);

      await storage.close();

      this.log(styles.success(`\nUnarchived project "${project.name}"`));
      this.log(styles.muted('View project: prlt project view ' + args.id));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
