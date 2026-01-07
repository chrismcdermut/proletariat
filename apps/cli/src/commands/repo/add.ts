import { Command, Args, Flags } from '@oclif/core';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptAddSingleRepo,
  addRepository
} from '../../lib/repos/index.js';

export default class Add extends Command {
  static description = 'Add a repository to the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/repo',
    '<%= config.bin %> <%= command.id %> git@github.com:user/repo.git',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    path: Args.string({
      description: 'Repository path or Git URL',
      required: false,
    }),
  };

  static flags = {
    action: Flags.string({
      char: 'a',
      description: 'Action for local paths',
      options: ['clone', 'move'],
      default: 'clone',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Add);

    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
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
}
