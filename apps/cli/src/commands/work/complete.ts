import { Args } from '@oclif/core';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';

export default class WorkComplete extends PMOCommand {
  static description = 'Mark work as complete (moves ticket to Done column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args } = await this.parse(WorkComplete);

    // Get workspace info for execution storage
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.');
    }

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);
    const executionStorage = new ExecutionStorage(db);

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId;

      if (!ticketId) {
        // Get all tickets that could be completed (in progress / started)
        const allTickets = await this.storage.listTickets();
        const completableTickets = allTickets.filter(t =>
          t.statusCategory === 'started' || (t.statusName && t.statusName.toLowerCase().includes('progress'))
        );

        if (completableTickets.length === 0) {
          db.close();
          this.log(styles.info('No in-progress work found.'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select work to mark as complete:',
          choices: completableTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.statusName})`,
            value: t.id,
          })),
        }]);
        ticketId = selectedTicketId;
      }

      // Get ticket
      const ticket = await this.storage.getTicket(ticketId!);
      if (!ticket) {
        db.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Get configured column name (from pmo_settings or default)
      const targetColumnName = getWorkColumnSetting(db, 'done');
      const board = await this.storage.getBoard();
      const columnNames = board.columns.map(col => col.name);
      const doneColumn = findColumnByName(columnNames, targetColumnName);

      if (!doneColumn) {
        db.close();
        this.error(`No "${targetColumnName}" column found in board configuration. Configure with: prlt config set column_done <column-name>`);
      }

      const previousColumn = ticket.statusName;

      // Move to Done column (moveTicket also updates status_id)
      await this.storage.moveTicket(ticketId!, doneColumn);

      // Auto-export to board.md if configured
      await autoExportToBoard(this.pmoPath, this.storage);

      // Mark any running executions for this ticket as completed
      const runningExecution = executionStorage.getRunningExecution(ticketId!);
      if (runningExecution) {
        executionStorage.updateStatus(runningExecution.id, 'completed');
        this.log(styles.muted(`   Execution ${runningExecution.id} marked as completed`));
      }

      db.close();

      this.log(styles.success(`Work complete: ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   From: ${previousColumn}`));
      this.log(styles.muted(`   To: ${doneColumn}`));
    } catch (error) {
      db.close();
      throw error;
    }
  }
}
