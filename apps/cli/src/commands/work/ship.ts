import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { moveTicketByIntent } from '../../lib/work-lifecycle/transition.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';
import {
  isGHInstalled,
  isGHAuthenticated,
  getPRByNumber,
  getPRForBranch,
  getPRChecks,
  mergePR,
  getGitHubRepo,
  getDefaultBaseBranch,
  listOpenPRs,
  type PRInfo,
  type PRCheck,
} from '../../lib/pr/index.js';
import {
  rebaseSiblingPRs,
  type SiblingRebaseResult,
  watchAndShip,
  GitHubAutoMergeProvider,
  type WhenGreenResult,
} from '../../lib/shipping/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { getEventBus } from '../../lib/events/event-bus.js';
import { validateBranchName } from '../../lib/branch/index.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import type { Ticket } from '../../lib/pmo/types.js';
import { execSync } from 'node:child_process';
import { openWorkspaceDatabase } from '../../lib/database/index.js';

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class WorkShip extends PMOCommand {
  static description = 'Ship work: rebase, merge PR, and move ticket to Done';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> PRLT-1092',
    '<%= config.bin %> <%= command.id %> --pr 929',
    '<%= config.bin %> <%= command.id %> TKT-001 --dry-run',
    '<%= config.bin %> <%= command.id %> TKT-001 --wait',
    '<%= config.bin %> <%= command.id %> TKT-001 --when-green',
    '<%= config.bin %> <%= command.id %> --when-green --pr 990',
    '<%= config.bin %> <%= command.id %> --when-green --all',
    '<%= config.bin %> <%= command.id %> TKT-001 --no-rebase',
    '<%= config.bin %> <%= command.id %> TKT-001 --no-rebase-siblings',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    pr: Flags.integer({
      description: 'PR number to merge (alternative to ticket ID lookup)',
      required: false,
    }),
    method: Flags.string({
      description: 'Merge method',
      options: ['merge', 'squash', 'rebase'],
      default: 'squash',
    }),
    wait: Flags.boolean({
      description: 'Wait for CI to go green before merging',
      default: false,
    }),
    'when-green': Flags.boolean({
      description: 'Watch CI and auto-merge when all checks pass. Rebases if behind main.',
      default: false,
    }),
    all: Flags.boolean({
      description: 'Ship all currently-green PRs (use with --when-green to watch all)',
      default: false,
    }),
    'no-rebase': Flags.boolean({
      description: 'Fail on conflicts instead of auto-rebasing',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would happen without doing it',
      default: false,
    }),
    'delete-branch': Flags.boolean({
      description: 'Delete remote branch after merging',
      default: true,
      allowNo: true,
    }),
    admin: Flags.boolean({
      description: 'Use admin privileges to bypass branch protections',
      default: false,
    }),
    'rebase-siblings': Flags.boolean({
      description: 'After merging, rebase other open PRs that become conflicting',
      default: true,
      allowNo: true,
    }),
    'no-transition': Flags.boolean({
      description: 'Skip board state transition (still merges PR)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkShip);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work ship', flags));
        return;
      }
      this.error(message);
    };

    // Check gh CLI
    if (!isGHInstalled()) {
      return handleError('GH_NOT_INSTALLED', 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    if (!isGHAuthenticated()) {
      return handleError('GH_NOT_AUTHENTICATED', 'GitHub CLI is not authenticated. Run "gh auth login" first.');
    }

    // Get workspace info
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.');
    }

    const db = openWorkspaceDatabase(workspaceInfo.path);
    const executionStorage = new ExecutionStorage(db);

    try {
      // --- Handle --all flag: batch ship all green PRs ---
      if (flags.all) {
        await this.shipAll(flags, workspaceInfo, executionStorage, db, jsonMode);
        return;
      }

      // --- Step 1: Resolve ticket and PR ---
      let ticketId = args.ticketId;
      let prNumber = flags.pr;
      let ticket: Ticket | null = null;
      let prInfo: PRInfo | null = null;

      if (prNumber) {
        // PR number provided directly — find the PR, then resolve the ticket
        prInfo = getPRByNumber(prNumber);
        if (!prInfo) {
          db.close();
          return handleError('PR_NOT_FOUND', `PR #${prNumber} not found.`);
        }

        // Try to resolve the linked ticket
        ticket = await this.resolveLinkedTicket(prNumber, prInfo.headBranch, projectId);
        if (ticket) {
          ticketId = ticket.id;
        }
      } else {
        // Resolve ticket first
        if (!ticketId) {
          // Prompt for ticket selection from shippable tickets (in review or in progress)
          const allTickets = await this.storage.listTickets(projectId);
          const shippableTickets = allTickets.filter(t =>
            t.statusCategory === 'started' ||
            (t.statusName && (
              t.statusName.toLowerCase().includes('progress') ||
              t.statusName.toLowerCase().includes('review')
            ))
          );

          if (shippableTickets.length === 0) {
            db.close();
            if (jsonMode) {
              outputErrorAsJson('NO_SHIPPABLE_WORK', 'No in-progress or in-review work found.', createMetadata('work ship', flags));
              return;
            }
            this.log(styles.info('No in-progress or in-review work found.'));
            return;
          }

          const selected = await this.selectFromList({
            message: 'Select work to ship:',
            items: shippableTickets,
            getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
            getValue: (t) => t.id,
            getCommand: (t) => `prlt work ship ${t.id} --json`,
            jsonMode: jsonMode ? { flags, commandName: 'work ship' } : null,
          });

          if (!selected) {
            db.close();
            return;
          }
          ticketId = selected;
        }

        // Get ticket
        ticket = await this.storage.getTicket(ticketId!);
        if (!ticket) {
          db.close();
          return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
        }
        ticketId = ticket.id;

        // Find PR from ticket metadata or branch
        prNumber = ticket.metadata?.pr_number ? parseInt(ticket.metadata.pr_number, 10) : undefined;

        if (prNumber) {
          prInfo = getPRByNumber(prNumber);
        }

        if (!prInfo) {
          // Try to find PR from execution branch
          const runningExecution = executionStorage.getRunningExecution(ticketId!);
          const branch = runningExecution?.branch || ticket.branch;
          if (branch) {
            prInfo = getPRForBranch(branch);
            if (prInfo) {
              prNumber = prInfo.number;
            }
          }
        }

        if (!prInfo || !prNumber) {
          db.close();
          return handleError('NO_PR_FOUND', `No pull request found for ticket "${ticketId}". Create one with "prlt work ready ${ticketId} --pr".`);
        }
      }

      // Validate PR state
      if (prInfo.state === 'MERGED') {
        db.close();
        if (jsonMode) {
          outputSuccessAsJson(
            { alreadyMerged: true, prNumber, title: prInfo.title, ticketId: ticketId ?? null },
            createMetadata('work ship', flags),
          );
          return;
        }
        this.log(styles.info(`PR #${prNumber} is already merged.`));
        return;
      }

      if (prInfo.state === 'CLOSED') {
        db.close();
        return handleError('PR_CLOSED', `PR #${prNumber} is closed. Reopen it first.`);
      }

      // Resolve the working directory for git operations
      const cwd = this.resolveWorktreePath(workspaceInfo, executionStorage, ticketId);

      // --- Dry run summary ---
      if (flags['dry-run']) {
        this.log('');
        this.log(styles.info('Dry run — no changes will be made:'));
        this.log('');
        this.log(styles.muted(`   PR:      #${prNumber} — ${prInfo.title}`));
        this.log(styles.muted(`   Branch:  ${prInfo.headBranch} → ${prInfo.baseBranch}`));
        this.log(styles.muted(`   Method:  ${flags.method}`));
        this.log(styles.muted(`   Mode:    ${flags['when-green'] ? 'when-green (watch + auto-merge)' : 'immediate'}`));
        if (ticketId) {
          this.log(styles.muted(`   Ticket:  ${ticketId}${ticket ? ` — ${ticket.title}` : ''}`));
        }

        // Check CI
        const checks = getPRChecks(prNumber, cwd);
        if (checks.length > 0) {
          const allPassed = checks.every(c => c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED');
          const pending = checks.filter(c => !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED');
          const failed = checks.filter(c => c.conclusion === 'FAILURE');

          if (allPassed) {
            this.log(styles.muted(`   CI:      All checks passed (${checks.length})`));
          } else if (pending.length > 0) {
            this.log(styles.muted(`   CI:      ${pending.length} pending, ${failed.length} failed`));
          } else {
            this.log(styles.muted(`   CI:      ${failed.length} failed`));
          }
        } else {
          this.log(styles.muted(`   CI:      No checks configured`));
        }

        // Check conflicts
        const hasConflicts = this.checkMergeConflicts(prNumber, cwd);
        this.log(styles.muted(`   Conflicts: ${hasConflicts ? 'Yes — would rebase' : 'None'}`));

        this.log('');
        this.log(styles.muted('   Actions that would be taken:'));
        if (hasConflicts && !flags['no-rebase']) {
          this.log(styles.muted('   1. Rebase onto base branch and force-push'));
          this.log(styles.muted('   2. Wait for CI to rerun'));
        }
        this.log(styles.muted(`   ${hasConflicts && !flags['no-rebase'] ? '3' : '1'}. Squash merge PR #${prNumber}`));
        if (ticketId) {
          this.log(styles.muted(`   ${hasConflicts && !flags['no-rebase'] ? '4' : '2'}. Move ticket ${ticketId} to Done`));
        }
        if (flags['delete-branch']) {
          this.log(styles.muted(`   ${hasConflicts && !flags['no-rebase'] ? '5' : '3'}. Delete remote branch ${prInfo.headBranch}`));
        }
        if (flags['rebase-siblings']) {
          this.log(styles.muted(`   ${hasConflicts && !flags['no-rebase'] ? '6' : '4'}. Check and rebase conflicting sibling PRs`));
        }

        db.close();
        return;
      }

      // --- Step 2+3+4: CI check, rebase, and merge ---
      const method = flags.method as 'merge' | 'squash' | 'rebase';
      this.log('');
      this.log(styles.info(`Shipping PR #${prNumber}: ${prInfo.title}`));

      let whenGreenResult: WhenGreenResult | undefined;

      if (flags['when-green']) {
        // --- When-green mode: watch CI and auto-merge ---
        whenGreenResult = await watchAndShip(
          {
            prNumber,
            method,
            deleteBranch: flags['delete-branch'],
            admin: flags.admin,
            noRebase: flags['no-rebase'],
            cwd,
            headBranch: prInfo.headBranch,
            baseBranch: prInfo.baseBranch,
            onProgress: (msg) => this.log(styles.muted(`   ${msg}`)),
            onWarning: (msg) => this.warn(msg),
          },
          new GitHubAutoMergeProvider(),
        );

        if (!whenGreenResult.merged) {
          db.close();
          return handleError(
            whenGreenResult.errorCode || 'WHEN_GREEN_FAILED',
            whenGreenResult.error || 'Auto-merge failed for unknown reason.',
          );
        }

        this.log(styles.success(`   PR #${prNumber} merged`));
      } else {
        // --- Standard mode: immediate CI check + merge ---
        const ciResult = await this.waitForCI(prNumber, flags.wait, cwd);
        if (!ciResult.passed) {
          db.close();
          return handleError('CI_FAILED', ciResult.message);
        }

        // Check for merge conflicts and rebase if needed
        const hasConflicts = this.checkMergeConflicts(prNumber, cwd);
        if (hasConflicts) {
          if (flags['no-rebase']) {
            db.close();
            return handleError('MERGE_CONFLICTS', `PR #${prNumber} has merge conflicts. Resolve them manually or run without --no-rebase to auto-rebase.`);
          }

          this.log(styles.muted('   Merge conflicts detected, rebasing...'));
          const rebaseResult = this.rebaseOntoBase(prInfo.headBranch, prInfo.baseBranch, cwd);
          if (!rebaseResult.success) {
            db.close();
            return handleError('REBASE_FAILED', `Rebase failed: ${rebaseResult.error}. Resolve conflicts manually.`);
          }

          this.log(styles.muted('   Rebased and force-pushed. Waiting for CI...'));

          // Wait for CI to rerun after rebase
          const postRebaseCI = await this.waitForCI(prNumber, true, cwd);
          if (!postRebaseCI.passed) {
            db.close();
            return handleError('CI_FAILED_AFTER_REBASE', postRebaseCI.message);
          }
        }

        // Merge the PR
        this.log(styles.muted(`   Merging PR #${prNumber} (${method})...`));

        const mergeResult = mergePR(prNumber, {
          method,
          deleteBranch: flags['delete-branch'],
          admin: flags.admin,
          cwd,
        });

        if (!mergeResult.success) {
          db.close();
          return handleError('MERGE_FAILED', `Failed to merge PR #${prNumber}: ${mergeResult.error}`);
        }

        this.log(styles.success(`   PR #${prNumber} merged`));
      }

      // --- Step 5: Move ticket to Done ---
      let ticketMovedToDone = false;
      let ticketTransitionProvider: string | undefined;
      let previousColumn: string | undefined;
      let doneColumn: string | null | undefined;

      if (ticket && ticketId) {
        // Update PR metadata
        await this.storage.updateTicket(ticketId, {
          metadata: {
            ...ticket.metadata,
            pr_state: 'MERGED',
            merged_at: new Date().toISOString(),
          },
        });

        if (!flags['no-transition']) {
          try {
            previousColumn = ticket.statusName;
            const transition = await moveTicketByIntent({
              db,
              storage: this.storage,
              ticket,
              intent: 'completed',
              providerName: 'pmo',
              resolveProvider: (tid, pid) => this.resolveTicketProvider(tid, pid),
              log: (msg) => this.log(styles.muted(`   ${msg}`)),
            });
            if (transition.moved) {
              doneColumn = transition.targetColumn;
              ticketMovedToDone = true;
              ticketTransitionProvider = 'pmo';
            }
          } catch (err) {
            this.warn(`Failed to move ticket ${ticketId} to Done: ${err instanceof Error ? err.message : err}`);
          }
        }

        // Auto-export board
        await autoExportToBoard(this.pmoPath, this.storage);

        // Mark execution as completed
        const runningExecution = executionStorage.getRunningExecution(ticketId);
        if (runningExecution) {
          executionStorage.updateStatus(runningExecution.id, 'completed');
          this.log(styles.muted(`   Execution ${runningExecution.id} marked as completed`));
        }
      }

      // --- Step 6: Emit event ---
      if (ticketId) {
        try {
          const repo = getGitHubRepo(cwd);
          const prUrl = repo ? `https://github.com/${repo}/pull/${prNumber}` : null;

          getEventBus().emit('work:pr_merged', {
            workItemId: ticketId,
            source: 'github',
            prNumber,
            prTitle: prInfo.title,
            prUrl,
            mergeMethod: method,
            timestamp: new Date(),
          });
        } catch {
          // Non-critical
        }
      }

      // --- Step 7: Auto-rebase conflicting sibling PRs ---
      let siblingRebaseResults: Array<{ prNumber: number; headBranch: string; success: boolean; error?: string }> = [];
      if (flags['rebase-siblings']) {
        try {
          this.log(styles.muted('   Checking sibling PRs for conflicts...'));
          const rebaseResult: SiblingRebaseResult = rebaseSiblingPRs({
            excludePRNumber: prNumber,
            cwd,
            onProgress: (msg) => this.log(styles.muted(`   ${msg}`)),
            labelConflicts: true,
            commentOnConflicts: true,
          });

          // Combine succeeded + failed for backward-compatible output
          siblingRebaseResults = [
            ...rebaseResult.succeeded.map(r => ({
              prNumber: r.prNumber,
              headBranch: r.headBranch,
              success: true,
              error: undefined,
            })),
            ...rebaseResult.failed.map(r => ({
              prNumber: r.prNumber,
              headBranch: r.headBranch,
              success: false,
              error: r.error,
            })),
          ];

          if (rebaseResult.succeeded.length === 0 && rebaseResult.failed.length === 0) {
            this.log(styles.muted('   No conflicting sibling PRs found'));
          } else {
            for (const r of rebaseResult.succeeded) {
              this.log(styles.success(`   Rebased sibling PR #${r.prNumber} (${r.headBranch})`));
            }
            for (const r of rebaseResult.failed) {
              const conflictNote = r.hasConflicts ? ' (labeled rebase-conflict)' : '';
              this.log(styles.warning(`   Failed to rebase PR #${r.prNumber}: ${r.error}${conflictNote}`));
            }
          }
        } catch {
          // Non-critical — don't block ship for sibling rebase failures
          this.log(styles.muted('   Sibling PR rebase check skipped (error)'));
        }
      }

      db.close();

      // --- Output ---
      if (jsonMode) {
        outputSuccessAsJson(
          {
            shipped: true,
            prNumber,
            prTitle: prInfo.title,
            method,
            branchDeleted: flags['delete-branch'],
            ticketId: ticketId ?? null,
            ticketMovedToDone,
            ticketTransitionProvider: ticketTransitionProvider ?? null,
            siblingRebases: siblingRebaseResults,
            whenGreen: whenGreenResult ? {
              autoMergeEnabled: whenGreenResult.autoMergeEnabled,
              pollCycles: whenGreenResult.pollCycles,
              rebasePerformed: whenGreenResult.rebasePerformed,
            } : null,
          },
          createMetadata('work ship', flags),
        );
        return;
      }

      this.log('');
      this.log(styles.success(`Shipped: ${ticketId ?? `PR #${prNumber}`}`));
      this.log(styles.muted(`   PR:     #${prNumber} — ${prInfo.title}`));
      this.log(styles.muted(`   Method: ${method}`));
      if (flags['delete-branch']) {
        this.log(styles.muted(`   Branch: ${prInfo.headBranch} deleted`));
      }
      if (ticketMovedToDone && ticketId) {
        this.log(styles.muted(`   Ticket: ${ticketId} → ${doneColumn}`));
        if (previousColumn) {
          this.log(styles.muted(`   From:   ${previousColumn}`));
        }
      }
      if (siblingRebaseResults.length > 0) {
        const succeeded = siblingRebaseResults.filter(r => r.success).length;
        const failed = siblingRebaseResults.filter(r => !r.success).length;
        this.log(styles.muted(`   Sibling rebases: ${succeeded} succeeded, ${failed} failed`));
      }
      if (whenGreenResult) {
        if (whenGreenResult.rebasePerformed) {
          this.log(styles.muted('   Rebase: performed during watch'));
        }
        this.log(styles.muted(`   Watch:  ${whenGreenResult.pollCycles} poll cycles`));
      }
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /**
   * Resolve the linked ticket for a PR.
   */
  private async resolveLinkedTicket(
    prNumber: number,
    headBranch: string,
    projectId: string | undefined,
  ): Promise<Ticket | null> {
    // 1. Find by PR metadata on tickets
    const allTickets = await this.storage.listTickets(projectId);
    const byMetadata = allTickets.find(t =>
      t.metadata?.pr_number === String(prNumber) ||
      t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`) ||
      t.metadata?.pr_url?.endsWith(`/${prNumber}`)
    );
    if (byMetadata) return byMetadata;

    // 2. Look up from agent_work table by branch name
    try {
      const db = this.storage.getDatabase();
      const row = db.prepare(
        `SELECT ticket_id FROM ${PMO_TABLES.agent_work} WHERE branch = ? LIMIT 1`
      ).get(headBranch) as { ticket_id: string } | undefined;
      if (row?.ticket_id) {
        const ticket = await this.storage.getTicket(row.ticket_id);
        if (ticket) return ticket;
      }
    } catch {
      // agent_work lookup failed
    }

    // 3. Parse ticket ID from branch name
    const branchResult = validateBranchName(headBranch);
    if (branchResult.valid && branchResult.parts?.ticketId) {
      const branchTicketId = branchResult.parts.ticketId;

      const directTicket = await this.storage.getTicket(branchTicketId);
      if (directTicket) return directTicket;

      const byExternalKey = allTickets.find(t =>
        t.metadata?.external_key === branchTicketId
      );
      if (byExternalKey) return byExternalKey;
    }

    return null;
  }

  /**
   * Wait for CI checks to pass. Returns immediately if all passed.
   * If --wait is set, polls until all complete. Otherwise warns on pending.
   */
  private async waitForCI(
    prNumber: number,
    shouldWait: boolean,
    cwd?: string,
  ): Promise<{ passed: boolean; message: string }> {
    const maxAttempts = 120; // 30 minutes max (15s intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      const checks = getPRChecks(prNumber, cwd);

      // No checks configured — pass through
      if (checks.length === 0) {
        this.log(styles.muted('   No CI checks configured'));
        return { passed: true, message: '' };
      }

      const failed = checks.filter(c => c.conclusion === 'FAILURE');
      const pending = checks.filter(c =>
        !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED'
      );
      const passed = checks.filter(c =>
        c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED'
      );

      // All done
      if (pending.length === 0) {
        if (failed.length > 0) {
          const failedNames = failed.map(c => c.name).join(', ');
          return {
            passed: false,
            message: `CI checks failed: ${failedNames}. Fix the failures before shipping.`,
          };
        }

        this.log(styles.muted(`   CI: ${passed.length} checks passed`));
        return { passed: true, message: '' };
      }

      // Checks still running
      if (!shouldWait) {
        const pendingNames = pending.map(c => c.name).join(', ');
        return {
          passed: false,
          message: `CI checks still running: ${pendingNames}. Use --wait to wait for them, or re-run after they complete.`,
        };
      }

      // Wait and retry
      if (attempts === 0) {
        this.log(styles.muted(`   Waiting for CI (${pending.length} pending)...`));
      }
      attempts++;
      await sleep(15_000);
    }

    return {
      passed: false,
      message: 'Timed out waiting for CI checks (30 minutes). Check manually.',
    };
  }

  /**
   * Check if the PR has merge conflicts with the base branch.
   */
  private checkMergeConflicts(prNumber: number, cwd?: string): boolean {
    try {
      const result = execSync(
        `gh pr view ${prNumber} --json mergeable -q .mergeable`,
        {
          cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim();

      return result === 'CONFLICTING';
    } catch {
      // If we can't determine, assume no conflicts
      return false;
    }
  }

  /**
   * Rebase the PR branch onto the base branch and force-push.
   */
  private rebaseOntoBase(
    headBranch: string,
    baseBranch: string,
    cwd?: string,
  ): { success: boolean; error?: string } {
    try {
      // Fetch latest from origin
      execSync('git fetch origin', {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Check out the head branch
      execSync(`git checkout ${headBranch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Rebase onto base
      execSync(`git rebase origin/${baseBranch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Force-push
      execSync(`git push --force-with-lease origin ${headBranch}`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return { success: true };
    } catch (error) {
      // Abort rebase on failure
      try {
        execSync('git rebase --abort', {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // Ignore abort failures
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown rebase error',
      };
    }
  }

  /**
   * Resolve the working directory for git operations.
   * Tries: devcontainer repo dirs, execution worktree, agent dirs.
   */
  private resolveWorktreePath(
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    executionStorage: ExecutionStorage,
    ticketId?: string,
  ): string | undefined {
    // In devcontainer, find repo directories
    if (process.env.DEVCONTAINER === 'true') {
      try {
        const entries = fs.readdirSync('/workspace', { withFileTypes: true });
        const repoDirs = entries.filter(e =>
          e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules'
        );
        if (repoDirs.length > 0) {
          return path.join('/workspace', repoDirs[0].name);
        }
      } catch {
        // Fall through
      }
    }

    // Try execution record
    if (ticketId) {
      const execution = executionStorage.getRunningExecution(ticketId);
      if (execution?.agentName) {
        const agentRecord = workspaceInfo.agents.find(a => a.name === execution.agentName);
        let agentDir: string | undefined;
        if (agentRecord?.worktree_path) {
          agentDir = path.join(workspaceInfo.path, agentRecord.worktree_path);
        } else if (agentRecord?.type === 'ephemeral') {
          agentDir = path.join(workspaceInfo.path, 'agents', workspaceInfo.ephemeralAgentsDir, execution.agentName);
        } else if (agentRecord) {
          agentDir = path.join(workspaceInfo.path, 'agents', workspaceInfo.persistentAgentsDir, execution.agentName);
        }

        if (agentDir && fs.existsSync(agentDir)) {
          try {
            const entries = fs.readdirSync(agentDir, { withFileTypes: true });
            const repoDirs = entries.filter(e =>
              e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules'
            );
            if (repoDirs.length > 0) {
              return path.join(agentDir, repoDirs[0].name);
            }
          } catch {
            // Fall through
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Ship all currently-green PRs, or watch all open PRs when --when-green is set.
   */
  private async shipAll(
    flags: Record<string, unknown>,
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    executionStorage: ExecutionStorage,
    db: ReturnType<typeof openWorkspaceDatabase>,
    jsonMode: boolean,
  ): Promise<void> {
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work ship', flags));
        return;
      }
      this.error(message);
    };

    const cwd = this.resolveWorktreePath(workspaceInfo, executionStorage);

    // Get all open PRs
    const openPRs = listOpenPRs(cwd);
    if (openPRs.length === 0) {
      db.close();
      if (jsonMode) {
        outputSuccessAsJson(
          { shipped: [], skipped: [], message: 'No open PRs found.' },
          createMetadata('work ship', flags),
        );
        return;
      }
      this.log(styles.info('No open PRs found.'));
      return;
    }

    const method = (flags.method as string) || 'squash';
    const whenGreen = flags['when-green'] as boolean;
    const shipped: Array<{ prNumber: number; title: string }> = [];
    const skipped: Array<{ prNumber: number; title: string; reason: string }> = [];
    const failed: Array<{ prNumber: number; title: string; error: string }> = [];

    this.log('');
    this.log(styles.info(`Processing ${openPRs.length} open PRs...`));

    for (const pr of openPRs) {
      // Check CI status
      const checks = getPRChecks(pr.number, cwd);
      const ciPending = checks.filter(c =>
        !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED'
      );
      const ciFailed = checks.filter(c => c.conclusion === 'FAILURE');
      const ciPassed = checks.length === 0 || (ciPending.length === 0 && ciFailed.length === 0);

      if (!ciPassed && !whenGreen) {
        const reason = ciFailed.length > 0
          ? `CI failed: ${ciFailed.map(c => c.name).join(', ')}`
          : `CI pending: ${ciPending.map(c => c.name).join(', ')}`;
        skipped.push({ prNumber: pr.number, title: pr.title, reason });
        this.log(styles.muted(`   Skip #${pr.number}: ${reason}`));
        continue;
      }

      if (whenGreen) {
        // Enable auto-merge on each PR and move on (non-blocking)
        const autoMergeProvider = new GitHubAutoMergeProvider();
        const result = autoMergeProvider.enableAutoMerge(
          pr.number,
          method as 'merge' | 'squash' | 'rebase',
          cwd,
        );
        if (result.success) {
          shipped.push({ prNumber: pr.number, title: pr.title });
          this.log(styles.success(`   #${pr.number}: auto-merge enabled (${pr.title})`));
        } else {
          failed.push({ prNumber: pr.number, title: pr.title, error: result.error || 'Unknown error' });
          this.log(styles.warning(`   #${pr.number}: failed to enable auto-merge: ${result.error}`));
        }
      } else {
        // Ship immediately — CI is green
        this.log(styles.muted(`   Shipping #${pr.number}: ${pr.title}...`));

        const mergeResult = mergePR(pr.number, {
          method: method as 'merge' | 'squash' | 'rebase',
          deleteBranch: flags['delete-branch'] as boolean ?? true,
          admin: flags.admin as boolean ?? false,
          cwd,
        });

        if (mergeResult.success) {
          shipped.push({ prNumber: pr.number, title: pr.title });
          this.log(styles.success(`   #${pr.number} merged`));

          // Try to resolve and update the linked ticket
          const ticket = await this.resolveLinkedTicket(pr.number, pr.headBranch, (flags as { project?: string }).project);
          if (ticket) {
            try {
              const transition = await moveTicketByIntent({
                db,
                storage: this.storage,
                ticket,
                intent: 'completed',
                providerName: 'pmo',
                resolveProvider: (tid, pid) => this.resolveTicketProvider(tid, pid),
              });
              if (transition.moved) {
                this.log(styles.muted(`   ${ticket.id} → ${transition.targetColumn}`));
              }
            } catch {
              // Non-fatal
            }
          }
        } else {
          failed.push({ prNumber: pr.number, title: pr.title, error: mergeResult.error || 'Unknown error' });
          this.log(styles.warning(`   #${pr.number} merge failed: ${mergeResult.error}`));
        }
      }
    }

    db.close();

    // Output
    if (jsonMode) {
      outputSuccessAsJson(
        { shipped, skipped, failed, mode: whenGreen ? 'when-green' : 'immediate' },
        createMetadata('work ship', flags),
      );
      return;
    }

    this.log('');
    this.log(styles.success(`Done: ${shipped.length} shipped, ${skipped.length} skipped, ${failed.length} failed`));
  }
}
