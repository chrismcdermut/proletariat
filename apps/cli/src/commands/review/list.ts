import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { styles, divider } from '../../lib/styles.js';
import {
  shouldOutputJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import { getCurrentBranchInWorktree } from '../../lib/review/index.js';
import * as fs from 'node:fs';

interface ReviewWorktreeRow {
  name: string;
  path: string;
  current_branch: string | null;
  repo_name: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export default class ReviewList extends PMOCommand {
  static description = 'List review worktrees and their current branches';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(ReviewList);
    const jsonMode = shouldOutputJson(flags);

    const db = this.storage.getDatabase();
    const rows = db.prepare(
      `SELECT name, path, current_branch, repo_name, created_at, last_used_at
       FROM ${PMO_TABLES.review_worktrees}
       ORDER BY name`
    ).all() as ReviewWorktreeRow[];

    // Update current branch info from the actual worktrees
    const enrichedRows = rows.map(row => {
      let actualBranch = row.current_branch;
      const exists = fs.existsSync(row.path);

      if (exists) {
        const branch = getCurrentBranchInWorktree(row.path);
        if (branch) {
          actualBranch = branch;
          // Update DB with actual branch
          db.prepare(
            `UPDATE ${PMO_TABLES.review_worktrees} SET current_branch = ? WHERE name = ?`
          ).run(branch, row.name);
        }
      }

      return {
        name: row.name,
        path: row.path,
        currentBranch: actualBranch,
        repoName: row.repo_name,
        exists,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      };
    });

    if (jsonMode) {
      this.log(JSON.stringify(enrichedRows, null, 2));
      return;
    }

    if (enrichedRows.length === 0) {
      this.log(styles.info('No review worktrees found.'));
      this.log(styles.muted('Create one with: prlt review add [name]'));
      return;
    }

    this.log('');
    this.log(styles.header(`Review Worktrees (${enrichedRows.length})`));
    this.log(divider(70));

    for (const row of enrichedRows) {
      const statusIcon = row.exists ? '🟢' : '🔴';
      const branchInfo = row.currentBranch ? styles.code(row.currentBranch) : styles.muted('(no branch)');

      this.log(`${statusIcon} ${styles.emphasis(row.name)} → ${branchInfo}`);
      this.log(styles.muted(`   Path: ${row.path}`));
      if (row.repoName) {
        this.log(styles.muted(`   Repo: ${row.repoName}`));
      }
      if (row.lastUsedAt) {
        const lastUsed = new Date(row.lastUsedAt).toLocaleDateString();
        this.log(styles.muted(`   Last used: ${lastUsed}`));
      }
      if (!row.exists) {
        this.log(styles.warning('   (worktree directory missing)'));
      }
      this.log('');
    }

    this.log(divider(70));
    this.log(styles.muted(`Checkout a branch: prlt review checkout <name> <branch|PR#>`));
  }
}
