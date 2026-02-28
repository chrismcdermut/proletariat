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
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class PRLink extends PMOCommand {
  static description = 'Link an existing GitHub pull request to a ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --pr 123',
    '<%= config.bin %> <%= command.id %> TKT-001 --url https://github.com/owner/repo/pull/123',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to link PR to',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    pr: Flags.integer({
      char: 'p',
      description: 'PR number to link',
    }),
    url: Flags.string({
      char: 'u',
      description: 'PR URL to link',
    }),
    ticket: Flags.string({
      description: 'Ticket ID to link (alternative to positional arg)',
    }),
    confirm: Flags.boolean({
      description: 'Confirm overwriting existing PR link',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PRLink);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr link', flags));
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

    // PMOCommand ensures we have storage access
    if (!this.storage) {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.');
    }

    // Get ticket ID from args or flags
    let ticketId = args.ticketId || flags.ticket;

    if (!ticketId) {
      const projectId = flags.project;
      const allTickets = await this.storage.listTickets(projectId);
      const activeTickets = allTickets.filter(t =>
        t.statusName && !t.statusName.toLowerCase().includes('done') && !t.statusName.toLowerCase().includes('archive')
      );

      if (activeTickets.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ACTIVE_TICKETS', 'No active tickets found.', createMetadata('pr link', flags));
          this.exit(1);
        }
        this.log(styles.info('No active tickets found.'));
        return;
      }

      // Use FlagResolver for ticket selection
      const resolver = new FlagResolver<{ ticket?: string }>({
        commandName: 'pr link',
        baseCommand: 'prlt pr link',
        jsonMode,
        flags: { ticket: ticketId },
      });

      resolver.addPrompt({
        flagName: 'ticket',
        type: 'list',
        message: 'Select ticket to link PR to:',
        choices: () => activeTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        })),
        when: (ctx) => !ctx.flags.ticket,
      });

      const resolved = await resolver.resolve();
      ticketId = resolved.ticket;
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`);
    }

    // Check if ticket already has a PR linked
    if (ticket.metadata?.pr_url && !flags.confirm) {
      this.log(styles.info(`Ticket ${ticketId} already has a linked PR:`));
      this.log(styles.muted(`   URL: ${ticket.metadata.pr_url}`));

      // Use FlagResolver for confirmation
      const confirmResolver = new FlagResolver<{ confirm?: string }>({
        commandName: 'pr link',
        baseCommand: `prlt pr link ${ticketId}`,
        jsonMode,
        flags: {},
      });

      confirmResolver.addPrompt({
        flagName: 'confirm',
        type: 'list',
        message: 'Replace with a different PR?',
        choices: () => [
          { name: 'No', value: 'no' },
          { name: 'Yes', value: 'yes' },
        ],
      });

      const confirmResolved = await confirmResolver.resolve();

      if (confirmResolved.confirm !== 'yes') {
        return;
      }
    }

    // Get PR number
    let prNumber = flags.pr;
    const prUrl = flags.url;

    if (prUrl) {
      // Extract PR number from URL
      const urlMatch = prUrl.match(/\/pull\/(\d+)/);
      if (urlMatch) {
        prNumber = parseInt(urlMatch[1], 10);
      } else {
        this.error('Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123');
      }
    }

    if (!prNumber) {
      // List open PRs for selection
      const openPRs = listOpenPRs();

      if (openPRs.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OPEN_PRS', 'No open PRs found. Create one first with "prlt pr create".', createMetadata('pr link', flags));
          this.exit(1);
        }
        this.error('No open PRs found. Create one first with "prlt pr create".');
      }

      // Use FlagResolver for PR selection
      const prResolver = new FlagResolver<{ pr?: string }>({
        commandName: 'pr link',
        baseCommand: `prlt pr link ${ticketId}`,
        jsonMode,
        flags: {},
      });

      prResolver.addPrompt({
        flagName: 'pr',
        type: 'list',
        message: 'Select PR to link:',
        choices: () => openPRs.map(pr => ({
          name: `#${pr.number} - ${pr.title} (${pr.headBranch})`,
          value: String(pr.number),
        })),
      });

      const prResolved = await prResolver.resolve();
      prNumber = parseInt(prResolved.pr!, 10);
    }

    // Get PR info
    const prInfo = getPRByNumber(prNumber!);
    if (!prInfo) {
      this.error(`PR #${prNumber} not found.`);
    }

    // Link PR to ticket
    await this.storage.updateTicket(ticketId!, {
      metadata: {
        ...ticket.metadata,
        pr_url: prInfo.url,
        pr_number: String(prInfo.number),
        pr_branch: prInfo.headBranch,
      },
    });

    this.log('');
    this.log(styles.success(`PR linked to ticket!`));
    this.log(styles.muted(`   Ticket: ${ticketId}`));
    this.log(styles.muted(`   PR: #${prInfo.number} - ${prInfo.title}`));
    this.log(styles.muted(`   URL: ${prInfo.url}`));
  }
}
