import { Command, Flags } from '@oclif/core';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { requireGhCli } from '../../lib/pr/index.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

// Target repository for feedback issues
const FEEDBACK_REPO = 'chrismcdermut/proletariat';

// Category to GitHub label mapping
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'bug',
  feature: 'enhancement',
  general: 'feedback',
};

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  createdAt: string;
  author: { login: string };
}

export default class FeedbackList extends Command {
  static description = 'List recent feedback issues from the repository';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --category bug',
    '<%= config.bin %> <%= command.id %> --state closed --limit 10',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...machineOutputFlags,
    category: Flags.string({
      char: 'c',
      description: 'Filter by category (bug, feature, general)',
      options: ['bug', 'feature', 'general'],
    }),
    state: Flags.string({
      char: 's',
      description: 'Filter by state',
      options: ['open', 'closed', 'all'],
      default: 'open',
    }),
    limit: Flags.integer({
      char: 'l',
      description: 'Maximum number of issues to show',
      default: 20,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FeedbackList);
    const jsonMode = isMachineOutput(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('feedback list', flags));
        return
      }
      this.error(message);
    };

    // Check gh CLI (differentiated not-installed vs not-authenticated)
    if (!requireGhCli(handleError)) return;

    // Build the gh issue list command
    const args = [
      'issue', 'list',
      '--repo', FEEDBACK_REPO,
      '--limit', String(flags.limit),
      '--json', 'number,title,state,labels,createdAt,author',
    ];

    // Add state filter
    if (flags.state && flags.state !== 'all') {
      args.push('--state', flags.state);
    }

    // Add label filter for category
    if (flags.category) {
      const label = CATEGORY_LABELS[flags.category];
      if (label) {
        args.push('--label', label);
      }
    }

    try {
      const result = execSync(`gh ${args.join(' ')}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const issues: GitHubIssue[] = JSON.parse(result || '[]');

      if (jsonMode) {
        outputSuccessAsJson(
          {
            issues: issues.map(issue => ({
              number: issue.number,
              title: issue.title,
              state: issue.state,
              labels: issue.labels.map(l => l.name),
              createdAt: issue.createdAt,
              author: issue.author.login,
              url: `https://github.com/${FEEDBACK_REPO}/issues/${issue.number}`,
            })),
            count: issues.length,
            repository: FEEDBACK_REPO,
            filters: {
              category: flags.category,
              state: flags.state,
              limit: flags.limit,
            },
          },
          createMetadata('feedback list', flags)
        );
        return
      }

      // Display issues in human-friendly format
      if (issues.length === 0) {
        this.log(styles.muted('\nNo issues found matching your criteria.\n'));
        return;
      }

      this.log(`\n${styles.header('Feedback Issues')} ${styles.muted(`(${FEEDBACK_REPO})`)}\n`);

      for (const issue of issues) {
        const stateIcon = issue.state === 'open' ? chalk.green('●') : chalk.red('●');
        const labels = issue.labels.map(l => chalk.cyan(`[${l.name}]`)).join(' ');
        const date = new Date(issue.createdAt).toLocaleDateString();

        this.log(`${stateIcon} ${chalk.bold(`#${issue.number}`)} ${issue.title}`);
        this.log(`  ${labels} ${styles.muted(`by ${issue.author.login} on ${date}`)}`);
        this.log('');
      }

      this.log(styles.muted(`Showing ${issues.length} issue(s). Use 'prlt feedback view <number>' to see details.\n`));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error listing issues';
      return handleError('ISSUE_LIST_FAILED', `Failed to list issues: ${errorMessage}`);
    }
  }
}
