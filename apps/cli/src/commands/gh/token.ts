import { Command } from '@oclif/core';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated, isGHTokenInEnv } from '../../lib/pr/index.js';
import {
  isMachineOutput,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

export default class GHToken extends Command {
  static description = 'Show GH_TOKEN setup for devcontainer PR creation';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GHToken);

    // Check if machine output mode is active
    const jsonMode = isMachineOutput(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('gh token', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Check if gh is installed
    if (!isGHInstalled()) {
      if (jsonMode) {
        return handleError('GH_NOT_INSTALLED', 'gh CLI not installed. Install with: brew install gh');
      }
      this.log(chalk.red('  ✗ gh CLI not installed'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Install first:'));
      this.log(chalk.cyan('      brew install gh'));
      return;
    }

    // Check if gh is authenticated
    if (!isGHAuthenticated()) {
      if (jsonMode) {
        return handleError('GH_NOT_AUTHENTICATED', 'gh CLI not authenticated. Run: prlt gh login');
      }
      this.log(chalk.yellow('  ⚠ gh CLI not authenticated'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Authenticate first:'));
      this.log(chalk.cyan('      prlt gh login'));
      return;
    }

    // Detect shell
    const shell = process.env.SHELL || '/bin/zsh';
    const rcFile = shell.includes('zsh') ? '~/.zshrc' : shell.includes('bash') ? '~/.bashrc' : '~/.profile';

    // Check if already set
    if (isGHTokenInEnv()) {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            ghTokenSet: true,
            message: 'GH_TOKEN is already set in your environment',
          },
          createMetadata('gh token', flags)
        );
        return;
      }
      this.log(chalk.green('  ✓ GH_TOKEN is already set in your environment'));
      this.log(styles.muted(''));
      this.log(styles.muted('    PR creation will work in devcontainers.'));
      return;
    }

    // Get setup command
    const setupCommand = `echo 'export GH_TOKEN=$(gh auth token 2>/dev/null)' >> ${rcFile}`;
    const sourceCommand = `source ${rcFile}`;

    // In JSON mode, output setup instructions
    if (jsonMode) {
      outputSuccessAsJson(
        {
          ghTokenSet: false,
          shell,
          rcFile,
          setupCommand,
          sourceCommand,
          message: 'GH_TOKEN not set. Follow setup instructions to enable PR creation from devcontainers.',
        },
        createMetadata('gh token', flags)
      );
      return;
    }

    this.log(chalk.yellow('  ⚠ GH_TOKEN not set'));
    this.log(styles.muted(''));
    this.log(styles.muted('    To enable PR creation from devcontainers, add this to your shell profile:'));
    this.log(styles.muted(''));
    this.log(chalk.cyan(`      ${setupCommand}`));
    this.log(styles.muted(''));
    this.log(styles.muted('    Then restart your terminal or run:'));
    this.log(chalk.cyan(`      ${sourceCommand}`));
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
