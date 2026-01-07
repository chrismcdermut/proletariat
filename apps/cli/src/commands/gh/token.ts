import { Command } from '@oclif/core';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated, isGHTokenInEnv } from '../../lib/pr/index.js';

export default class GHToken extends Command {
  static description = 'Show GH_TOKEN setup for devcontainer PR creation';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    // Check if gh is installed
    if (!isGHInstalled()) {
      this.log(chalk.red('  ✗ gh CLI not installed'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Install first:'));
      this.log(chalk.cyan('      brew install gh'));
      return;
    }

    // Check if gh is authenticated
    if (!isGHAuthenticated()) {
      this.log(chalk.yellow('  ⚠ gh CLI not authenticated'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Authenticate first:'));
      this.log(chalk.cyan('      prlt gh login'));
      return;
    }

    // Check if already set
    if (isGHTokenInEnv()) {
      this.log(chalk.green('  ✓ GH_TOKEN is already set in your environment'));
      this.log(styles.muted(''));
      this.log(styles.muted('    PR creation will work in devcontainers.'));
      return;
    }

    // Detect shell
    const shell = process.env.SHELL || '/bin/zsh';
    const rcFile = shell.includes('zsh') ? '~/.zshrc' : shell.includes('bash') ? '~/.bashrc' : '~/.profile';

    this.log(chalk.yellow('  ⚠ GH_TOKEN not set'));
    this.log(styles.muted(''));
    this.log(styles.muted('    To enable PR creation from devcontainers, add this to your shell profile:'));
    this.log(styles.muted(''));
    this.log(chalk.cyan(`      echo 'export GH_TOKEN=$(gh auth token 2>/dev/null)' >> ${rcFile}`));
    this.log(styles.muted(''));
    this.log(styles.muted('    Then restart your terminal or run:'));
    this.log(chalk.cyan(`      source ${rcFile}`));
    this.log(styles.muted(''));

    // Show current token (masked) for verification
    try {
      const token = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (token) {
        const masked = token.substring(0, 4) + '...' + token.substring(token.length - 4);
        this.log(styles.muted(`    Your current gh token: ${masked}`));
      }
    } catch {
      // Ignore - token retrieval might fail
    }
  }
}
