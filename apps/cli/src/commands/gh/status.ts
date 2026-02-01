import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated, getGHUsername, isGHTokenInEnv } from '../../lib/pr/index.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class GHStatus extends Command {
  static description = 'Check GitHub CLI status for PR workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GHStatus);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Gather status information
    const ghInstalled = isGHInstalled();
    const ghAuthenticated = ghInstalled && isGHAuthenticated();
    const username = ghAuthenticated ? getGHUsername() : null;
    const ghTokenSet = isGHTokenInEnv();

    // In JSON mode, output status as JSON
    if (jsonMode) {
      outputSuccessAsJson(
        {
          ghInstalled,
          ghAuthenticated,
          username,
          ghTokenSet,
          ready: ghInstalled && ghAuthenticated && ghTokenSet,
        },
        createMetadata('gh status', flags)
      );
      return;
    }

    this.log(styles.muted('Checking GitHub CLI status...\n'));

    // Check if gh is installed
    if (!ghInstalled) {
      this.log(chalk.red('  ✗ gh CLI not installed'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Install with Homebrew:'));
      this.log(chalk.cyan('      brew install gh'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Or see: https://cli.github.com/'));
      return;
    }
    this.log(chalk.green('  ✓ gh CLI installed'));

    // Check if gh is authenticated
    if (!ghAuthenticated) {
      this.log(chalk.yellow('  ⚠ gh CLI not authenticated'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Run to authenticate:'));
      this.log(chalk.cyan('      prlt gh login'));
      this.log(styles.muted(''));
      return;
    }

    this.log(chalk.green(`  ✓ Authenticated${username ? ` as ${chalk.bold(username)}` : ''}`));

    // Check if GH_TOKEN is available for devcontainers
    if (ghTokenSet) {
      this.log(chalk.green('  ✓ GH_TOKEN available for devcontainers'));
      this.log(styles.muted(''));
      this.log(chalk.green('All set! PR creation will work in both host and devcontainers.'));
    } else {
      this.log(chalk.yellow('  ⚠ GH_TOKEN not set'));
      this.log(styles.muted(''));
      this.log(styles.muted('    PR creation works on host, but not in devcontainers.'));
      this.log(styles.muted('    Run to see setup instructions:'));
      this.log(chalk.cyan('      prlt gh token'));
    }
  }
}
