import { Command } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { SQLiteStorage } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { findPMO } from '../../lib/find-pmo.js';

export default class ProjectList extends Command {
  static description = 'List all projects in the PMO';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
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
      const projects = await storage.listProjects();

      if (projects.length === 0) {
        this.log(styles.muted('No projects found. Create one with: prlt project create'));
        return;
      }

      this.log(styles.title('\nProjects\n'));

      for (const project of projects) {
        const isDefault = project.id === 'default';
        const marker = isDefault ? styles.success(' (default)') : '';

        this.log(`  ${styles.emphasis(project.name)}${marker}`);
        this.log(styles.muted(`    ID: ${project.id}`));
        this.log(styles.muted(`    Tickets: ${project.ticketCount}`));
        if (project.description) {
          this.log(styles.muted(`    ${project.description}`));
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
