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
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Add);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('repo add', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      return handleError('NOT_IN_HQ', 'Not in an HQ directory. Run "prlt init" first.');
    }

    // Bulk mode: add multiple repositories interactively
    if (flags.bulk) {
      // In JSON mode, output guidance
      if (jsonMode) {
        const agentConfig = { flags, commandName: 'repo add --bulk' };
        await this.prompt<{ method: string }>([{
          type: 'list',
          name: 'method',
          message: 'Bulk mode requires interactive selection. Use one of these instead:',
          choices: [
            { name: 'Add single repository by path', value: 'path', command: 'prlt repo add <path> --json' },
            { name: 'Add by Git URL', value: 'url', command: 'prlt repo add <git-url> --json' },
          ],
        }], agentConfig);
        return;
      }
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
      // In JSON mode, output prompt for method selection
      if (jsonMode) {
        const agentConfig = { flags, commandName: 'repo add' };
        await this.prompt<{ method: string }>([{
          type: 'list',
          name: 'method',
          message: 'How would you like to add a repository?',
          choices: [
            { name: 'Enter path or Git URL', value: 'manual', command: 'prlt repo add <path> --json' },
            { name: 'Search for repositories (bulk)', value: 'search', command: 'prlt repo add --bulk --json' },
          ],
        }], agentConfig);
        return;
      }

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
