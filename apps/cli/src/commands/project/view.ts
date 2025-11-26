import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { SQLiteStorage } from '../../lib/pmo/index.js';
import { styles, getColumnStyle, getColumnEmoji, formatPriority, formatCategory } from '../../lib/styles.js';

export default class ProjectView extends Command {
  static description = 'View a project\'s board';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %>  # Views default project',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID to view (default: "default")',
      required: false,
      default: 'default',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ProjectView);

    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const hqPath = path.dirname(pmoPath);
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');

    if (!fs.existsSync(dbPath)) {
      this.error('Database not found. Run "prlt init" first.');
    }

    const storage = new SQLiteStorage(dbPath, args.id);

    try {
      const project = await storage.getProject(args.id);
      if (!project) {
        await storage.close();
        this.error(`Project "${args.id}" not found.`);
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
