import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import {
  getStorageWithAutoSync,
  autoExportToBoard,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class TicketComplete extends Command {
  static description = 'Mark a ticket as complete (move to Done column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TICK-001',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketComplete);

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
      (msg) => this.log(styles.muted(msg))
    );

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId;

      if (!ticketId) {
        // Get all incomplete tickets for selection
        const allTickets = await storage.listTickets();
        const incompleteTickets = allTickets.filter((t: { column: string }) =>
          !t.column.toLowerCase().includes('done')
        );

        if (incompleteTickets.length === 0) {
          await storage.close();
          this.log(styles.info('No incomplete tickets found. All tickets are done!'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to complete:',
          choices: incompleteTickets.map((t: { id: string; title: string; column: string }) => ({
            name: `${t.id} - ${t.title} (${t.column})`,
            value: t.id,
          })),
        }]);
        ticketId = selectedTicketId;
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Find the "Done" column (case-insensitive)
      const doneColumn = config.columns.find((col: string) =>
        col.toLowerCase().includes('done')
      );

      if (!doneColumn) {
        await storage.close();
        this.error('No "Done" column found in board configuration.');
      }

      // Move to Done column
      await storage.moveTicket(ticketId!, doneColumn);

      // Auto-export to board.md if configured
      await autoExportToBoard(pmoPath, storage);

      await storage.close();

      this.log(styles.success(`✅ Completed ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   Moved to: ${doneColumn}`));
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
