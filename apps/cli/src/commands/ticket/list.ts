import { Command, Flags } from '@oclif/core';
import { Ticket, pmoBaseFlags, TicketFilter } from '../../lib/pmo/index.js';
import { getPMOContext, type PMOContext } from '../../lib/pmo/pmo-context.js';
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
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static flags = {
    ...pmoBaseFlags,
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
      description: 'Show tickets across all projects',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketList);

    // When --all is set, we don't need to select a specific project
    // Otherwise, use the normal project selection flow
    let pmoContext: PMOContext | undefined;

    if (!flags.all) {
      pmoContext = await getPMOContext({
        projectId: flags.project,
        logger: (msg) => this.log(styles.muted(msg)),
        promptIfMultiple: true,
      });
    } else {
      // For --all, we still need a storage connection but skip project selection entirely
      pmoContext = await getPMOContext({
        logger: (msg) => this.log(styles.muted(msg)),
        skipProjectSelection: true,
      });
    }

    try {
      // Build filter
      const filter: TicketFilter = {};

      if (flags.all) {
        filter.allProjects = true;
      }
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

      const tickets = await pmoContext.storage.listTickets(filter);

      if (tickets.length === 0) {
        this.log(styles.warning('No tickets found.'));
        return;
      }

      // Output based on format
      if (flags.all) {
        // Cross-project view
        switch (flags.format) {
          case 'json':
            this.log(JSON.stringify(tickets, null, 2));
            break;
          case 'compact':
            this.outputCrossProjectCompact(tickets);
            break;
          default:
            this.outputCrossProjectTable(tickets);
        }
      } else {
        // Single project view
        const board = await pmoContext.storage.getBoard();
        const columns = board.columns.map(col => col.name);

        switch (flags.format) {
          case 'json':
            this.log(JSON.stringify(tickets, null, 2));
            break;
          case 'compact':
            this.outputCompact(tickets, columns);
            break;
          default:
            this.outputTable(tickets, columns);
        }
      }
    } finally {
      await pmoContext.storage.close();
    }
  }

  private outputCrossProjectTable(tickets: Ticket[]): void {
    // Group tickets by project, then by column
    const byProject: Record<string, Ticket[]> = {};
    for (const ticket of tickets) {
      const projectName = ticket.projectName || ticket.projectId || 'Unknown';
      if (!byProject[projectName]) {
        byProject[projectName] = [];
      }
      byProject[projectName].push(ticket);
    }

    const projectNames = Object.keys(byProject).sort();

    for (const projectName of projectNames) {
      const projectTickets = byProject[projectName];

      // Project header
      this.log(styles.emphasis(`\n${projectName}`));
      this.log(divider(60));

      // Group by column within project
      const byColumn: Record<string, Ticket[]> = {};
      for (const ticket of projectTickets) {
        const col = ticket.statusName || 'Unknown';
        if (!byColumn[col]) {
          byColumn[col] = [];
        }
        byColumn[col].push(ticket);
      }

      const columns = Object.keys(byColumn).sort();
      for (const col of columns) {
        const colTickets = byColumn[col];

        const headerColor = getColumnStyle(col);
        this.log(headerColor(`  ${getColumnEmoji(col)} ${col} (${colTickets.length})`));

        colTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

        for (const ticket of colTickets) {
          const priorityBadge = formatPriority(ticket.priority);
          const categoryBadge = formatCategory(ticket.category);

          this.log(`    ${styles.code(ticket.id)} ${ticket.title} ${priorityBadge} ${categoryBadge}`);

          if (ticket.description) {
            const shortDesc = ticket.description.split('\n')[0].substring(0, 55);
            this.log(styles.muted(`       ${shortDesc}${ticket.description.length > 55 ? '...' : ''}`));
          }
        }
      }
    }

    // Summary
    this.log('\n' + divider(60));
    this.log(styles.emphasis(`Total: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} across ${projectNames.length} project${projectNames.length === 1 ? '' : 's'}`));
  }

  private outputCrossProjectCompact(tickets: Ticket[]): void {
    // Group tickets by project
    const byProject: Record<string, Ticket[]> = {};
    for (const ticket of tickets) {
      const projectName = ticket.projectName || ticket.projectId || 'Unknown';
      if (!byProject[projectName]) {
        byProject[projectName] = [];
      }
      byProject[projectName].push(ticket);
    }

    const projectNames = Object.keys(byProject).sort();

    for (const projectName of projectNames) {
      const projectTickets = byProject[projectName];
      this.log(styles.emphasis(`${projectName} (${projectTickets.length}):`));

      projectTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of projectTickets) {
        const priority = formatPriority(ticket.priority);
        const status = ticket.statusName ? styles.muted(`[${ticket.statusName}]`) : '';
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${priority} ${status}`);
      }
    }
  }

  private outputTable(tickets: Ticket[], columns: string[]): void {
    // Group tickets by column
    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) {
      byColumn[col] = [];
    }
    for (const ticket of tickets) {
      const col = ticket.statusName || 'Unknown';
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

  private outputCompact(tickets: Ticket[], columns: string[]): void {
    // Group by column
    const byColumn: Record<string, Ticket[]> = {};
    for (const col of columns) {
      byColumn[col] = [];
    }
    for (const ticket of tickets) {
      const col = ticket.statusName || 'Unknown';
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
