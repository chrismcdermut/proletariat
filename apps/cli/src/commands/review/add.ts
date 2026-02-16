import { Args, Flags } from '@oclif/core';
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
import { createReviewWorktree } from '../../lib/review/index.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';

export default class ReviewAdd extends PMOCommand {
  static description = 'Create a new review worktree for PR review and manual testing';

  static examples = [
    '<%= config.bin %> <%= command.id %> review-1',
    '<%= config.bin %> <%= command.id %> review-2 --repo my-repo',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the review worktree (e.g., review-1, review-2)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    repo: Flags.string({
      char: 'r',
      description: 'Repository to create worktree from (defaults to primary repo)',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ReviewAdd);
    const jsonMode = shouldOutputJson(flags);

    const hqPath = findHQRoot();
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt init" first.', createMetadata('review add', flags));
      }
      this.error('Not in an HQ workspace. Run "prlt init" first.');
    }

    // Auto-generate name if not provided
    const name = args.name || await this.generateName(hqPath);

    // Check if name already exists in DB
    const db = this.storage.getDatabase();
    const existing = db.prepare(
      `SELECT name FROM ${PMO_TABLES.review_worktrees} WHERE name = ?`
    ).get(name);

    if (existing) {
      if (jsonMode) {
        outputErrorAsJson('ALREADY_EXISTS', `Review worktree "${name}" already exists`, createMetadata('review add', flags));
      }
      this.error(`Review worktree "${name}" already exists`);
    }

    try {
      const result = createReviewWorktree(name, hqPath, flags.repo);

      // Store in database
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO ${PMO_TABLES.review_worktrees} (name, path, current_branch, repo_name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(name, result.worktreePath, result.branch, result.repoName, now, now);

      if (jsonMode) {
        outputSuccessAsJson({
          name,
          path: result.worktreePath,
          branch: result.branch,
          repoName: result.repoName,
        }, createMetadata('review add', flags));
      }

      this.log('');
      this.log(styles.success(`Created review worktree "${name}"`));
      this.log(styles.muted(`  Path: ${result.worktreePath}`));
      this.log(styles.muted(`  Repo: ${result.repoName}`));
      this.log(styles.muted(`  Branch: ${result.branch}`));
      this.log('');
      this.log(`To use: ${styles.code(`cd ${result.worktreePath}`)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jsonMode) {
        outputErrorAsJson('CREATE_FAILED', message, createMetadata('review add', flags));
      }
      this.error(message);
    }
  }

  private async generateName(hqPath: string): Promise<string> {
    const db = this.storage.getDatabase();
    const rows = db.prepare(
      `SELECT name FROM ${PMO_TABLES.review_worktrees} ORDER BY name`
    ).all() as Array<{ name: string }>;

    const existingNames = new Set(rows.map(r => r.name));
    let i = 1;
    while (existingNames.has(`review-${i}`)) {
      i++;
    }
    return `review-${i}`;
  }
}
