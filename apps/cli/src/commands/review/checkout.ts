import { Args } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputPromptAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import { checkoutInReviewWorktree } from '../../lib/review/index.js';
import inquirer from 'inquirer';

interface ReviewWorktreeRow {
  name: string;
  path: string;
  current_branch: string | null;
}

export default class ReviewCheckout extends PMOCommand {
  static description = 'Checkout a branch or PR into a review worktree';

  static examples = [
    '<%= config.bin %> <%= command.id %> review-1 feat/my-feature',
    '<%= config.bin %> <%= command.id %> review-1 123',
    '<%= config.bin %> <%= command.id %> review-1 main',
  ];

  static args = {
    name: Args.string({
      description: 'Name of the review worktree',
      required: false,
    }),
    target: Args.string({
      description: 'Branch name or PR number to checkout',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ReviewCheckout);
    const jsonMode = shouldOutputJson(flags);

    const db = this.storage.getDatabase();

    // Get the worktree name
    let name = args.name;
    if (!name) {
      const rows = db.prepare(
        `SELECT name, current_branch FROM ${PMO_TABLES.review_worktrees} ORDER BY name`
      ).all() as ReviewWorktreeRow[];

      if (rows.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_WORKTREES', 'No review worktrees found. Create one with "prlt review add"', createMetadata('review checkout', flags));
        }
        this.error('No review worktrees found. Create one with "prlt review add"');
      }

      const choices = rows.map(r => ({
        name: `${r.name}${r.current_branch ? ` (${r.current_branch})` : ''}`,
        value: r.name,
      }));
      const message = 'Select review worktree:';

      if (jsonMode) {
        outputPromptAsJson(
          { type: 'list', name: 'name', message, choices },
          createMetadata('review checkout', flags)
        );
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message,
        choices,
      }]);
      name = selected;
    }

    // Verify worktree exists
    const worktree = db.prepare(
      `SELECT name, path, current_branch FROM ${PMO_TABLES.review_worktrees} WHERE name = ?`
    ).get(name) as ReviewWorktreeRow | undefined;

    if (!worktree) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Review worktree "${name}" not found`, createMetadata('review checkout', flags));
      }
      this.error(`Review worktree "${name}" not found`);
    }

    // Get the target branch/PR
    let target = args.target;
    if (!target) {
      if (jsonMode) {
        outputPromptAsJson(
          {
            type: 'input',
            name: 'target',
            message: 'Enter branch name or PR number:',
            context: {
              hint: 'Use a branch name (e.g., feat/my-feature), PR number (e.g., 123), or "main" to reset',
              example: 'prlt review checkout review-1 123',
            },
          },
          createMetadata('review checkout', flags)
        );
      }

      const { inputTarget } = await inquirer.prompt([{
        type: 'input',
        name: 'inputTarget',
        message: 'Enter branch name or PR number:',
        validate: (input: string) => input.trim().length > 0 || 'Please enter a branch name or PR number',
      }]);
      target = inputTarget;
    }

    try {
      const resultBranch = checkoutInReviewWorktree(worktree.path, target!);

      // Update database
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE ${PMO_TABLES.review_worktrees} SET current_branch = ?, last_used_at = ? WHERE name = ?`
      ).run(resultBranch, now, name);

      if (jsonMode) {
        outputSuccessAsJson({
          name,
          path: worktree.path,
          branch: resultBranch,
          target: target!,
        }, createMetadata('review checkout', flags));
      }

      const isPR = /^\d+$/.test(target!);
      this.log('');
      this.log(styles.success(`Checked out ${isPR ? `PR #${target}` : `branch "${target}"`} into ${name}`));
      this.log(styles.muted(`  Branch: ${resultBranch}`));
      this.log(styles.muted(`  Path: ${worktree.path}`));
      this.log('');
      this.log(`To review: ${styles.code(`cd ${worktree.path}`)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jsonMode) {
        outputErrorAsJson('CHECKOUT_FAILED', message, createMetadata('review checkout', flags));
      }
      this.error(message);
    }
  }
}
