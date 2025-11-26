import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  SQLiteStorage,
  Board,
  Ticket,
  parseBoard,
  findAddedTickets,
  findRemovedTickets,
  findModifiedTickets,
  getStorageWithAutoSync,
} from '../../lib/pmo/index.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class PMOBoard extends Command {
  static description = 'View or interact with the kanban board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> view',
    '<%= config.bin %> <%= command.id %> open',
  ];

  static args = {
    action: Args.string({
      description: 'Action to perform',
      options: ['view', 'open', 'markdown', 'export', 'sync'],
      default: 'view',
    }),
  };

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Show all columns including empty ones',
      default: false,
    }),
    compact: Flags.boolean({
      char: 'c',
      description: 'Compact view without details',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force sync without confirmation (for sync action)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would change without applying (for sync action)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PMOBoard);

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

    switch (args.action) {
      case 'view':
        await this.viewBoard(pmoPath, config, flags);
        break;

      case 'open':
        this.openInObsidian(pmoPath, config);
        break;

      case 'markdown':
        await this.showMarkdown(pmoPath, config);
        break;

      case 'export':
        await this.exportMarkdown(pmoPath, config);
        break;

      case 'sync':
        await this.syncFromMarkdown(pmoPath, config, flags);
        break;
    }
  }

  private async viewBoard(
    pmoPath: string,
    config: PMOConfigFile,
    flags: { all: boolean; compact: boolean }
  ): Promise<void> {
    // Use auto-sync storage for read operations
    const storage = getStorageWithAutoSync(
      pmoPath,
      config.storage,
      (msg) => this.log(chalk.gray(msg))
    );

    try {
      const board = await storage.getBoard();
      await storage.close();

      // Header
      this.log(chalk.bold.cyan(`\n${board.name}`));
      this.log(chalk.gray(`Template: ${config.template} | Storage: ${config.storage}`));
      this.log(chalk.gray('═'.repeat(60)));

      // Display each column
      for (const column of board.columns) {
        // Skip empty columns unless --all flag
        if (!flags.all && column.tickets.length === 0) {
          continue;
        }

        const headerColor = this.getColumnColor(column.name);
        const emoji = this.getColumnEmoji(column.name);

        this.log(headerColor(`\n${emoji} ${column.name} (${column.tickets.length})`));
        this.log(chalk.gray('─'.repeat(50)));

        if (column.tickets.length === 0) {
          this.log(chalk.gray('  (empty)'));
          continue;
        }

        // Sort tickets by position
        const sortedTickets = [...column.tickets].sort((a, b) => a.position - b.position);

        for (const ticket of sortedTickets) {
          if (flags.compact) {
            this.outputTicketCompact(ticket);
          } else {
            this.outputTicketFull(ticket);
          }
        }
      }

      // Summary
      const totalTickets = board.columns.reduce((sum, col) => sum + col.tickets.length, 0);
      this.log(chalk.gray('\n═'.repeat(60)));
      this.log(chalk.bold(`Total: ${totalTickets} ticket${totalTickets === 1 ? '' : 's'}`));

      // Per-column summary
      const summary = board.columns
        .filter(col => col.tickets.length > 0)
        .map(col => `${col.name}: ${col.tickets.length}`)
        .join(' | ');
      if (summary) {
        this.log(chalk.gray(summary));
      }

      this.log(chalk.gray('\nCommands:'));
      this.log(chalk.gray('  prlt ticket create     Create a new ticket'));
      this.log(chalk.gray('  prlt ticket list       List all tickets'));
      this.log(chalk.gray('  prlt ticket move <id>  Move a ticket'));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private outputTicketCompact(ticket: Ticket): void {
    const priority = this.formatPriority(ticket.priority);
    this.log(`  ${chalk.bold(ticket.id)}: ${ticket.title} ${priority}`);
  }

  private outputTicketFull(ticket: Ticket): void {
    const priority = this.formatPriority(ticket.priority);
    const category = ticket.category ? chalk.cyan(`[${ticket.category}]`) : '';

    this.log(`  ${chalk.bold(ticket.id)} ${ticket.title} ${priority} ${category}`);

    if (ticket.description) {
      const shortDesc = ticket.description.split('\n')[0].substring(0, 55);
      this.log(chalk.gray(`     ${shortDesc}${ticket.description.length > 55 ? '...' : ''}`));
    }

    if (ticket.subtasks.length > 0) {
      const done = ticket.subtasks.filter(s => s.done).length;
      const total = ticket.subtasks.length;
      const progress = Math.round((done / total) * 100);
      this.log(chalk.gray(`     Subtasks: ${done}/${total} (${progress}%)`));
    }

    if (ticket.specs.length > 0) {
      this.log(chalk.gray(`     Specs: ${ticket.specs.join(', ')}`));
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

  private async showMarkdown(pmoPath: string, config: PMOConfigFile): Promise<void> {
    const storage = await this.getStorage(pmoPath, config);

    try {
      const markdown = await storage.getBoardMarkdown();
      await storage.close();
      this.log(markdown);
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async exportMarkdown(pmoPath: string, config: PMOConfigFile): Promise<void> {
    const storage = await this.getStorage(pmoPath, config);

    try {
      const markdown = await storage.getBoardMarkdown();
      await storage.close();

      const boardPath = path.join(pmoPath, 'board.md');
      fs.writeFileSync(boardPath, markdown);

      this.log(chalk.green(`✅ Exported board to ${boardPath}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async syncFromMarkdown(
    pmoPath: string,
    config: PMOConfigFile,
    flags: { force: boolean; 'dry-run': boolean }
  ): Promise<void> {
    const boardPath = path.join(pmoPath, 'board.md');
    if (!fs.existsSync(boardPath)) {
      this.error('board.md not found. Run "prlt pmo board export" first to create it.');
    }

    // Parse markdown file
    const markdown = fs.readFileSync(boardPath, 'utf-8');
    const markdownBoard = parseBoard(markdown);

    // Get current SQLite/cache state
    const storage = await this.getStorage(pmoPath, config);

    try {
      const sqliteBoard = await storage.getBoard();

      // Find differences
      const added = findAddedTickets(sqliteBoard, markdownBoard);
      const removed = findRemovedTickets(sqliteBoard, markdownBoard);
      const modified = findModifiedTickets(sqliteBoard, markdownBoard);

      // Check if anything changed
      if (added.length === 0 && removed.length === 0 && modified.length === 0) {
        this.log(chalk.green('✅ Database is already in sync with board.md'));
        await storage.close();
        return;
      }

      // Display changes
      const dbType = config.storage === 'git' ? 'cache' : 'database';
      this.log(chalk.bold.cyan(`\n📊 Changes detected in board.md (to sync to ${dbType}):\n`));

      if (added.length > 0) {
        this.log(chalk.green.bold(`  + ${added.length} ticket(s) to add:`));
        for (const ticket of added) {
          this.log(chalk.green(`    + ${ticket.id}: ${ticket.title} (${ticket.column})`));
        }
      }

      if (removed.length > 0) {
        this.log(chalk.red.bold(`  - ${removed.length} ticket(s) to remove:`));
        for (const ticket of removed) {
          this.log(chalk.red(`    - ${ticket.id}: ${ticket.title}`));
        }
      }

      if (modified.length > 0) {
        this.log(chalk.yellow.bold(`  ~ ${modified.length} ticket(s) to update:`));
        for (const { old: oldTicket, new: newTicket } of modified) {
          this.log(chalk.yellow(`    ~ ${newTicket.id}: ${newTicket.title}`));
          if (oldTicket.column !== newTicket.column) {
            this.log(chalk.gray(`        column: ${oldTicket.column} → ${newTicket.column}`));
          }
          if (oldTicket.priority !== newTicket.priority) {
            this.log(chalk.gray(`        priority: ${oldTicket.priority || '(none)'} → ${newTicket.priority || '(none)'}`));
          }
          if (oldTicket.title !== newTicket.title) {
            this.log(chalk.gray(`        title: ${oldTicket.title} → ${newTicket.title}`));
          }
        }
      }

      this.log('');

      // Dry run - just show changes
      if (flags['dry-run']) {
        this.log(chalk.gray('Dry run - no changes applied.'));
        await storage.close();
        return;
      }

      // For git mode, we can just rebuild the cache entirely (faster and simpler)
      if (config.storage === 'git') {
        if (!flags.force) {
          const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Rebuild cache from board.md?',
            default: true,
          }]);

          if (!confirm) {
            this.log(chalk.yellow('Sync cancelled.'));
            await storage.close();
            return;
          }
        }

        this.log(chalk.blue('\nRebuilding cache from board.md...'));

        // Rebuild entire cache from markdown
        storage.rebuildFromBoard(markdownBoard);

        // Update cache metadata with file mtime
        const stats = fs.statSync(boardPath);
        storage.setCacheMetadata({
          boardMtime: stats.mtimeMs,
          cacheBuiltAt: Date.now(),
        });

        await storage.close();
        this.log(chalk.green('\n✅ Cache rebuilt from board.md!'));
        return;
      }

      // For SQLite mode, apply incremental changes
      if (!flags.force) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Apply these changes to the database?',
          default: false,
        }]);

        if (!confirm) {
          this.log(chalk.yellow('Sync cancelled.'));
          await storage.close();
          return;
        }
      }

      // Apply changes
      this.log(chalk.blue('\nApplying changes...'));

      // Remove deleted tickets
      for (const ticket of removed) {
        await storage.deleteTicket(ticket.id);
        this.log(chalk.red(`  Deleted: ${ticket.id}`));
      }

      // Add new tickets
      for (const ticket of added) {
        await storage.createTicket(ticket);
        this.log(chalk.green(`  Added: ${ticket.id}`));
      }

      // Update modified tickets
      for (const { new: newTicket } of modified) {
        // If column changed, move first
        const existing = await storage.getTicket(newTicket.id);
        if (existing && existing.column !== newTicket.column) {
          await storage.moveTicket(newTicket.id, newTicket.column, newTicket.position);
        }
        // Then update other fields
        await storage.updateTicket(newTicket.id, {
          title: newTicket.title,
          priority: newTicket.priority,
          category: newTicket.category,
          description: newTicket.description,
          subtasks: newTicket.subtasks,
          metadata: newTicket.metadata,
          specs: newTicket.specs,
        });
        this.log(chalk.yellow(`  Updated: ${newTicket.id}`));
      }

      await storage.close();

      this.log(chalk.green('\n✅ Sync complete!'));
      this.log(chalk.gray(`  Added: ${added.length} | Removed: ${removed.length} | Updated: ${modified.length}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private openInObsidian(pmoPath: string, config: PMOConfigFile): void {
    // For git storage, open the board.md
    if (config.storage === 'git') {
      const boardPath = path.join(pmoPath, 'board.md');
      if (!fs.existsSync(boardPath)) {
        this.error('board.md not found. PMO may need to be reinitialized.');
      }
    }

    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        execSync(`open "obsidian://open?path=${encodeURIComponent(pmoPath)}"`);
      } else if (platform === 'linux') {
        execSync(`xdg-open "obsidian://open?path=${encodeURIComponent(pmoPath)}"`);
      } else if (platform === 'win32') {
        execSync(`start "" "obsidian://open?path=${encodeURIComponent(pmoPath)}"`);
      }
      this.log(chalk.green('✅ Opened PMO in Obsidian'));
    } catch {
      this.log(chalk.yellow('Could not open Obsidian. Make sure it is installed.'));
      this.log(chalk.gray(`PMO location: ${pmoPath}`));
    }
  }

  private async getStorage(pmoPath: string, config: PMOConfigFile): Promise<SQLiteStorage> {
    let dbPath: string;

    if (config.storage === 'sqlite') {
      dbPath = path.join(pmoPath, 'board.db');
    } else if (config.storage === 'git') {
      dbPath = path.join(pmoPath, '.cache.db');
    } else {
      this.error(`Unsupported storage type: ${config.storage}`);
    }

    if (!fs.existsSync(dbPath)) {
      this.error(`Database not found at ${dbPath}. PMO may need to be reinitialized.`);
    }

    return new SQLiteStorage(dbPath);
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
