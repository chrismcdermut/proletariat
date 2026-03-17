import { Command } from '@oclif/core';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { styles } from '../../lib/styles.js';
import { isGHInstalled, isGHAuthenticated, getGHUsername } from '../../lib/pr/index.js';
import {
  isMachineOutput,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { trackChildProcess } from '../../lib/signal-handler.js';

export default class GHLogin extends Command {
  static description = 'Login to GitHub CLI for PR workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GHLogin);

    // Check if machine output mode is active
    const jsonMode = isMachineOutput(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('gh login', flags));
        return
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
      this.log(styles.muted('    Install with Homebrew:'));
      this.log(chalk.cyan('      brew install gh'));
      this.log(styles.muted(''));
      this.log(styles.muted('    Or see: https://cli.github.com/'));
      return;
    }

    // Check if already authenticated
    if (isGHAuthenticated()) {
      const username = getGHUsername();
      if (jsonMode) {
        outputSuccessAsJson(
          {
            authenticated: true,
            username: username || null,
            message: 'Already authenticated',
          },
          createMetadata('gh login', flags)
        );
        return;
      }
      this.log(chalk.green(`Already authenticated${username ? ` as ${chalk.bold(username)}` : ''}`));
      this.log(styles.muted(''));
      this.log(styles.muted('To re-authenticate or switch accounts, run directly:'));
      this.log(chalk.cyan('  gh auth login'));
      return;
    }

    // In JSON mode, we can't run interactive login - return error
    if (jsonMode) {
      return handleError('REQUIRES_INTERACTIVE', 'gh login requires interactive authentication. Run: gh auth login');
    }

    this.log(styles.muted('Starting GitHub authentication...\n'));

    // Run gh auth login interactively - track for cleanup on Ctrl+C
    const child = spawn('gh', ['auth', 'login'], {
      stdio: 'inherit',
      shell: true,
    });

    trackChildProcess(child);

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
