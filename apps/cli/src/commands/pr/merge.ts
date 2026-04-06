import { Args, Flags } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { getWorkColumnSetting, findColumnByName } from '../../lib/work-lifecycle/settings.js';
import { styles } from '../../lib/styles.js';
import {
  requireGhCli,
  getPRByNumber,
  listOpenPRs,
  mergePR,
  getGitHubRepo,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { getEventBus } from '../../lib/events/event-bus.js';
import { validateBranchName } from '../../lib/branch/index.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import type { Ticket } from '../../lib/pmo/types.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

export default class PRMerge extends PMOCommand {
  static description = 'Merge a GitHub pull request by number';

  static examples = [
    '<%= config.bin %> <%= command.id %> 123',
    '<%= config.bin %> <%= command.id %> 123 --method squash',
    '<%= config.bin %> <%= command.id %> 123 --no-delete-branch',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static args = {
    prNumber: Args.integer({
      description: 'PR number to merge',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    method: Flags.string({
      description: 'Merge method',
      options: ['merge', 'squash', 'rebase'],
      default: 'squash',
    }),
    'delete-branch': Flags.boolean({
      description: 'Delete branch after merging',
      default: true,
      allowNo: true,
    }),
    admin: Flags.boolean({
      description: 'Use admin privileges to bypass branch protections',
      default: false,
    }),
  };

  // Flag to track if PMO is available
  private hasPMO = true;

  async init(): Promise<void> {
    try {
      await super.init();
    } catch {
      this.hasPMO = false;
    }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PRMerge);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr merge', flags));
        return
      }
      this.error(message);
    };

    // Check gh CLI (differentiated not-installed vs not-authenticated)
    if (!requireGhCli(handleError)) return;

    // Resolve repo cwd for gh CLI commands (may not be in a git repo)
    const repoCwd = this.resolveRepoCwd();

    let prNumber = args.prNumber;

    // If no PR number provided, prompt for selection
    if (!prNumber) {
      const openPRs = listOpenPRs(repoCwd);

      if (openPRs.length === 0) {
        return handleError('NO_OPEN_PRS', 'No open pull requests found.');
      }

      const resolver = new FlagResolver<{ pr?: string }>({
        commandName: 'pr merge',
        baseCommand: 'prlt pr merge',
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'pr',
        type: 'list',
        message: 'Select PR to merge:',
        choices: () => openPRs.map(pr => ({
          name: `#${pr.number} - ${pr.title} (${pr.headBranch})`,
          value: String(pr.number),
        })),
      });

      const resolved = await resolver.resolve();
      prNumber = parseInt(resolved.pr!, 10);
    }

    // Verify PR exists and is open
    const prInfo = getPRByNumber(prNumber, repoCwd);
    if (!prInfo) {
      return handleError('PR_NOT_FOUND', `PR #${prNumber} not found.`);
    }

    if (prInfo.state !== 'OPEN') {
      return handleError('PR_NOT_OPEN', `PR #${prNumber} is ${prInfo.state.toLowerCase()}, not open.`);
    }

    // Merge the PR
    const method = flags.method as 'merge' | 'squash' | 'rebase';
    const result = mergePR(prNumber, {
      method,
      deleteBranch: flags['delete-branch'],
      admin: flags.admin,
      cwd: repoCwd,
    });

    if (!result.success) {
      return handleError('MERGE_FAILED', `Failed to merge PR #${prNumber}: ${result.error}`);
    }

    // After successful merge, resolve the linked ticket and move it to Done
    let linkedTicketId: string | undefined;
    let ticketMovedToDone = false;
    let ticketTransitionProvider: string | undefined;
    if (this.hasPMO) {
      try {
        const linkedTicket = await this.resolveLinkedTicket(prNumber, prInfo.headBranch, flags.project);
        if (linkedTicket) {
          linkedTicketId = linkedTicket.id;

          // Update PR state metadata
          await this.storage.updateTicket(linkedTicket.id, {
            metadata: {
              ...linkedTicket.metadata,
              pr_state: 'MERGED',
            },
          });

          // Move ticket to Done column
          try {
            const db = this.storage.getDatabase();
            const targetColumnName = getWorkColumnSetting(db, 'done');
            const board = linkedTicket.projectId
              ? await this.storage.getProjectBoard(linkedTicket.projectId)
              : null;
            const columnNames = board ? board.columns.map(col => col.name) : [];
            const doneColumn = findColumnByName(columnNames, targetColumnName);

            if (doneColumn && linkedTicket.projectId) {
              // Move in local PMO
              await this.storage.moveTicket(linkedTicket.projectId, linkedTicket.id, doneColumn);
              ticketMovedToDone = true;

              // Sync to external provider (e.g., Linear)
              const provider = await this.resolveTicketProvider(linkedTicket.id, linkedTicket.projectId);
              if (provider.name !== 'pmo') {
                const moveResult = await provider.moveTicket(linkedTicket.id, doneColumn);
                if (moveResult.success) {
                  ticketTransitionProvider = moveResult.provider;
                }
              }
            }
          } catch (err) {
            this.warn(`Failed to move ticket ${linkedTicket.id} to Done: ${err instanceof Error ? err.message : err}`);
          }
        }
      } catch (err) {
        this.warn(`Failed to resolve linked ticket: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Emit work:pr_merged event for outbound sync (e.g., Linear auto-transition)
    if (linkedTicketId) {
      try {
        const repo = getGitHubRepo(repoCwd);
        const prUrl = repo ? `https://github.com/${repo}/pull/${prNumber}` : null;

        getEventBus().emit('work:pr_merged', {
          workItemId: linkedTicketId,
          source: 'github',
          prNumber,
          prTitle: prInfo.title,
          prUrl,
          mergeMethod: method,
          timestamp: new Date(),
        });
      } catch {
        // Non-critical - don't fail the merge if event emission fails
      }
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          merged: true,
          prNumber,
          title: prInfo.title,
          method,
          branchDeleted: flags['delete-branch'],
          linkedTicket: linkedTicketId ?? null,
          ticketMovedToDone,
          ticketTransitionProvider: ticketTransitionProvider ?? null,
        },
        createMetadata('pr merge', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.success(`PR #${prNumber} merged successfully!`));
    this.log(styles.muted(`   Title: ${prInfo.title}`));
    this.log(styles.muted(`   Method: ${method}`));
    if (flags['delete-branch']) {
      this.log(styles.muted(`   Branch ${prInfo.headBranch} deleted`));
    }
    if (linkedTicketId) {
      this.log(styles.muted(`   Ticket ${linkedTicketId} → Done`));
      if (ticketTransitionProvider) {
        this.log(styles.muted(`   Synced to ${ticketTransitionProvider}`));
      }
    }
  }

  /**
   * Resolve a repo-level cwd for gh CLI commands.
   * gh needs to run inside a git repo to determine the GitHub repository.
   */
  private resolveRepoCwd(): string | undefined {
    try {
      const info = getWorkspaceInfo();
      const mainRepo = info.repositories.find(r => r.type === 'main');
      const repo = mainRepo || info.repositories[0];
      if (repo?.path) {
        const repoPath = path.isAbsolute(repo.path)
          ? repo.path
          : path.join(info.path, repo.path);
        if (fs.existsSync(repoPath)) return repoPath;
      }
    } catch {
      // No workspace available — cwd is likely already in a git repo
    }
    return undefined;
  }

  /**
   * Resolve the linked ticket for a merged PR.
   *
   * Lookup order:
   * 1. PR metadata (pr_number / pr_url) on tickets
   * 2. agent_work table (branch → ticket_id)
   * 3. PR branch name parsing (extract ticket ID from conventional branch format)
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
      // agent_work lookup failed, continue to branch name parsing
    }

    // 3. Parse ticket ID from branch name (e.g., PRLT-1043/feat/owner/agent/desc)
    const branchResult = validateBranchName(headBranch);
    if (branchResult.valid && branchResult.parts?.ticketId) {
      const ticketId = branchResult.parts.ticketId;

      // Try direct lookup (works for TKT-xxx internal IDs)
      const directTicket = await this.storage.getTicket(ticketId);
      if (directTicket) return directTicket;

      // Search by external_key metadata (works for PRLT-xxx, LINEAR-xxx, etc.)
      const byExternalKey = allTickets.find(t =>
        t.metadata?.external_key === ticketId
      );
      if (byExternalKey) return byExternalKey;
    }

    return null;
  }
}
