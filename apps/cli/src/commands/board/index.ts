import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  Ticket,
  parseBoard,
  findAddedTickets,
  findRemovedTickets,
  findModifiedTickets,
  getBoardPath,
  PMOCommand,
  pmoBaseFlags,
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
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Board extends PMOCommand {
  static description = 'Interactive menu for board operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(Board);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'View board in terminal', value: 'view' },
      { name: 'Open board in Obsidian', value: 'open' },
      { name: 'Show as markdown', value: 'markdown' },
      { name: 'Export board', value: 'export' },
      { name: 'Sync board', value: 'sync' },
      { name: 'Watch for changes', value: 'watch' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = `Board Operations - ${this.projectName} - What would you like to do?`;

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('board', flags)
      );
      return;
    }

    // Show interactive menu (with separator before Cancel)
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '📋 ' + message,
      choices: [
        ...menuChoices.slice(0, -1),
        new inquirer.Separator(),
        menuChoices[menuChoices.length - 1],
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    switch (action) {
      case 'view':
        await this.viewBoard({ all: false, compact: false });
        break;

      case 'open':
        this.openInObsidian();
        break;

      case 'markdown':
        await this.showMarkdown();
        break;

      case 'export':
        await this.exportMarkdown();
        break;

      case 'sync':
        await this.syncFromMarkdown({ force: false, 'dry-run': false });
        break;

      case 'watch':
        this.log(styles.info('To watch for changes, run: prlt board watch'));
        break;
    }
  }

  private async viewBoard(
    flags: { all: boolean; compact: boolean }
  ): Promise<void> {
    const board = await this.storage.getBoard();

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
        if (flags.compact) {
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

  private async showMarkdown(): Promise<void> {
    const markdown = await this.storage.getBoardMarkdown();
    this.log(markdown);
  }

  private async exportMarkdown(): Promise<void> {
    const markdown = await this.storage.getBoardMarkdown();

    const boardPath = getBoardPath(this.pmoPath, this.projectId);
    fs.writeFileSync(boardPath, markdown);

    this.log(chalk.green(`✅ Exported board to ${boardPath}`));
  }

  private async syncFromMarkdown(
    flags: { force: boolean; 'dry-run': boolean }
  ): Promise<void> {
    const boardPath = getBoardPath(this.pmoPath, this.projectId);

    if (!fs.existsSync(boardPath)) {
      this.error('board.md not found. Run "prlt board export" first to create it.');
    }

    // Parse markdown file
    const markdown = fs.readFileSync(boardPath, 'utf-8');
    const markdownBoard = parseBoard(markdown);

    const sqliteBoard = await this.storage.getBoard();

    // Find differences
    const added = findAddedTickets(sqliteBoard, markdownBoard);
    const removed = findRemovedTickets(sqliteBoard, markdownBoard);
    const modified = findModifiedTickets(sqliteBoard, markdownBoard);

    // Check if anything changed
    if (added.length === 0 && removed.length === 0 && modified.length === 0) {
      this.log(chalk.green('✅ Database is already in sync with board.md'));
      return;
    }

    // Display changes
    this.log(chalk.bold.cyan(`\n📊 Changes detected in board.md (to sync to database):\n`));

    if (added.length > 0) {
      this.log(chalk.green.bold(`  + ${added.length} ticket(s) to add:`));
      for (const ticket of added) {
        this.log(chalk.green(`    + ${ticket.id}: ${ticket.title} (${ticket.statusName})`));
      }
    }

    if (removed.length > 0) {
      this.log(chalk.red.bold(`  - ${removed.length} ticket(s) to remove:`));
      for (const ticket of removed) {
        this.log(chalk.red(`    - ${ticket.id}: ${ticket.title}`));
      }
    }

    if (modified.length > 0) {
      this.log(chalk.yellow.bold(`  ~ ${modified.length} ticket(s) to update:`));
      for (const { old: oldTicket, new: newTicket } of modified) {
        this.log(chalk.yellow(`    ~ ${newTicket.id}: ${newTicket.title}`));
        if (oldTicket.statusName !== newTicket.statusName) {
          this.log(styles.muted(`        status: ${oldTicket.statusName} → ${newTicket.statusName}`));
        }
        if (oldTicket.priority !== newTicket.priority) {
          this.log(styles.muted(`        priority: ${oldTicket.priority || '(none)'} → ${newTicket.priority || '(none)'}`));
        }
        if (oldTicket.title !== newTicket.title) {
          this.log(styles.muted(`        title: ${oldTicket.title} → ${newTicket.title}`));
        }
      }
    }

    this.log('');

    // Dry run - just show changes
    if (flags['dry-run']) {
      this.log(styles.muted('Dry run - no changes applied.'));
      return;
    }

    // Confirm before applying
    if (!flags.force) {
      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Apply these changes to the database?',
        choices: [
          { name: 'Yes, apply changes', value: true },
          { name: 'No, cancel', value: false },
        ],
        default: 0,
      }]);

      if (!confirm) {
        this.log(chalk.yellow('Sync cancelled.'));
        return;
      }
    }

    this.log(chalk.blue('\nSyncing from board.md...'));

    // Rebuild database from markdown (cleaner than incremental updates)
    this.storage.rebuildFromBoard(markdownBoard);

    // Update cache metadata with file mtime
    const stats = fs.statSync(boardPath);
    this.storage.setCacheMetadata({
      boardMtime: stats.mtimeMs,
      cacheBuiltAt: Date.now(),
    });

    this.log(chalk.green('\n✅ Database synced from board.md!'));
  }

  private openInObsidian(): void {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        execSync(`open "obsidian://open?path=${encodeURIComponent(this.pmoPath)}"`);
      } else if (platform === 'linux') {
        execSync(`xdg-open "obsidian://open?path=${encodeURIComponent(this.pmoPath)}"`);
      } else if (platform === 'win32') {
        execSync(`start "" "obsidian://open?path=${encodeURIComponent(this.pmoPath)}"`);
      }
      this.log(styles.success('✅ Opened PMO in Obsidian'));
    } catch {
      this.log(styles.warning('Could not open Obsidian. Make sure it is installed.'));
      this.log(styles.muted(`PMO location: ${this.pmoPath}`));
    }
  }

}
