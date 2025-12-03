import { Command, Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptSelectRepo,
  removeRepository,
  getWorkspaceRepoInfo
} from '../../lib/repos/index.js';

export default class Remove extends Command {
  static description = 'Remove a repository from the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-repo',
    '<%= config.bin %> <%= command.id %> my-repo --force',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Repository name to remove',
      required: false,
    }),
  };

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    'keep-files': Flags.boolean({
      description: 'Remove from database but keep files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Remove);

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
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
}
