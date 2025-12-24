import { Command, Args } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import inquirer from 'inquirer';
import {
  getPMOContext,
  autoExportToBoard,
} from '../../lib/pmo/index.js';
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';

export default class WorkReady extends Command {
  static description = 'Mark work as ready for review (moves ticket to In Review column)';

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

  async run(): Promise<void> {
    const { args } = await this.parse(WorkReady);

    // Get workspace info for execution storage
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch (error) {
      this.error('Not in a workspace. Run "prlt init" first.');
    }

    // Get PMO context (prompts for project if multiple exist)
    const { pmoPath, storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);
    const executionStorage = new ExecutionStorage(db);

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId;

      if (!ticketId) {
        // Get all in-progress tickets for selection
        const allTickets = await storage.listTickets();
        const inProgressTickets = allTickets.filter(t =>
          t.column && t.column.toLowerCase().includes('progress')
        );

        if (inProgressTickets.length === 0) {
          await storage.close();
          db.close();
          this.log(styles.info('No in-progress work found.'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select work to mark as ready for review:',
          choices: inProgressTickets.map(t => ({
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
        db.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Get configured column name (from pmo_settings or default)
      const targetColumnName = getWorkColumnSetting(db, 'review');
      const board = await storage.getBoard();
      const columnNames = board.columns.map(col => col.name);
      const reviewColumn = findColumnByName(columnNames, targetColumnName);

      if (!reviewColumn) {
        await storage.close();
        db.close();
        this.error(`No "${targetColumnName}" column found in board configuration. Configure with: prlt config set column_review <column-name>`);
      }

      const previousColumn = ticket.column;

      // Move to Review column
      await storage.moveTicket(ticketId!, reviewColumn);

      // Auto-export to board.md if configured
      await autoExportToBoard(pmoPath, storage);

      // Mark any running executions for this ticket as completed
      const runningExecution = executionStorage.getRunningExecution(ticketId!);
      if (runningExecution) {
        executionStorage.updateStatus(runningExecution.id, 'completed');
        this.log(styles.muted(`   Execution ${runningExecution.id} marked as completed`));
      }

      await storage.close();
      db.close();

      this.log(styles.success(`👀 Work ready for review: ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   From: ${previousColumn}`));
      this.log(styles.muted(`   To: ${reviewColumn}`));
    } catch (error) {
      await storage.close();
      db.close();
      throw error;
    }
  }
}
