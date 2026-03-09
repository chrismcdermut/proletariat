import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  removeRepository,
  getWorkspaceRepoInfo
} from '../../lib/repos/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('repo remove', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      return handleError('NOT_IN_HQ', 'Not in an HQ directory. Run "prlt new" first.');
    }

    // Bulk mode: remove multiple repositories interactively
    if (flags.bulk) {
      await this.executeBulk(hqPath, flags.force, flags['keep-files'], jsonMode, flags);
      return;
    }

    let repoName: string | null = args.name || null;

    // Interactive selection if no name provided
    if (!repoName) {
      const { repositories } = getWorkspaceRepoInfo();
      if (repositories.length === 0) {
        return handleError('NO_REPOSITORIES', 'No repositories found.');
      }

      // Use selectFromList helper for JSON mode support
      const selected = await this.selectFromList({
        message: 'Select repository to remove:',
        items: repositories,
        getName: (r) => r.name,
        getValue: (r) => r.name,
        getCommand: (r) => `prlt repo remove ${r.name} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'repo remove' } : null,
      });

      if (!selected) {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }
      repoName = selected;
    }

    // Validate repository exists
    const { repositories } = getWorkspaceRepoInfo();
    const repo = repositories.find(r => r.name === repoName);
    if (!repo) {
      return handleError('REPO_NOT_FOUND', `Repository "${repoName}" not found.`);
    }

    // Confirmation unless --force
    if (!flags.force) {
      const agentConfig = jsonMode ? { flags, commandName: 'repo remove' } : null;

      this.log(colors.warning('\n⚠️  This will:'));
      this.log(colors.text(`  • Remove repos/${repoName} directory`));
      this.log(colors.text('  • Remove agent worktrees for this repo'));
      this.log(colors.text('  • Update database\n'));

      const { confirm } = await this.prompt<{ confirm: string }>([{
        type: 'list',
        name: 'confirm',
        message: `Are you sure you want to remove "${repoName}"?`,
        choices: [
          { name: 'No, cancel', value: 'false', command: '' },
          { name: 'Yes, remove repository', value: 'true', command: `prlt repo remove ${repoName} --force --json` },
        ],
      }], agentConfig);

      if (confirm !== 'true') {
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
  private async executeBulk(hqPath: string, force: boolean, keepFiles: boolean, jsonMode = false, flags: Record<string, unknown> = {}): Promise<void> {
    const { repositories } = getWorkspaceRepoInfo();
    if (repositories.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_REPOSITORIES', 'No repositories found.', createMetadata('repo remove', flags));
        this.exit(1);
      }
      this.error('No repositories found.');
    }

    // Only show header in interactive mode
    if (!jsonMode) {
      this.log(colors.primary('📦 Remove Repositories (Bulk Mode)\n'));
    }

    // Use prompt for JSON mode support
    const agentConfig = jsonMode ? { flags, commandName: 'repo remove --bulk' } : null;

    const { selectedRepos } = await this.prompt<{ selectedRepos: string[] }>([{
      type: 'checkbox',
      name: 'selectedRepos',
      message: 'Select repositories to remove:',
      choices: repositories.map(r => ({
        name: r.name,
        value: r.name,
        command: `prlt repo remove ${r.name} --json`,
      })),
    }], agentConfig);

    if (!selectedRepos || selectedRepos.length === 0) {
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

      const { confirm } = await this.prompt<{ confirm: string }>([{
        type: 'list',
        name: 'confirm',
        message: 'Are you sure?',
        choices: [
          { name: 'No, cancel', value: 'false', command: '' },
          { name: 'Yes, remove repositories', value: 'true', command: `prlt repo remove ${selectedRepos.join(' ')} --force --json` },
        ],
      }], agentConfig);

      if (confirm !== 'true') {
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

      // eslint-disable-next-line no-await-in-loop -- Sequential remove with user feedback
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
