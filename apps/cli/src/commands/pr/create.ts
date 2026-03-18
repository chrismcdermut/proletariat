import { Args, Flags } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
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
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { trackPRCreated } from '../../lib/telemetry/analytics.js';
import { ensureRemoteUpToDate } from '../../lib/repos/git.js';

export default class PRCreate extends PMOCommand {
  static description = 'Create a GitHub pull request from the current branch';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> --draft',
    '<%= config.bin %> <%= command.id %> --base develop',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to link to PR - auto-detects from branch if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    base: Flags.string({
      char: 'b',
      description: 'Base branch for the PR (defaults to main/master)',
    }),
    draft: Flags.boolean({
      char: 'd',
      description: 'Create as draft PR',
      default: false,
    }),
    'no-link': Flags.boolean({
      description: 'Skip linking PR to ticket',
      default: false,
    }),
    title: Flags.string({
      char: 't',
      description: 'PR title (auto-generated from ticket if not provided)',
    }),
    body: Flags.string({
      description: 'PR body/description',
    }),
    ticket: Flags.string({
      description: 'Ticket ID to link (alternative to positional arg)',
    }),
  };

  // Flag to track if PMO is available (for graceful degradation)
  private hasPMO = true;

  /**
   * Override init to gracefully handle missing PMO
   * PR creation should work even without PMO (just without ticket linking)
   */
  async init(): Promise<void> {
    try {
      await super.init();
    } catch {
      // PMO not available - that's fine, we can still create PRs
      this.hasPMO = false;
    }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PRCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr create', flags));
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

    // Get current branch
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
      return handleError('NO_GIT_REPO', 'Not in a git repository or unable to determine current branch.');
    }

    // Check if on main/master
    const baseBranch = flags.base || getDefaultBaseBranch();
    if (currentBranch === baseBranch) {
      return handleError('ON_BASE_BRANCH', `Cannot create PR from ${baseBranch} branch. Switch to a feature branch first.`);
    }

    // Check if PR already exists for this branch
    const existingPR = getPRForBranch(currentBranch);
    if (existingPR) {
      this.log(styles.info(`PR already exists for branch "${currentBranch}":`));
      this.log(styles.muted(`   #${existingPR.number}: ${existingPR.title}`));
      this.log(styles.muted(`   URL: ${existingPR.url}`));
      return;
    }

    // Log if PMO is not available
    if (!this.hasPMO) {
      this.log(styles.muted('   No workspace found - creating PR without ticket linking'));
    }

    // Determine ticket ID from args or flags
    let ticketId = args.ticketId || flags.ticket;

    if (!ticketId && !flags['no-link'] && this.hasPMO) {
      // Try to extract ticket ID from branch name (e.g., feat/agent/TKT-001-description)
      const ticketMatch = currentBranch.match(/(TKT-\d+)/i);
      if (ticketMatch) {
        ticketId = ticketMatch[1].toUpperCase();
        this.log(styles.muted(`   Auto-detected ticket: ${ticketId}`));
      }
    }

    // Get ticket info if available
    let ticket: { id: string; title: string; description?: string } | null = null;
    if (ticketId && this.hasPMO) {
      ticket = await this.storage.getTicket(ticketId);
      if (!ticket) {
        this.warn(`Ticket "${ticketId}" not found. Continuing without ticket link.`);
        ticketId = undefined;
      }
    }

    // If no ticket, prompt for selection (only if we have PMO)
    if (!ticketId && !flags['no-link'] && this.hasPMO) {
      const projectId = flags.project;
      const allTickets = await this.storage.listTickets(projectId);
      const inProgressTickets = allTickets.filter(t =>
        t.statusName && t.statusName.toLowerCase().includes('progress')
      );

      if (inProgressTickets.length > 0) {
        // Use FlagResolver for ticket selection
        const resolver = new FlagResolver<{ ticket?: string }>({
          commandName: 'pr create',
          baseCommand: 'prlt pr create',
          jsonMode,
          flags: { ticket: ticketId },
        });

        resolver.addPrompt({
          flagName: 'ticket',
          type: 'list',
          message: 'Link PR to a ticket?',
          choices: () => [
            ...inProgressTickets.map(t => ({
              name: `${t.id} - ${t.title}`,
              value: t.id,
            })),
            { name: 'Skip - create PR without linking', value: '__skip__' },
          ],
          when: (ctx) => !ctx.flags.ticket,
        });

        const resolved = await resolver.resolve();

        if (resolved.ticket && resolved.ticket !== '__skip__') {
          ticketId = resolved.ticket;
          ticket = await this.storage.getTicket(ticketId!);
        }
      }
    }

    // Generate PR title and body
    let prTitle = flags.title;
    let prBody = flags.body;

    if (!prTitle) {
      if (ticket) {
        prTitle = generatePRTitle(ticket.id, ticket.title);
      } else {
        // Use branch name as title
        const branchParts = currentBranch.split('/');
        prTitle = branchParts[branchParts.length - 1].replace(/-/g, ' ');
      }
    }

    if (!prBody && ticket) {
      const commits = getCommitLog(baseBranch);
      prBody = generatePRBody({
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        commits: commits.slice(0, 10), // Limit to 10 commits
      });
    }

    // Ensure remote URL is up to date (detect transferred repos)
    ensureRemoteUpToDate(undefined, (msg) => this.log(styles.muted(`   ${msg}`)));

    // Push branch if not pushed
    if (!hasBranchBeenPushed(currentBranch)) {
      this.log(styles.muted(`   Pushing branch to origin...`));
      if (!pushBranch(currentBranch)) {
        return handleError('PUSH_FAILED', 'Failed to push branch to origin.');
      }
    } else if (hasUnpushedCommits(currentBranch)) {
      this.log(styles.muted(`   Pushing unpushed commits...`));
      if (!pushBranch(currentBranch)) {
        return handleError('PUSH_FAILED', 'Failed to push commits to origin.');
      }
    }

    // Create PR
    this.log('');
    this.log(styles.header('Creating Pull Request'));
    this.log(styles.muted(`   Branch: ${currentBranch}`));
    this.log(styles.muted(`   Base: ${baseBranch}`));
    this.log(styles.muted(`   Title: ${prTitle}`));
    if (flags.draft) {
      this.log(styles.muted(`   Draft: yes`));
    }

    const result = createPR({
      title: prTitle,
      body: prBody,
      base: baseBranch,
      draft: flags.draft,
    });

    if (!result.success) {
      return handleError('PR_CREATE_FAILED', `Failed to create PR: ${result.error}`);
    }

    // Track PR creation analytics
    trackPRCreated({ source: 'prlt' });

    // Store PR URL in ticket metadata
    if (ticket && result.url && this.hasPMO) {
      await this.storage.updateTicket(ticket.id, {
        metadata: {
          pr_url: result.url,
          pr_number: String(result.number),
        },
      });
    }

    this.log('');
    this.log(styles.success(`Pull request created!`));
    this.log(styles.muted(`   PR #${result.number}`));
    this.log(styles.muted(`   URL: ${result.url}`));
    if (ticket) {
      this.log(styles.muted(`   Linked to: ${ticket.id}`));
    }
  }
}
