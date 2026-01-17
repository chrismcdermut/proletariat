import { Command, Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import {
  isGHInstalled,
  isGHAuthenticated,
  getPRByNumber,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class PRStatus extends Command {
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  async run(): Promise<void> {
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

    // Get workspace and PMO context
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.');
    }

    const { storage } = await getPMOContext({
      logger: (msg) => this.log(styles.muted(msg)),
    });

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);

    try {
      // Get ticket ID
      let ticketId = args.ticketId;

      if (!ticketId) {
        const projectId = (flags as { project?: string }).project
        const allTickets = await storage.listTickets(projectId);
        // Filter to tickets that have a PR linked
        const ticketsWithPR = allTickets.filter(t => t.metadata?.pr_url);
        const ticketsWithoutPR = allTickets.filter(t => !t.metadata?.pr_url && t.statusName && !t.statusName.toLowerCase().includes('done'));

        if (ticketsWithPR.length === 0 && ticketsWithoutPR.length === 0) {
          await storage.close();
          db.close();
          this.log(styles.info('No tickets found.'));
          return;
        }

        // Build choices once, use for both JSON and interactive modes
        const ticketsWithPRChoices = ticketsWithPR.map(t => ({
          name: `${t.id} - ${t.title} [PR linked]`,
          value: t.id,
        }));
        const ticketsWithoutPRChoices = ticketsWithoutPR.slice(0, 10).map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        }));
        const ticketChoices = [...ticketsWithPRChoices, ...ticketsWithoutPRChoices];
        const message = 'Select ticket to check PR status:';

        // In JSON mode, output ticket selection prompt and exit
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'ticketId', message, ticketChoices),
            createMetadata('pr status', flags)
          );
        }

        // Build interactive choices with separator
        const interactiveChoices: Array<{ name: string; value: string } | inquirer.Separator> = [...ticketsWithPRChoices];
        if (ticketsWithoutPRChoices.length > 0) {
          interactiveChoices.push(new inquirer.Separator('── No PR Linked ──'));
          interactiveChoices.push(...ticketsWithoutPRChoices);
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message,
          choices: interactiveChoices,
        }]);
        ticketId = selectedTicketId;
      }

      // Get ticket
      const ticket = await storage.getTicket(ticketId!);
      if (!ticket) {
        await storage.close();
        db.close();
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
        await storage.close();
        db.close();
        return;
      }

      // Check gh CLI for live status
      if (!isGHInstalled() || !isGHAuthenticated()) {
        this.log(styles.muted('   PR URL:'), ticket.metadata.pr_url);
        this.log(styles.muted('   (Install and authenticate `gh` CLI for live status)'));
        await storage.close();
        db.close();
        return;
      }

      const prNumber = parseInt(ticket.metadata.pr_number || '0', 10);
      if (!prNumber) {
        this.log(styles.muted('   PR URL:'), ticket.metadata.pr_url);
        await storage.close();
        db.close();
        return;
      }

      const prInfo = getPRByNumber(prNumber);
      if (!prInfo) {
        this.log(styles.warning('Unable to fetch PR status (PR may have been deleted).'));
        this.log(styles.muted('   Stored URL:'), ticket.metadata.pr_url);
        await storage.close();
        db.close();
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

      await storage.close();
      db.close();
    } catch (error) {
      await storage.close();
      db.close();
      throw error;
    }
  }
}
