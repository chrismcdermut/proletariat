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
import { findHQRoot } from '../../lib/workspace.js';
import { removeReviewWorktree } from '../../lib/review/index.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import inquirer from 'inquirer';

export default class ReviewRemove extends PMOCommand {
  static description = 'Remove a review worktree';

  static examples = [
    '<%= config.bin %> <%= command.id %> review-1',
  ];

  static args = {
    name: Args.string({
      description: 'Name of the review worktree to remove',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ReviewRemove);
    const jsonMode = shouldOutputJson(flags);

    const hqPath = findHQRoot();
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('NO_HQ', 'Not in an HQ workspace. Run "prlt init" first.', createMetadata('review remove', flags));
      }
      this.error('Not in an HQ workspace. Run "prlt init" first.');
    }

    const db = this.storage.getDatabase();

    let name = args.name;
    if (!name) {
      // List existing worktrees to select from
      const rows = db.prepare(
        `SELECT name, current_branch FROM ${PMO_TABLES.review_worktrees} ORDER BY name`
      ).all() as Array<{ name: string; current_branch: string | null }>;

      if (rows.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_WORKTREES', 'No review worktrees found', createMetadata('review remove', flags));
        }
        this.error('No review worktrees found. Create one with "prlt review add"');
      }

      const choices = rows.map(r => ({
        name: `${r.name}${r.current_branch ? ` (${r.current_branch})` : ''}`,
        value: r.name,
      }));
      const message = 'Select review worktree to remove:';

      if (jsonMode) {
        outputPromptAsJson(
          { type: 'list', name: 'name', message, choices },
          createMetadata('review remove', flags)
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

    // Verify it exists
    const existing = db.prepare(
      `SELECT name, path FROM ${PMO_TABLES.review_worktrees} WHERE name = ?`
    ).get(name) as { name: string; path: string } | undefined;

    if (!existing) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Review worktree "${name}" not found`, createMetadata('review remove', flags));
      }
      this.error(`Review worktree "${name}" not found`);
    }

    try {
      removeReviewWorktree(name!, hqPath);

      // Remove from database
      db.prepare(
        `DELETE FROM ${PMO_TABLES.review_worktrees} WHERE name = ?`
      ).run(name);

      if (jsonMode) {
        outputSuccessAsJson({ name, removed: true }, createMetadata('review remove', flags));
      }

      this.log(styles.success(`Removed review worktree "${name}"`));
    } catch (error) {
      // Still remove from DB even if filesystem cleanup fails
      db.prepare(
        `DELETE FROM ${PMO_TABLES.review_worktrees} WHERE name = ?`
      ).run(name);

      const message = error instanceof Error ? error.message : String(error);
      this.log(styles.warning(`Warning: ${message}`));
      this.log(styles.success(`Removed review worktree "${name}" from database`));
    }
  }
}
