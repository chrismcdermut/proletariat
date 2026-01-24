import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { getWorkColumnSetting, findColumnByName } from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkComplete);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work complete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get workspace info for execution storage
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.');
    }

    // Open database for execution storage
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);
    const executionStorage = new ExecutionStorage(db);

    try {
      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId;

      if (!ticketId) {
        // Get all tickets that could be completed (in progress / started), optionally filtered by project
        const allTickets = await this.storage.listTickets(projectId);
        const completableTickets = allTickets.filter(t =>
          t.statusCategory === 'started' || (t.statusName && t.statusName.toLowerCase().includes('progress'))
        );

        if (completableTickets.length === 0) {
          db.close();
          if (jsonMode) {
            outputErrorAsJson('NO_COMPLETABLE_WORK', 'No in-progress work found.', createMetadata('work complete', flags));
            return;
          }
          this.log(styles.info('No in-progress work found.'));
          return;
        }

        const selected = await this.selectFromList({
          message: 'Select work to mark as complete:',
          items: completableTickets,
          getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
          getValue: (t) => t.id,
          getCommand: (t) => `prlt work complete ${t.id} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work complete' } : null,
        });

        if (!selected) {
          db.close();
          return;
        }
        ticketId = selected;
      }

      // Get ticket
      const ticket = await this.storage.getTicket(ticketId!);
      if (!ticket) {
        db.close();
        this.error(`Ticket "${ticketId}" not found.`);
      }

      // Get configured column name (from pmo_settings or default)
      const targetColumnName = getWorkColumnSetting(db, 'done');

      const board = await this.storage.getBoard(ticket.projectId!);
      const columnNames = board.columns.map(col => col.name);
      const doneColumn = findColumnByName(columnNames, targetColumnName);

      if (!doneColumn) {
        db.close();
        this.error(`No "${targetColumnName}" column found in board configuration. Configure with: prlt config set column_done <column-name>`);
      }

      const previousColumn = ticket.statusName;

      // Move to Done column (moveTicket also updates status_id)
      await this.storage.moveTicket(ticket.projectId!, ticketId!, doneColumn);

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
