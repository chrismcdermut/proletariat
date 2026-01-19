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
  listOpenPRs,
} from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
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
        const activeTickets = allTickets.filter(t =>
          t.statusName && !t.statusName.toLowerCase().includes('done') && !t.statusName.toLowerCase().includes('archive')
        );

        if (activeTickets.length === 0) {
          await storage.close();
          db.close();
          if (jsonMode) {
            outputErrorAsJson('NO_ACTIVE_TICKETS', 'No active tickets found.', createMetadata('pr link', flags));
            this.exit(1);
          }
          this.log(styles.info('No active tickets found.'));
          return;
        }

        // Build choices once, use for both JSON and interactive modes
        const ticketChoices = activeTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName})`,
          value: t.id,
        }));
        const ticketMessage = 'Select ticket to link PR to:';

        // In JSON mode, output ticket selection prompt and exit
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'ticketId', ticketMessage, ticketChoices),
            createMetadata('pr link', flags)
          );
        }

        const { selectedTicketId } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedTicketId',
          message: ticketMessage,
          choices: ticketChoices,
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
        // Build choices once, use for both JSON and interactive modes
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        const confirmMessage = `Ticket ${ticketId} already has a linked PR (${ticket.metadata.pr_url}). Replace with a different PR?`;

        // In JSON mode, output overwrite confirmation prompt and exit
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'overwrite', confirmMessage, confirmChoices),
            createMetadata('pr link', flags)
          );
        }

        this.log(styles.info(`Ticket ${ticketId} already has a linked PR:`));
        this.log(styles.muted(`   URL: ${ticket.metadata.pr_url}`));

        const { overwrite } = await inquirer.prompt([{
          type: 'list',
          name: 'overwrite',
          message: 'Replace with a different PR?',
          choices: confirmChoices.map(c => ({ name: c.name, value: c.value === 'true' })),
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
          await storage.close();
          db.close();
          if (jsonMode) {
            outputErrorAsJson('NO_OPEN_PRS', 'No open PRs found. Create one first with "prlt pr create".', createMetadata('pr link', flags));
            this.exit(1);
          }
          this.error('No open PRs found. Create one first with "prlt pr create".');
        }

        // Build choices once, use for both JSON and interactive modes
        const prChoices = openPRs.map(pr => ({
          name: `#${pr.number} - ${pr.title} (${pr.headBranch})`,
          value: String(pr.number),
        }));
        const prMessage = 'Select PR to link:';

        // In JSON mode, output PR selection prompt and exit
        if (jsonMode) {
          outputPromptAsJson(
            buildPromptConfig('list', 'prNumber', prMessage, prChoices),
            createMetadata('pr link', flags)
          );
        }

        const { selectedPR } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedPR',
          message: prMessage,
          choices: prChoices.map(c => ({ name: c.name, value: parseInt(c.value, 10) })),
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
