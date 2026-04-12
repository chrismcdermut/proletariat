import { Args, Flags } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  requireGhCli,
  getPRByNumber,
  listOpenPRs,
  mergePR,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import type { Ticket } from '../../lib/pmo/types.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { PRService } from '../../services/index.js';
import type { ProviderStorage } from '../../lib/providers/types.js';
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

    // --- Check if PR is linked to a ticket BEFORE merging ---
    // If linked, delegate to work:ship for full lifecycle
    if (this.hasPMO) {
      try {
        const db = this.storage.getDatabase();
        const prService = new PRService(db, this.storage as unknown as ProviderStorage & { listTickets: any; updateTicket: any });
        const linkResult = await prService.resolveLinkedTicket(prNumber, prInfo.headBranch, (flags as { project?: string }).project);

        if (linkResult.ticket) {
          const ticketDisplayId = linkResult.ticket.metadata?.external_key || linkResult.ticket.id;

          if (!jsonMode) {
            this.log('');
            this.log(styles.info(`PR #${prNumber} is linked to ${ticketDisplayId} — running full ship lifecycle`));
          }

          // Build args for work:ship --pr <num>
          const shipArgs: string[] = ['--pr', String(prNumber)];
          shipArgs.push('--method', flags.method as string);
          if (!flags['delete-branch']) {
            shipArgs.push('--no-delete-branch');
          }
          if (flags.admin) {
            shipArgs.push('--admin');
          }
          if ((flags as { project?: string }).project) {
            shipArgs.push('--project', (flags as { project?: string }).project as string);
          }
          if (jsonMode) {
            shipArgs.push('--json');
          }

          await this.config.runCommand('work:ship', shipArgs);
          return;
        }
      } catch {
        // If ticket resolution fails, fall through to simple merge
      }
    }

    // --- No linked ticket — simple merge (no lifecycle) ---
    if (!jsonMode) {
      this.log('');
      this.log(styles.info(`PR #${prNumber} has no linked ticket — merging directly`));
    }

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

    if (jsonMode) {
      outputSuccessAsJson(
        {
          merged: true,
          prNumber,
          title: prInfo.title,
          method,
          branchDeleted: flags['delete-branch'],
          linkedTicket: null,
          ticketMovedToDone: false,
          ticketTransitionProvider: null,
          delegatedToWorkShip: false,
        },
        createMetadata('pr merge', flags)
      );
      return;
    }

    this.log(styles.success(`PR #${prNumber} merged successfully!`));
    this.log(styles.muted(`   Title: ${prInfo.title}`));
    this.log(styles.muted(`   Method: ${method}`));
    if (flags['delete-branch']) {
      this.log(styles.muted(`   Branch ${prInfo.headBranch} deleted`));
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

}
