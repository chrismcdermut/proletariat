import { Args, Flags } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  isGHInstalled,
  isGHAuthenticated,
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
      default: 'merge',
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

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr merge', flags));
        this.exit(1);
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

    let prNumber = args.prNumber;

    // If no PR number provided, prompt for selection
    if (!prNumber) {
      const openPRs = listOpenPRs();

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
    const prInfo = getPRByNumber(prNumber);
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
    });

    if (!result.success) {
      return handleError('MERGE_FAILED', `Failed to merge PR #${prNumber}: ${result.error}`);
    }

    // Update ticket metadata if PR was linked
    if (this.hasPMO) {
      try {
        const allTickets = await this.storage.listTickets(flags.project);
        const linkedTicket = allTickets.find(t =>
          t.metadata?.pr_number === String(prNumber)
        );
        if (linkedTicket) {
          await this.storage.updateTicket(linkedTicket.id, {
            metadata: {
              ...linkedTicket.metadata,
              pr_state: 'MERGED',
            },
          });
        }
      } catch {
        // Non-critical - don't fail the merge if PMO update fails
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
  }
}
