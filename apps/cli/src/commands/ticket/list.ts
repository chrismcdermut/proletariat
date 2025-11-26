import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { Ticket, getStorageWithAutoSync } from '../../lib/pmo/index.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class TicketList extends Command {
  static description = 'List tickets from the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --column Backlog',
    '<%= config.bin %> <%= command.id %> --priority URGENT',
    '<%= config.bin %> <%= command.id %> --category bug',
    '<%= config.bin %> <%= command.id %> --search "login"',
  ];

  static flags = {
    column: Flags.string({
      char: 'c',
      description: 'Filter by column',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Filter by priority',
      options: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
    }),
    category: Flags.string({
      description: 'Filter by category',
    }),
    search: Flags.string({
      char: 's',
      description: 'Search in title and description',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'compact', 'json'],
      default: 'table',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show all columns (including Done)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketList);

    // Find PMO directory
    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Load PMO config
    const configPath = path.join(pmoPath, 'config.json');
    if (!fs.existsSync(configPath)) {
      this.error('PMO config not found. Run "prlt pmo init" first.');
    }

    const config: PMOConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Get storage with auto-sync from board.md (read-only, no export needed)
    const storage = getStorageWithAutoSync(
      pmoPath,
      config.storage,
      (msg) => this.log(chalk.gray(msg))
    );

    try {
      // Build filter
      const filter: {
        column?: string;
        priority?: string;
        category?: string;
        search?: string;
      } = {};

      if (flags.column) {
        filter.column = flags.column;
      }
      if (flags.priority) {
        filter.priority = flags.priority;
      }
      if (flags.category) {
        filter.category = flags.category;
      }
      if (flags.search) {
        filter.search = flags.search;
      }

      const tickets = await storage.listTickets(filter);
      await storage.close();

      if (tickets.length === 0) {
        this.log(chalk.yellow('No tickets found.'));
        return;
      }

      // Output based on format
      switch (flags.format) {
        case 'json':
          this.log(JSON.stringify(tickets, null, 2));
          break;
        case 'compact':
          this.outputCompact(tickets, config.columns, flags.all);
          break;
        default:
          this.outputTable(tickets, config.columns, flags.all);
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private outputTable(tickets: Ticket[], columns: string[], showAll: boolean): void {
    // Group tickets by column
    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) {
      byColumn[col] = [];
    }
    for (const ticket of tickets) {
      if (!byColumn[ticket.column]) {
        byColumn[ticket.column] = [];
      }
      byColumn[ticket.column].push(ticket);
    }

    // Display each column with tickets
    for (const col of columns) {
      const colTickets = byColumn[col];

      // Skip Done column unless --all flag
      if (col === 'Done' && !showAll && colTickets.length === 0) {
        continue;
      }

      // Column header with color
      const headerColor = this.getColumnColor(col);
      this.log(headerColor(`\n${this.getColumnEmoji(col)} ${col} (${colTickets.length})`));
      this.log(chalk.gray('─'.repeat(50)));

      if (colTickets.length === 0) {
        this.log(chalk.gray('  (empty)'));
        continue;
      }

      // Sort by position
      colTickets.sort((a, b) => a.position - b.position);

      for (const ticket of colTickets) {
        const priorityBadge = this.formatPriority(ticket.priority);
        const categoryBadge = ticket.category ? chalk.cyan(`[${ticket.category}]`) : '';

        this.log(`  ${chalk.bold(ticket.id)} ${ticket.title} ${priorityBadge} ${categoryBadge}`);

        if (ticket.description) {
          const shortDesc = ticket.description.split('\n')[0].substring(0, 60);
          this.log(chalk.gray(`     ${shortDesc}${ticket.description.length > 60 ? '...' : ''}`));
        }

        if (ticket.subtasks.length > 0) {
          const done = ticket.subtasks.filter(s => s.done).length;
          this.log(chalk.gray(`     Subtasks: ${done}/${ticket.subtasks.length}`));
        }
      }
    }

    // Summary
    this.log(chalk.gray('\n─'.repeat(50)));
    this.log(chalk.bold(`Total: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`));
  }

  private outputCompact(tickets: Ticket[], columns: string[], showAll: boolean): void {
    // Group by column
    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) {
      byColumn[col] = [];
    }
    for (const ticket of tickets) {
      if (!byColumn[ticket.column]) {
        byColumn[ticket.column] = [];
      }
      byColumn[ticket.column].push(ticket);
    }

    for (const col of columns) {
      const colTickets = byColumn[col];

      if (col === 'Done' && !showAll && colTickets.length === 0) {
        continue;
      }

      if (colTickets.length === 0) continue;

      const headerColor = this.getColumnColor(col);
      this.log(headerColor(`${col}:`));

      colTickets.sort((a, b) => a.position - b.position);

      for (const ticket of colTickets) {
        const priority = ticket.priority ? chalk.yellow(`[${ticket.priority}]`) : '';
        this.log(`  ${ticket.id}: ${ticket.title} ${priority}`);
      }
    }
  }

  private formatPriority(priority?: string): string {
    if (!priority) return '';

    switch (priority) {
      case 'URGENT':
        return chalk.red.bold(`[${priority}]`);
      case 'HIGH':
        return chalk.red(`[${priority}]`);
      case 'MEDIUM':
        return chalk.yellow(`[${priority}]`);
      case 'LOW':
        return chalk.gray(`[${priority}]`);
      default:
        return chalk.gray(`[${priority}]`);
    }
  }

  private getColumnColor(column: string): chalk.Chalk {
    if (column.includes('BL')) {
      // Backlog columns
      if (column.includes('BUILD')) return chalk.magenta;
      if (column.includes('GROW')) return chalk.green;
      if (column.includes('SUPPORT')) return chalk.yellow;
      if (column.includes('BIZOPS')) return chalk.blue;
      if (column.includes('STRATEGY')) return chalk.cyan;
    }

    switch (column) {
      case 'Backlog':
      case 'Ready':
        return chalk.blue;
      case 'In Progress':
        return chalk.yellow;
      case 'In Review':
        return chalk.magenta;
      case 'Blocked':
        return chalk.red;
      case 'Done':
      case 'Merged':
      case 'Published':
        return chalk.green;
      case 'Dropped':
        return chalk.gray;
      default:
        return chalk.white;
    }
  }

  private getColumnEmoji(column: string): string {
    const emojis: Record<string, string> = {
      'Backlog': '📥',
      'In Progress': '🚀',
      'In Review': '👀',
      'Blocked': '🚧',
      'Done': '✅',
      'BUILD BL': '🔨',
      'GROW BL': '📈',
      'SUPPORT BL': '🛟',
      'BIZOPS BL': '⚙️',
      'STRATEGY BL': '🎯',
      'Ready': '📥',
      'Merged': '🔀',
      'Published': '🚀',
      'Dropped': '🗑️',
    };
    return emojis[column] || '📋';
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
          if (config.pmoPath) {
            const absolutePath = path.isAbsolute(config.pmoPath)
              ? config.pmoPath
              : path.join(currentDir, config.pmoPath);
            if (fs.existsSync(path.join(absolutePath, 'config.json'))) {
              return absolutePath;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      const dotPmoPath = path.join(currentDir, '.pmo');
      if (fs.existsSync(path.join(dotPmoPath, 'config.json'))) {
        return dotPmoPath;
      }

      const pmoPath = path.join(currentDir, 'pmo');
      if (fs.existsSync(path.join(pmoPath, 'config.json'))) {
        return pmoPath;
      }

      currentDir = path.dirname(currentDir);
    }

    const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
        if (config.defaultPMO && fs.existsSync(path.join(config.defaultPMO, 'config.json'))) {
          return config.defaultPMO;
        }
      } catch {
        // Ignore parse errors
      }
    }

    return null;
  }
}
