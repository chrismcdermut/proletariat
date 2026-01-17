import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
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
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class WorkReady extends PMOCommand {
  static description = 'Mark work as ready for review (moves ticket to In Review column)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> --pr',
    '<%= config.bin %> <%= command.id %> TKT-001 --pr --draft',
    '<%= config.bin %> <%= command.id %> --json  # Output choices as JSON',
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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
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

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkReady);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work ready', flags));
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
        // Get all in-progress (started) tickets for selection, optionally filtered by project
        const allTickets = await this.storage.listTickets(projectId);
        const inProgressTickets = allTickets.filter(t =>
          t.statusCategory === 'started' || (t.statusName && t.statusName.toLowerCase().includes('progress'))
        );

        if (inProgressTickets.length === 0) {
          db.close();
          if (jsonMode) {
            outputErrorAsJson('NO_IN_PROGRESS_WORK', 'No in-progress work found.', createMetadata('work ready', flags));
            return;
          }
          this.log(styles.info('No in-progress work found.'));
          return;
        }

        // In JSON mode, output ticket selection prompt and exit
        if (jsonMode) {
          const ticketChoices = inProgressTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.statusName})`,
            value: t.id,
          }));
          outputPromptAsJson(
            buildPromptConfig('list', 'ticketId', 'Select work to mark as ready for review:', ticketChoices),
            createMetadata('work ready', flags)
          );
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select work to mark as ready for review:',
          choices: inProgressTickets.map(t => ({
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
      // In Linear-style workflow, "ready" moves ticket to Done (review is implicit via PR)
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

      // Handle PR creation
      let prUrl: string | undefined;
      const shouldCreatePR = flags.pr || (!flags['no-pr'] && await this.shouldOfferPRCreation());

      if (shouldCreatePR) {
        // Get branch and worktree path from the execution record
        const branch = runningExecution?.branch;
        const agentName = runningExecution?.agentName;
        let worktreePath: string | undefined;

        if (agentName) {
          // Get agent's worktree path
          if (process.env.DEVCONTAINER === 'true') {
            // In devcontainer, look for repo directories inside /workspace
            const entries = fs.readdirSync('/workspace', { withFileTypes: true });
            const repoDirs = entries.filter((e) =>
              e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules'
            );
            if (repoDirs.length > 0) {
              // Use the first repo directory (typically proletariat-{agentName})
              worktreePath = path.join('/workspace', repoDirs[0].name);
            }
          } else {
            const agentsPath = path.join(workspaceInfo.path, 'agents', 'staff');
            const agentDir = path.join(agentsPath, agentName);
            // Look for repo directories inside agent dir
            const entries = fs.readdirSync(agentDir, { withFileTypes: true });
            const repoDirs = entries.filter((e) =>
              e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules'
            );
            if (repoDirs.length > 0) {
              // Use the first repo directory (typically the main worktree)
              worktreePath = path.join(agentDir, repoDirs[0].name);
            }
          }
        }

        prUrl = await this.handlePRCreation(ticket, flags.draft, branch, worktreePath);
        if (prUrl) {
          // Store PR URL in ticket metadata
          await this.storage.updateTicket(ticketId!, {
            metadata: {
              ...ticket.metadata,
              pr_url: prUrl,
            },
          });
        }
      }

      db.close();

      this.log(styles.success(`Work ready: ${ticketId}`));
      this.log(styles.muted(`   Title: ${ticket.title}`));
      this.log(styles.muted(`   From: ${previousColumn}`));
      this.log(styles.muted(`   To: ${doneColumn}`));
      if (prUrl) {
        this.log(styles.muted(`   PR: ${prUrl}`));
      }
    } catch (error) {
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
      type: 'list',
      name: 'createPR',
      message: 'Create a pull request for this work?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
      default: true,
    }]);

    return wantPR;
  }

  /**
   * Handle PR creation for the ticket.
   */
  private async handlePRCreation(
    ticket: { id: string; title: string; description?: string },
    draft: boolean,
    branchFromExecution?: string,
    worktreePath?: string
  ): Promise<string | undefined> {
    // Use branch from execution record if available, otherwise try to detect
    const currentBranch = branchFromExecution || getCurrentBranch();
    if (!currentBranch) {
      this.log(styles.warning('Could not determine current branch. Skipping PR creation.'));
      return undefined;
    }

    // If we have a worktree path, cd to it for git operations
    const originalCwd = process.cwd();
    if (worktreePath) {
      try {
        process.chdir(worktreePath);
      } catch {
        this.log(styles.warning(`Could not access worktree at ${worktreePath}. Skipping PR creation.`));
        return undefined;
      }
    }

    try {
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
    } finally {
      // Restore original cwd
      if (worktreePath) {
        process.chdir(originalCwd);
      }
    }
  }
}
