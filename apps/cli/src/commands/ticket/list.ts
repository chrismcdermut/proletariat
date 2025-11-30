import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { Ticket, getStorageWithAutoSync, findPMO } from '../../lib/pmo/index.js';
import {
  styles,
  formatPriority,
  formatCategory,
  getColumnStyle,
  getColumnEmoji,
  divider,
} from '../../lib/styles.js';

export default class TicketList extends Command {
  static description = 'List tickets from the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --column Backlog',
    '<%= config.bin %> <%= command.id %> --priority URGENT',
    '<%= config.bin %> <%= command.id %> --category bug',
    '<%= config.bin %> <%= command.id %> --search "login"',
    '<%= config.bin %> <%= command.id %> --project mobile-app',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
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
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Resolve project ID
    const projectId = flags.project || 'default';

    // Get storage with auto-sync from board.md (read-only, no export needed)
    const storage = getStorageWithAutoSync(
      pmoPath,
      'sqlite',
      (msg) => this.log(styles.muted(msg)),
      projectId
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
      const board = await storage.getBoard();
      await storage.close();

      if (tickets.length === 0) {
        this.log(styles.warning('No tickets found.'));
        return;
      }

      // Extract column names from board
      const columns = board.columns.map(col => col.name);

      // Output based on format
      switch (flags.format) {
        case 'json':
          this.log(JSON.stringify(tickets, null, 2));
          break;
        case 'compact':
          this.outputCompact(tickets, columns, flags.all);
          break;
        default:
          this.outputTable(tickets, columns, flags.all);
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
      const col = ticket.column || 'Unknown';
      if (!byColumn[col]) {
        byColumn[col] = [];
      }
      byColumn[col].push(ticket);
    }

    // Display ALL columns
    for (const col of columns) {
      const colTickets = byColumn[col];

      // Column header with color
      const headerColor = getColumnStyle(col);
      this.log(headerColor(`\n${getColumnEmoji(col)} ${col} (${colTickets.length})`));
      this.log(divider(50));

      if (colTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      // Sort by position
      colTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of colTickets) {
        const priorityBadge = formatPriority(ticket.priority);
        const categoryBadge = formatCategory(ticket.category);

        this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${priorityBadge} ${categoryBadge}`);

        if (ticket.description) {
          const shortDesc = ticket.description.split('\n')[0].substring(0, 60);
          this.log(styles.muted(`     ${shortDesc}${ticket.description.length > 60 ? '...' : ''}`));
        }

        if (ticket.subtasks.length > 0) {
          const done = ticket.subtasks.filter(s => s.done).length;
          this.log(styles.muted(`     Subtasks: ${done}/${ticket.subtasks.length}`));
        }
      }
    }

    // Summary
    this.log('\n' + divider(50));
    this.log(styles.emphasis(`Total: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`));
  }

  private outputCompact(tickets: Ticket[], columns: string[], showAll: boolean): void {
    // Group by column
    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) {
      byColumn[col] = [];
    }
    for (const ticket of tickets) {
      const col = ticket.column || 'Unknown';
      if (!byColumn[col]) {
        byColumn[col] = [];
      }
      byColumn[col].push(ticket);
    }

    for (const col of columns) {
      const colTickets = byColumn[col];

      // Show all columns
      const headerColor = getColumnStyle(col);
      this.log(headerColor(`${getColumnEmoji(col)} ${col} (${colTickets.length}):`));

      if (colTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      colTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of colTickets) {
        const priority = formatPriority(ticket.priority);
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${priority}`);
      }
    }
  }

}
