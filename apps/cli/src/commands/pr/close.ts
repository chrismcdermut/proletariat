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
  closePR,
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

export default class PRClose extends PMOCommand {
  static description = 'Close a GitHub pull request by number';

  static examples = [
    '<%= config.bin %> <%= command.id %> 123',
    '<%= config.bin %> <%= command.id %> 123 --comment "Superseded by #456"',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static args = {
    prNumber: Args.integer({
      description: 'PR number to close',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    comment: Flags.string({
      char: 'c',
      description: 'Comment to leave when closing the PR',
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
    const { args, flags } = await this.parse(PRClose);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr close', flags));
        return
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
        commandName: 'pr close',
        baseCommand: 'prlt pr close',
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'pr',
        type: 'list',
        message: 'Select PR to close:',
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

    // Close the PR
    const result = closePR(prNumber, {
      comment: flags.comment,
    });

    if (!result.success) {
      return handleError('CLOSE_FAILED', `Failed to close PR #${prNumber}: ${result.error}`);
    }

    // Update ticket metadata if PR was linked
    let linkedTicketId: string | undefined;
    if (this.hasPMO) {
      try {
        const allTickets = await this.storage.listTickets(flags.project);
        const linkedTicket = allTickets.find(t =>
          t.metadata?.pr_number === String(prNumber) ||
          t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`) ||
          t.metadata?.pr_url?.endsWith(`/${prNumber}`)
        );
        if (linkedTicket) {
          linkedTicketId = linkedTicket.id;
          await this.storage.updateTicket(linkedTicket.id, {
            metadata: {
              ...linkedTicket.metadata,
              pr_state: 'CLOSED',
            },
          });
        }
      } catch {
        // Non-critical - don't fail the close if PMO update fails
      }
    }

    // Emit work:pr_closed event for outbound sync
    if (linkedTicketId) {
      try {
        const repo = getGitHubRepo();
        const prUrl = repo ? `https://github.com/${repo}/pull/${prNumber}` : null;

        getEventBus().emit('work:pr_closed', {
          workItemId: linkedTicketId,
          source: 'github',
          prNumber,
          prTitle: prInfo.title,
          prUrl,
          comment: flags.comment,
          timestamp: new Date(),
        });
      } catch {
        // Non-critical - don't fail the close if event emission fails
      }
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          closed: true,
          prNumber,
          title: prInfo.title,
          comment: flags.comment ?? null,
          linkedTicket: linkedTicketId ?? null,
        },
        createMetadata('pr close', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.success(`PR #${prNumber} closed.`));
    this.log(styles.muted(`   Title: ${prInfo.title}`));
    if (flags.comment) {
      this.log(styles.muted(`   Comment: ${flags.comment}`));
    }
    if (linkedTicketId) {
      this.log(styles.muted(`   Linked ticket ${linkedTicketId} updated`));
    }
  }
}
