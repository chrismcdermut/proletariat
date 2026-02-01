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
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class PRStatus extends PMOCommand {
  static description = 'View PR status for a ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to check PR status for',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PRStatus);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr status', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // PMOCommand ensures we have storage access
    if (!this.storage) {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.');
    }

    // Get ticket ID
    let ticketId = args.ticketId;

    if (!ticketId) {
      const projectId = flags.project;
      const allTickets = await this.storage.listTickets(projectId);
      // Filter to tickets that have a PR linked
      const ticketsWithPR = allTickets.filter(t => t.metadata?.pr_url);
      const ticketsWithoutPR = allTickets.filter(t => !t.metadata?.pr_url && t.statusName && !t.statusName.toLowerCase().includes('done'));

      if (ticketsWithPR.length === 0 && ticketsWithoutPR.length === 0) {
        this.log(styles.info('No tickets found.'));
        return;
      }

      // Combine tickets for selection - prioritize those with PRs
      const ticketItems = [
        ...ticketsWithPR.map(t => ({
          id: t.id,
          title: t.title,
          hasPR: true,
          statusName: t.statusName,
        })),
        ...ticketsWithoutPR.slice(0, 10).map(t => ({
          id: t.id,
          title: t.title,
          hasPR: false,
          statusName: t.statusName,
        })),
      ];

      // Use selectFromList helper for ticket selection
      const selectedTicketId = await this.selectFromList({
        message: 'Select ticket to check PR status:',
        items: ticketItems,
        getName: (item) => item.hasPR
          ? `${item.id} - ${item.title} [PR linked]`
          : `${item.id} - ${item.title} (${item.statusName})`,
        getValue: (item) => item.id,
        getCommand: (item) => `prlt pr status ${item.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'pr status' } : null,
      });

      if (!selectedTicketId) {
        return;
      }
      ticketId = selectedTicketId;
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`);
    }

    this.log('');
    this.log(styles.header(`PR Status: ${ticket.id}`));
    this.log(styles.muted(`   Title: ${ticket.title}`));
    this.log(styles.muted(`   Status: ${ticket.statusName}`));
    this.log('');

    if (!ticket.metadata?.pr_url) {
      this.log(styles.info('No PR linked to this ticket.'));
      this.log(styles.muted('   Use "prlt pr create" or "prlt pr link" to link a PR.'));
      return;
    }

    // Check gh CLI for live status
    if (!isGHInstalled() || !isGHAuthenticated()) {
      this.log(styles.muted('   PR URL:'), ticket.metadata.pr_url);
      this.log(styles.muted('   (Install and authenticate `gh` CLI for live status)'));
      return;
    }

    const prNumber = parseInt(ticket.metadata.pr_number || '0', 10);
    if (!prNumber) {
      this.log(styles.muted('   PR URL:'), ticket.metadata.pr_url);
      return;
    }

    const prInfo = getPRByNumber(prNumber);
    if (!prInfo) {
      this.log(styles.warning('Unable to fetch PR status (PR may have been deleted).'));
      this.log(styles.muted('   Stored URL:'), ticket.metadata.pr_url);
      return;
    }

    // Display PR status
    const stateEmoji = {
      OPEN: '🟢',
      CLOSED: '🔴',
      MERGED: '🟣',
    };

    this.log(styles.success(`${stateEmoji[prInfo.state]} PR #${prInfo.number}: ${prInfo.title}`));
    this.log('');
    this.log(styles.muted(`   State: ${prInfo.state}${prInfo.isDraft ? ' (Draft)' : ''}`));
    this.log(styles.muted(`   Branch: ${prInfo.headBranch} → ${prInfo.baseBranch}`));
    this.log(styles.muted(`   URL: ${prInfo.url}`));
    this.log(styles.muted(`   Created: ${new Date(prInfo.createdAt).toLocaleDateString()}`));
    this.log(styles.muted(`   Updated: ${new Date(prInfo.updatedAt).toLocaleDateString()}`));
  }
}
