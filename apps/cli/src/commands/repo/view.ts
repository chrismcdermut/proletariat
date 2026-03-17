import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  getWorkspaceRepoInfo,
} from '../../lib/repos/index.js';
import { getWorktreesForRepo } from '../../lib/database/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { visualPadEnd } from '../../lib/string-utils.js';

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
    const { args, flags } = await this.parse(View);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('repo view', flags));
        return
      }
      this.error(message);
    };

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      return handleError('NOT_IN_HQ', 'Not in an HQ directory. Run "prlt new" first.');
    }

    let repoName: string | null = args.name || null;

    // Interactive selection if no name provided
    if (!repoName) {
      const { repositories } = getWorkspaceRepoInfo();

      if (repositories.length === 0) {
        return handleError('NO_REPOSITORIES', 'No repositories found. Add one with "prlt repo add"');
      }

      // Use selectFromList helper for JSON mode support
      const selected = await this.selectFromList({
        message: 'Select repository to view:',
        items: repositories,
        getName: (r) => `${r.name} (${r.status}${r.commitsAhead > 0 ? `, ${r.commitsAhead} ahead` : ''})`,
        getValue: (r) => r.name,
        getCommand: (r) => `prlt repo view ${r.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'repo view' } : null,
        allowCancel: true,
      });

      if (!selected) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      repoName = selected;
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
    const worktrees = getWorktreesForRepo(hqPath, repoName);

    if (worktrees.length > 0) {
      this.log(format.subtitle('\n👥 Agent Worktrees:'));
      for (const wt of worktrees) {
        const wtStatus = wt.is_clean ? 'clean' : 'dirty';
        const wtColor = wt.is_clean ? colors.repoClean : colors.repoDirty;
        let line = `  • ${colors.agentName(visualPadEnd(wt.agent_name, 10))} - ${wtColor(wtStatus)}`;
        if (wt.commits_ahead > 0) {
          line += colors.commitsAhead(` (${wt.commits_ahead} ahead)`);
        }
        this.log(line);
      }
    }
  }
}
