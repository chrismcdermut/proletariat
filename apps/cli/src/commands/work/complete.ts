import { Args } from '@oclif/core';
import * as fs from 'node:fs';
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
import { trackWorkCompleted } from '../../lib/telemetry/analytics.js';
import { tryValidateCommits } from '../../lib/execution/commit-validation.js';
import { detectRepoWorktrees } from '../../lib/execution/context.js';

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
    const { args, flags } = await this.parse(WorkComplete);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work complete', flags));
        return
      }
      this.error(message);
    };

    // Get workspace info for execution storage
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.');
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
        return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
      }

      // Get configured column name (from pmo_settings or default)
      const targetColumnName = getWorkColumnSetting(db, 'done');

      const board = ticket.projectId ? await this.storage.getProjectBoard(ticket.projectId) : null;
      const columnNames = board ? board.columns.map(col => col.name) : [];
      const doneColumn = findColumnByName(columnNames, targetColumnName);

      if (!doneColumn) {
        db.close();
        this.error(`No "${targetColumnName}" column found in board configuration. Configure with: prlt config set column_done <column-name>`);
      }

      const previousColumn = ticket.statusName;

      // Move to Done column (moveTicket also updates status_id)
      await this.storage.moveTicket(ticket.projectId!, ticketId!, doneColumn);

      // Sync to external provider (e.g., Linear) if ticket was imported from one
      try {
        const provider = await this.resolveTicketProvider(ticketId!, ticket.projectId!);
        if (provider.name !== 'pmo') {
          const result = await provider.moveTicket(ticketId!, doneColumn);
          if (result.success) {
            this.log(styles.muted(`   Synced to ${result.provider}: ${doneColumn}`));
          }
        }
      } catch {
        // Non-fatal — don't block work complete for provider sync failures
      }

      // Auto-export to board.md if configured
      await autoExportToBoard(this.pmoPath, this.storage);

      // Mark any running executions for this ticket as completed
      const runningExecution = executionStorage.getRunningExecution(ticketId!);
      if (runningExecution) {
        executionStorage.updateStatus(runningExecution.id, 'completed');

        // Track work completion analytics
        const startTime = runningExecution.startedAt ? new Date(runningExecution.startedAt).getTime() : 0;
        const durationMs = startTime > 0 ? Date.now() - startTime : 0;
        trackWorkCompleted({ durationMs, prCreated: false });

        this.log(styles.muted(`   Execution ${runningExecution.id} marked as completed`));

        // PRLT-984: Commit validation — warn if no meaningful code was committed
        if (runningExecution.branch && runningExecution.agentName) {
          try {
            const agentRecord = workspaceInfo.agents.find(a => a.name === runningExecution.agentName);
            let agentDir: string | undefined;
            if (agentRecord?.worktree_path) {
              agentDir = path.join(workspaceInfo.path, agentRecord.worktree_path);
            } else if (agentRecord?.type === 'ephemeral') {
              agentDir = path.join(workspaceInfo.path, 'agents', workspaceInfo.ephemeralAgentsDir, runningExecution.agentName);
            } else if (agentRecord) {
              agentDir = path.join(workspaceInfo.path, 'agents', workspaceInfo.persistentAgentsDir, runningExecution.agentName);
            }

            if (agentDir && fs.existsSync(agentDir)) {
              const repoWorktrees = detectRepoWorktrees(agentDir);
              const validation = tryValidateCommits(agentDir, runningExecution.branch, repoWorktrees);
              if (validation && !validation.passed) {
                this.log(styles.warning(`   ⚠ Commit validation: ${validation.details}`));
                this.log(styles.warning(`     Agent may not have implemented meaningful code.`));
              } else if (validation?.passed) {
                this.log(styles.muted(`   ✓ Commit validation: ${validation.details}`));
              }
            }
          } catch {
            // Non-fatal — don't block work complete for validation failures
          }
        }
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
