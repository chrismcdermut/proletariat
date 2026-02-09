import { Command, Args } from '@oclif/core';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated } from '../../lib/pr/index.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

// Target repository for feedback issues
const FEEDBACK_REPO = 'chrismcdermut/proletariat';

interface GitHubIssueDetail {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string }>;
  createdAt: string;
  updatedAt: string;
  author: { login: string };
  comments: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
  }>;
}

export default class FeedbackView extends Command {
  static description = 'View details of a specific feedback issue';

  static examples = [
    '<%= config.bin %> <%= command.id %> 123',
    '<%= config.bin %> <%= command.id %> 123 --json',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  static args = {
    number: Args.integer({
      description: 'Issue number to view',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FeedbackView);
    const jsonMode = isMachineOutput(flags);
    const issueNumber = args.number;

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('feedback view', flags));
      }
      this.error(message);
    };

    // Check if gh CLI is installed
    if (!isGHInstalled()) {
      return handleError(
        'GH_NOT_INSTALLED',
        'GitHub CLI (gh) is not installed. Install it with: brew install gh'
      );
    }

    // Check if gh is authenticated
    if (!isGHAuthenticated()) {
      return handleError(
        'GH_NOT_AUTHENTICATED',
        'GitHub CLI is not authenticated. Run: gh auth login'
      );
    }

    try {
      // Get issue details
      const result = execSync(
        `gh issue view ${issueNumber} --repo "${FEEDBACK_REPO}" --json number,title,body,state,labels,createdAt,updatedAt,author,comments`,
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      const issue: GitHubIssueDetail = JSON.parse(result);

      if (jsonMode) {
        outputSuccessAsJson(
          {
            number: issue.number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            labels: issue.labels.map(l => l.name),
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            author: issue.author.login,
            comments: issue.comments.map(c => ({
              author: c.author.login,
              body: c.body,
              createdAt: c.createdAt,
            })),
            url: `https://github.com/${FEEDBACK_REPO}/issues/${issue.number}`,
            repository: FEEDBACK_REPO,
          },
          createMetadata('feedback view', flags)
        );
      }

      // Display issue in human-friendly format
      const stateIcon = issue.state === 'OPEN' ? chalk.green('OPEN') : chalk.red('CLOSED');
      const labels = issue.labels.map(l => chalk.cyan(`[${l.name}]`)).join(' ');
      const createdDate = new Date(issue.createdAt).toLocaleString();
      const updatedDate = new Date(issue.updatedAt).toLocaleString();

      this.log(`\n${styles.header('Issue #')}${chalk.bold(String(issue.number))} ${stateIcon}\n`);
      this.log(`${styles.header('Title:')}   ${issue.title}`);
      this.log(`${styles.header('Author:')}  ${issue.author.login}`);
      this.log(`${styles.header('Labels:')}  ${labels || styles.muted('none')}`);
      this.log(`${styles.header('Created:')} ${createdDate}`);
      this.log(`${styles.header('Updated:')} ${updatedDate}`);
      this.log(`${styles.header('URL:')}     ${chalk.cyan(`https://github.com/${FEEDBACK_REPO}/issues/${issue.number}`)}`);

      if (issue.body) {
        this.log(`\n${styles.header('Description:')}`);
        this.log(styles.muted('─'.repeat(50)));
        this.log(issue.body);
        this.log(styles.muted('─'.repeat(50)));
      }

      if (issue.comments && issue.comments.length > 0) {
        this.log(`\n${styles.header('Comments:')} (${issue.comments.length})`);
        this.log(styles.muted('─'.repeat(50)));

        for (const comment of issue.comments) {
          const commentDate = new Date(comment.createdAt).toLocaleString();
          this.log(`\n${chalk.bold(comment.author.login)} ${styles.muted(`on ${commentDate}`)}`);
          this.log(comment.body);
        }
        this.log(styles.muted('─'.repeat(50)));
      }

      this.log('');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error viewing issue';

      // Check if it's a "not found" error
      if (errorMessage.includes('not found') || errorMessage.includes('Could not resolve')) {
        return handleError('ISSUE_NOT_FOUND', `Issue #${issueNumber} not found in ${FEEDBACK_REPO}`);
      }

      return handleError('ISSUE_VIEW_FAILED', `Failed to view issue: ${errorMessage}`);
    }
  }
}
