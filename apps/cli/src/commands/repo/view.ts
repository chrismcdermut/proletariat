import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptSelectRepo,
  getWorkspaceRepoInfo,
} from '../../lib/repos/index.js';
import { openWorkspaceDatabase } from '../../lib/database/index.js';

export default class View extends PMOCommand {
  static description = 'View detailed information about a repository';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-repo',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Repository name to view',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(View);

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
    }

    let repoName: string | null = args.name || null;

    // Interactive selection if no name provided
    if (!repoName) {
      repoName = await promptSelectRepo('Select repository to view:');
      if (!repoName) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    // Get repository info
    const { repositories } = getWorkspaceRepoInfo();
    const repo = repositories.find(r => r.name === repoName);

    if (!repo) {
      this.error(`Repository "${repoName}" not found.`);
    }

    // Display repository details
    this.log(format.title(`📦 Repository: ${repo.name}`));
    this.log('');

    this.log(`Path:        ${colors.path(repo.path)}`);
    if (repo.sourceUrl) {
      this.log(`Source:      ${colors.text(repo.sourceUrl)}`);
    }
    if (repo.addedAt) {
      this.log(`Added:       ${colors.text(new Date(repo.addedAt).toLocaleString())}`);
    }

    this.log(format.subtitle('\n📊 Git Status:'));
    if (repo.status === 'missing') {
      this.log(colors.error('  Repository directory not found'));
    } else {
      const statusIcon = repo.status === 'clean' ? '🟢' : '🟡';
      const statusColor = repo.status === 'clean' ? colors.success : colors.warning;
      this.log(`  Branch:    ${colors.warning(repo.branch || 'unknown')}`);
      this.log(`  Status:    ${statusIcon} ${statusColor(repo.status)}`);

      if (repo.commitsAhead > 0 || repo.commitsBehind > 0) {
        let commitInfo = '';
        if (repo.commitsAhead > 0) {
          commitInfo += `${repo.commitsAhead} ahead`;
        }
        if (repo.commitsBehind > 0) {
          if (commitInfo) commitInfo += ', ';
          commitInfo += `${repo.commitsBehind} behind`;
        }
        this.log(`  Commits:   ${colors.text(commitInfo)}`);
      }
    }

    // Get agent worktree info
    const db = openWorkspaceDatabase(hqPath);
    const worktrees = db.prepare(`
      SELECT agent_name, is_clean, commits_ahead, branch
      FROM agent_worktrees
      WHERE repo_name = ?
    `).all(repoName) as { agent_name: string; is_clean: number; commits_ahead: number; branch: string }[];
    db.close();

    if (worktrees.length > 0) {
      this.log(format.subtitle('\n👥 Agent Worktrees:'));
      for (const wt of worktrees) {
        const wtStatus = wt.is_clean ? 'clean' : 'dirty';
        const wtColor = wt.is_clean ? colors.repoClean : colors.repoDirty;
        let line = `  • ${colors.agentName(wt.agent_name.padEnd(10))} - ${wtColor(wtStatus)}`;
        if (wt.commits_ahead > 0) {
          line += colors.commitsAhead(` (${wt.commits_ahead} ahead)`);
        }
        this.log(line);
      }
    }
  }
}
