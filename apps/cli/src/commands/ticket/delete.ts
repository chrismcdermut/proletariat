import { Command, Args, Flags } from '@oclif/core';
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

export default class TicketDelete extends Command {
  static description = 'Delete a ticket permanently';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %> TICK-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to delete - prompts with dropdown if not provided',
      required: false,
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
    const { args, flags } = await this.parse(TicketDelete);

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
        // Get all tickets for selection
        const allTickets = await storage.listTickets();

        if (allTickets.length === 0) {
          await storage.close();
          this.error('No tickets found.');
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to delete:',
          choices: allTickets.map((t: { id: string; title: string; column: string }) => ({
            name: `${t.id} - ${t.title} (${t.column})`,
            value: t.id,
          })),
        }]);
        ticketId = selectedTicketId;
      }

      // Get ticket to show details in confirmation
      const ticket = await storage.getTicket(ticketId!);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Confirmation prompt (unless --force)
      if (!flags.force) {
        this.log(`\nDelete ticket ${styles.emphasis(ticketId)}?`);
        this.log(`  Title: ${ticket.title}`);
        this.log(`  Project: ${config.boardName}`);
        this.log(`  Status: ${ticket.column}`);

        const { confirmed } = await inquirer.prompt([{
          type: 'list',
          name: 'confirmed',
          message: 'Are you sure?',
          choices: [
            { name: 'No, cancel', value: false },
            { name: 'Yes, delete', value: true },
          ],
          default: 0,
        }]);

        if (!confirmed) {
          await storage.close();
          this.log(styles.warning('Deletion cancelled.'));
          return;
        }
      }

      // Delete ticket
      await storage.deleteTicket(ticketId!);

      // Auto-export to board.md after write
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

      await storage.close();

      this.log(styles.success(`\n✅ Ticket ${styles.emphasis(ticketId)} deleted`));
      this.log(styles.muted('   Removed from database and board'));
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
