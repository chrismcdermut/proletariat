import { Command, Flags } from '@oclif/core';
import {
  Ticket,
  BoardView,
  ViewFilter,
  StateCategory,
  getPMOContext,
  findPMO,
} from '../../lib/pmo/index.js';
import {
  styles,
  formatPriority,
  formatCategory,
  getColumnStyle,
  getColumnEmoji,
  divider,
} from '../../lib/styles.js';

export default class BoardViewCommand extends Command {
  static description = 'View board with optional filters, grouping, and sorting';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --assignee alice',
    '<%= config.bin %> <%= command.id %> --priority HIGH',
    '<%= config.bin %> <%= command.id %> --group-by assignee',
    '<%= config.bin %> <%= command.id %> --sort-by priority',
    '<%= config.bin %> <%= command.id %> --view VIEW-001',
    '<%= config.bin %> <%= command.id %> --column "In Progress"',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID',
    }),
    view: Flags.string({
      char: 'V',
      description: 'Use a saved view by ID',
    }),
    // Inline filters (override saved view)
    assignee: Flags.string({
      char: 'a',
      description: 'Filter by assignee (use "unassigned" for unassigned tickets)',
      multiple: true,
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Filter by priority (HIGH, MEDIUM, LOW)',
      multiple: true,
    }),
    status: Flags.string({
      char: 's',
      description: 'Filter by status category (backlog, unstarted, started, completed, canceled)',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
      multiple: true,
    }),
    column: Flags.string({
      char: 'c',
      description: 'Filter by column name',
      multiple: true,
    }),
    search: Flags.string({
      description: 'Search in title, ID, and description',
    }),
    // Grouping and sorting
    'group-by': Flags.string({
      char: 'g',
      description: 'Group tickets by',
      options: ['status', 'assignee', 'priority', 'category', 'none'],
    }),
    'sort-by': Flags.string({
      description: 'Sort tickets by',
      options: ['priority', 'created', 'updated', 'title', 'assignee', 'position'],
    }),
    'sort-dir': Flags.string({
      description: 'Sort direction',
      options: ['asc', 'desc'],
      default: 'asc',
    }),
    // Display options
    compact: Flags.boolean({
      description: 'Compact display mode',
      default: false,
    }),
    'hide-empty': Flags.boolean({
      description: 'Hide empty columns',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BoardViewCommand);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Don't log sync messages when using JSON mode
    const logger = flags.json ? undefined : (msg: string) => this.log(styles.muted(msg));
    const { storage, projectName, projectId } = await getPMOContext(
      flags.project,
      logger,
      true
    );

    try {
      // Get board with optional saved view
      let result = await storage.getBoardWithView(flags.view);
      let { board, view, totalTickets, filteredTickets } = result;

      // Apply inline filters (override saved view)
      const hasInlineFilters =
        flags.assignee?.length ||
        flags.priority?.length ||
        flags.status?.length ||
        flags.column?.length ||
        flags.search;

      if (hasInlineFilters) {
        // Build inline filter
        const inlineFilter: ViewFilter = {};

        if (flags.assignee?.length) {
          inlineFilter.assignee = flags.assignee.flatMap((a) => a.split(',').map((s) => s.trim()));
        }
        if (flags.priority?.length) {
          inlineFilter.priority = flags.priority.flatMap((p) => p.split(',').map((s) => s.trim().toUpperCase()));
        }
        if (flags.status?.length) {
          inlineFilter.statusCategory = flags.status.flatMap((s) => s.split(',').map((x) => x.trim())) as StateCategory[];
        }
        if (flags.column?.length) {
          inlineFilter.column = flags.column.flatMap((c) => c.split(',').map((s) => s.trim()));
        }
        if (flags.search) {
          inlineFilter.search = flags.search;
        }

        // Create a temporary view with inline filters
        const tempView: BoardView = {
          id: 'inline',
          projectId,
          name: 'Inline Filter',
          type: view?.type || 'kanban',
          filter: inlineFilter,
          groupBy: (flags['group-by'] as BoardView['groupBy']) || view?.groupBy || 'status',
          sortBy: (flags['sort-by'] as BoardView['sortBy']) || view?.sortBy || 'position',
          sortDirection: (flags['sort-dir'] as BoardView['sortDirection']) || view?.sortDirection || 'asc',
          isDefault: false,
          position: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Re-fetch board with temp view
        const baseBoard = await storage.getBoard();
        totalTickets = baseBoard.columns.reduce((sum, col) => sum + col.tickets.length, 0);

        // Apply filters manually
        board = this.applyFilters(baseBoard, tempView);
        filteredTickets = board.columns.reduce((sum, col) => sum + col.tickets.length, 0);
        board = this.applySorting(board, tempView);
        view = tempView;
      }

      // Apply grouping/sorting flags if provided without inline filters
      if (!hasInlineFilters && (flags['group-by'] || flags['sort-by'])) {
        const tempView: BoardView = {
          id: 'inline-sort',
          projectId,
          name: 'Inline Sort',
          type: view?.type || 'kanban',
          filter: view?.filter || {},
          groupBy: (flags['group-by'] as BoardView['groupBy']) || view?.groupBy || 'status',
          sortBy: (flags['sort-by'] as BoardView['sortBy']) || view?.sortBy || 'position',
          sortDirection: (flags['sort-dir'] as BoardView['sortDirection']) || view?.sortDirection || 'asc',
          isDefault: false,
          position: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        board = this.applySorting(board, tempView);
        view = tempView;
      }

      await storage.close();

      // JSON output
      if (flags.json) {
        this.log(
          JSON.stringify(
            {
              board,
              view,
              totalTickets,
              filteredTickets,
            },
            null,
            2
          )
        );
        return;
      }

      // Render board
      this.renderBoard(board, view, totalTickets, filteredTickets, projectName, flags.compact, flags['hide-empty']);
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private applyFilters(board: { id: string; name: string; columns: any[]; updatedAt: Date }, view: BoardView): typeof board {
    const filter = view.filter;

    const filteredColumns = board.columns.map((column) => {
      let tickets = [...column.tickets];

      // Filter by assignee
      if (filter.assignee && filter.assignee.length > 0) {
        tickets = tickets.filter((t: Ticket) => {
          if (filter.assignee!.includes('unassigned')) {
            return !t.assignee || filter.assignee!.includes(t.assignee);
          }
          return t.assignee && filter.assignee!.includes(t.assignee);
        });
      }

      // Filter by priority
      if (filter.priority && filter.priority.length > 0) {
        tickets = tickets.filter((t: Ticket) => t.priority && filter.priority!.map((p) => p.toUpperCase()).includes(t.priority.toUpperCase()));
      }

      // Filter by status category
      if (filter.statusCategory && filter.statusCategory.length > 0) {
        tickets = tickets.filter((t: Ticket) => t.statusCategory && filter.statusCategory!.includes(t.statusCategory));
      }

      // Filter by search text
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        tickets = tickets.filter(
          (t: Ticket) =>
            t.title.toLowerCase().includes(searchLower) ||
            t.id.toLowerCase().includes(searchLower) ||
            (t.description && t.description.toLowerCase().includes(searchLower))
        );
      }

      return { ...column, tickets };
    });

    // Filter by column names
    let columnsToShow = filteredColumns;
    if (filter.column && filter.column.length > 0) {
      columnsToShow = filteredColumns.filter((c) => filter.column!.includes(c.name));
    }

    return { ...board, columns: columnsToShow };
  }

  private applySorting(board: { id: string; name: string; columns: any[]; updatedAt: Date }, view: BoardView): typeof board {
    const { sortBy, sortDirection } = view;
    const multiplier = sortDirection === 'desc' ? -1 : 1;

    const sortedColumns = board.columns.map((column) => {
      const sortedTickets = [...column.tickets].sort((a: Ticket, b: Ticket) => {
        let comparison = 0;

        switch (sortBy) {
          case 'priority': {
            const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            const aPriority = priorityOrder[(a.priority || 'MEDIUM').toUpperCase()] ?? 1;
            const bPriority = priorityOrder[(b.priority || 'MEDIUM').toUpperCase()] ?? 1;
            comparison = aPriority - bPriority;
            break;
          }
          case 'created':
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            break;
          case 'updated':
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'assignee':
            comparison = (a.assignee || '').localeCompare(b.assignee || '');
            break;
          case 'position':
          default:
            comparison = (a.position || 0) - (b.position || 0);
            break;
        }

        return comparison * multiplier;
      });

      return { ...column, tickets: sortedTickets };
    });

    return { ...board, columns: sortedColumns };
  }

  private renderBoard(
    board: { id: string; name: string; columns: any[]; updatedAt: Date },
    view: BoardView | null,
    totalTickets: number,
    filteredTickets: number,
    projectName: string,
    compact: boolean,
    hideEmpty: boolean
  ): void {
    // Header
    this.log(styles.title(`\n${board.name}`));

    // Show view info if using one
    if (view && view.id !== 'inline' && view.id !== 'inline-sort') {
      this.log(styles.muted(`View: ${view.name} (${view.id})`));
    }

    // Show filter summary
    if (view && Object.keys(view.filter).length > 0) {
      const filterParts: string[] = [];
      if (view.filter.assignee?.length) filterParts.push(`assignee=${view.filter.assignee.join(',')}`);
      if (view.filter.priority?.length) filterParts.push(`priority=${view.filter.priority.join(',')}`);
      if (view.filter.statusCategory?.length) filterParts.push(`category=${view.filter.statusCategory.join(',')}`);
      if (view.filter.column?.length) filterParts.push(`column=${view.filter.column.join(',')}`);
      if (view.filter.search) filterParts.push(`search="${view.filter.search}"`);

      if (filterParts.length > 0) {
        this.log(styles.muted(`Filters: ${filterParts.join(', ')}`));
      }
    }

    // Show sort info
    if (view && (view.sortBy !== 'position' || view.sortDirection !== 'asc')) {
      this.log(styles.muted(`Sorted by: ${view.sortBy} (${view.sortDirection})`));
    }

    this.log(styles.muted('═'.repeat(60)));

    // Filter indicator
    if (totalTickets !== filteredTickets) {
      this.log(styles.emphasis(`Showing ${filteredTickets} of ${totalTickets} total tickets`));
    }

    // Display columns
    const columnsToDisplay = hideEmpty ? board.columns.filter((col) => col.tickets.length > 0) : board.columns;

    if (columnsToDisplay.length === 0) {
      this.log(styles.muted('\nNo tickets match the current filters.'));
      this.log(styles.muted('Try removing some filters or using a different view.'));
      return;
    }

    for (const column of columnsToDisplay) {
      const headerColor = getColumnStyle(column.name);
      const emoji = getColumnEmoji(column.name);

      this.log(headerColor(`\n${emoji} ${column.name} (${column.tickets.length})`));
      this.log(divider(50));

      if (column.tickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      for (const ticket of column.tickets) {
        if (compact) {
          this.outputTicketCompact(ticket);
        } else {
          this.outputTicketFull(ticket);
        }
      }
    }

    // Summary
    this.log(styles.muted('\n' + '═'.repeat(60)));
    this.log(styles.emphasis(`Total: ${filteredTickets} ticket${filteredTickets === 1 ? '' : 's'}`));

    // Per-column summary (only non-empty)
    const summary = columnsToDisplay
      .filter((col) => col.tickets.length > 0)
      .map((col) => `${col.name}: ${col.tickets.length}`)
      .join(' | ');
    if (summary) {
      this.log(styles.primary(summary));
    }

    this.log('');
  }

  private outputTicketCompact(ticket: Ticket): void {
    const priority = formatPriority(ticket.priority);
    const assignee = ticket.assignee ? styles.muted(` @${ticket.assignee}`) : '';
    this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${priority}${assignee}`);
  }

  private outputTicketFull(ticket: Ticket): void {
    const priority = formatPriority(ticket.priority);
    const category = formatCategory(ticket.category);
    const assignee = ticket.assignee ? styles.muted(` @${ticket.assignee}`) : '';

    this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${priority} ${category}${assignee}`);

    if (ticket.description) {
      const shortDesc = ticket.description.split('\n')[0].substring(0, 55);
      this.log(styles.muted(`     ${shortDesc}${ticket.description.length > 55 ? '...' : ''}`));
    }

    if (ticket.subtasks && ticket.subtasks.length > 0) {
      const done = ticket.subtasks.filter((s) => s.done).length;
      const total = ticket.subtasks.length;
      const progress = Math.round((done / total) * 100);
      this.log(styles.muted(`     Subtasks: ${done}/${total} (${progress}%)`));
    }
  }
}
