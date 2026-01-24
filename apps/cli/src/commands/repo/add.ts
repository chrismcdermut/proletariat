import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptAddSingleRepo,
  promptForRepositories,
  addRepository
} from '../../lib/repos/index.js';
import { getWorkspaceRepositories } from '../../lib/database/index.js';

export default class Add extends PMOCommand {
  static description = 'Add a repository to the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/repo',
    '<%= config.bin %> <%= command.id %> git@github.com:user/repo.git',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --bulk',
  ];

  static args = {
    path: Args.string({
      description: 'Repository path or Git URL',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    action: Flags.string({
      char: 'a',
      description: 'Action for local paths',
      options: ['clone', 'move'],
      default: 'clone',
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Add multiple repositories interactively',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Add);

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
    }

    // Bulk mode: add multiple repositories interactively
    if (flags.bulk) {
      await this.executeBulk(hqPath);
      return;
    }

    let repoPath: string;
    let action: 'clone' | 'move';

    if (args.path) {
      // Path provided as argument
      repoPath = args.path;
      action = flags.action as 'clone' | 'move';

      // Force clone for URLs
      if (repoPath.startsWith('http://') ||
          repoPath.startsWith('https://') ||
          repoPath.startsWith('git@')) {
        action = 'clone';
      }
    } else {
      // Interactive mode
      const result = await promptAddSingleRepo();
      if (!result) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      repoPath = result.path;
      action = result.action;
    }

    // Add the repository
    const result = await addRepository(hqPath, repoPath, action);

    if (result.success) {
      this.log(format.success(`Repository ${result.name} added successfully`));
    } else {
      this.error(`Failed to add repository: ${result.error}`);
    }
  }

  /**
   * Bulk mode: add multiple repositories interactively
   */
  private async executeBulk(hqPath: string): Promise<void> {
    this.log(colors.primary('📦 Add Repositories (Bulk Mode)\n'));

    // Get existing repos
    const existingRepos = getWorkspaceRepositories(hqPath).map(r => r.name);

    // Use the shared prompt for repositories
    const reposToAdd = await promptForRepositories(process.cwd(), existingRepos);

    if (reposToAdd.length === 0) {
      this.log(colors.textMuted('No repositories selected.'));
      return;
    }

    this.log('');

    // Add each repository
    let successCount = 0;
    let failCount = 0;

    for (const repo of reposToAdd) {
      // eslint-disable-next-line no-await-in-loop -- Sequential add with user feedback
      const result = await addRepository(hqPath, repo.path, repo.action);

      if (result.success) {
        this.log(format.success(`Repository ${result.name} added`));
        successCount++;
      } else {
        this.log(format.error(`Failed to add ${result.name}: ${result.error}`));
        failCount++;
      }
    }

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(format.success(`Added ${successCount} repository(ies)`));
    }
    if (failCount > 0) {
      this.log(format.error(`Failed to add ${failCount} repository(ies)`));
    }
  }
}
