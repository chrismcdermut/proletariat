import { Flags } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles, divider } from '../../lib/styles.js';
import {
  requireGhCli,
  listOpenPRs,
  getPRChecks,
  PRInfo,
  PRCheck,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

interface PRWithTicket extends PRInfo {
  ticketId?: string;
  ticketTitle?: string;
  ticketStatus?: string;
  checks?: PRCheck[];
  checksSummary?: {
    total: number;
    passing: number;
    failing: number;
    pending: number;
  };
}

export default class PRList extends PMOCommand {
  static description = 'List pull requests linked to tickets in the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --state open',
    '<%= config.bin %> <%= command.id %> --state draft',
    '<%= config.bin %> <%= command.id %> --format json',
    '<%= config.bin %> <%= command.id %> --machine',
  ];

  static flags = {
    ...pmoBaseFlags,
    state: Flags.string({
      char: 's',
      description: 'Filter by PR state',
      options: ['open', 'draft', 'all'],
      default: 'open',
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'compact', 'json'],
      default: 'table',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of PRs to show',
      default: 50,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(PRList);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr list', flags));
        return
      }
      this.error(message);
    };

    // PMOCommand base class ensures PMO context is available
    if (!this.storage) {
      return handleError('PMO_NOT_FOUND', 'No workspace found. Run "prlt new" to create one.');
    }

    // Check gh CLI (differentiated not-installed vs not-authenticated)
    if (!requireGhCli(handleError)) return;

    // Get all tickets with linked PRs from database
    const allTickets = await this.storage.listTickets(flags.project);
    const ticketsWithPR = allTickets.filter(t => t.metadata?.pr_url || t.metadata?.pr_number);

    // Build a map of PR number -> ticket info for quick lookup
    const prToTicketMap = new Map<number, { id: string; title: string; status: string }>();
    for (const ticket of ticketsWithPR) {
      const prNumber = parseInt(ticket.metadata?.pr_number || '0', 10);
      if (prNumber > 0) {
        prToTicketMap.set(prNumber, {
          id: ticket.id,
          title: ticket.title,
          status: ticket.statusName || 'Unknown',
        });
      }
    }

    // Fetch open PRs from GitHub
    let prs = listOpenPRs();

    // Apply state filter
    if (flags.state === 'draft') {
      prs = prs.filter(pr => pr.isDraft);
    } else if (flags.state !== 'all') {
      // 'open' is default - listOpenPRs already returns open PRs
      // but filter out drafts if we only want non-draft open PRs
      // Actually, keep drafts in 'open' view as they are still open
    }

    // Apply limit
    if (flags.limit && prs.length > flags.limit) {
      prs = prs.slice(0, flags.limit);
    }

    // Enrich PRs with ticket info and CI checks
    const enrichedPRs: PRWithTicket[] = prs.map(pr => {
      const ticketInfo = prToTicketMap.get(pr.number);
      const checks = getPRChecks(pr.number);
      const checksSummary = {
        total: checks.length,
        passing: checks.filter(c => c.conclusion === 'SUCCESS').length,
        failing: checks.filter(c => c.conclusion === 'FAILURE').length,
        pending: checks.filter(c => c.status === 'IN_PROGRESS' || c.status === 'QUEUED').length,
      };
      return {
        ...pr,
        ticketId: ticketInfo?.id,
        ticketTitle: ticketInfo?.title,
        ticketStatus: ticketInfo?.status,
        checks,
        checksSummary,
      };
    });

    // Output based on format
    if (jsonMode || flags.format === 'json') {
      this.log(JSON.stringify(enrichedPRs, null, 2));
      return;
    }

    if (enrichedPRs.length === 0) {
      this.log(styles.info('No open pull requests found.'));
      return;
    }

    if (flags.format === 'compact') {
      this.outputCompact(enrichedPRs);
    } else {
      this.outputTable(enrichedPRs);
    }
  }

  private outputTable(prs: PRWithTicket[]): void {
    this.log('');
    this.log(styles.header(`Pull Requests (${prs.length})`));
    this.log(divider(80));

    for (const pr of prs) {
      const stateEmoji = this.getStateEmoji(pr);
      const draftBadge = pr.isDraft ? styles.muted(' [Draft]') : '';

      this.log(`${stateEmoji} ${styles.emphasis(`#${pr.number}`)} ${pr.title}${draftBadge}`);
      this.log(styles.muted(`   Branch: ${pr.headBranch} → ${pr.baseBranch}`));
      this.log(styles.muted(`   URL: ${pr.url}`));

      if (pr.ticketId) {
        this.log(styles.info(`   Ticket: ${pr.ticketId} - ${pr.ticketTitle} [${pr.ticketStatus}]`));
      } else {
        this.log(styles.muted(`   Ticket: (not linked)`));
      }

      // CI status
      if (pr.checksSummary && pr.checksSummary.total > 0) {
        const ciParts: string[] = [];
        if (pr.checksSummary.passing > 0) ciParts.push(styles.success(`${pr.checksSummary.passing} passing`));
        if (pr.checksSummary.failing > 0) ciParts.push(styles.error(`${pr.checksSummary.failing} failing`));
        if (pr.checksSummary.pending > 0) ciParts.push(styles.warning(`${pr.checksSummary.pending} pending`));
        const ciIcon = pr.checksSummary.failing > 0 ? '✗' : pr.checksSummary.pending > 0 ? '●' : '✓';
        this.log(`   ${ciIcon} CI: ${ciParts.join(', ')}`);
      } else {
        this.log(styles.muted(`   CI: no checks`));
      }

      const created = new Date(pr.createdAt).toLocaleDateString();
      const updated = new Date(pr.updatedAt).toLocaleDateString();
      this.log(styles.muted(`   Created: ${created} | Updated: ${updated}`));
      this.log('');
    }

    // Summary
    this.log(divider(80));
    const linkedCount = prs.filter(pr => pr.ticketId).length;
    const draftCount = prs.filter(pr => pr.isDraft).length;
    this.log(styles.muted(`Total: ${prs.length} PR${prs.length === 1 ? '' : 's'} | Linked: ${linkedCount} | Drafts: ${draftCount}`));
  }

  private outputCompact(prs: PRWithTicket[]): void {
    this.log('');
    this.log(styles.header(`Pull Requests (${prs.length})`));
    this.log(divider(60));

    for (const pr of prs) {
      const stateEmoji = this.getStateEmoji(pr);
      const ticketBadge = pr.ticketId ? styles.code(`[${pr.ticketId}]`) : '';
      const draftBadge = pr.isDraft ? styles.muted('[Draft]') : '';
      const ciBadge = this.getCIBadge(pr);

      this.log(`${stateEmoji} #${pr.number}: ${pr.title} ${ticketBadge} ${draftBadge} ${ciBadge}`);
    }

    this.log('');
  }

  private getCIBadge(pr: PRWithTicket): string {
    if (!pr.checksSummary || pr.checksSummary.total === 0) return '';
    if (pr.checksSummary.failing > 0) return styles.error('CI:✗');
    if (pr.checksSummary.pending > 0) return styles.warning('CI:●');
    return styles.success('CI:✓');
  }

  private getStateEmoji(pr: PRInfo): string {
    if (pr.isDraft) return '📝';
    switch (pr.state) {
      case 'OPEN': return '🟢';
      case 'CLOSED': return '🔴';
      case 'MERGED': return '🟣';
      default: return '⚪';
    }
  }
}
