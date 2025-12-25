import { Command, Args, Flags } from '@oclif/core';
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
import {
  isGHInstalled,
  isGHAuthenticated,
  getCurrentBranch,
  getDefaultBaseBranch,
  hasBranchBeenPushed,
  pushBranch,
  hasUnpushedCommits,
  getCommitLog,
  createPR,
  getPRForBranch,
  generatePRTitle,
  generatePRBody,
} from '../../lib/pr/index.js';

export default class WorkReady extends Command {
  static description = 'Mark work as ready for review (moves ticket to In Review column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> --pr',
    '<%= config.bin %> <%= command.id %> TKT-001 --pr --draft',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    pr: Flags.boolean({
      description: 'Create a pull request for this work',
      default: false,
    }),
    draft: Flags.boolean({
      description: 'Create PR as draft (only with --pr)',
      default: false,
    }),
    'no-pr': Flags.boolean({
      description: 'Skip PR creation prompt',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorkReady);

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

      // Handle PR creation
      let prUrl: string | undefined;
      const shouldCreatePR = flags.pr || (!flags['no-pr'] && await this.shouldOfferPRCreation());

      if (shouldCreatePR) {
        prUrl = await this.handlePRCreation(ticket, flags.draft);
        if (prUrl) {
          // Store PR URL in ticket metadata
          await storage.updateTicket(ticketId!, {
            metadata: {
              ...ticket.metadata,
              pr_url: prUrl,
            },
          });
        }
      }

      await storage.close();
      db.close();

      this.log(styles.success(`👀 Work ready for review: ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   From: ${previousColumn}`));
      this.log(styles.muted(`   To: ${reviewColumn}`));
      if (prUrl) {
        this.log(styles.muted(`   PR: ${prUrl}`));
      }
    } catch (error) {
      await storage.close();
      db.close();
      throw error;
    }
  }

  /**
   * Check if we should offer PR creation (gh is available, on a feature branch, etc.)
   */
  private async shouldOfferPRCreation(): Promise<boolean> {
    // Check if gh CLI is available
    if (!isGHInstalled() || !isGHAuthenticated()) {
      return false;
    }

    // Check if we're on a feature branch (not main/master)
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
      return false;
    }

    const baseBranch = getDefaultBaseBranch();
    if (currentBranch === baseBranch) {
      return false;
    }

    // Check if PR already exists
    const existingPR = getPRForBranch(currentBranch);
    if (existingPR) {
      this.log(styles.muted(`   PR already exists: ${existingPR.url}`));
      return false;
    }

    // Prompt user
    const { createPR: wantPR } = await inquirer.prompt([{
      type: 'confirm',
      name: 'createPR',
      message: 'Create a pull request for this work?',
      default: true,
    }]);

    return wantPR;
  }

  /**
   * Handle PR creation for the ticket.
   */
  private async handlePRCreation(
    ticket: { id: string; title: string; description?: string },
    draft: boolean
  ): Promise<string | undefined> {
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
      this.log(styles.warning('Could not determine current branch. Skipping PR creation.'));
      return undefined;
    }

    const baseBranch = getDefaultBaseBranch();

    // Push branch if needed
    if (!hasBranchBeenPushed(currentBranch)) {
      this.log(styles.muted(`   Pushing branch to origin...`));
      if (!pushBranch(currentBranch)) {
        this.log(styles.warning('Failed to push branch. Skipping PR creation.'));
        return undefined;
      }
    } else if (hasUnpushedCommits(currentBranch)) {
      this.log(styles.muted(`   Pushing unpushed commits...`));
      if (!pushBranch(currentBranch)) {
        this.log(styles.warning('Failed to push commits. Skipping PR creation.'));
        return undefined;
      }
    }

    // Generate PR content
    const prTitle = generatePRTitle(ticket.id, ticket.title);
    const commits = getCommitLog(baseBranch);
    const prBody = generatePRBody({
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      commits: commits.slice(0, 10),
    });

    // Create PR
    this.log(styles.muted(`   Creating pull request...`));
    const result = createPR({
      title: prTitle,
      body: prBody,
      base: baseBranch,
      draft,
    });

    if (!result.success) {
      this.log(styles.warning(`Failed to create PR: ${result.error}`));
      return undefined;
    }

    this.log(styles.success(`   PR #${result.number} created`));
    return result.url;
  }
}
