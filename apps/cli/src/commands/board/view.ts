import { Flags } from '@oclif/core';
import {
  Ticket,
  PMOCommand,
  pmoBaseFlags,
  Subtask,
} from '../../lib/pmo/index.js';
import {
  styles,
  formatPriority,
  formatCategory,
  getColumnStyle,
  getColumnEmoji,
  divider,
} from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class BoardView extends PMOCommand {
  static description = 'View the kanban board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --compact',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    compact: Flags.boolean({
      char: 'c',
      description: 'Show compact ticket view (ID and title only)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(BoardView);

    // Board operations require project context
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('board view', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const board = await this.storage.getBoard(projectId);

    if (!board) {
      return handleError('BOARD_NOT_FOUND', `Board not found for project "${projectId}".`);
    }

    // In JSON mode, output board as structured data
    if (jsonMode) {
      outputSuccessAsJson(
        {
          id: board.id,
          name: board.name,
          columns: board.columns.map(col => ({
            id: col.id,
            name: col.name,
            position: col.position,
            ticketCount: col.tickets.length,
            tickets: col.tickets.map(t => ({
              id: t.id,
              title: t.title,
              description: t.description,
              priority: t.priority,
              category: t.category,
              owner: t.owner,
              assignee: t.assignee,
              specId: t.specId,
              epicId: t.epicId,
              labels: t.labels,
              subtasksDone: t.subtasks.filter((s: Subtask) => s.done).length,
              subtasksTotal: t.subtasks.length,
              position: t.position,
            })),
          })),
          totalTickets: board.columns.reduce((sum, col) => sum + col.tickets.length, 0),
        },
        createMetadata('board view', flags)
      );
      return;
    }

    // Interactive mode - render board to terminal
    this.renderBoard(board, flags.compact);
  }

  private renderBoard(
    board: { name: string; columns: Array<{ name: string; tickets: Ticket[] }> },
    compact: boolean
  ): void {
    // Header
    this.log(styles.title(`\n${board.name}`));
    this.log(styles.muted(`Storage: SQLite`));
    this.log(styles.muted('═'.repeat(60)));

    // Display ALL columns (always show empty ones too)
    for (const column of board.columns) {
      const headerColor = getColumnStyle(column.name);
      const emoji = getColumnEmoji(column.name);

      this.log(headerColor(`\n${emoji} ${column.name} (${column.tickets.length})`));
      this.log(divider(50));

      if (column.tickets.length === 0) {
        this.log(styles.muted('  (empty)'));
        continue;
      }

      // Sort tickets by position
      const sortedTickets = [...column.tickets].sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const ticket of sortedTickets) {
        if (compact) {
          this.outputTicketCompact(ticket);
        } else {
          this.outputTicketFull(ticket);
        }
      }
    }

    // Summary
    const totalTickets = board.columns.reduce((sum, col) => sum + col.tickets.length, 0);
    this.log(styles.muted('\n' + '═'.repeat(60)));
    this.log(styles.emphasis(`Total: ${totalTickets} ticket${totalTickets === 1 ? '' : 's'}`));

    // Per-column summary (only non-empty)
    const summary = board.columns
      .filter(col => col.tickets.length > 0)
      .map(col => `${col.name}: ${col.tickets.length}`)
      .join(' | ');
    if (summary) {
      this.log(styles.primary(summary));
    }

    this.log(styles.muted('\nCommands:'));
    this.log(styles.primary('  prlt ticket create     ') + styles.muted('Create a new ticket'));
    this.log(styles.primary('  prlt ticket list       ') + styles.muted('List all tickets'));
    this.log(styles.primary('  prlt ticket move <id>  ') + styles.muted('Move a ticket'));
  }

  private outputTicketCompact(ticket: Ticket): void {
    const priority = formatPriority(ticket.priority);
    this.log(`  ${styles.code(ticket.id)}: ${ticket.title} ${priority}`);
  }

  private outputTicketFull(ticket: Ticket): void {
    const priority = formatPriority(ticket.priority);
    const category = formatCategory(ticket.category);

    this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${priority} ${category}`);

    if (ticket.description) {
      const shortDesc = ticket.description.split('\n')[0].substring(0, 55);
      this.log(styles.muted(`     ${shortDesc}${ticket.description.length > 55 ? '...' : ''}`));
    }

    if (ticket.subtasks.length > 0) {
      const done = ticket.subtasks.filter(s => s.done).length;
      const total = ticket.subtasks.length;
      const progress = Math.round((done / total) * 100);
      this.log(styles.muted(`     Subtasks: ${done}/${total} (${progress}%)`));
    }

    if (ticket.specId) {
      this.log(styles.muted(`     Spec: ${ticket.specId}`));
    }
  }
}
