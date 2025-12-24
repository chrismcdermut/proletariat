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

export default class PRCreate extends Command {
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
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PRCreate);

    // Check gh CLI
    if (!isGHInstalled()) {
      this.error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    if (!isGHAuthenticated()) {
      this.error('GitHub CLI is not authenticated. Run "gh auth login" first.');
    }

    // Get current branch
    const currentBranch = getCurrentBranch();
    if (!currentBranch) {
      this.error('Not in a git repository or unable to determine current branch.');
    }

    // Check if on main/master
    const baseBranch = flags.base || getDefaultBaseBranch();
    if (currentBranch === baseBranch) {
      this.error(`Cannot create PR from ${baseBranch} branch. Switch to a feature branch first.`);
    }

    // Check if PR already exists for this branch
    const existingPR = getPRForBranch(currentBranch);
    if (existingPR) {
      this.log(styles.info(`PR already exists for branch "${currentBranch}":`));
      this.log(styles.muted(`   #${existingPR.number}: ${existingPR.title}`));
      this.log(styles.muted(`   URL: ${existingPR.url}`));
      return;
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
      // Determine ticket ID
      let ticketId = args.ticketId;

      if (!ticketId && !flags['no-link']) {
        // Try to extract ticket ID from branch name (e.g., feat/agent/TKT-001-description)
        const ticketMatch = currentBranch.match(/(TKT-\d+)/i);
        if (ticketMatch) {
          ticketId = ticketMatch[1].toUpperCase();
          this.log(styles.muted(`   Auto-detected ticket: ${ticketId}`));
        }
      }

      // Get ticket info if available
      let ticket: { id: string; title: string; description?: string } | null = null;
      if (ticketId) {
        ticket = await storage.getTicket(ticketId);
        if (!ticket) {
          this.warn(`Ticket "${ticketId}" not found. Continuing without ticket link.`);
          ticketId = undefined;
        }
      }

      // If no ticket, prompt for selection
      if (!ticketId && !flags['no-link']) {
        const allTickets = await storage.listTickets();
        const inProgressTickets = allTickets.filter(t =>
          t.column && t.column.toLowerCase().includes('progress')
        );

        if (inProgressTickets.length > 0) {
          const { selectedTicketId, skipLink } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedTicketId',
              message: 'Link PR to a ticket?',
              choices: [
                ...inProgressTickets.map(t => ({
                  name: `${t.id} - ${t.title}`,
                  value: t.id,
                })),
                new inquirer.Separator(),
                { name: 'Skip - create PR without linking', value: '__skip__' },
              ],
            },
          ]);

          if (selectedTicketId !== '__skip__') {
            ticketId = selectedTicketId;
            ticket = await storage.getTicket(ticketId!);
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

      // Push branch if not pushed
      if (!hasBranchBeenPushed(currentBranch)) {
        this.log(styles.muted(`   Pushing branch to origin...`));
        if (!pushBranch(currentBranch)) {
          this.error('Failed to push branch to origin.');
        }
      } else if (hasUnpushedCommits(currentBranch)) {
        this.log(styles.muted(`   Pushing unpushed commits...`));
        if (!pushBranch(currentBranch)) {
          this.error('Failed to push commits to origin.');
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
        this.error(`Failed to create PR: ${result.error}`);
      }

      // Store PR URL in ticket metadata
      if (ticket && result.url) {
        await storage.updateTicket(ticket.id, {
          metadata: {
            pr_url: result.url,
            pr_number: String(result.number),
          },
        });
      }

      await storage.close();
      db.close();

      this.log('');
      this.log(styles.success(`Pull request created!`));
      this.log(styles.muted(`   PR #${result.number}`));
      this.log(styles.muted(`   URL: ${result.url}`));
      if (ticket) {
        this.log(styles.muted(`   Linked to: ${ticket.id}`));
      }
    } catch (error) {
      await storage.close();
      db.close();
      throw error;
    }
  }
}
