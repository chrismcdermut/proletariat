import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';
import {
  requireGhCli,
  getPRForBranch,
  getPRByNumber,
  listOpenPRs,
  getMergeableState,
  rebasePRBranch,
  type PRInfo,
} from '../../lib/pr/index.js';
import { rebaseSiblingPRs, type SiblingRebaseResult } from '../../lib/shipping/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { validateBranchName } from '../../lib/branch/index.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import type { Ticket } from '../../lib/pmo/types.js';
import { openWorkspaceDatabase } from '../../lib/database/index.js';

export default class WorkRebase extends PMOCommand {
  static description = 'Rebase PR branch(es) onto latest base branch to resolve conflicts';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> --pr 929',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --all --dry-run',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID whose PR should be rebased',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    pr: Flags.integer({
      description: 'PR number to rebase (alternative to ticket ID lookup)',
      required: false,
    }),
    all: Flags.boolean({
      description: 'Rebase all open PRs that have merge conflicts',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be rebased without doing it',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkRebase);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work rebase', flags));
        return;
      }
      this.error(message);
    };

    // Check gh CLI (differentiated not-installed vs not-authenticated)
    if (!requireGhCli(handleError)) return;

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
      // Resolve the working directory for git operations
      const cwd = this.resolveWorktreePath(workspaceInfo, executionStorage, args.ticketId);

      if (flags.all) {
        await this.rebaseAll(flags, cwd, jsonMode);
      } else {
        await this.rebaseSingle(args, flags, projectId, executionStorage, cwd, jsonMode);
      }
    } finally {
      db.close();
    }
  }

  /**
   * Rebase all conflicting open PRs using provider-based API updates.
   */
  private async rebaseAll(
    flags: Record<string, unknown>,
    cwd: string | undefined,
    jsonMode: boolean,
  ): Promise<void> {
    const openPRs = listOpenPRs(cwd);

    if (openPRs.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson(
          { rebased: [], conflicting: 0, total: 0 },
          createMetadata('work rebase', flags),
        );
        return;
      }
      this.log(styles.info('No open PRs found.'));
      return;
    }

    // Check each PR for conflicts (for dry-run display)
    if (flags['dry-run']) {
      const conflicting: PRInfo[] = [];
      for (const pr of openPRs) {
        const state = getMergeableState(pr.number, cwd);
        if (state === 'CONFLICTING') {
          conflicting.push(pr);
        }
      }

      if (conflicting.length === 0) {
        this.log(styles.info(`No conflicting PRs found (${openPRs.length} open PRs checked).`));
        return;
      }

      this.log('');
      this.log(styles.info(`Dry run — ${conflicting.length} conflicting PR(s) would be rebased:`));
      this.log('');
      for (const pr of conflicting) {
        this.log(styles.muted(`   #${pr.number} — ${pr.title} (${pr.headBranch} → ${pr.baseBranch})`));
      }
      return;
    }

    // Use provider-based rebase for all conflicting PRs
    this.log('');
    this.log(styles.info('Rebasing conflicting PRs...'));

    const rebaseResult: SiblingRebaseResult = rebaseSiblingPRs({
      excludePRNumber: null,
      cwd,
      onProgress: (msg) => this.log(styles.muted(`   ${msg}`)),
      labelConflicts: true,
      commentOnConflicts: true,
    });

    for (const r of rebaseResult.succeeded) {
      this.log(styles.success(`   #${r.prNumber} rebased (${r.headBranch})`));
    }
    for (const r of rebaseResult.failed) {
      const conflictNote = r.hasConflicts ? ' (labeled rebase-conflict)' : '';
      this.log(styles.warning(`   #${r.prNumber} rebase failed: ${r.error}${conflictNote}`));
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          rebased: [
            ...rebaseResult.succeeded.map(r => ({
              prNumber: r.prNumber,
              headBranch: r.headBranch,
              success: true,
              error: null,
            })),
            ...rebaseResult.failed.map(r => ({
              prNumber: r.prNumber,
              headBranch: r.headBranch,
              success: false,
              error: r.error ?? null,
            })),
          ],
          conflicting: rebaseResult.succeeded.length + rebaseResult.failed.length,
          total: rebaseResult.totalChecked,
          succeeded: rebaseResult.succeeded.length,
          failed: rebaseResult.failed.length,
        },
        createMetadata('work rebase', flags),
      );
      return;
    }

    if (rebaseResult.succeeded.length === 0 && rebaseResult.failed.length === 0) {
      this.log(styles.info(`No conflicting PRs found (${openPRs.length} open PRs checked).`));
    } else {
      this.log('');
      this.log(styles.success(`Rebase complete: ${rebaseResult.succeeded.length} succeeded, ${rebaseResult.failed.length} failed`));
    }
  }

  /**
   * Rebase a single ticket's PR.
   */
  private async rebaseSingle(
    args: { ticketId?: string },
    flags: Record<string, unknown>,
    projectId: string | undefined,
    executionStorage: ExecutionStorage,
    cwd: string | undefined,
    jsonMode: boolean,
  ): Promise<void> {
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work rebase', flags));
        return;
      }
      this.error(message);
    };

    let ticketId = args.ticketId;
    let prNumber = flags.pr as number | undefined;
    let ticket: Ticket | null = null;
    let prInfo: PRInfo | null = null;

    if (prNumber) {
      // PR number provided directly
      prInfo = getPRByNumber(prNumber, cwd);
      if (!prInfo) {
        return handleError('PR_NOT_FOUND', `PR #${prNumber} not found.`);
      }

      // Try to resolve linked ticket
      ticket = await this.resolveLinkedTicket(prNumber, prInfo.headBranch, projectId);
      if (ticket) {
        ticketId = ticket.id;
      }
    } else {
      // Resolve ticket first
      if (!ticketId) {
        // Prompt for ticket selection from in-progress or in-review tickets with PRs
        const allTickets = await this.storage.listTickets(projectId);
        const rebasableTickets = allTickets.filter(t =>
          t.statusCategory === 'started' ||
          (t.statusName && (
            t.statusName.toLowerCase().includes('progress') ||
            t.statusName.toLowerCase().includes('review')
          ))
        );

        if (rebasableTickets.length === 0) {
          if (jsonMode) {
            outputErrorAsJson('NO_REBASABLE_WORK', 'No in-progress or in-review work found.', createMetadata('work rebase', flags));
            return;
          }
          this.log(styles.info('No in-progress or in-review work found.'));
          return;
        }

        const selected = await this.selectFromList({
          message: 'Select work to rebase:',
          items: rebasableTickets,
          getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
          getValue: (t) => t.id,
          getCommand: (t) => `prlt work rebase ${t.id} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work rebase' } : null,
        });

        if (!selected) {
          return;
        }
        ticketId = selected;
      }

      // Get ticket
      ticket = await this.storage.getTicket(ticketId!);
      if (!ticket) {
        return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`);
      }
      ticketId = ticket.id;

      // Find PR from ticket metadata or branch
      prNumber = ticket.metadata?.pr_number ? parseInt(ticket.metadata.pr_number, 10) : undefined;

      if (prNumber) {
        prInfo = getPRByNumber(prNumber, cwd);
      }

      if (!prInfo) {
        // Try to find PR from execution branch
        const runningExecution = executionStorage.getRunningExecution(ticketId!);
        const branch = runningExecution?.branch || ticket.branch;
        if (branch) {
          prInfo = getPRForBranch(branch, cwd);
          if (prInfo) {
            prNumber = prInfo.number;
          }
        }
      }

      if (!prInfo || !prNumber) {
        return handleError('NO_PR_FOUND', `No pull request found for ticket "${ticketId}".`);
      }
    }

    // Validate PR state
    if (prInfo.state !== 'OPEN') {
      return handleError('PR_NOT_OPEN', `PR #${prNumber} is ${prInfo.state}. Only open PRs can be rebased.`);
    }

    // Check if it actually has conflicts
    const mergeableState = getMergeableState(prNumber, cwd);

    // Dry run
    if (flags['dry-run']) {
      this.log('');
      this.log(styles.info('Dry run — no changes will be made:'));
      this.log('');
      this.log(styles.muted(`   PR:       #${prNumber} — ${prInfo.title}`));
      this.log(styles.muted(`   Branch:   ${prInfo.headBranch} → ${prInfo.baseBranch}`));
      this.log(styles.muted(`   State:    ${mergeableState}`));
      if (ticketId) {
        this.log(styles.muted(`   Ticket:   ${ticketId}${ticket ? ` — ${ticket.title}` : ''}`));
      }
      this.log('');
      if (mergeableState === 'CONFLICTING') {
        this.log(styles.muted('   Action: Would rebase onto base branch and force-push'));
      } else if (mergeableState === 'MERGEABLE') {
        this.log(styles.muted('   Action: No rebase needed — PR is already mergeable'));
      } else {
        this.log(styles.muted('   Action: Would attempt rebase (mergeable state unknown)'));
      }
      return;
    }

    // If already mergeable, nothing to do
    if (mergeableState === 'MERGEABLE') {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            rebased: false,
            reason: 'already_mergeable',
            prNumber,
            headBranch: prInfo.headBranch,
            ticketId: ticketId ?? null,
          },
          createMetadata('work rebase', flags),
        );
        return;
      }
      this.log(styles.info(`PR #${prNumber} is already mergeable — no rebase needed.`));
      return;
    }

    // Rebase
    this.log(styles.muted(`   Rebasing #${prNumber} (${prInfo.headBranch} onto ${prInfo.baseBranch})...`));

    const result = rebasePRBranch(prInfo.headBranch, prInfo.baseBranch, cwd);

    if (!result.success) {
      return handleError(
        'REBASE_FAILED',
        `Rebase failed for PR #${prNumber}: ${result.error}. Manual conflict resolution may be required.`,
      );
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          rebased: true,
          prNumber,
          headBranch: prInfo.headBranch,
          baseBranch: prInfo.baseBranch,
          ticketId: ticketId ?? null,
        },
        createMetadata('work rebase', flags),
      );
      return;
    }

    this.log(styles.success(`Rebased: PR #${prNumber}`));
    this.log(styles.muted(`   Branch: ${prInfo.headBranch} → ${prInfo.baseBranch}`));
    if (ticketId) {
      this.log(styles.muted(`   Ticket: ${ticketId}`));
    }
    this.log(styles.muted('   CI will rerun automatically on the force-pushed branch.'));
  }

  /**
   * Resolve the linked ticket for a PR (same logic as work:ship).
   */
  private async resolveLinkedTicket(
    prNumber: number,
    headBranch: string,
    projectId: string | undefined,
  ): Promise<Ticket | null> {
    const allTickets = await this.storage.listTickets(projectId);
    const byMetadata = allTickets.find(t =>
      t.metadata?.pr_number === String(prNumber) ||
      t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`) ||
      t.metadata?.pr_url?.endsWith(`/${prNumber}`)
    );
    if (byMetadata) return byMetadata;

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
   * Resolve the working directory for git operations.
   */
  private resolveWorktreePath(
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    executionStorage: ExecutionStorage,
    ticketId?: string,
  ): string | undefined {
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
}
