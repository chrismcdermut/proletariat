import { Command, Flags } from '@oclif/core';
import { Ticket, pmoBaseFlags, TicketFilter } from '../../lib/pmo/index.js';
import { PRIORITIES } from '../../lib/pmo/types.js';
import { getPMOContext, type PMOContext } from '../../lib/pmo/pmo-context.js';
import {
  styles,
  formatPriority,
  formatCategory,
  getColumnStyle,
  getColumnEmoji,
  divider,
  getPriorityStyle,
} from '../../lib/styles.js';

// Priority order for grouping: P0, P1, P2, P3, None
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'None'];

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
    '<%= config.bin %> <%= command.id %> --all --group-by priority',
    '<%= config.bin %> <%= command.id %> -g priority',
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
      options: [...PRIORITIES],
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
    'group-by': Flags.string({
      char: 'g',
      description: 'Group tickets by field',
      options: ['status', 'priority'],
      default: 'status',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketList);

    // When --all is set, we don't need to select a specific project
    // Otherwise, use the normal project selection flow
    let pmoContext: PMOContext | undefined;

    // Get PMO context - no project selection needed
    pmoContext = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    });

    try {
      // Build filter
      const filter: TicketFilter = {};

      if (flags.all) {
        filter.allProjects = true;
      } else if (flags.project) {
        filter.projectId = flags.project;
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

      // Determine projectId for the query
      const projectId = flags.all ? undefined : (filter.projectId || undefined);
      const tickets = await pmoContext.storage.listTickets(projectId, filter);

      if (tickets.length === 0) {
        this.log(styles.warning('No tickets found.'));
        return;
      }

      const groupBy = flags['group-by'] as 'status' | 'priority';

      // Output based on format
      if (flags.all) {
        // Cross-project view
        switch (flags.format) {
          case 'json':
            this.log(JSON.stringify(tickets, null, 2));
            break;
          case 'compact':
            this.outputCrossProjectCompact(tickets, groupBy);
            break;
          default:
            this.outputCrossProjectTable(tickets, groupBy);
        }
      } else {
        // Single project view - get projectId from first ticket or use flag
        const actualProjectId = projectId || tickets[0]?.projectId;
        if (!actualProjectId) {
          this.log(styles.warning('No project found.'));
          return;
        }
        const board = await pmoContext.storage.getBoard(actualProjectId);
        const columns = board.columns.map(col => col.name);

        switch (flags.format) {
          case 'json':
            this.log(JSON.stringify(tickets, null, 2));
            break;
          case 'compact':
            this.outputCompact(tickets, columns, groupBy);
            break;
          default:
            this.outputTable(tickets, columns, groupBy);
        }
      }
    } finally {
      await pmoContext.storage.close();
    }
  }

  private outputCrossProjectTable(tickets: Ticket[], groupBy: 'status' | 'priority'): void {
    if (groupBy === 'priority') {
      this.outputCrossProjectTableByPriority(tickets);
      return;
    }

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

  private outputCrossProjectTableByPriority(tickets: Ticket[]): void {
    // Group tickets by priority
    const byPriority: Record<string, Ticket[]> = {};
    for (const priority of PRIORITY_ORDER) {
      byPriority[priority] = [];
    }
    for (const ticket of tickets) {
      const priority = ticket.priority || 'None';
      if (!byPriority[priority]) {
        byPriority[priority] = [];
      }
      byPriority[priority].push(ticket);
    }

    for (const priority of PRIORITY_ORDER) {
      const priorityTickets = byPriority[priority];

      // Priority header
      const headerColor = getPriorityStyle(priority);
      this.log(headerColor(`\n${priority} (${priorityTickets.length})`));
      this.log(divider(60));

      if (priorityTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      // Sort by position within priority
      priorityTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of priorityTickets) {
        const statusBadge = ticket.statusName ? styles.muted(`[${ticket.statusName}]`) : '';
        const categoryBadge = formatCategory(ticket.category);
        const projectBadge = ticket.projectName ? styles.info(`[${ticket.projectName}]`) : '';

        this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${statusBadge} ${categoryBadge} ${projectBadge}`);

        if (ticket.description) {
          const shortDesc = ticket.description.split('\n')[0].substring(0, 55);
          this.log(styles.muted(`     ${shortDesc}${ticket.description.length > 55 ? '...' : ''}`));
        }
      }
    }

    // Summary
    this.log('\n' + divider(60));
    this.log(styles.emphasis(`Total: ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`));
  }

  private outputCrossProjectCompact(tickets: Ticket[], groupBy: 'status' | 'priority'): void {
    if (groupBy === 'priority') {
      this.outputCrossProjectCompactByPriority(tickets);
      return;
    }

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

  private outputCrossProjectCompactByPriority(tickets: Ticket[]): void {
    // Group tickets by priority
    const byPriority: Record<string, Ticket[]> = {};
    for (const priority of PRIORITY_ORDER) {
      byPriority[priority] = [];
    }
    for (const ticket of tickets) {
      const priority = ticket.priority || 'None';
      if (!byPriority[priority]) {
        byPriority[priority] = [];
      }
      byPriority[priority].push(ticket);
    }

    for (const priority of PRIORITY_ORDER) {
      const priorityTickets = byPriority[priority];
      if (priorityTickets.length === 0) continue;

      const headerColor = getPriorityStyle(priority);
      this.log(headerColor(`${priority} (${priorityTickets.length}):`));

      priorityTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of priorityTickets) {
        const status = ticket.statusName ? styles.muted(`[${ticket.statusName}]`) : '';
        const project = ticket.projectName ? styles.info(`[${ticket.projectName}]`) : '';
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${status} ${project}`);
      }
    }
  }

  private outputTable(tickets: Ticket[], columns: string[], groupBy: 'status' | 'priority'): void {
    if (groupBy === 'priority') {
      this.outputTableByPriority(tickets);
      return;
    }

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

  private outputTableByPriority(tickets: Ticket[]): void {
    // Group tickets by priority
    const byPriority: Record<string, Ticket[]> = {};
    for (const priority of PRIORITY_ORDER) {
      byPriority[priority] = [];
    }
    for (const ticket of tickets) {
      const priority = ticket.priority || 'None';
      if (!byPriority[priority]) {
        byPriority[priority] = [];
      }
      byPriority[priority].push(ticket);
    }

    // Display ALL priority groups
    for (const priority of PRIORITY_ORDER) {
      const priorityTickets = byPriority[priority];

      // Priority header with color
      const headerColor = getPriorityStyle(priority);
      this.log(headerColor(`\n${priority} (${priorityTickets.length})`));
      this.log(divider(50));

      if (priorityTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      // Sort by position
      priorityTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of priorityTickets) {
        const statusBadge = ticket.statusName ? styles.muted(`[${ticket.statusName}]`) : '';
        const categoryBadge = formatCategory(ticket.category);

        this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${statusBadge} ${categoryBadge}`);

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

  private outputCompact(tickets: Ticket[], columns: string[], groupBy: 'status' | 'priority'): void {
    if (groupBy === 'priority') {
      this.outputCompactByPriority(tickets);
      return;
    }

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

  private outputCompactByPriority(tickets: Ticket[]): void {
    // Group by priority
    const byPriority: Record<string, Ticket[]> = {};
    for (const priority of PRIORITY_ORDER) {
      byPriority[priority] = [];
    }
    for (const ticket of tickets) {
      const priority = ticket.priority || 'None';
      if (!byPriority[priority]) {
        byPriority[priority] = [];
      }
      byPriority[priority].push(ticket);
    }

    for (const priority of PRIORITY_ORDER) {
      const priorityTickets = byPriority[priority];

      // Show all priority groups
      const headerColor = getPriorityStyle(priority);
      this.log(headerColor(`${priority} (${priorityTickets.length}):`));

      if (priorityTickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      priorityTickets.sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of priorityTickets) {
        const status = ticket.statusName ? styles.muted(`[${ticket.statusName}]`) : '';
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${status}`);
      }
    }
  }

}
