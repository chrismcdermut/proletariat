import { Command } from '@oclif/core';
import { colors, format } from '../../lib/colors.js';
import {
  findHQRoot,
  promptForRepositories,
  addRepository
} from '../../lib/repos/index.js';
import { getWorkspaceRepositories } from '../../lib/database/index.js';

export default class Add extends Command {
  static description = 'Add multiple repositories to the HQ';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    // Find HQ root
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt init" first.');
    }

    this.log(colors.primary('📦 Add Repositories\n'));

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
