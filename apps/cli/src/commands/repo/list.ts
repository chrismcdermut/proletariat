import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import { findHQRoot, getWorkspaceRepoInfo } from '../../lib/repos/index.js';
import { isNonTTY } from '../../lib/prompt-json.js';
import { visualPadEnd } from '../../lib/string-utils.js';

export default class List extends PMOCommand {
  static description = 'List all repositories in the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format compact',
    '<%= config.bin %> <%= command.id %> --format json',
  ];

  static flags = {
    ...pmoBaseFlags,
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'compact', 'json'],
      default: 'table',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(List);

    // Default format to 'json' in non-TTY environments (piped output, CI, agents)
    if (flags.format === 'table' && isNonTTY()) {
      flags.format = 'json';
    }

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt new" first.');
    }

    const { repositories } = getWorkspaceRepoInfo();

    if (repositories.length === 0) {
      this.log(colors.warning('No repositories found. Add one with "prlt repo add"'));
      return;
    }

    if (flags.format === 'json') {
      this.log(JSON.stringify(repositories, null, 2));
      return;
    }

    if (flags.format === 'compact') {
      for (const repo of repositories) {
        const statusIcon = repo.status === 'clean' ? '📦' : repo.status === 'dirty' ? '📦' : '❌';
        let line = `${statusIcon} ${repo.name} (${repo.branch || 'unknown'}, ${repo.status}`;
        if (repo.commitsAhead > 0) {
          line += `, ${repo.commitsAhead} ahead`;
        }
        line += ')';
        this.log(line);
      }
      return;
    }

    // Table format (default)
    this.log(format.title(`📦 Repositories (${repositories.length})`));
    this.log('');

    // Header
    this.log(colors.textMuted(
      visualPadEnd('Name', 20) +
      visualPadEnd('Status', 10) +
      visualPadEnd('Branch', 15) +
      visualPadEnd('Commits', 12) +
      'Added'
    ));
    this.log(colors.textMuted('─'.repeat(70)));

    for (const repo of repositories) {
      const statusColor = repo.status === 'clean' ? colors.repoClean :
                         repo.status === 'dirty' ? colors.repoDirty :
                         colors.repoMissing;

      let commits = '-';
      if (repo.commitsAhead > 0 && repo.commitsBehind > 0) {
        commits = `+${repo.commitsAhead}/-${repo.commitsBehind}`;
      } else if (repo.commitsAhead > 0) {
        commits = `${repo.commitsAhead} ahead`;
      } else if (repo.commitsBehind > 0) {
        commits = `${repo.commitsBehind} behind`;
      }

      const added = repo.addedAt ? new Date(repo.addedAt).toLocaleDateString() : '-';

      this.log(
        colors.text(visualPadEnd(repo.name, 20)) +
        statusColor(visualPadEnd(repo.status, 10)) +
        colors.warning(visualPadEnd(repo.branch || '-', 15)) +
        colors.text(visualPadEnd(commits, 12)) +
        colors.textMuted(added)
      );
    }

    // Summary
    this.log('');
    const dirtyCount = repositories.filter(r => r.status === 'dirty').length;
    const aheadCount = repositories.filter(r => r.commitsAhead > 0).length;

    this.log(format.subtitle('Summary:'));
    this.log(colors.text(`  ${repositories.length} repositories`));
    if (dirtyCount > 0) {
      this.log(colors.warning(`  ${dirtyCount} with uncommitted changes`));
    }
    if (aheadCount > 0) {
      this.log(colors.text(`  ${aheadCount} with unpushed commits`));
    }
  }
}
