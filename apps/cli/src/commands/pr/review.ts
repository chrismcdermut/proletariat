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
  createMetadata,
} from '../../lib/prompt-json.js';
import { findHQRoot } from '../../lib/workspace.js';
import {
  isGHInstalled,
  isGHAuthenticated,
} from '../../lib/pr/index.js';
import {
  createReviewWorktree,
  checkoutInReviewWorktree,
} from '../../lib/review/index.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';

interface ReviewWorktreeRow {
  name: string;
  path: string;
  current_branch: string | null;
}

export default class PRReview extends PMOCommand {
  static description = 'Checkout a PR into an available review worktree for manual testing';

  static examples = [
    '<%= config.bin %> <%= command.id %> 123',
    '<%= config.bin %> <%= command.id %> 456',
  ];

  static args = {
    pr: Args.string({
      description: 'PR number to review',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PRReview);
    const jsonMode = shouldOutputJson(flags);

    const hqPath = findHQRoot();
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt init" first.', createMetadata('pr review', flags));
      }
      this.error('Not in an HQ workspace. Run "prlt init" first.');
    }

    // Validate gh CLI
    if (!isGHInstalled()) {
      if (jsonMode) {
        outputErrorAsJson('GH_NOT_INSTALLED', 'GitHub CLI (gh) is not installed.', createMetadata('pr review', flags));
      }
      this.error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }

    if (!isGHAuthenticated()) {
      if (jsonMode) {
        outputErrorAsJson('GH_NOT_AUTHENTICATED', 'GitHub CLI is not authenticated.', createMetadata('pr review', flags));
      }
      this.error('GitHub CLI is not authenticated. Run "gh auth login" first.');
    }

    const prNumber = args.pr;
    const db = this.storage.getDatabase();

    // Find an available review worktree (or the one already reviewing this PR)
    const rows = db.prepare(
      `SELECT name, path, current_branch FROM ${PMO_TABLES.review_worktrees} ORDER BY last_used_at ASC`
    ).all() as ReviewWorktreeRow[];

    let worktree: ReviewWorktreeRow | null = null;

    if (rows.length > 0) {
      // Check if any worktree is already on this PR's branch
      // Use the least recently used worktree otherwise
      worktree = rows[0];
    } else {
      // No worktrees exist - create one automatically
      if (!jsonMode) {
        this.log(styles.info('No review worktrees found. Creating one...'));
      }

      try {
        const result = createReviewWorktree('review-1', hqPath);
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO ${PMO_TABLES.review_worktrees} (name, path, current_branch, repo_name, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run('review-1', result.worktreePath, result.branch, result.repoName, now, now);

        worktree = { name: 'review-1', path: result.worktreePath, current_branch: result.branch };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (jsonMode) {
          outputErrorAsJson('CREATE_FAILED', `Failed to create review worktree: ${message}`, createMetadata('pr review', flags));
        }
        this.error(`Failed to create review worktree: ${message}`);
      }
    }

    // Checkout the PR into the worktree
    try {
      const resultBranch = checkoutInReviewWorktree(worktree!.path, prNumber);

      // Update database
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE ${PMO_TABLES.review_worktrees} SET current_branch = ?, last_used_at = ? WHERE name = ?`
      ).run(resultBranch, now, worktree!.name);

      if (jsonMode) {
        outputSuccessAsJson({
          worktree: worktree!.name,
          path: worktree!.path,
          pr: parseInt(prNumber, 10),
          branch: resultBranch,
        }, createMetadata('pr review', flags));
      }

      this.log('');
      this.log(styles.success(`PR #${prNumber} checked out into ${worktree!.name}`));
      this.log(styles.muted(`  Branch: ${resultBranch}`));
      this.log(styles.muted(`  Path: ${worktree!.path}`));
      this.log('');
      this.log(`To review: ${styles.code(`cd ${worktree!.path}`)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jsonMode) {
        outputErrorAsJson('CHECKOUT_FAILED', message, createMetadata('pr review', flags));
      }
      this.error(message);
    }
  }
}
