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
  getPRFeedback,
  type PRInfo,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class PRView extends PMOCommand {
  static description = 'View detailed PR information';

  static examples = [
    '<%= config.bin %> <%= command.id %> 123',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    prNumber: Args.string({
      description: 'PR number to view',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      char: 't',
      description: 'Get PR from ticket ID instead of PR number',
    }),
    feedback: Flags.boolean({
      char: 'f',
      description: 'Include reviews and comments',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PRView);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr view', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Check if gh CLI is available
    if (!isGHInstalled()) {
      return handleError('GH_NOT_INSTALLED', 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    if (!isGHAuthenticated()) {
      return handleError('GH_NOT_AUTHENTICATED', 'GitHub CLI is not authenticated. Run "gh auth login" first.');
    }

    let prNumber: number | null = null;
    let prInfo: PRInfo | null = null;

    // If ticket flag is provided, look up PR from ticket
    if (flags.ticket) {
      if (!this.storage) {
        return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.');
      }

      const ticket = await this.storage.getTicket(flags.ticket);
      if (!ticket) {
        return handleError('TICKET_NOT_FOUND', `Ticket "${flags.ticket}" not found.`);
      }

      if (!ticket.metadata?.pr_number) {
        return handleError('NO_PR_LINKED', `Ticket "${flags.ticket}" has no linked PR.`);
      }

      prNumber = parseInt(ticket.metadata.pr_number, 10);
    } else if (args.prNumber) {
      // Use provided PR number
      prNumber = parseInt(args.prNumber, 10);
      if (isNaN(prNumber)) {
        return handleError('INVALID_PR_NUMBER', `"${args.prNumber}" is not a valid PR number.`);
      }
    } else {
      // Interactive mode - list open PRs and let user select
      const openPRs = listOpenPRs();

      if (openPRs.length === 0) {
        return handleError('NO_OPEN_PRS', 'No open PRs found in this repository.');
      }

      // Use helper for PR selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select PR to view:',
        items: openPRs,
        getName: (pr) => `#${pr.number} - ${pr.title}${pr.isDraft ? ' (Draft)' : ''}`,
        getValue: (pr) => String(pr.number),
        getCommand: (pr) => `prlt pr view ${pr.number}${flags.feedback ? ' --feedback' : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'pr view' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      prNumber = parseInt(selected, 10);
    }

    // Fetch PR info
    prInfo = getPRByNumber(prNumber);
    if (!prInfo) {
      return handleError('PR_NOT_FOUND', `PR #${prNumber} not found or inaccessible.`);
    }

    // JSON output mode - return structured data
    if (jsonMode) {
      const output: Record<string, unknown> = {
        pr: {
          number: prInfo.number,
          url: prInfo.url,
          title: prInfo.title,
          state: prInfo.state,
          isDraft: prInfo.isDraft,
          headBranch: prInfo.headBranch,
          baseBranch: prInfo.baseBranch,
          createdAt: prInfo.createdAt,
          updatedAt: prInfo.updatedAt,
        },
        metadata: createMetadata('pr view', flags),
      };

      // Include feedback if requested
      if (flags.feedback) {
        const feedback = getPRFeedback(prNumber);
        if (feedback) {
          output.feedback = {
            reviewDecision: feedback.reviewDecision,
            reviews: feedback.reviews,
            comments: feedback.comments,
          };
        }
      }

      this.log(JSON.stringify(output, null, 2));
      return;
    }

    // Display PR details
    const stateEmoji = {
      OPEN: '🟢',
      CLOSED: '🔴',
      MERGED: '🟣',
    };

    this.log('');
    this.log(styles.header(`${stateEmoji[prInfo.state]} PR #${prInfo.number}`));
    this.log('');
    this.log(`${styles.header('Title:')}     ${prInfo.title}${prInfo.isDraft ? styles.muted(' (Draft)') : ''}`);
    this.log(`${styles.header('State:')}     ${prInfo.state}`);
    this.log(`${styles.header('Branch:')}    ${prInfo.headBranch} → ${prInfo.baseBranch}`);
    this.log(`${styles.header('URL:')}       ${prInfo.url}`);
    this.log(`${styles.header('Created:')}   ${new Date(prInfo.createdAt).toLocaleString()}`);
    this.log(`${styles.header('Updated:')}   ${new Date(prInfo.updatedAt).toLocaleString()}`);

    // Show linked ticket if we have storage access
    if (this.storage) {
      const projectId = flags.project;
      const allTickets = await this.storage.listTickets(projectId);
      const linkedTicket = allTickets.find(t =>
        t.metadata?.pr_number === String(prInfo!.number) ||
        t.metadata?.pr_url === prInfo!.url
      );

      if (linkedTicket) {
        this.log(`${styles.header('Ticket:')}    ${linkedTicket.id} - ${linkedTicket.title}`);
      }
    }

    // Show feedback if requested
    if (flags.feedback) {
      const feedback = getPRFeedback(prNumber);
      if (feedback) {
        this.log('');
        this.log(styles.header('Reviews & Comments'));
        this.log('');

        if (feedback.reviewDecision) {
          const decisionEmoji = feedback.reviewDecision === 'APPROVED' ? '✅' :
                                feedback.reviewDecision === 'CHANGES_REQUESTED' ? '❌' : '⏳';
          this.log(`${styles.header('Status:')}    ${decisionEmoji} ${feedback.reviewDecision}`);
          this.log('');
        }

        // Show reviews
        if (feedback.reviews.length > 0) {
          for (const review of feedback.reviews) {
            const stateIcon = review.state === 'APPROVED' ? '✅' :
                              review.state === 'CHANGES_REQUESTED' ? '❌' : '💬';
            this.log(`${stateIcon} ${styles.emphasis(review.author)} (${review.state})`);
            if (review.body) {
              this.log(styles.muted(`   ${review.body.split('\n').join('\n   ')}`));
            }
            // Show review comments
            for (const comment of review.comments) {
              if (comment.path) {
                this.log(styles.muted(`   📄 ${comment.path}${comment.line ? `:${comment.line}` : ''}`));
              }
              this.log(styles.muted(`   > ${comment.body.split('\n').join('\n   > ')}`));
            }
            this.log('');
          }
        }

        // Show general comments
        if (feedback.comments.length > 0) {
          this.log(styles.muted('General Comments:'));
          for (const comment of feedback.comments) {
            this.log(styles.muted(`   ${comment.author}: ${comment.body.split('\n').join('\n   ')}`));
          }
          this.log('');
        }

        if (feedback.reviews.length === 0 && feedback.comments.length === 0) {
          this.log(styles.muted('   No reviews or comments yet.'));
          this.log('');
        }
      }
    }

    this.log('');
  }
}
