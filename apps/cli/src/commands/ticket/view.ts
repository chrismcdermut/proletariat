import { Command, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import {
  getStorageWithAutoSync,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class TicketView extends Command {
  static description = 'View detailed ticket information';

  static examples = [
    '<%= config.bin %> <%= command.id %> TICK-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to view - prompts with dropdown if not provided',
      required: false,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(TicketView);

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
          this.error('No tickets found. Create a ticket first with "prlt ticket create".');
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to view:',
          choices: allTickets.map((t: { id: string; title: string; column: string }) => ({
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

      await storage.close();

      // Display ticket details
      this.log(`\n${styles.header('📄 Ticket')} ${styles.emphasis(ticket.id)}\n`);
      this.log(`${styles.header('Title:')}       ${ticket.title}`);
      this.log(`${styles.header('Project:')}     ${config.boardName}`);
      this.log(`${styles.header('Status:')}      ${ticket.column}`);
      this.log(`${styles.header('Priority:')}    ${ticket.priority || 'none'}`);
      this.log(`${styles.header('Category:')}    ${ticket.category || 'none'}`);
      this.log(`${styles.header('Created:')}     ${ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'unknown'}`);
      this.log(`${styles.header('Updated:')}     ${ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : 'unknown'}`);

      if (ticket.description) {
        this.log(`\n${styles.header('Description:')}`);
        this.log(`  ${ticket.description.split('\n').join('\n  ')}`);
      }

      // TODO: Implement subtasks
      // const subtasks = await storage.getSubtasks(ticketId);
      // if (subtasks && subtasks.length > 0) {
      //   this.log(`\n${styles.header('Subtasks:')}`);
      //   for (const subtask of subtasks) {
      //     const checkbox = subtask.completed ? '☑' : '☐';
      //     this.log(`  ${checkbox} ${subtask.title}`);
      //   }
      // }

      this.log('');
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
