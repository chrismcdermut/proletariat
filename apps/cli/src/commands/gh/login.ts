import { Command } from '@oclif/core';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated, getGHUsername } from '../../lib/pr/index.js';

export default class GHLogin extends Command {
  static description = 'Login to GitHub CLI for PR workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    // Check if gh is installed
    if (!isGHInstalled()) {
      this.log(chalk.red('  ✗ gh CLI not installed'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Install with Homebrew:'));
      this.log(chalk.cyan('      brew install gh'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Or see: https://cli.github.com/'));
      return;
    }

    // Check if already authenticated
    if (isGHAuthenticated()) {
      const username = getGHUsername();
      this.log(chalk.green(`Already authenticated${username ? ` as ${chalk.bold(username)}` : ''}`));
      this.log(styles.muted(''));
      this.log(styles.muted('To re-authenticate or switch accounts, run directly:'));
      this.log(chalk.cyan('  gh auth login'));
      return;
    }

    this.log(styles.muted('Starting GitHub authentication...\n'));

    // Run gh auth login interactively
    const child = spawn('gh', ['auth', 'login'], {
      stdio: 'inherit',
      shell: true,
    });

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          this.log(chalk.green('\n✓ Successfully authenticated!'));
          this.log(styles.muted(''));
          this.log(styles.muted('Next, set up GH_TOKEN for devcontainers:'));
          this.log(chalk.cyan('  prlt gh token'));
          resolve();
        } else {
          this.log(chalk.yellow('\nAuthentication cancelled or failed.'));
          resolve();
        }
      });

      child.on('error', (err) => {
        this.log(chalk.red(`\nFailed to run gh auth login: ${err.message}`));
        reject(err);
      });
    });
  }
}
