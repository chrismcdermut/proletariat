import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptSelectRepo,
  promptSelectMultipleRepos,
  removeRepository,
  getWorkspaceRepoInfo
} from '../../lib/repos/index.js';

export default class Remove extends PMOCommand {
  static description = 'Remove a repository from the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-repo',
    '<%= config.bin %> <%= command.id %> my-repo --force',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --bulk',
  ];

  static args = {
    name: Args.string({
      description: 'Repository name to remove',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    'keep-files': Flags.boolean({
      description: 'Remove from database but keep files',
      default: false,
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Remove multiple repositories interactively',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
    }

    // Bulk mode: remove multiple repositories interactively
    if (flags.bulk) {
      await this.executeBulk(hqPath, flags.force, flags['keep-files']);
      return;
    }

    let repoName: string | null = args.name || null;

    // Interactive selection if no name provided
    if (!repoName) {
      repoName = await promptSelectRepo('Select repository to remove:');
      if (!repoName) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
    }

    // Validate repository exists
    const { repositories } = getWorkspaceRepoInfo();
    const repo = repositories.find(r => r.name === repoName);
    if (!repo) {
      this.error(`Repository "${repoName}" not found.`);
    }

    // Confirmation unless --force
    if (!flags.force) {
      this.log(colors.warning('\n⚠️  This will:'));
      this.log(colors.text(`  • Remove repos/${repoName} directory`));
      this.log(colors.text('  • Remove agent worktrees for this repo'));
      this.log(colors.text('  • Update database\n'));

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: `Are you sure you want to remove "${repoName}"?`,
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '⚠️  Yes, remove repository', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(colors.textMuted('Removal cancelled.'));
        return;
      }
    }

    // Remove the repository
    this.log(colors.primary(`\nRemoving repository "${repoName}"...`));

    const result = await removeRepository(hqPath, repoName, flags['keep-files']);

    if (result.success) {
      this.log(format.success(`Repository ${repoName} removed`));
    } else {
      this.error(`Failed to remove repository: ${result.error}`);
    }
  }

  /**
   * Bulk mode: remove multiple repositories interactively
   */
  private async executeBulk(hqPath: string, force: boolean, keepFiles: boolean): Promise<void> {
    this.log(colors.primary('📦 Remove Repositories (Bulk Mode)\n'));

    // Select repositories to remove
    const selectedRepos = await promptSelectMultipleRepos('Select repositories to remove:');

    if (selectedRepos.length === 0) {
      this.log(colors.textMuted('No repositories selected.'));
      return;
    }

    // Confirmation unless --force
    if (!force) {
      this.log(colors.warning('\n⚠️  This will permanently delete:'));
      for (const name of selectedRepos) {
        this.log(colors.text(`  • repos/${name}`));
      }
      this.log(colors.text('  • Agent worktrees for these repos\n'));

      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Are you sure?',
        choices: [
          { name: '❌ No, cancel', value: false },
          { name: '⚠️  Yes, remove repositories', value: true }
        ],
        default: 0
      }]);

      if (!confirm) {
        this.log(colors.textMuted('Removal cancelled.'));
        return;
      }
    }

    this.log('');

    // Remove each repository
    let successCount = 0;
    let failCount = 0;

    for (const repoName of selectedRepos) {
      this.log(colors.textMuted(`Removing ${repoName}...`));

      const result = await removeRepository(hqPath, repoName, keepFiles);

      if (result.success) {
        this.log(format.success(`Removed ${repoName}`));
        successCount++;
      } else {
        this.log(format.error(`Failed to remove ${repoName}: ${result.error}`));
        failCount++;
      }
    }

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(format.success(`Removed ${successCount} repository(ies)`));
    }
    if (failCount > 0) {
      this.log(format.error(`Failed to remove ${failCount} repository(ies)`));
    }
  }
}
