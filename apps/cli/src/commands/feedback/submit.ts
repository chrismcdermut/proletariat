import { Flags } from '@oclif/core';
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import chalk from 'chalk';
import { PromptCommand } from '../../lib/prompt-command.js';
import { styles } from '../../lib/styles.js';
import { requireGhCli } from '../../lib/pr/index.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputPromptAsJson,
  buildPromptConfig,
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

export default class FeedbackSubmit extends PromptCommand {
  static description = 'Submit feedback, bug reports, or feature requests to GitHub Issues';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "Bug in CLI" --body "Description here" --category bug',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...machineOutputFlags,
    title: Flags.string({
      char: 't',
      description: 'Issue title (one-liner) [required for non-interactive]',
    }),
    body: Flags.string({
      char: 'b',
      description: 'Issue description [required for non-interactive]',
    }),
    category: Flags.string({
      char: 'c',
      description: 'Feedback category',
      options: ['bug', 'feature', 'general'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FeedbackSubmit);
    const jsonMode = isMachineOutput(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('feedback submit', flags));
        return
      }
      this.error(message);
    };

    // Check gh CLI (differentiated not-installed vs not-authenticated)
    if (!requireGhCli(handleError)) return;

    // Collect category
    let category = flags.category;
    if (!category) {
      const categoryChoices = [
        { name: 'Bug report', value: 'bug' },
        { name: 'Feature request', value: 'feature' },
        { name: 'General feedback', value: 'general' },
      ];
      const categoryMessage = 'What type of feedback would you like to submit?';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'category', categoryMessage, categoryChoices),
          createMetadata('feedback submit', flags)
        );
        return;
      }

      const { selectedCategory } = await this.prompt<{ selectedCategory: string }>([{
        type: 'list',
        name: 'selectedCategory',
        message: categoryMessage,
        choices: categoryChoices,
      }], null);
      category = selectedCategory;
    }

    // Collect title
    let title = flags.title;
    if (!title) {
      const titleMessage = 'Enter a brief title for your feedback:';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('input', 'title', titleMessage),
          createMetadata('feedback submit', { ...flags, category })
        );
        return;
      }

      const { inputTitle } = await this.prompt<{ inputTitle: string }>([{
        type: 'input',
        name: 'inputTitle',
        message: titleMessage,
        validate: (input: unknown) => {
          if (!(input as string).trim()) {
            return 'Title is required';
          }
          if ((input as string).length > 200) {
            return 'Title must be less than 200 characters';
          }
          return true;
        },
      }], null);
      title = inputTitle;
    }

    // Collect body/description
    let body = flags.body;
    if (!body) {
      const bodyMessage = 'Describe your feedback in detail:';

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('editor', 'body', bodyMessage),
          createMetadata('feedback submit', { ...flags, category, title })
        );
        return;
      }

      const { inputBody } = await this.prompt<{ inputBody: string }>([{
        type: 'editor',
        name: 'inputBody',
        message: bodyMessage,
        validate: (input: unknown) => {
          if (!(input as string).trim()) {
            return 'Description is required';
          }
          return true;
        },
      }], null);
      body = inputBody;
    }

    // Build diagnostics section
    const diagnostics = this.collectDiagnostics();

    // Build full issue body with diagnostics
    const fullBody = `${body}\n\n---\n\n## Diagnostics\n\n${diagnostics}`;

    // Get label for category
    const label = CATEGORY_LABELS[category!] || 'feedback';

    // Create the GitHub issue
    if (!jsonMode) {
      this.log(styles.muted('\nCreating issue on GitHub...\n'));
    }

    // Escape title for shell
    const escapedTitle = title!.replace(/"/g, '\\"');
    let usedLabel: string | null = label;
    let result: string;

    try {
      // Try with label first
      result = execSync(
        `gh issue create --repo "${FEEDBACK_REPO}" --title "${escapedTitle}" --body-file - --label "${label}"`,
        {
          encoding: 'utf-8',
          input: fullBody,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();
    } catch (labelError) {
      // If label doesn't exist, try without label
      const labelErrorMessage = labelError instanceof Error ? labelError.message : '';
      if (labelErrorMessage.includes('not found') && labelErrorMessage.includes('label')) {
        try {
          usedLabel = null;
          result = execSync(
            `gh issue create --repo "${FEEDBACK_REPO}" --title "${escapedTitle}" --body-file -`,
            {
              encoding: 'utf-8',
              input: fullBody,
              stdio: ['pipe', 'pipe', 'pipe'],
            }
          ).trim();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error creating issue';
          return handleError('ISSUE_CREATE_FAILED', `Failed to create issue: ${errorMessage}`);
        }
      } else {
        const errorMessage = labelError instanceof Error ? labelError.message : 'Unknown error creating issue';
        return handleError('ISSUE_CREATE_FAILED', `Failed to create issue: ${errorMessage}`);
      }
    }

    // Parse issue URL from result
    const issueUrl = result;
    const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
    const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : undefined;

    if (jsonMode) {
      outputSuccessAsJson(
        {
          issueUrl,
          issueNumber,
          title: title!,
          category: category!,
          label: usedLabel,
          repository: FEEDBACK_REPO,
        },
        createMetadata('feedback submit', flags)
      );
      return
    }

    this.log(chalk.green('  ✓ Issue created successfully!\n'));
    this.log(`${styles.header('Issue URL:')} ${chalk.cyan(issueUrl)}`);
    if (issueNumber) {
      this.log(`${styles.header('Issue #:')}   ${issueNumber}`);
    }
    this.log(`${styles.header('Category:')} ${category}`);
    if (usedLabel) {
      this.log(`${styles.header('Label:')}    ${usedLabel}\n`);
    } else {
      this.log(styles.muted(`(Label '${label}' not found in repository)\n`));
    }
    this.log(styles.muted('Thank you for your feedback!'));
  }

  /**
   * Collect diagnostic information to include in the issue
   */
  private collectDiagnostics(): string {
    const lines: string[] = [];

    // CLI version
    lines.push(`- **CLI Version:** ${this.config.version}`);

    // Node version
    lines.push(`- **Node Version:** ${process.version}`);

    // OS info
    lines.push(`- **OS:** ${process.platform}`);
    lines.push(`- **OS Version:** ${os.release()}`);

    // Try to get workspace name if available
    try {
      const cwd = process.cwd();
      const workspaceName = cwd.split('/').pop() || 'unknown';
      lines.push(`- **Working Directory:** ${workspaceName}`);
    } catch {
      // Ignore errors getting workspace name
    }

    return lines.join('\n');
  }
}
