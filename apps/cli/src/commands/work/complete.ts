import { Command, Args } from '@oclif/core';
import * as path from 'node:path';
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

export default class WorkComplete extends Command {
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

  async run(): Promise<void> {
    const { args } = await this.parse(WorkComplete);

    // Get workspace info for execution storage
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
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
        // Get all tickets that could be completed (in progress)
        const allTickets = await storage.listTickets();
        const completableTickets = allTickets.filter(t =>
          t.status === 'in_progress' || (t.column && t.column.toLowerCase().includes('progress'))
        );

        if (completableTickets.length === 0) {
          await storage.close();
          db.close();
          this.log(styles.info('No in-progress work found.'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select work to mark as complete:',
          choices: completableTickets.map(t => ({
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
      const targetColumnName = getWorkColumnSetting(db, 'done');
      const board = await storage.getBoard();
      const columnNames = board.columns.map(col => col.name);
      const doneColumn = findColumnByName(columnNames, targetColumnName);

      if (!doneColumn) {
        await storage.close();
        db.close();
        this.error(`No "${targetColumnName}" column found in board configuration. Configure with: prlt config set column_done <column-name>`);
      }

      const previousColumn = ticket.column;

      // Update ticket status
      await storage.updateTicket(ticketId!, { status: 'done' });

      // Move to Done column
      await storage.moveTicket(ticketId!, doneColumn);

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

      this.log(styles.success(`✅ Work complete: ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   From: ${previousColumn}`));
      this.log(styles.muted(`   To: ${doneColumn}`));
    } catch (error) {
      await storage.close();
      db.close();
      throw error;
    }
  }
}
