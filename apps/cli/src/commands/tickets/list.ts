import { Flags } from '@oclif/core';
import { Ticket, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import {
  styles,
  formatPriority,
  formatCategory,
  getColumnStyle,
  getColumnEmoji,
  divider,
} from '../../lib/styles.js';

export default class List extends PMOCommand {
  static description = 'List all tickets across all projects or filtered';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format compact',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --column Backlog',
    '<%= config.bin %> <%= command.id %> --priority HIGH',
  ];

  static flags = {
    ...pmoBaseFlags,
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'compact', 'json'],
      default: 'table',
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
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(List);

    // Build filter
    const filter: {
      column?: string;
      priority?: string;
      category?: string;
      search?: string;
    } = {};

    if (flags.column) filter.column = flags.column;
    if (flags.priority) filter.priority = flags.priority;
    if (flags.category) filter.category = flags.category;
    if (flags.search) filter.search = flags.search;

    const tickets = await this.storage.listTickets(filter);
    const board = await this.storage.getBoard();

    if (flags.format === 'json') {
      this.log(JSON.stringify(tickets, null, 2));
      return;
    }

    if (tickets.length === 0) {
      this.log(colors.warning('No tickets found.'));
      return;
    }

    const columns = board.columns.map(col => col.name);

    if (flags.format === 'compact') {
      this.outputCompact(tickets, columns, this.projectName);
    } else {
      this.outputTable(tickets, columns, this.projectName);
    }
  }

  private outputTable(tickets: Ticket[], columns: string[], projectName: string): void {
    this.log(format.title(`🎫 Tickets - ${projectName} (${tickets.length})`));
    this.log('');

    // Group tickets by column
    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) {
      byColumn[col] = [];
    }
    for (const ticket of tickets) {
      const col = ticket.statusName || 'Unknown';
      if (!byColumn[col]) byColumn[col] = [];
      byColumn[col].push(ticket);
    }

    for (const col of columns) {
      const colTickets = byColumn[col];
      const headerColor = getColumnStyle(col);
      this.log(headerColor(`\n${getColumnEmoji(col)} ${col} (${colTickets.length})`));
      this.log(divider(50));

      if (colTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      colTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of colTickets) {
        const priorityBadge = formatPriority(ticket.priority);
        const categoryBadge = formatCategory(ticket.category);
        this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${priorityBadge} ${categoryBadge}`);

        if (ticket.description) {
          const shortDesc = ticket.description.split('\n')[0].substring(0, 60);
          this.log(styles.muted(`     ${shortDesc}${ticket.description.length > 60 ? '...' : ''}`));
        }
      }
    }

    this.log('\n' + divider(50));
    this.log(styles.emphasis(`Total: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`));
  }

  private outputCompact(tickets: Ticket[], columns: string[], projectName: string): void {
    this.log(format.title(`🎫 ${projectName} (${tickets.length} tickets)`));

    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) byColumn[col] = [];
    for (const ticket of tickets) {
      const col = ticket.statusName || 'Unknown';
      if (!byColumn[col]) byColumn[col] = [];
      byColumn[col].push(ticket);
    }

    for (const col of columns) {
      const colTickets = byColumn[col];
      const headerColor = getColumnStyle(col);
      this.log(headerColor(`${getColumnEmoji(col)} ${col} (${colTickets.length}):`));

      if (colTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      for (const ticket of colTickets) {
        const priority = formatPriority(ticket.priority);
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${priority}`);
      }
    }
  }
}
