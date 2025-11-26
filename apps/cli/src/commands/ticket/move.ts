import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getStorageWithAutoSync,
  autoExportToBoard,
} from '../../lib/pmo/index.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class TicketMove extends Command {
  static description = 'Move a ticket to a different column';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-ticket "In Progress"',
    '<%= config.bin %> <%= command.id %> implement-auth Done',
    '<%= config.bin %> <%= command.id %> fix-bug "In Review" --position 0',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
    column: Args.string({
      description: 'Target column',
      required: false,
    }),
  };

  static flags = {
    position: Flags.integer({
      description: 'Position within the column (0 = top)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode to select column',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketMove);

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

    // Get storage with auto-sync from board.md
    const storage = getStorageWithAutoSync(
      pmoPath,
      config.storage,
      (msg) => this.log(chalk.gray(msg))
    );

    try {
      // Get ticket first
      const ticket = await storage.getTicket(args.ticketId);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket "${args.ticketId}" not found.`);
      }

      // Get target column
      let targetColumn = args.column;

      if (!targetColumn || flags.interactive) {
        const { column } = await inquirer.prompt([{
          type: 'list',
          name: 'column',
          message: `Move "${ticket.title}" to:`,
          choices: config.columns.map(col => ({
            name: col === ticket.column ? `${col} (current)` : col,
            value: col,
          })),
          default: ticket.column,
        }]);
        targetColumn = column;
      }

      // Validate column
      if (!targetColumn || !config.columns.includes(targetColumn)) {
        await storage.close();
        this.error(`Invalid column "${targetColumn}". Available columns: ${config.columns.join(', ')}`);
      }

      // Check if actually moving
      if (targetColumn === ticket.column && flags.position === undefined) {
        await storage.close();
        this.log(chalk.yellow(`Ticket "${args.ticketId}" is already in "${targetColumn}".`));
        return;
      }

      // Move ticket (targetColumn is guaranteed to be string after validation above)
      const moved = await storage.moveTicket(args.ticketId, targetColumn!, flags.position);

      // Auto-export to board.md after write
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(chalk.gray(msg)));

      await storage.close();

      this.log(chalk.green(`\n✅ Moved ticket ${chalk.bold(moved.id)}`));
      if (targetColumn !== ticket.column) {
        this.log(chalk.gray(`   From: ${ticket.column}`));
        this.log(chalk.gray(`   To: ${moved.column}`));
      }
      if (flags.position !== undefined) {
        this.log(chalk.gray(`   Position: ${flags.position}`));
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
