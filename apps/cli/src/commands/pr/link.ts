import { Command, Args, Flags } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import {
  isGHInstalled,
  isGHAuthenticated,
  getPRByNumber,
  listOpenPRs,
} from '../../lib/pr/index.js';

export default class PRLink extends Command {
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
    pr: Flags.integer({
      char: 'p',
      description: 'PR number to link',
    }),
    url: Flags.string({
      char: 'u',
      description: 'PR URL to link',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PRLink);

    // Check gh CLI
    if (!isGHInstalled()) {
      this.error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    if (!isGHAuthenticated()) {
      this.error('GitHub CLI is not authenticated. Run "gh auth login" first.');
    }

    // Get workspace and PMO context
    let workspaceInfo;
    try {
      workspaceInfo = getWorkspaceInfo();
    } catch {
      this.error('Not in a workspace. Run "prlt init" first.');
    }

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);

    try {
      // Get ticket ID
      let ticketId = args.ticketId;

      if (!ticketId) {
        const allTickets = await storage.listTickets();
        const activeTickets = allTickets.filter(t =>
          t.column && !t.column.toLowerCase().includes('done') && !t.column.toLowerCase().includes('archive')
        );

        if (activeTickets.length === 0) {
          await storage.close();
          db.close();
          this.log(styles.info('No active tickets found.'));
          return;
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: 'Select ticket to link PR to:',
          choices: activeTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.column})`,
            value: t.id,
          })),
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

      // Check if ticket already has a PR linked
      if (ticket.metadata?.pr_url) {
        this.log(styles.info(`Ticket ${ticketId} already has a linked PR:`));
        this.log(styles.muted(`   URL: ${ticket.metadata.pr_url}`));

        const { overwrite } = await inquirer.prompt([{
          type: 'list',
          name: 'overwrite',
          message: 'Replace with a different PR?',
          choices: [
            { name: 'No', value: false },
            { name: 'Yes', value: true },
          ],
          default: false,
        }]);

        if (!overwrite) {
          await storage.close();
          db.close();
          return;
        }
      }

      // Get PR number
      let prNumber = flags.pr;
      let prUrl = flags.url;

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
          await storage.close();
          db.close();
          this.error('No open PRs found. Create one first with "prlt pr create".');
        }

        const { selectedPR } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedPR',
          message: 'Select PR to link:',
          choices: openPRs.map(pr => ({
            name: `#${pr.number} - ${pr.title} (${pr.headBranch})`,
            value: pr.number,
          })),
        }]);
        prNumber = selectedPR;
      }

      // Get PR info
      const prInfo = getPRByNumber(prNumber!);
      if (!prInfo) {
        await storage.close();
        db.close();
        this.error(`PR #${prNumber} not found.`);
      }

      // Link PR to ticket
      await storage.updateTicket(ticketId!, {
        metadata: {
          ...ticket.metadata,
          pr_url: prInfo.url,
          pr_number: String(prInfo.number),
          pr_branch: prInfo.headBranch,
        },
      });

      await storage.close();
      db.close();

      this.log('');
      this.log(styles.success(`PR linked to ticket!`));
      this.log(styles.muted(`   Ticket: ${ticketId}`));
      this.log(styles.muted(`   PR: #${prInfo.number} - ${prInfo.title}`));
      this.log(styles.muted(`   URL: ${prInfo.url}`));
    } catch (error) {
      await storage.close();
      db.close();
      throw error;
    }
  }
}
