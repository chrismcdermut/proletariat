import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptSelectMultipleRepos,
  removeRepository,
} from '../../lib/repos/index.js';

export default class Remove extends PMOCommand {
  static description = 'Remove multiple repositories from the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Remove);

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
    }

    this.log(colors.primary('📦 Remove Repositories\n'));

    // Select repositories to remove
    const selectedRepos = await promptSelectMultipleRepos('Select repositories to remove:');

    if (selectedRepos.length === 0) {
      this.log(colors.textMuted('No repositories selected.'));
      return;
    }

    // Confirmation unless --force
    if (!flags.force) {
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

      const result = await removeRepository(hqPath, repoName);

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
